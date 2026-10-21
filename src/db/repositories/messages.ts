import type { SQLiteDatabase } from 'expo-sqlite';

import type { MessageRow } from '@/db/types';

export type AppendMessageInput = Omit<MessageRow, 'sequenceNo'>;

export async function upsertMessage(db: SQLiteDatabase, row: MessageRow) {
  await db.runAsync(
    'INSERT INTO messages ' +
      '(id, novel_id, world_id, role, content, reasoning_content, status, created_at, updated_at, prompt_tokens, ' +
      'completion_tokens, model_id, sequence_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET content = excluded.content, status = excluded.status, ' +
      'reasoning_content = excluded.reasoning_content, updated_at = excluded.updated_at, prompt_tokens = excluded.prompt_tokens, ' +
      'completion_tokens = excluded.completion_tokens, model_id = excluded.model_id, ' +
      'sequence_no = excluded.sequence_no',
    row.id,
    row.novelId,
    row.worldId ?? 'legacy',
    row.role,
    row.content,
    // reasoning_content was added as a NOT NULL column in migration v13.
    // UI messages legitimately omit reasoning when the model does not expose
    // a thinking trace, so persist the schema-compatible empty value instead
    // of binding NULL (which native SQLite rejects during statement finalize).
    row.reasoningContent ?? '',
    row.status,
    row.createdAt,
    row.updatedAt,
    row.promptTokens,
    row.completionTokens,
    row.modelId,
    row.sequenceNo,
  );
}


async function inTransaction<T>(db: SQLiteDatabase, task: (transaction: SQLiteDatabase) => Promise<T>) {
  const exclusive = db as SQLiteDatabase & {
    withExclusiveTransactionAsync?: (callback: (transaction: SQLiteDatabase) => Promise<void>) => Promise<void>;
  };
  if (typeof exclusive.withExclusiveTransactionAsync === 'function') {
    let result!: T;
    await exclusive.withExclusiveTransactionAsync(async (transaction) => {
      result = await task(transaction);
    });
    return result;
  }
  if (typeof db.withTransactionAsync === 'function') {
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task(db);
    });
    return result;
  }
  return task(db);
}

/** Append a message exactly once and allocate its sequence in SQLite. */
export async function appendMessage(db: SQLiteDatabase, row: AppendMessageInput) {
  return inTransaction(db, async (transaction) => {
    const existing = await transaction.getFirstAsync<Pick<MessageRow, 'id' | 'sequenceNo'>>(
      'SELECT id, sequence_no AS sequenceNo FROM messages WHERE id = ?',
      row.id,
    );
    if (existing) return existing.sequenceNo;

    const next = await transaction.getFirstAsync<{ sequenceNo: number }>(
      'SELECT COALESCE(MAX(sequence_no), -1) + 1 AS sequenceNo FROM messages WHERE novel_id = ? AND world_id = ?',
      row.novelId,
      row.worldId ?? 'legacy',
    );
    const sequenceNo = Number(next?.sequenceNo ?? 0);
    await upsertMessage(transaction, { ...row, sequenceNo });
    return sequenceNo;
  });
}

export async function getMessageById(db: SQLiteDatabase, messageId: string) {
  return db.getFirstAsync<MessageRow>(
    'SELECT id, novel_id AS novelId, role, content, reasoning_content AS reasoningContent, status, created_at AS createdAt, ' +
      'updated_at AS updatedAt, prompt_tokens AS promptTokens, ' +
      'completion_tokens AS completionTokens, model_id AS modelId, sequence_no AS sequenceNo ' +
      'FROM messages WHERE id = ?',
    messageId,
  );
}


export async function deleteMessage(db: SQLiteDatabase, messageId: string) {
  await db.runAsync('DELETE FROM messages WHERE id = ?', messageId);
}

export async function listMessagesByStatus(
  db: SQLiteDatabase,
  statuses: string[] = ['streaming', 'error'],
  limit = 500,
  novelId?: string,
) {
  const safeStatuses = statuses.filter((status) => status.trim()).slice(0, 8);
  if (!safeStatuses.length) return [] as MessageRow[];
  const placeholders = safeStatuses.map(() => '?').join(', ');
  const novelClause = novelId ? ' AND novel_id = ?' : '';
  const params: (string | number)[] = [...safeStatuses];
  if (novelId) params.push(novelId);
  params.push(Math.max(1, Math.min(1000, Math.round(limit))));
  return db.getAllAsync<MessageRow>(
    'SELECT id, novel_id AS novelId, role, content, reasoning_content AS reasoningContent, status, created_at AS createdAt, ' +
      'updated_at AS updatedAt, prompt_tokens AS promptTokens, completion_tokens AS completionTokens, ' +
      'model_id AS modelId, sequence_no AS sequenceNo FROM messages ' +
      `WHERE status IN (${placeholders})${novelClause} ORDER BY updated_at DESC LIMIT ?`,
    ...params,
  );
}


export async function listMessagePage(
  db: SQLiteDatabase,
  novelId: string,
  options?: { limit?: number; beforeSequenceNo?: number; afterSequenceNo?: number },
) {
  const limit = Math.max(1, Math.min(200, Math.round(options?.limit ?? 50)));
  const before = options?.beforeSequenceNo;
  const after = options?.afterSequenceNo;
  if (typeof before === 'number' && typeof after === 'number') {
    throw new Error('beforeSequenceNo and afterSequenceNo are mutually exclusive');
  }
  if (typeof before === 'number' && Number.isFinite(before)) {
    return db.getAllAsync<MessageRow>(
      'SELECT id, novel_id AS novelId, role, content, reasoning_content AS reasoningContent, status, created_at AS createdAt, ' +
        'updated_at AS updatedAt, prompt_tokens AS promptTokens, ' +
        'completion_tokens AS completionTokens, model_id AS modelId, sequence_no AS sequenceNo ' +
        'FROM messages WHERE novel_id = ? AND sequence_no < ? ' +
        'ORDER BY sequence_no DESC LIMIT ?',
      novelId,
      Math.max(0, Math.floor(before)),
      limit,
    );
  }
  if (typeof after === 'number' && Number.isFinite(after)) {
    return db.getAllAsync<MessageRow>(
      'SELECT id, novel_id AS novelId, role, content, reasoning_content AS reasoningContent, status, created_at AS createdAt, ' +
        'updated_at AS updatedAt, prompt_tokens AS promptTokens, ' +
        'completion_tokens AS completionTokens, model_id AS modelId, sequence_no AS sequenceNo ' +
        'FROM messages WHERE novel_id = ? AND sequence_no > ? ' +
        'ORDER BY sequence_no ASC LIMIT ?',
      novelId,
      Math.floor(after),
      limit,
    );
  }
  return db.getAllAsync<MessageRow>(
    'SELECT id, novel_id AS novelId, role, content, reasoning_content AS reasoningContent, status, created_at AS createdAt, ' +
      'updated_at AS updatedAt, prompt_tokens AS promptTokens, ' +
      'completion_tokens AS completionTokens, model_id AS modelId, sequence_no AS sequenceNo ' +
      'FROM messages WHERE novel_id = ? ORDER BY sequence_no DESC LIMIT ?',
    novelId,
    limit,
  );
}

/** World-scoped message paging used by quick-travel novels. */
export async function listMessagePageByWorld(
  db: SQLiteDatabase,
  novelId: string,
  worldId: string,
  options?: { limit?: number; beforeSequenceNo?: number; afterSequenceNo?: number },
) {
  const limit = Math.max(1, Math.min(200, Math.round(options?.limit ?? 50)));
  const before = options?.beforeSequenceNo;
  const after = options?.afterSequenceNo;
  const base = 'SELECT id, novel_id AS novelId, world_id AS worldId, role, content, reasoning_content AS reasoningContent, status, created_at AS createdAt, updated_at AS updatedAt, prompt_tokens AS promptTokens, completion_tokens AS completionTokens, model_id AS modelId, sequence_no AS sequenceNo FROM messages WHERE novel_id = ? AND world_id = ?';
  if (typeof before === 'number' && Number.isFinite(before)) {
    return db.getAllAsync<MessageRow>(`${base} AND sequence_no < ? ORDER BY sequence_no DESC LIMIT ?`, novelId, worldId, Math.floor(before), limit);
  }
  if (typeof after === 'number' && Number.isFinite(after)) {
    return db.getAllAsync<MessageRow>(`${base} AND sequence_no > ? ORDER BY sequence_no ASC LIMIT ?`, novelId, worldId, Math.floor(after), limit);
  }
  return db.getAllAsync<MessageRow>(`${base} ORDER BY sequence_no DESC LIMIT ?`, novelId, worldId, limit);
}

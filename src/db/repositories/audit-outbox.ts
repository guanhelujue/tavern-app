import type { SQLiteDatabase } from 'expo-sqlite';

export type AuditOutboxRow = {
  id: string;
  novelId: string;
  canonRevision: number;
  jobType: string;
  jobKey: string;
  payloadJson: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  attempts: number;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
};

const COLUMNS =
  'id, novel_id AS novelId, canon_revision AS canonRevision, job_type AS jobType, ' +
  'job_key AS jobKey, payload_json AS payloadJson, status, attempts, ' +
  'available_at AS availableAt, created_at AS createdAt, updated_at AS updatedAt';

export async function listRunnableAuditJobs(
  db: SQLiteDatabase,
  now: string,
  limit = 10,
  jobType?: string,
) {
  const typeClause = jobType ? ' AND job_type = ?' : '';
  const params: (string | number)[] = [now];
  if (jobType) params.push(jobType);
  params.push(Math.max(1, Math.min(50, Math.round(limit))));
  return db.getAllAsync<AuditOutboxRow>(
    `SELECT ${COLUMNS} FROM audit_outbox ` +
      "WHERE status IN ('pending', 'failed') AND available_at <= ?" + typeClause + ' ' +
      'ORDER BY canon_revision ASC, created_at ASC LIMIT ?',
    ...params,
  );
}

/** Guarded claim: only one worker can transition a runnable job to running. */
export async function claimAuditJob(
  db: SQLiteDatabase,
  jobId: string,
  now: string,
) {
  const result = await db.runAsync(
    "UPDATE audit_outbox SET status = 'running', attempts = attempts + 1, updated_at = ? " +
      "WHERE id = ? AND status IN ('pending', 'failed') AND available_at <= ?",
    now,
    jobId,
    now,
  );
  return result.changes === 1;
}

export async function completeAuditJob(db: SQLiteDatabase, jobId: string, now: string) {
  await db.runAsync(
    "UPDATE audit_outbox SET status = 'complete', updated_at = ? WHERE id = ? AND status = 'running'",
    now,
    jobId,
  );
}

export async function failAuditJob(
  db: SQLiteDatabase,
  jobId: string,
  now: string,
  retryAt: string,
) {
  await db.runAsync(
    "UPDATE audit_outbox SET status = 'failed', available_at = ?, updated_at = ? " +
      "WHERE id = ? AND status = 'running'",
    retryAt,
    now,
    jobId,
  );
}

/** App restart recovery: running means the prior JS worker died before acknowledgement. */
export async function recoverInterruptedAuditJobs(db: SQLiteDatabase, now: string) {
  const result = await db.runAsync(
    "UPDATE audit_outbox SET status = 'failed', available_at = ?, updated_at = ? WHERE status = 'running'",
    now,
    now,
  );
  return result.changes;
}

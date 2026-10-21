import { getAppDatabase } from '@/db/database';
import { listMessagesByStatus } from '@/db/repositories/messages';
import { appendStoryEventInTransaction } from '@/db/repositories/story-events';
import { projectStoryEventInTransaction } from '@/services/novel-story-projection';
import { recoverInterruptedAuditJobs } from '@/db/repositories/audit-outbox';
import type { MessageRow } from '@/db/types';

export type NovelRecoveryItem = MessageRow & {
  action: 'save_partial' | 'abandon';
};

export async function scanNovelRecovery(): Promise<NovelRecoveryItem[]> {
  const db = await getAppDatabase();
  await recoverInterruptedAuditJobs(db, new Date().toISOString());
  // Only an assistant left in streaming state represents an interrupted
  // request. Historical error/cancelled messages are normal editable content
  // and should not mark the whole novel as requiring recovery on every boot.
  const rows = await listMessagesByStatus(db, ['streaming'], 500);
  return rows.filter((row) => row.role === 'assistant').map((row) => ({
    ...row,
    action: 'save_partial',
  }));
}

async function resolveNovelRequest(item: NovelRecoveryItem, status: 'complete' | 'cancelled') {
  const db = await getAppDatabase();
  const updatedAt = new Date().toISOString();
  const recoveryAction = status === 'complete' ? 'save_partial' : 'abandon';
  const eventId = `${item.id}:recovery:${recoveryAction}`;
  const event = {
    id: eventId,
    novelId: item.novelId,
    chapterId: null,
    eventType: `message:${item.role}`,
    payloadJson: JSON.stringify({ messageId: item.id, role: item.role, status, recoveryAction, contentPreview: item.content.trim().slice(0, 1200), facts: [] }),
    sourceMessageId: item.id,
    createdAt: updatedAt,
  };
  const exclusive = db as typeof db & { withExclusiveTransactionAsync?: (callback: (tx: typeof db) => Promise<void>) => Promise<void> };
  let changed = false;
  const work = async (tx: typeof db) => {
    const result = await tx.runAsync(
      'UPDATE messages SET status = ?, updated_at = ? WHERE id = ? AND novel_id = ? AND role = ? AND status = ? AND updated_at = ?',
      status, updatedAt, item.id, item.novelId, 'assistant', 'streaming', item.updatedAt,
    );
    changed = Number(result.changes ?? 0) === 1;
    if (!changed) return;
    const sequence = await appendStoryEventInTransaction(tx, event);
    await projectStoryEventInTransaction(tx, { ...event, sequence });
  };
  if (typeof exclusive.withExclusiveTransactionAsync === 'function') await exclusive.withExclusiveTransactionAsync(work);
  else if (typeof db.withTransactionAsync === 'function') await db.withTransactionAsync(() => work(db));
  else await work(db);
  return changed ? { changed: true, updatedAt } : { changed: false, updatedAt: item.updatedAt };
}

export async function savePartialNovelRequest(item: NovelRecoveryItem) {
  if (!item.content.trim() || item.content.trim() === '正在生成回复...') return { changed: false, updatedAt: item.updatedAt };
  return resolveNovelRequest(item, 'complete');
}

export async function abandonNovelRequest(item: NovelRecoveryItem) {
  return resolveNovelRequest(item, 'cancelled');
}

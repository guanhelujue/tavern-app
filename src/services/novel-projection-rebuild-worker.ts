import { getAppDatabase } from '@/db/database';
import {
  claimAuditJob,
  completeAuditJob,
  failAuditJob,
  listRunnableAuditJobs,
} from '@/db/repositories/audit-outbox';
import { rebuildNovelStoryProjection } from '@/services/novel-story-projection';

/** Process only local projection jobs; network-backed audit jobs use a separate worker. */
export async function processProjectionRebuildJobs(limit = 1) {
  const db = await getAppDatabase();
  const now = new Date();
  const jobs = await listRunnableAuditJobs(
    db,
    now.toISOString(),
    limit,
    'projection-rebuild',
  );
  let completed = 0;
  for (const job of jobs) {
    if (!(await claimAuditJob(db, job.id, now.toISOString()))) continue;
    try {
      await rebuildNovelStoryProjection(job.novelId);
      await completeAuditJob(db, job.id, new Date().toISOString());
      completed += 1;
    } catch (error) {
      const failedAt = new Date();
      await failAuditJob(
        db,
        job.id,
        failedAt.toISOString(),
        new Date(failedAt.getTime() + 30_000).toISOString(),
      );
      throw error;
    }
  }
  return { scanned: jobs.length, completed };
}

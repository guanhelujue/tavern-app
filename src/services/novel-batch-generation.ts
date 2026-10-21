import type { NovelRewriteAudit } from '@/types/tavern';

export function clampBatchChapterCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.round(value)));
}

/** A batch must stop when the latest audit is not a clean pass or has a critical issue. */
export function getBatchAuditRisk(audit: NovelRewriteAudit | undefined): 'none' | 'high' {
  if (!audit) return 'none';
  return !audit.passed || audit.issues.some((issue) => issue.severity === 'critical')
    ? 'high'
    : 'none';
}

export function getLatestChapterAudit(
  audits: NovelRewriteAudit[] | undefined,
  chapterId: string,
): NovelRewriteAudit | undefined {
  return audits
    ?.filter((audit) => audit.chapterId === chapterId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}


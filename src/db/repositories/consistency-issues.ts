import type { SQLiteDatabase } from 'expo-sqlite';

export type ConsistencyIssueStatus = 'open' | 'acknowledged' | 'resolved' | 'superseded';

export type ConsistencyIssueRow = {
  id: string;
  auditRunId: string;
  novelId: string;
  canonRevision: number;
  chapterId: string | null;
  category: string;
  severity: 'critical' | 'warning' | 'info';
  subject: string | null;
  evidence: string[];
  suggestion: string;
  status: ConsistencyIssueStatus;
  createdAt: string;
  resolvedAt: string | null;
};

export type ConsistencyAuditRunRow = {
  id: string;
  canonRevision: number;
  kind: string;
  modelId: string | null;
  status: 'running' | 'complete' | 'failed';
  summary: string;
  createdAt: string;
  completedAt: string | null;
};

type RawIssueRow = Omit<ConsistencyIssueRow, 'evidence'> & { evidenceJson: string };

function parseEvidence(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function listConsistencyIssues(
  db: SQLiteDatabase,
  novelId: string,
  options: { status?: ConsistencyIssueStatus | 'active'; limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(500, options.limit ?? 100));
  const statusClause = options.status === 'active'
    ? " AND status IN ('open', 'acknowledged')"
    : options.status
      ? ' AND status = ?'
      : '';
  const params: (string | number)[] = [novelId];
  if (options.status && options.status !== 'active') params.push(options.status);
  params.push(limit);
  const rows = await db.getAllAsync<RawIssueRow>(
    'SELECT id, audit_run_id AS auditRunId, novel_id AS novelId, canon_revision AS canonRevision, ' +
      'chapter_id AS chapterId, category, severity, subject, evidence_json AS evidenceJson, suggestion, ' +
      'status, created_at AS createdAt, resolved_at AS resolvedAt FROM consistency_issues ' +
      'WHERE novel_id = ?' + statusClause +
      " ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, " +
      "CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, canon_revision DESC LIMIT ?",
    ...params,
  );
  return rows.map(({ evidenceJson, ...row }) => ({ ...row, evidence: parseEvidence(evidenceJson) }));
}

export async function listConsistencyAuditRuns(db: SQLiteDatabase, novelId: string, limit = 20) {
  return db.getAllAsync<ConsistencyAuditRunRow>(
    'SELECT id, canon_revision AS canonRevision, kind, model_id AS modelId, status, summary, ' +
      'created_at AS createdAt, completed_at AS completedAt FROM audit_runs ' +
      'WHERE novel_id = ? ORDER BY canon_revision DESC, created_at DESC LIMIT ?',
    novelId,
    Math.max(1, Math.min(100, limit)),
  );
}

export async function updateConsistencyIssueStatus(
  db: SQLiteDatabase,
  novelId: string,
  issueId: string,
  nextStatus: Exclude<ConsistencyIssueStatus, 'open'>,
  now: string,
) {
  const allowedCurrent = nextStatus === 'acknowledged'
    ? "status = 'open'"
    : "status IN ('open', 'acknowledged')";
  const result = await db.runAsync(
    `UPDATE consistency_issues SET status = ?, resolved_at = ? WHERE id = ? AND novel_id = ? AND ${allowedCurrent}`,
    nextStatus,
    nextStatus === 'acknowledged' ? null : now,
    issueId,
    novelId,
  );
  return result.changes === 1;
}

export async function supersedeStaleConsistencyIssues(
  db: SQLiteDatabase,
  novelId: string,
  canonRevision: number,
  now: string,
) {
  const result = await db.runAsync(
    "UPDATE consistency_issues SET status = 'superseded', resolved_at = ? " +
      "WHERE novel_id = ? AND canon_revision < ? AND status IN ('open', 'acknowledged')",
    now,
    novelId,
    canonRevision,
  );
  return result.changes;
}

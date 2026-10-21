import type { SQLiteDatabase } from 'expo-sqlite';

import { getAppDatabase } from '@/db/database';
import {
  claimAuditJob,
  completeAuditJob,
  failAuditJob,
  listRunnableAuditJobs,
  type AuditOutboxRow,
} from '@/db/repositories/audit-outbox';
import { listActiveStoryFacts } from '@/db/repositories/story-facts';
import type { LlmCompletion } from '@/services/novel-story-state';

type AuditIssue = {
  category: 'character' | 'world' | 'hook' | 'timeline' | 'plot' | 'entity';
  severity: 'critical' | 'warning' | 'info';
  subject?: string;
  evidence: string;
  suggestion: string;
};

function parseIssues(content: string): { summary: string; issues: AuditIssue[] } {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('审计模型未返回 JSON。');
  const value = JSON.parse(content.slice(start, end + 1)) as { summary?: unknown; issues?: unknown[] };
  const allowedCategory = new Set(['character', 'world', 'hook', 'timeline', 'plot', 'entity']);
  const allowedSeverity = new Set(['critical', 'warning', 'info']);
  const issues = (value.issues ?? []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (!allowedCategory.has(String(row.category)) || !allowedSeverity.has(String(row.severity))) return [];
    if (typeof row.evidence !== 'string' || !row.evidence.trim()) return [];
    return [{
      category: String(row.category) as AuditIssue['category'],
      severity: String(row.severity) as AuditIssue['severity'],
      subject: typeof row.subject === 'string' ? row.subject : undefined,
      evidence: row.evidence,
      suggestion: typeof row.suggestion === 'string' ? row.suggestion : '',
    }];
  });
  return { summary: typeof value.summary === 'string' ? value.summary : '', issues };
}

async function exclusive<T>(db: SQLiteDatabase, task: (transaction: SQLiteDatabase) => Promise<T>) {
  const target = db as SQLiteDatabase & {
    withExclusiveTransactionAsync?: (callback: (transaction: SQLiteDatabase) => Promise<void>) => Promise<void>;
  };
  if (!target.withExclusiveTransactionAsync) return task(db);
  let result!: T;
  await target.withExclusiveTransactionAsync(async (transaction) => { result = await task(transaction); });
  return result;
}

async function auditJob(db: SQLiteDatabase, job: AuditOutboxRow, completion: LlmCompletion) {
  const payload = JSON.parse(job.payloadJson) as {
    chapterIndex?: number;
    chapterId?: string;
    auditFromChapter?: number;
  };
  const window = job.jobType === 'volume-consistency-audit' ? 25 : 5;
  const toChapter = Number(payload.chapterIndex ?? Number.MAX_SAFE_INTEGER);
  const fromChapter = Number.isFinite(payload.auditFromChapter)
    ? Number(payload.auditFromChapter)
    : Math.max(1, toChapter - window + 1);
  const chapters = await db.getAllAsync<{ chapterIndex: number; title: string; content: string }>(
    'SELECT chapter_index AS chapterIndex, title, content FROM chapters WHERE novel_id = ? ' +
      'AND status = \'final\' AND chapter_index >= ? AND chapter_index <= ? ' +
      'ORDER BY chapter_index DESC LIMIT ?',
    job.novelId, fromChapter, toChapter, Math.max(window, toChapter - fromChapter + 1),
  );
  const facts = await listActiveStoryFacts(db, job.novelId, { limit: 120 });
  const result = await completion([
    {
      role: 'system',
      content: '你是小说长期一致性审计器。仅报告有正文证据的问题。输出 JSON：' +
        '{"summary":"","issues":[{"category":"character|world|hook|timeline|plot|entity",' +
        '"severity":"critical|warning|info","subject":"","evidence":"","suggestion":""}]}',
    },
    {
      role: 'user',
      content: `审计类型：${job.jobType}\n正史版本：${job.canonRevision}\n` +
        `【章节窗口】\n${chapters.reverse().map((chapter) => `第${chapter.chapterIndex}章 ${chapter.title}\n${chapter.content.slice(0, 5000)}`).join('\n\n')}\n` +
        `【当前事实】\n${facts.map((fact) => `${fact.factType}/${fact.subjectId}: ${fact.contentJson}`).join('\n').slice(0, 12000)}`,
    },
  ], 'consistency-audit');
  const audit = parseIssues(result.content);
  await exclusive(db, async (transaction) => {
    const runId = `${job.id}:run:${job.attempts + 1}`;
    const now = new Date().toISOString();
    await transaction.runAsync(
      'INSERT INTO audit_runs (id, job_id, novel_id, canon_revision, kind, model_id, status, summary, created_at, completed_at) ' +
        "VALUES (?, ?, ?, ?, ?, ?, 'complete', ?, ?, ?)",
      runId, job.id, job.novelId, job.canonRevision, job.jobType, result.modelId ?? null,
      audit.summary, job.createdAt, now,
    );
    for (let index = 0; index < audit.issues.length; index += 1) {
      const issue = audit.issues[index];
      await transaction.runAsync(
        'INSERT INTO consistency_issues ' +
          '(id, audit_run_id, novel_id, canon_revision, chapter_id, category, severity, subject, evidence_json, suggestion, status, created_at) ' +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)",
        `${runId}:issue:${index}`, runId, job.novelId, job.canonRevision, payload.chapterId ?? null,
        issue.category, issue.severity, issue.subject ?? null, JSON.stringify([issue.evidence]), issue.suggestion, now,
      );
    }
    await completeAuditJob(transaction, job.id, now);
  });
}

export async function processConsistencyAuditJobs(completion: LlmCompletion, limitPerKind = 1) {
  const db = await getAppDatabase();
  let completed = 0;
  for (const kind of ['scene-consistency-audit', 'volume-consistency-audit']) {
    const jobs = await listRunnableAuditJobs(db, new Date().toISOString(), limitPerKind, kind);
    for (const job of jobs) {
      if (!(await claimAuditJob(db, job.id, new Date().toISOString()))) continue;
      try {
        await auditJob(db, job, completion);
        completed += 1;
      } catch (error) {
        const now = new Date();
        await failAuditJob(db, job.id, now.toISOString(), new Date(now.getTime() + 60_000).toISOString());
        console.error('[novel] consistency audit job failed', error);
      }
    }
  }
  return { completed };
}

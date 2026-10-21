import type { SQLiteDatabase } from 'expo-sqlite';

import { getAppDatabase } from '@/db/database';
import { serializeChapterMetadata, serializeNovelMetadata } from '@/db/novel-metadata';
import { upsertChapter } from '@/db/repositories/chapters';
import { upsertNovel } from '@/db/repositories/novels';
import { appendStoryEventInTransaction } from '@/db/repositories/story-events';
import { supersedeStaleConsistencyIssues } from '@/db/repositories/consistency-issues';
import { projectStoryEventInTransaction } from '@/services/novel-story-projection';
import type { NovelAuditBoundaries } from '@/services/novel-audit-boundaries';
import type { StoryAnalysisDelta } from '@/services/novel-story-state';
import type {
  Novel,
  NovelChapter,
  NovelStoryAnalysis,
  NovelStorySnapshot,
  NovelMissionVerification,
} from '@/types/tavern';

type EventFact = {
  id: string;
  factType: string;
  subjectId: string | null;
  content: unknown;
  confidence: number;
  locked: boolean;
};

export type CommitNovelChapterInput = {
  novel: Novel;
  chapter: NovelChapter;
  nextAnalysis: NovelStoryAnalysis;
  delta: StoryAnalysisDelta;
  snapshot: NovelStorySnapshot;
  idempotencyKey: string;
  expectedChapterUpdatedAt: string;
  createdAt: string;
  missionVerification?: NovelMissionVerification;
  auditBoundaries?: NovelAuditBoundaries;
};

export type CommitNovelChapterResult = {
  commitId: string;
  chapterRevisionId: string;
  canonRevision: number;
  eventSequence: number;
  idempotent: boolean;
  needsProjectionRebuild: boolean;
};

type ExistingCommit = {
  commitId: string;
  chapterRevisionId: string;
  canonRevision: number;
};

function recordOf(value: unknown) {
  return value as Record<string, unknown>;
}

/** Stable, non-cryptographic fingerprint used for optimistic concurrency and idempotency. */
export function fingerprintChapterContent(title: string, content: string) {
  const value = `${title}\u0000${content}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function eventFacts(eventId: string, delta: StoryAnalysisDelta): EventFact[] {
  const groups: [string, unknown[]][] = [
    ['world-fact', delta.worldFacts],
    ['character', delta.characters],
    ['character-state', delta.characterStates],
    ['relationship', delta.relationships],
    ['timeline', delta.timeline],
    ['plot-thread', delta.plotThreads],
    ['hook', delta.hooks],
    ['chapter-summary', delta.summaries],
    ['style-profile', [delta.styleProfile]],
  ];
  const facts: EventFact[] = [];
  for (const [factType, values] of groups) {
    for (let index = 0; index < values.length; index += 1) {
      const value = recordOf(values[index]);
      const subjectId = String(
        value.id ?? value.characterId ?? value.chapter ?? `${factType}:${index}`,
      );
      facts.push({
        id: `${eventId}:fact:${factType}:${subjectId}:${index}`,
        factType,
        subjectId,
        content: values[index],
        confidence: typeof value.confidence === 'number' ? value.confidence : 1,
        locked: value.locked === true || value.lockedByUser === true,
      });
    }
  }
  return facts;
}

function eventSubjects(delta: StoryAnalysisDelta) {
  const subjects = new Map<string, string>();
  const add = (id: unknown, role: string) => {
    if (typeof id === 'string' && id.trim()) subjects.set(`${id}\u0000${role}`, role);
  };
  delta.characters.forEach((item) => add(item.id, 'character'));
  delta.characterStates.forEach((item) => add(item.characterId, 'character-state'));
  delta.relationships.forEach((item) => add(item.id, 'relationship'));
  delta.worldFacts.forEach((item) => add(item.id, 'world-fact'));
  delta.timeline.forEach((item) => add(item.canonicalId ?? item.id, item.type));
  delta.plotThreads.forEach((item) => add(item.id, 'plot-thread'));
  delta.hooks.forEach((item) => add(item.id, 'hook'));
  return [...subjects.entries()].map(([key, role]) => ({ entityId: key.split('\u0000')[0], role }));
}

async function withExclusiveTransaction<T>(
  db: SQLiteDatabase,
  task: (transaction: SQLiteDatabase) => Promise<T>,
) {
  const exclusive = db as SQLiteDatabase & {
    withExclusiveTransactionAsync?: (
      callback: (transaction: SQLiteDatabase) => Promise<void>,
    ) => Promise<void>;
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

async function findExistingCommit(
  db: SQLiteDatabase,
  novelId: string,
  idempotencyKey: string,
) {
  return db.getFirstAsync<ExistingCommit>(
    'SELECT id AS commitId, chapter_revision_id AS chapterRevisionId, ' +
      'canon_revision AS canonRevision FROM canon_commits ' +
      'WHERE novel_id = ? AND idempotency_key = ?',
    novelId,
    idempotencyKey,
  );
}

function outboxKinds(
  boundaries: NovelAuditBoundaries | undefined,
  needsProjectionRebuild: boolean,
) {
  const kinds: string[] = [];
  if (needsProjectionRebuild) kinds.push('projection-rebuild');
  if (boundaries?.scene) kinds.push('scene-consistency-audit');
  if (boundaries?.volume) kinds.push('volume-consistency-audit');
  return kinds;
}

/**
 * 在事务内记录一次「章节任务验收」结果：更新 mission 状态，未通过时写入 audit_runs
 * 与 consistency_issues。提交路径与门禁拦截路径共用，保证问题展示一致。
 */
export async function recordMissionVerificationResult(
  transaction: SQLiteDatabase,
  input: {
    novelId: string;
    chapterId: string;
    canonRevision: number;
    runId: string;
    verification: NovelMissionVerification;
    createdAt: string;
  },
): Promise<void> {
  await transaction.runAsync(
    "UPDATE chapter_missions SET status = 'verified', verification_json = ?, updated_at = ? WHERE id = ?",
    JSON.stringify(input.verification),
    input.verification.verifiedAt,
    input.verification.missionId,
  );
  if (input.verification.passed) {
    return;
  }
  await transaction.runAsync(
    'INSERT OR REPLACE INTO audit_runs ' +
      '(id, job_id, novel_id, canon_revision, kind, model_id, status, summary, created_at, completed_at) ' +
      "VALUES (?, NULL, ?, ?, 'mission-verification', NULL, 'complete', ?, ?, ?)",
    input.runId, input.novelId, input.canonRevision,
    input.verification.warnings.join('；'), input.createdAt, input.createdAt,
  );
  for (let index = 0; index < input.verification.warnings.length; index += 1) {
    const warning = input.verification.warnings[index];
    const category = warning.includes('人物') ? 'character' : warning.includes('伏笔') ? 'hook' : 'plot';
    await transaction.runAsync(
      'INSERT OR REPLACE INTO consistency_issues ' +
        '(id, audit_run_id, novel_id, canon_revision, chapter_id, category, severity, subject, evidence_json, suggestion, status, created_at) ' +
        "VALUES (?, ?, ?, ?, ?, ?, 'warning', NULL, ?, ?, 'open', ?)",
      `${input.runId}:issue:${index}`, input.runId, input.novelId, input.canonRevision, input.chapterId,
      category, JSON.stringify([warning]), '检查正文或调整下一章任务卡', input.createdAt,
    );
  }
}

/**
 * 门禁拦截时（未提交正史）落库任务验收结果：章节保持草稿，问题进入一致性工作台。
 */
export async function recordBlockedMissionVerification(input: {
  novelId: string;
  chapterId: string;
  canonRevision: number;
  verification: NovelMissionVerification;
  createdAt: string;
}): Promise<void> {
  const db = await getAppDatabase();
  await withExclusiveTransaction(db, async (transaction) => {
    await recordMissionVerificationResult(transaction, {
      novelId: input.novelId,
      chapterId: input.chapterId,
      canonRevision: input.canonRevision,
      runId: `${input.verification.missionId}:verification`,
      verification: input.verification,
      createdAt: input.createdAt,
    });
  });
}

export async function commitNovelChapter(
  input: CommitNovelChapterInput,
): Promise<CommitNovelChapterResult> {
  const db = await getAppDatabase();
  return withExclusiveTransaction(db, async (transaction) => {
    const existing = await findExistingCommit(
      transaction,
      input.novel.id,
      input.idempotencyKey,
    );
    if (existing) {
      const event = await transaction.getFirstAsync<{ sequence: number }>(
        'SELECT sequence FROM story_events WHERE causation_id = ? ORDER BY sequence ASC LIMIT 1',
        existing.commitId,
      );
      const revision = await transaction.getFirstAsync<{ revisionNo: number }>(
        'SELECT revision_no AS revisionNo FROM chapter_revisions WHERE id = ?',
        existing.chapterRevisionId,
      );
      return {
        ...existing,
        eventSequence: Number(event?.sequence ?? 0),
        idempotent: true,
        needsProjectionRebuild: Number(revision?.revisionNo ?? 1) > 1,
      };
    }

    await upsertNovel(transaction, {
      id: input.novel.id,
      name: input.novel.name,
      worldName: input.novel.worldName,
      worldEra: input.novel.worldEra,
      worldConflict: input.novel.worldConflict,
      worldTone: input.novel.worldTone,
      writingStyle: input.novel.writingStyle,
      createdAt: input.novel.createdAt,
      updatedAt: input.createdAt,
      jsonExtra: serializeNovelMetadata(recordOf(input.novel)),
      storyAnalysisJson: JSON.stringify(input.nextAnalysis),
      canonRevision: input.novel.canonRevision ?? 0,
    });

    const storedChapter = await transaction.getFirstAsync<{
      updatedAt: string;
      currentRevisionId: string | null;
      status: string;
      title: string;
      content: string;
    }>(
      'SELECT updated_at AS updatedAt, current_revision_id AS currentRevisionId, status, title, content ' +
        'FROM chapters WHERE id = ? AND novel_id = ?',
      input.chapter.id,
      input.novel.id,
    );
    const storedHash = storedChapter
      ? fingerprintChapterContent(storedChapter.title, storedChapter.content)
      : null;
    const inputHash = fingerprintChapterContent(input.chapter.title, input.chapter.content);
    if (
      storedChapter?.status === 'final' &&
      storedChapter.updatedAt !== input.expectedChapterUpdatedAt &&
      storedHash !== inputHash
    ) {
      throw new Error('章节已在其他任务中更新，请重新加载后再确认。');
    }

    const finalChapter: NovelChapter = {
      ...input.chapter,
      status: 'final',
      updatedAt: input.createdAt,
    };
    await upsertChapter(transaction, {
      id: finalChapter.id,
      novelId: input.novel.id,
      chapterIndex: finalChapter.index,
      title: finalChapter.title,
      content: finalChapter.content,
      status: finalChapter.status,
      createdAt: finalChapter.createdAt,
      updatedAt: finalChapter.updatedAt,
      jsonExtra: serializeChapterMetadata(recordOf(finalChapter)),
    });

    const revisionRow = await transaction.getFirstAsync<{ revisionNo: number }>(
      'SELECT COALESCE(MAX(revision_no), 0) + 1 AS revisionNo FROM chapter_revisions WHERE chapter_id = ?',
      input.chapter.id,
    );
    const revisionNo = Number(revisionRow?.revisionNo ?? 1);
    const needsProjectionRebuild = revisionNo > 1;
    const contentHash = inputHash;
    const chapterRevisionId = `${input.chapter.id}:revision:${revisionNo}:${contentHash}`;
    await transaction.runAsync(
      'INSERT INTO chapter_revisions ' +
        '(id, novel_id, chapter_id, revision_no, title, content, content_hash, status, supersedes_revision_id, created_at) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'final', ?, ?)",
      chapterRevisionId,
      input.novel.id,
      input.chapter.id,
      revisionNo,
      input.chapter.title,
      input.chapter.content,
      contentHash,
      storedChapter?.currentRevisionId ?? null,
      input.createdAt,
    );
    if (storedChapter?.currentRevisionId) {
      await transaction.runAsync(
        "UPDATE chapter_revisions SET status = 'superseded' WHERE id = ?",
        storedChapter.currentRevisionId,
      );
    }
    await transaction.runAsync(
      'UPDATE chapters SET current_revision_id = ? WHERE id = ?',
      chapterRevisionId,
      input.chapter.id,
    );

    const revision = await transaction.getFirstAsync<{ canonRevision: number }>(
      'SELECT canon_revision + 1 AS canonRevision FROM novels WHERE id = ?',
      input.novel.id,
    );
    const canonRevision = Number(revision?.canonRevision ?? 1);
    const canonicalAnalysis: NovelStoryAnalysis = {
      ...input.nextAnalysis,
      canonRevision,
    };
    const commitId = `${input.novel.id}:canon:${canonRevision}`;
    await transaction.runAsync(
      'INSERT INTO canon_commits ' +
        '(id, novel_id, canon_revision, idempotency_key, command_type, chapter_revision_id, created_at) ' +
        "VALUES (?, ?, ?, ?, 'confirm-chapter', ?, ?)",
      commitId,
      input.novel.id,
      canonRevision,
      input.idempotencyKey,
      chapterRevisionId,
      input.createdAt,
    );
    const revisionUpdate = await transaction.runAsync(
      'UPDATE novels SET canon_revision = ?, story_analysis_json = ?, updated_at = ? ' +
        'WHERE id = ? AND canon_revision = ?',
      canonRevision,
      JSON.stringify(canonicalAnalysis),
      input.createdAt,
      input.novel.id,
      canonRevision - 1,
    );
    if (revisionUpdate.changes !== 1) {
      throw new Error('正史版本已变化，本次章节提交已回滚，请重新确认。');
    }

    const eventId = `${commitId}:chapter-finalized`;
    const supersededEvent = storedChapter?.currentRevisionId
      ? await transaction.getFirstAsync<{ id: string }>(
          'SELECT id FROM story_events WHERE chapter_revision_id = ? ORDER BY sequence DESC LIMIT 1',
          storedChapter.currentRevisionId,
        )
      : null;
    const payloadJson = JSON.stringify({
      schemaVersion: 2,
      chapterId: input.chapter.id,
      chapterRevisionId,
      chapterIndex: input.chapter.index,
      contentHash,
      facts: eventFacts(eventId, input.delta),
    });
    await transaction.runAsync(
      'INSERT OR IGNORE INTO projection_generations ' +
        '(novel_id, generation, through_canon_revision, status, created_at, updated_at) ' +
        "VALUES (?, 0, 0, 'active', ?, ?)",
      input.novel.id,
      input.createdAt,
      input.createdAt,
    );
    const eventSequence = await appendStoryEventInTransaction(transaction, {
      id: eventId,
      novelId: input.novel.id,
      chapterId: input.chapter.id,
      eventType: 'chapter:finalized',
      payloadJson,
      sourceMessageId: null,
      createdAt: input.createdAt,
      canonRevision,
      chapterRevisionId,
      causationId: commitId,
      correlationId: input.idempotencyKey,
      supersedesEventId: supersededEvent?.id ?? null,
    });
    const event = {
      id: eventId,
      novelId: input.novel.id,
      chapterId: input.chapter.id,
      sequence: eventSequence,
      eventType: 'chapter:finalized',
      payloadJson,
      sourceMessageId: null,
      createdAt: input.createdAt,
      canonRevision,
      chapterRevisionId,
      causationId: commitId,
      correlationId: input.idempotencyKey,
      supersedesEventId: supersededEvent?.id ?? null,
    };
    await projectStoryEventInTransaction(transaction, event);
    if (!needsProjectionRebuild) {
      await transaction.runAsync(
        'UPDATE projection_generations SET through_canon_revision = ?, updated_at = ? ' +
          "WHERE novel_id = ? AND status = 'active'",
        canonRevision,
        input.createdAt,
        input.novel.id,
      );
    }

    for (const subject of eventSubjects(input.delta)) {
      await transaction.runAsync(
        'INSERT OR IGNORE INTO event_subjects (event_id, entity_id, role) VALUES (?, ?, ?)',
        eventId,
        subject.entityId,
        subject.role,
      );
    }

    const canonicalSnapshot: NovelStorySnapshot = {
      ...input.snapshot,
      canonRevision,
      analysis: canonicalAnalysis,
    };
    await transaction.runAsync(
      'INSERT OR REPLACE INTO novel_story_snapshots ' +
        '(id, novel_id, state_version, created_at, updated_at, content_json) VALUES (?, ?, ?, ?, ?, ?)',
      canonicalSnapshot.snapshotId,
      input.novel.id,
      canonicalSnapshot.stateVersion,
      canonicalSnapshot.createdAt,
      canonicalSnapshot.createdAt,
      JSON.stringify(canonicalSnapshot),
    );

    if (needsProjectionRebuild) {
      await supersedeStaleConsistencyIssues(
        transaction,
        input.novel.id,
        canonRevision,
        input.createdAt,
      );
    }

    for (const jobType of outboxKinds(input.auditBoundaries, needsProjectionRebuild)) {
      const jobKey = `${jobType}:${canonRevision}`;
      await transaction.runAsync(
        'INSERT OR IGNORE INTO audit_outbox ' +
          '(id, novel_id, canon_revision, job_type, job_key, payload_json, status, attempts, available_at, created_at, updated_at) ' +
          "VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)",
        `${commitId}:outbox:${jobType}`,
        input.novel.id,
        canonRevision,
        jobType,
        jobKey,
        JSON.stringify({
          novelId: input.novel.id,
          chapterId: input.chapter.id,
          chapterRevisionId,
          chapterIndex: input.chapter.index,
          canonRevision,
          boundarySource: input.auditBoundaries?.source,
          boundaryReasons: input.auditBoundaries?.reasons ?? [],
          auditFromChapter: jobType === 'scene-consistency-audit'
            ? input.auditBoundaries?.sceneFromChapter
            : input.auditBoundaries?.volumeFromChapter,
        }),
        input.createdAt,
        input.createdAt,
        input.createdAt,
      );
    }
    if (input.missionVerification) {
      await recordMissionVerificationResult(transaction, {
        novelId: input.novel.id,
        chapterId: input.chapter.id,
        canonRevision,
        runId: `${commitId}:mission-verification`,
        verification: input.missionVerification,
        createdAt: input.createdAt,
      });
    }

    return {
      commitId,
      chapterRevisionId,
      canonRevision,
      eventSequence,
      idempotent: false,
      needsProjectionRebuild,
    };
  });
}

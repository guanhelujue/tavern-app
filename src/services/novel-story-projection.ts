import { getAppDatabase } from '@/db/database';
import { listStoryEvents } from '@/db/repositories/story-events';
import {
  upsertProjectedStoryFact,
  upsertStoryFact,
} from '@/db/repositories/story-facts';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { StoryEventRow, StoryFactRow } from '@/db/types';
import { projectConsistencyEventInTransaction } from '@/services/novel-consistency-projection';

type ProjectionFactInput = {
  id?: string;
  factType?: string;
  subjectId?: string | null;
  content?: unknown;
  contentJson?: string;
  confidence?: number;
  locked?: boolean | number;
};

function parseFacts(event: StoryEventRow): ProjectionFactInput[] {
  let payload: unknown;
  try {
    payload = JSON.parse(event.payloadJson);
  } catch {
    payload = null;
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const facts = (payload as Record<string, unknown>).facts;
    if (Array.isArray(facts)) return facts.filter((item): item is ProjectionFactInput => Boolean(item && typeof item === 'object'));
  }
  return [{ factType: event.eventType, subjectId: event.chapterId, contentJson: event.payloadJson }];
}

function isReplayableCanonEvent(event: StoryEventRow) {
  if ((event.canonRevision ?? 0) > 0) return true;
  if (event.eventType !== 'chapter:updated') return true;
  try {
    const payload = JSON.parse(event.payloadJson) as { facts?: { content?: { status?: unknown } }[] };
    return payload.facts?.some((fact) => fact.content?.status === 'final') ?? false;
  } catch {
    return false;
  }
}

function normalizeConfidence(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function toFact(event: StoryEventRow, input: ProjectionFactInput, index: number): StoryFactRow {
  const contentJson =
    typeof input.contentJson === 'string'
      ? input.contentJson
      : JSON.stringify(input.content ?? { eventType: event.eventType, payload: event.payloadJson });
  return {
    id: input.id || `${event.id}:fact:${index}`,
    novelId: event.novelId,
    factType: input.factType || event.eventType,
    subjectId: input.subjectId ?? event.chapterId,
    contentJson,
    sourceEventId: event.id,
    stateVersion: event.sequence + 1,
    confidence: normalizeConfidence(input.confidence),
    locked: input.locked === true || input.locked === 1 ? 1 : 0,
    stale: 0,
    updatedAt: event.createdAt,
    canonRevision: event.canonRevision ?? 0,
  };
}

async function inTransaction<T>(
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

/** Project using an already-owned transaction. */
export async function projectStoryEventInTransaction(
  transaction: SQLiteDatabase,
  event: StoryEventRow,
  options?: { generation?: number; writeCompatibility?: boolean },
) {
    const generation = options?.generation ?? Number((await transaction.getFirstAsync<{ generation: number }>(
      'SELECT active_projection_generation AS generation FROM novels WHERE id = ?',
      event.novelId,
    ))?.generation ?? 0);
    const facts = parseFacts(event);
    for (let index = 0; index < facts.length; index += 1) {
      const fact = toFact(event, facts[index], index);
      await upsertProjectedStoryFact(transaction, fact, generation);
      if (options?.writeCompatibility !== false) {
        await upsertStoryFact(transaction, fact);
      }
    }
    await projectConsistencyEventInTransaction(transaction, event, generation);
    return facts.length;
}

/** Idempotently project one event; fact ids are deterministic per event and index. */
export async function projectStoryEvent(
  db: SQLiteDatabase,
  event: StoryEventRow,
  options?: { generation?: number; writeCompatibility?: boolean },
) {
  return inTransaction(db, (transaction) =>
    projectStoryEventInTransaction(transaction, event, options));
}

export async function rebuildNovelStoryProjection(novelId: string, options?: { throughSequence?: number }) {
  const db = await getAppDatabase();
  const now = new Date().toISOString();
  const build = await inTransaction(db, async (transaction) => {
    const novel = await transaction.getFirstAsync<{ canonRevision: number }>(
      'SELECT canon_revision AS canonRevision FROM novels WHERE id = ?',
      novelId,
    );
    if (!novel) throw new Error('无法重建不存在的小说投影。');
    const next = await transaction.getFirstAsync<{ generation: number }>(
      'SELECT COALESCE(MAX(generation), -1) + 1 AS generation FROM projection_generations WHERE novel_id = ?',
      novelId,
    );
    const generation = Number(next?.generation ?? 0);
    await transaction.runAsync(
      'INSERT INTO projection_generations ' +
        '(novel_id, generation, through_canon_revision, status, created_at, updated_at) ' +
        "VALUES (?, ?, ?, 'building', ?, ?)",
      novelId,
      generation,
      novel.canonRevision,
      now,
      now,
    );
    await transaction.runAsync(
      'DELETE FROM story_projection_facts WHERE novel_id = ? AND generation = ?',
      novelId,
      generation,
    );
    return { generation, targetCanonRevision: Number(novel.canonRevision) };
  });
  let afterSequence: number | undefined;
  let eventCount = 0;
  let latestStateVersion = 0;
  try {
    outer: for (;;) {
      const page = await listStoryEvents(db, novelId, { limit: 200, afterSequence });
      if (!page.length) break;
      for (const event of page) {
        if (options?.throughSequence !== undefined && event.sequence > options.throughSequence) {
          break outer;
        }
        if ((event.canonRevision ?? 0) > build.targetCanonRevision) break outer;
        if (!isReplayableCanonEvent(event)) {
          afterSequence = event.sequence;
          continue;
        }
        await projectStoryEvent(db, event, {
          generation: build.generation,
          writeCompatibility: false,
        });
        eventCount += 1;
        latestStateVersion = Math.max(latestStateVersion, event.sequence + 1);
        afterSequence = event.sequence;
      }
      if (page.length < 200) break;
    }
    await inTransaction(db, async (transaction) => {
      const current = await transaction.getFirstAsync<{ canonRevision: number }>(
        'SELECT canon_revision AS canonRevision FROM novels WHERE id = ?',
        novelId,
      );
      if (Number(current?.canonRevision ?? -1) !== build.targetCanonRevision) {
        throw new Error('重建期间正史已变化，影子投影不会切换。');
      }
      await transaction.runAsync(
        "UPDATE projection_generations SET status = 'retired', updated_at = ? " +
          "WHERE novel_id = ? AND status = 'active'",
        new Date().toISOString(),
        novelId,
      );
      await transaction.runAsync(
        "UPDATE projection_generations SET status = 'active', updated_at = ? " +
          "WHERE novel_id = ? AND generation = ? AND status = 'building'",
        new Date().toISOString(),
        novelId,
        build.generation,
      );
      await transaction.runAsync(
        'UPDATE novels SET active_projection_generation = ? WHERE id = ?',
        build.generation,
        novelId,
      );
    });
  } catch (error) {
    await db.runAsync(
      "UPDATE projection_generations SET status = 'failed', updated_at = ? " +
        "WHERE novel_id = ? AND generation = ? AND status = 'building'",
      new Date().toISOString(),
      novelId,
      build.generation,
    );
    throw error;
  }
  return {
    eventCount,
    stateVersion: latestStateVersion,
    generation: build.generation,
    canonRevision: build.targetCanonRevision,
  };
}

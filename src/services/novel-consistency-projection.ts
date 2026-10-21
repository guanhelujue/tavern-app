import type { SQLiteDatabase } from 'expo-sqlite';

import type { StoryEventRow } from '@/db/types';

type ProjectedFact = {
  factType?: string;
  subjectId?: string | null;
  content?: unknown;
  locked?: boolean;
};

function factsOf(event: StoryEventRow): ProjectedFact[] {
  try {
    const payload = JSON.parse(event.payloadJson) as { facts?: unknown[] };
    return Array.isArray(payload.facts)
      ? payload.facts.filter((item): item is ProjectedFact => Boolean(item && typeof item === 'object'))
      : [];
  } catch {
    return [];
  }
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeEntityAlias(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s·•._-]+/g, '');
}

async function closeCurrent(
  db: SQLiteDatabase,
  table: string,
  idColumn: string,
  novelId: string,
  generation: number,
  id: string,
  canonRevision: number,
) {
  await db.runAsync(
    `UPDATE ${table} SET valid_to_canon_revision = ? ` +
      `WHERE novel_id = ? AND generation = ? AND ${idColumn} = ? ` +
      'AND valid_to_canon_revision IS NULL AND valid_from_canon_revision < ?',
    canonRevision - 1,
    novelId,
    generation,
    id,
    canonRevision,
  );
}

async function projectCharacter(
  db: SQLiteDatabase,
  event: StoryEventRow,
  generation: number,
  fact: ProjectedFact,
) {
  const value = objectOf(fact.content);
  const entityId = text(value.id) || text(fact.subjectId);
  if (!entityId) return;
  const name = text(value.name) || entityId;
  const aliases = Array.isArray(value.aliases) ? value.aliases.map(text).filter(Boolean) : [];
  const locked = fact.locked === true || value.lockedByUser === true || value.locked === true;
  await db.runAsync(
    'INSERT INTO story_entities ' +
      '(novel_id, generation, entity_id, entity_kind, canonical_name, distinguisher, locked, ' +
      'created_canon_revision, updated_canon_revision, source_event_id) ' +
      "VALUES (?, ?, ?, 'character', ?, ?, ?, ?, ?, ?) " +
      'ON CONFLICT(novel_id, generation, entity_id) DO UPDATE SET ' +
      'canonical_name = CASE WHEN story_entities.locked = 1 AND excluded.locked = 0 THEN story_entities.canonical_name ELSE excluded.canonical_name END, ' +
      'distinguisher = CASE WHEN story_entities.locked = 1 AND excluded.locked = 0 THEN story_entities.distinguisher ELSE excluded.distinguisher END, ' +
      'locked = MAX(story_entities.locked, excluded.locked), updated_canon_revision = excluded.updated_canon_revision, ' +
      'source_event_id = excluded.source_event_id',
    event.novelId, generation, entityId, name, text(value.distinguisher), locked ? 1 : 0,
    event.canonRevision ?? 0, event.canonRevision ?? 0, event.id,
  );
  for (const alias of [name, ...aliases]) {
    const normalized = normalizeEntityAlias(alias);
    if (!normalized) continue;
    const collisions = await db.getAllAsync<{ entityId: string }>(
      'SELECT entity_id AS entityId FROM entity_aliases WHERE novel_id = ? AND generation = ? ' +
        'AND normalized_alias = ? AND entity_id != ? LIMIT 5',
      event.novelId, generation, normalized, entityId,
    );
    for (const collision of collisions) {
      const [primary, secondary] = [collision.entityId, entityId].sort();
      await db.runAsync(
        'INSERT OR IGNORE INTO entity_merge_candidates ' +
          '(id, novel_id, generation, primary_entity_id, secondary_entity_id, confidence, evidence_json, status, created_canon_revision, updated_at) ' +
          "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
        `${event.novelId}:${generation}:merge:${primary}:${secondary}`,
        event.novelId, generation, primary, secondary, alias === name ? 0.75 : 0.65,
        JSON.stringify([{ alias, sourceEventId: event.id }]), event.canonRevision ?? 0, event.createdAt,
      );
    }
    await db.runAsync(
      'INSERT OR IGNORE INTO entity_aliases ' +
        '(novel_id, generation, normalized_alias, alias, entity_id, confidence, authority, source_event_id, created_canon_revision) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      event.novelId, generation, normalized, alias, entityId,
      alias === name ? 1 : 0.9, locked ? 'user' : alias === name ? 'exact' : 'model', event.id,
      event.canonRevision ?? 0,
    );
  }
}

const HOOK_RANK: Record<string, number> = { open: 0, progressing: 1, deferred: 2, resolved: 3 };

/** Deterministic business projection shared by live commits and shadow replay. */
export async function projectConsistencyEventInTransaction(
  db: SQLiteDatabase,
  event: StoryEventRow,
  generation: number,
) {
  const canonRevision = event.canonRevision ?? 0;
  for (const fact of factsOf(event)) {
    const value = objectOf(fact.content);
    const id = text(value.id) || text(value.characterId) || text(fact.subjectId);
    if (fact.factType === 'character') {
      await projectCharacter(db, event, generation, fact);
    } else if (fact.factType === 'character-state' && id) {
      await closeCurrent(db, 'character_state_versions', 'character_id', event.novelId, generation, id, canonRevision);
      await db.runAsync(
        'INSERT OR REPLACE INTO character_state_versions ' +
          '(novel_id, generation, character_id, valid_from_canon_revision, valid_to_canon_revision, chapter_index, state_json, locked, source_event_id) ' +
          'VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)',
        event.novelId, generation, id, canonRevision, Number(value.atChapter ?? 0),
        JSON.stringify(value), fact.locked || value.locked === true ? 1 : 0, event.id,
      );
    } else if (fact.factType === 'world-fact' && id) {
      const previous = await db.getFirstAsync<{ locked: number }>(
        'SELECT locked FROM world_fact_versions WHERE novel_id = ? AND generation = ? AND fact_id = ? ' +
          'AND valid_to_canon_revision IS NULL ORDER BY valid_from_canon_revision DESC LIMIT 1',
        event.novelId, generation, id,
      );
      const incomingLocked = fact.locked === true || value.locked === true;
      if (previous?.locked === 1 && !incomingLocked) continue;
      await closeCurrent(db, 'world_fact_versions', 'fact_id', event.novelId, generation, id, canonRevision);
      await db.runAsync(
        'INSERT OR REPLACE INTO world_fact_versions ' +
          '(novel_id, generation, fact_id, subject, valid_from_canon_revision, valid_to_canon_revision, ' +
          'valid_from_chapter, valid_to_chapter, content_json, authority, locked, source_event_id) ' +
          'VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)',
        event.novelId, generation, id, text(value.subject) || id, canonRevision,
        Number(value.validFromChapter ?? value.sourceChapter ?? 0),
        typeof value.validUntilChapter === 'number' ? value.validUntilChapter : null,
        JSON.stringify(value), incomingLocked ? 'user_locked' : value.canon === true ? 'system_rule' : 'model_observation',
        incomingLocked ? 1 : 0, event.id,
      );
    } else if (fact.factType === 'hook' && id) {
      const status = text(value.status) || 'open';
      const previous = await db.getFirstAsync<{ status: string }>(
        'SELECT status FROM hook_versions WHERE novel_id = ? AND generation = ? AND hook_id = ? ' +
          'AND valid_to_canon_revision IS NULL ORDER BY valid_from_canon_revision DESC LIMIT 1',
        event.novelId, generation, id,
      );
      if (!event.supersedesEventId && previous && (HOOK_RANK[status] ?? 0) < (HOOK_RANK[previous.status] ?? 0)) continue;
      await closeCurrent(db, 'hook_versions', 'hook_id', event.novelId, generation, id, canonRevision);
      await db.runAsync(
        'INSERT OR REPLACE INTO hook_versions ' +
          '(novel_id, generation, hook_id, valid_from_canon_revision, valid_to_canon_revision, status, chapter_index, hook_json, source_event_id) ' +
          'VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)',
        event.novelId, generation, id, canonRevision, status, Number(value.lastAdvancedChapter ?? 0), JSON.stringify(value), event.id,
      );
    } else if (fact.factType === 'plot-thread' && id) {
      await closeCurrent(db, 'plot_thread_versions', 'thread_id', event.novelId, generation, id, canonRevision);
      await db.runAsync(
        'INSERT OR REPLACE INTO plot_thread_versions ' +
          '(novel_id, generation, thread_id, valid_from_canon_revision, valid_to_canon_revision, chapter_index, progress_json, source_event_id) ' +
          'VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
        event.novelId, generation, id, canonRevision, Number(value.lastAdvancedChapter ?? value.startChapter ?? 0), JSON.stringify(value), event.id,
      );
    }
  }
}

import type { SQLiteDatabase } from 'expo-sqlite';

const activeJoin =
  ' JOIN novels n ON n.id = p.novel_id AND n.active_projection_generation = p.generation ' +
  'JOIN projection_generations pg ON pg.novel_id = p.novel_id AND pg.generation = p.generation ' +
  'AND pg.through_canon_revision = n.canon_revision ';







export async function listPendingEntityMergeCandidates(db: SQLiteDatabase, novelId: string, limit = 100) {
  return db.getAllAsync<{
    id: string; primaryEntityId: string; secondaryEntityId: string; confidence: number; evidenceJson: string;
  }>(
    'SELECT p.id, p.primary_entity_id AS primaryEntityId, p.secondary_entity_id AS secondaryEntityId, ' +
      'p.confidence, p.evidence_json AS evidenceJson FROM entity_merge_candidates p' + activeJoin +
      "WHERE p.novel_id = ? AND p.status = 'pending' ORDER BY p.confidence DESC LIMIT ?",
    novelId, Math.max(1, Math.min(500, limit)),
  );
}

export async function decideEntityMergeCandidate(
  db: SQLiteDatabase,
  candidateId: string,
  decision: 'accepted' | 'rejected',
  now: string,
) {
  const candidate = await db.getFirstAsync<{
    novelId: string; generation: number; primaryEntityId: string; secondaryEntityId: string; secondaryLocked: number;
  }>(
    'SELECT c.novel_id AS novelId, c.generation, c.primary_entity_id AS primaryEntityId, ' +
      'c.secondary_entity_id AS secondaryEntityId, e.locked AS secondaryLocked ' +
      'FROM entity_merge_candidates c JOIN story_entities e ON e.novel_id = c.novel_id ' +
      'AND e.generation = c.generation AND e.entity_id = c.secondary_entity_id ' +
      "WHERE c.id = ? AND c.status = 'pending'",
    candidateId,
  );
  if (!candidate) return false;
  if (decision === 'accepted' && candidate.secondaryLocked === 1) {
    throw new Error('用户锁定实体不能被合并。');
  }
  if (decision === 'accepted') {
    await db.runAsync(
      'INSERT OR REPLACE INTO entity_redirects ' +
        '(novel_id, generation, secondary_entity_id, primary_entity_id, candidate_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      candidate.novelId, candidate.generation, candidate.secondaryEntityId,
      candidate.primaryEntityId, candidateId, now,
    );
  }
  const result = await db.runAsync(
    "UPDATE entity_merge_candidates SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    decision, now, candidateId,
  );
  return result.changes === 1;
}

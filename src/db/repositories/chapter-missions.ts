import type { SQLiteDatabase } from 'expo-sqlite';

import type {
  NovelChapterMission,
  NovelCharacterRedLine,
  NovelHookTask,
  NovelMissionFeasibility,
} from '@/types/tavern';

export async function saveChapterMission(db: SQLiteDatabase, input: {
  mission: NovelChapterMission;
  redLines: NovelCharacterRedLine[];
  hookTasks: NovelHookTask[];
  feasibility: NovelMissionFeasibility;
  attempt?: number;
}) {
  await db.runAsync(
    'INSERT INTO chapter_missions ' +
      '(id, novel_id, chapter_index, canon_revision, attempt, mission_json, red_lines_json, hook_tasks_json, feasibility_json, status, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET mission_json = excluded.mission_json, red_lines_json = excluded.red_lines_json, ' +
      'hook_tasks_json = excluded.hook_tasks_json, feasibility_json = excluded.feasibility_json, status = excluded.status, updated_at = excluded.updated_at',
    input.mission.missionId, input.mission.novelId, input.mission.chapterIndex,
    input.mission.canonRevision, input.attempt ?? 1, JSON.stringify(input.mission),
    JSON.stringify(input.redLines), JSON.stringify(input.hookTasks), JSON.stringify(input.feasibility), input.mission.status,
    input.mission.createdAt, input.mission.createdAt,
  );
}

export async function markChapterMissionUsed(db: SQLiteDatabase, missionId: string, now: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await db.runAsync(
        "UPDATE chapter_missions SET status = 'used', updated_at = ? WHERE id = ? AND status = 'planned'",
        now, missionId,
      );
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/database is locked|SQLITE_BUSY/i.test(message) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}


export async function loadLatestChapterMission(db: SQLiteDatabase, novelId: string, chapterIndex: number) {
  return db.getFirstAsync<{
    id: string; missionJson: string; redLinesJson: string; hookTasksJson: string; status: string;
  }>(
    'SELECT id, mission_json AS missionJson, red_lines_json AS redLinesJson, hook_tasks_json AS hookTasksJson, status ' +
      'FROM chapter_missions WHERE novel_id = ? AND chapter_index = ? ' +
      'ORDER BY canon_revision DESC, attempt DESC LIMIT 1',
    novelId, chapterIndex,
  );
}

import { Platform } from 'react-native';

import { getAppDatabase } from '@/db/database';
import { backupLegacyStore, importLegacySnapshot, type LegacyImportReport } from '@/db/legacy-import';
import { countNovels } from '@/db/repositories/novels';
import type { MigrationMarkerRow, MigrationMarkerStatus } from '@/db/types';

export const LEGACY_MIGRATION_MARKER_ID = 'legacy-async-storage-v1';

export type MigrationCoordinatorResult = {
  status: MigrationMarkerStatus | 'web-fallback';
  report?: Omit<LegacyImportReport, 'backupUri'> & { backupUri?: string };
  errorMessage?: string;
};

function nowIso() {
  return new Date().toISOString();
}

async function readMarker(db: Awaited<ReturnType<typeof getAppDatabase>>) {
  return db.getFirstAsync<MigrationMarkerRow>(
    'SELECT id, status, source_version AS sourceVersion, started_at AS startedAt, ' +
      'completed_at AS completedAt, error_message AS errorMessage, report_json AS reportJson ' +
      'FROM migration_markers WHERE id = ?',
    LEGACY_MIGRATION_MARKER_ID,
  );
}

async function writeMarker(
  db: Awaited<ReturnType<typeof getAppDatabase>>,
  input: {
    status: MigrationMarkerStatus;
    sourceVersion: number;
    startedAt?: string | null;
    completedAt?: string | null;
    errorMessage?: string | null;
    reportJson?: string | null;
  },
) {
  await db.runAsync(
    'INSERT INTO migration_markers ' +
      '(id, status, source_version, started_at, completed_at, error_message, report_json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET status = excluded.status, source_version = excluded.source_version, ' +
      'started_at = excluded.started_at, completed_at = excluded.completed_at, ' +
      'error_message = excluded.error_message, report_json = excluded.report_json',
    LEGACY_MIGRATION_MARKER_ID,
    input.status,
    input.sourceVersion,
    input.startedAt ?? null,
    input.completedAt ?? null,
    input.errorMessage ?? null,
    input.reportJson ?? null,
  );
}

async function validateImport(
  db: Awaited<ReturnType<typeof getAppDatabase>>,
  report: Omit<LegacyImportReport, 'backupUri'>,
) {
  const novels = await countNovels(db);

  // The repository count APIs are novel-scoped. Validate the global minimum
  // with direct aggregate queries so a retry can safely coexist with old rows.
  const totals = await Promise.all([
    db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM messages'),
    db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM chapters'),
    db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM memories'),
  ]);
  const actual = {
    novels,
    messages: Number(totals[0]?.count ?? 0),
    chapters: Number(totals[1]?.count ?? 0),
    memories: Number(totals[2]?.count ?? 0),
  };
  const valid =
    actual.novels >= report.novels &&
    actual.messages >= report.messages &&
    actual.chapters >= report.chapters &&
    actual.memories >= report.memories;
  if (!valid) {
    throw new Error(
      `Legacy migration validation failed: expected at least ${JSON.stringify({
        novels: report.novels,
        messages: report.messages,
        chapters: report.chapters,
        memories: report.memories,
      })}, got ${JSON.stringify(actual)}`,
    );
  }
  return actual;
}

function parseReport(reportJson: string | null | undefined) {
  if (!reportJson) {
    return undefined;
  }
  try {
    return JSON.parse(reportJson) as MigrationCoordinatorResult['report'];
  } catch {
    return undefined;
  }
}

/**
 * Runs the one-time legacy import with a durable marker. Failed imports are
 * observable and can be retried; the legacy AsyncStorage value is never
 * deleted by this coordinator.
 */
export async function runMigrationCoordinator(): Promise<MigrationCoordinatorResult> {
  if (Platform.OS === 'web') {
    return { status: 'web-fallback' };
  }

  const db = await getAppDatabase();
  const marker = await readMarker(db);
  if (marker?.status === 'validated') {
    return { status: 'validated', report: parseReport(marker.reportJson) };
  }

  const startedAt = nowIso();
  await writeMarker(db, {
    status: 'running',
    sourceVersion: 1,
    startedAt,
    completedAt: null,
    errorMessage: null,
  });

  try {
    const backup = await backupLegacyStore();
    const imported = await importLegacySnapshot(db, backup.raw);
    const totals = await validateImport(db, imported);
    const report = { ...imported, backupUri: backup.backupUri, totals };
    await writeMarker(db, {
      status: 'validated',
      sourceVersion: 1,
      startedAt,
      completedAt: nowIso(),
      errorMessage: null,
      reportJson: JSON.stringify(report),
    });
    return { status: 'validated', report };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await writeMarker(db, {
      status: 'failed',
      sourceVersion: 1,
      startedAt,
      completedAt: null,
      errorMessage,
    });
    throw new Error(`Legacy migration failed and is retryable: ${errorMessage}`);
  }
}

import type { SQLiteDatabase } from 'expo-sqlite';

import type { DatabaseMigrationReport } from '@/db/types';

export const DATABASE_NAME = 'tavern-v1.db';
export const DATABASE_VERSION = 16;

async function readUserVersion(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return Number(row?.user_version ?? 0);
}

async function migrateToV1(db: SQLiteDatabase) {
  const schema = [
    'CREATE TABLE IF NOT EXISTS novels (',
    '  id TEXT PRIMARY KEY NOT NULL,',
    '  name TEXT NOT NULL,',
    "  world_name TEXT NOT NULL DEFAULT '',",
    "  world_era TEXT NOT NULL DEFAULT '',",
    "  world_conflict TEXT NOT NULL DEFAULT '',",
    "  world_tone TEXT NOT NULL DEFAULT '',",
    "  writing_style TEXT NOT NULL DEFAULT '',",
    '  created_at TEXT NOT NULL,',
    '  updated_at TEXT NOT NULL,',
    "  json_extra TEXT NOT NULL DEFAULT '{}'",
    ');',
    'CREATE TABLE IF NOT EXISTS messages (',
    '  id TEXT PRIMARY KEY NOT NULL,',
    '  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,',
    '  role TEXT NOT NULL,',
    '  content TEXT NOT NULL,',
    '  status TEXT NOT NULL,',
    '  created_at TEXT NOT NULL,',
    '  updated_at TEXT NOT NULL,',
    '  prompt_tokens INTEGER,',
    '  completion_tokens INTEGER,',
    '  model_id TEXT,',
    '  sequence_no INTEGER NOT NULL',
    ');',
    'CREATE TABLE IF NOT EXISTS chapters (',
    '  id TEXT PRIMARY KEY NOT NULL,',
    '  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,',
    '  chapter_index INTEGER NOT NULL,',
    "  title TEXT NOT NULL DEFAULT '',",
    "  content TEXT NOT NULL DEFAULT '',",
    "  status TEXT NOT NULL DEFAULT 'draft',",
    '  created_at TEXT NOT NULL,',
    '  updated_at TEXT NOT NULL,',
    "  json_extra TEXT NOT NULL DEFAULT '{}',",
    '  UNIQUE(novel_id, chapter_index)',
    ');',
    'CREATE TABLE IF NOT EXISTS memories (',
    '  id TEXT PRIMARY KEY NOT NULL,',
    '  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,',
    '  memory_type TEXT NOT NULL,',
    '  content TEXT NOT NULL,',
    '  source_message_id TEXT,',
    '  source_chapter_id TEXT,',
    '  created_at TEXT NOT NULL,',
    '  updated_at TEXT NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_messages_novel_sequence ON messages(novel_id, sequence_no);',
    'CREATE INDEX IF NOT EXISTS idx_chapters_novel_index ON chapters(novel_id, chapter_index);',
    'CREATE INDEX IF NOT EXISTS idx_memories_novel_type ON memories(novel_id, memory_type);',
  ].join('\n');
  await db.execAsync(schema);
  await db.execAsync('PRAGMA user_version = 1');
}

async function migrateToV2(db: SQLiteDatabase) {
  try {
    await db.execAsync('ALTER TABLE memories ADD COLUMN stale INTEGER NOT NULL DEFAULT 0');
  } catch (error) {
    // A previous interrupted run may have added the column before updating user_version.
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('duplicate column')) {
      throw error;
    }
  }
  await db.execAsync('PRAGMA user_version = 2');
}

async function migrateToV3(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS migration_markers (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      source_version INTEGER NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      report_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_migration_markers_status
      ON migration_markers(status);
  `);
  await db.execAsync('PRAGMA user_version = 3');
}

async function addColumnIfMissing(db: SQLiteDatabase, sql: string) {
  try {
    await db.execAsync(sql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('duplicate column')) {
      throw error;
    }
  }
}

async function migrateToV4(db: SQLiteDatabase) {
  await addColumnIfMissing(
    db,
    "ALTER TABLE memories ADD COLUMN source_type TEXT NOT NULL DEFAULT 'legacy'",
  );
  await addColumnIfMissing(db, 'ALTER TABLE memories ADD COLUMN source_id TEXT');
  await addColumnIfMissing(db, 'ALTER TABLE memories ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0');
  await addColumnIfMissing(db, 'ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS story_events (
      id TEXT PRIMARY KEY NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      source_message_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(novel_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_story_events_novel_sequence
      ON story_events(novel_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_story_events_chapter
      ON story_events(novel_id, chapter_id, sequence);
    CREATE TABLE IF NOT EXISTS story_facts (
      id TEXT PRIMARY KEY NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      fact_type TEXT NOT NULL,
      subject_id TEXT,
      content_json TEXT NOT NULL,
      source_event_id TEXT NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
      state_version INTEGER NOT NULL,
      confidence REAL NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      stale INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_story_facts_novel_state
      ON story_facts(novel_id, state_version, stale, locked);
    CREATE INDEX IF NOT EXISTS idx_story_facts_source_event
      ON story_facts(source_event_id);
  `);
  await db.execAsync('PRAGMA user_version = 4');
}

async function migrateToV5(db: SQLiteDatabase) {
  await addColumnIfMissing(
    db,
    "ALTER TABLE novels ADD COLUMN story_analysis_json TEXT NOT NULL DEFAULT ''",
  );
  await db.execAsync(
    'CREATE INDEX IF NOT EXISTS idx_messages_novel_status ON messages(novel_id, status, sequence_no)',
  );
  await db.execAsync('PRAGMA user_version = 5');
}

async function migrateToV6(db: SQLiteDatabase) {
  const tables = [
    'novel_forecasts',
    'novel_continuation_plans',
    'novel_branches',
    'novel_story_snapshots',
    'novel_generation_jobs',
    'novel_rewrite_audits',
    'novel_chapter_audits',
  ];
  for (const table of tables) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      state_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      content_json TEXT NOT NULL
    )`);
    await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_${table}_novel_updated ON ${table}(novel_id, updated_at)`);
  }
  await addColumnIfMissing(
    db,
    "ALTER TABLE novel_generation_jobs ADD COLUMN status TEXT NOT NULL DEFAULT ''",
  );
  await db.execAsync(
    'CREATE INDEX IF NOT EXISTS idx_generation_jobs_novel_status ON novel_generation_jobs(novel_id, status, updated_at)',
  );
  await db.execAsync(
    'CREATE INDEX IF NOT EXISTS idx_story_facts_novel_type ON story_facts(novel_id, fact_type, stale)',
  );
  await db.execAsync('PRAGMA user_version = 6');
}

async function migrateToV7(db: SQLiteDatabase) {
  await addColumnIfMissing(
    db,
    'ALTER TABLE novels ADD COLUMN canon_revision INTEGER NOT NULL DEFAULT 0',
  );
  await addColumnIfMissing(
    db,
    'ALTER TABLE novels ADD COLUMN active_projection_generation INTEGER NOT NULL DEFAULT 0',
  );
  await addColumnIfMissing(db, 'ALTER TABLE chapters ADD COLUMN current_revision_id TEXT');
  await addColumnIfMissing(
    db,
    'ALTER TABLE story_events ADD COLUMN canon_revision INTEGER NOT NULL DEFAULT 0',
  );
  await addColumnIfMissing(db, 'ALTER TABLE story_events ADD COLUMN chapter_revision_id TEXT');
  await addColumnIfMissing(db, 'ALTER TABLE story_events ADD COLUMN causation_id TEXT');
  await addColumnIfMissing(db, 'ALTER TABLE story_events ADD COLUMN correlation_id TEXT');
  await addColumnIfMissing(db, 'ALTER TABLE story_events ADD COLUMN supersedes_event_id TEXT');

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS chapter_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      revision_no INTEGER NOT NULL CHECK(revision_no > 0),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'final', 'superseded')),
      supersedes_revision_id TEXT REFERENCES chapter_revisions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(chapter_id, revision_no)
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_revisions_chapter_no
      ON chapter_revisions(chapter_id, revision_no DESC);
    CREATE INDEX IF NOT EXISTS idx_chapter_revisions_novel_created
      ON chapter_revisions(novel_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS canon_commits (
      id TEXT PRIMARY KEY NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      canon_revision INTEGER NOT NULL CHECK(canon_revision > 0),
      idempotency_key TEXT NOT NULL,
      command_type TEXT NOT NULL,
      chapter_revision_id TEXT REFERENCES chapter_revisions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(novel_id, canon_revision),
      UNIQUE(novel_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_canon_commits_novel_revision
      ON canon_commits(novel_id, canon_revision DESC);

    CREATE TABLE IF NOT EXISTS event_subjects (
      event_id TEXT NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY(event_id, entity_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_event_subjects_entity
      ON event_subjects(entity_id, event_id);

    CREATE TABLE IF NOT EXISTS audit_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      canon_revision INTEGER NOT NULL,
      job_type TEXT NOT NULL,
      job_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'running', 'complete', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(novel_id, job_key)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_outbox_status_available
      ON audit_outbox(status, available_at);

    CREATE TABLE IF NOT EXISTS audit_runs (
      id TEXT PRIMARY KEY NOT NULL,
      job_id TEXT UNIQUE REFERENCES audit_outbox(id) ON DELETE SET NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      canon_revision INTEGER NOT NULL,
      kind TEXT NOT NULL,
      model_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('running', 'complete', 'failed')),
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_runs_novel_revision
      ON audit_runs(novel_id, canon_revision DESC);

    CREATE TABLE IF NOT EXISTS consistency_issues (
      id TEXT PRIMARY KEY NOT NULL,
      audit_run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      canon_revision INTEGER NOT NULL,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'warning', 'info')),
      subject TEXT,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      suggestion TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open', 'acknowledged', 'resolved', 'superseded')),
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_consistency_issues_novel_status
      ON consistency_issues(novel_id, status, severity, canon_revision DESC);

    CREATE TABLE IF NOT EXISTS projection_generations (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      through_canon_revision INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('building', 'active', 'failed', 'retired')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(novel_id, generation)
    );
    CREATE INDEX IF NOT EXISTS idx_projection_generations_status
      ON projection_generations(novel_id, status, generation DESC);

    CREATE INDEX IF NOT EXISTS idx_story_events_novel_canon
      ON story_events(novel_id, canon_revision, sequence);
    CREATE INDEX IF NOT EXISTS idx_story_events_chapter_revision
      ON story_events(chapter_revision_id);
  `);
  await db.execAsync('PRAGMA user_version = 7');
}

async function migrateToV8(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS story_projection_facts (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      id TEXT NOT NULL,
      fact_type TEXT NOT NULL,
      subject_id TEXT,
      content_json TEXT NOT NULL,
      source_event_id TEXT NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
      state_version INTEGER NOT NULL,
      canon_revision INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      stale INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(novel_id, generation, id)
    );
    CREATE INDEX IF NOT EXISTS idx_projection_facts_active_query
      ON story_projection_facts(novel_id, generation, stale, fact_type, state_version DESC);
    CREATE INDEX IF NOT EXISTS idx_projection_facts_source
      ON story_projection_facts(source_event_id, generation);

    INSERT OR IGNORE INTO story_projection_facts (
      novel_id, generation, id, fact_type, subject_id, content_json,
      source_event_id, state_version, canon_revision, confidence, locked, stale, updated_at
    )
    SELECT f.novel_id, 0, f.id, f.fact_type, f.subject_id, f.content_json,
      f.source_event_id, f.state_version, COALESCE(e.canon_revision, 0),
      f.confidence, f.locked, f.stale, f.updated_at
    FROM story_facts f
    LEFT JOIN story_events e ON e.id = f.source_event_id;

    INSERT OR IGNORE INTO projection_generations (
      novel_id, generation, through_canon_revision, status, created_at, updated_at
    )
    SELECT id, 0, canon_revision, 'active', updated_at, updated_at FROM novels;
  `);
  await db.execAsync('PRAGMA user_version = 8');
}

async function migrateToV9(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS story_entities (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      entity_id TEXT NOT NULL,
      entity_kind TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      distinguisher TEXT NOT NULL DEFAULT '',
      locked INTEGER NOT NULL DEFAULT 0,
      created_canon_revision INTEGER NOT NULL,
      updated_canon_revision INTEGER NOT NULL,
      source_event_id TEXT NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
      PRIMARY KEY(novel_id, generation, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_story_entities_name
      ON story_entities(novel_id, generation, canonical_name);

    CREATE TABLE IF NOT EXISTS entity_aliases (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      normalized_alias TEXT NOT NULL,
      alias TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      confidence REAL NOT NULL,
      authority TEXT NOT NULL CHECK(authority IN ('user', 'exact', 'model', 'imported')),
      source_event_id TEXT NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
      created_canon_revision INTEGER NOT NULL,
      PRIMARY KEY(novel_id, generation, normalized_alias, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_alias_lookup
      ON entity_aliases(novel_id, generation, normalized_alias, confidence DESC);

    CREATE TABLE IF NOT EXISTS entity_merge_candidates (
      id TEXT PRIMARY KEY NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      primary_entity_id TEXT NOT NULL,
      secondary_entity_id TEXT NOT NULL,
      confidence REAL NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'accepted', 'rejected', 'superseded')),
      created_canon_revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(novel_id, generation, primary_entity_id, secondary_entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_merge_candidates_pending
      ON entity_merge_candidates(novel_id, generation, status, confidence DESC);

    CREATE TABLE IF NOT EXISTS character_state_versions (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      character_id TEXT NOT NULL,
      valid_from_canon_revision INTEGER NOT NULL,
      valid_to_canon_revision INTEGER,
      chapter_index INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      locked INTEGER NOT NULL DEFAULT 0,
      source_event_id TEXT NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
      PRIMARY KEY(novel_id, generation, character_id, valid_from_canon_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_character_state_current
      ON character_state_versions(novel_id, generation, character_id, valid_to_canon_revision);

    CREATE TABLE IF NOT EXISTS world_fact_versions (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      fact_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      valid_from_canon_revision INTEGER NOT NULL,
      valid_to_canon_revision INTEGER,
      valid_from_chapter INTEGER NOT NULL,
      valid_to_chapter INTEGER,
      content_json TEXT NOT NULL,
      authority TEXT NOT NULL CHECK(authority IN ('user_locked', 'system_rule', 'model_observation', 'imported')),
      locked INTEGER NOT NULL DEFAULT 0,
      source_event_id TEXT NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
      PRIMARY KEY(novel_id, generation, fact_id, valid_from_canon_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_world_fact_current
      ON world_fact_versions(novel_id, generation, fact_id, valid_to_canon_revision);

    CREATE TABLE IF NOT EXISTS hook_versions (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      hook_id TEXT NOT NULL,
      valid_from_canon_revision INTEGER NOT NULL,
      valid_to_canon_revision INTEGER,
      status TEXT NOT NULL CHECK(status IN ('open', 'progressing', 'deferred', 'resolved')),
      chapter_index INTEGER NOT NULL,
      hook_json TEXT NOT NULL,
      source_event_id TEXT NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
      PRIMARY KEY(novel_id, generation, hook_id, valid_from_canon_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_hook_current_status
      ON hook_versions(novel_id, generation, status, valid_to_canon_revision);

    CREATE TABLE IF NOT EXISTS plot_thread_versions (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      thread_id TEXT NOT NULL,
      valid_from_canon_revision INTEGER NOT NULL,
      valid_to_canon_revision INTEGER,
      chapter_index INTEGER NOT NULL,
      progress_json TEXT NOT NULL,
      source_event_id TEXT NOT NULL REFERENCES story_events(id) ON DELETE CASCADE,
      PRIMARY KEY(novel_id, generation, thread_id, valid_from_canon_revision)
    );
    CREATE INDEX IF NOT EXISTS idx_plot_thread_current
      ON plot_thread_versions(novel_id, generation, thread_id, valid_to_canon_revision);
  `);
  await db.execAsync('PRAGMA user_version = 9');
}

async function migrateToV10(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS chapter_missions (
      id TEXT PRIMARY KEY NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_index INTEGER NOT NULL,
      canon_revision INTEGER NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 1,
      mission_json TEXT NOT NULL,
      red_lines_json TEXT NOT NULL DEFAULT '[]',
      hook_tasks_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL CHECK(status IN ('planned', 'used', 'verified', 'superseded')),
      verification_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(novel_id, chapter_index, canon_revision, attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_missions_current
      ON chapter_missions(novel_id, chapter_index, canon_revision DESC, attempt DESC);

    CREATE TABLE IF NOT EXISTS entity_redirects (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      secondary_entity_id TEXT NOT NULL,
      primary_entity_id TEXT NOT NULL,
      candidate_id TEXT REFERENCES entity_merge_candidates(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(novel_id, generation, secondary_entity_id)
    );
  `);
  await db.execAsync('PRAGMA user_version = 10');
}

async function migrateToV11(db: SQLiteDatabase) {
  await addColumnIfMissing(
    db,
    "ALTER TABLE chapter_missions ADD COLUMN feasibility_json TEXT NOT NULL DEFAULT '{}'",
  );
  await db.execAsync('PRAGMA user_version = 11');
}

async function migrateToV12(db: SQLiteDatabase) {
  await addColumnIfMissing(
    db,
    "ALTER TABLE messages ADD COLUMN world_id TEXT NOT NULL DEFAULT 'legacy'",
  );
  await addColumnIfMissing(
    db,
    "ALTER TABLE memories ADD COLUMN world_id TEXT NOT NULL DEFAULT 'legacy'",
  );
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_messages_novel_world_sequence ON messages(novel_id, world_id, sequence_no)');
  await db.execAsync('CREATE INDEX IF NOT EXISTS idx_memories_novel_world_type ON memories(novel_id, world_id, memory_type)');
  await db.execAsync('PRAGMA user_version = 12');
}

async function migrateToV13(db: SQLiteDatabase) {
  await addColumnIfMissing(
    db,
    "ALTER TABLE messages ADD COLUMN reasoning_content TEXT NOT NULL DEFAULT ''",
  );
  await db.execAsync('PRAGMA user_version = 13');
}

async function migrateToV14(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS character_biographies (
      id TEXT NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL,
      title TEXT NOT NULL,
      request TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(novel_id, character_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_character_biographies_owner
      ON character_biographies(novel_id, character_id, sort_order);
  `);
  await db.execAsync('PRAGMA user_version = 14');
}

async function migrateToV15(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS novel_slot_books (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      world_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      PRIMARY KEY(novel_id, world_id)
    );
    CREATE TABLE IF NOT EXISTS novel_slot_messages (
      novel_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      position INTEGER NOT NULL,
      message_json TEXT NOT NULL,
      PRIMARY KEY(novel_id, world_id, snapshot_key, position),
      FOREIGN KEY(novel_id, world_id) REFERENCES novel_slot_books(novel_id, world_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS novel_slot_snapshot_counts (
      novel_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      PRIMARY KEY(novel_id, world_id, snapshot_key),
      FOREIGN KEY(novel_id, world_id) REFERENCES novel_slot_books(novel_id, world_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS novel_conversation_state (
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      world_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      state_revision INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(novel_id, world_id)
    );
    CREATE TABLE IF NOT EXISTS novel_import_journal (
      novel_id TEXT PRIMARY KEY NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      metadata_json TEXT NOT NULL
    );
  `);
  await db.execAsync('PRAGMA user_version = 15');
}

async function migrateToV16(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS novel_chapter_backups (
      id TEXT PRIMARY KEY NOT NULL,
      novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      state_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      content_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_chapter_backups_novel_created
      ON novel_chapter_backups(novel_id, created_at);
  `);
  await db.execAsync('PRAGMA user_version = 16');
}

async function runMigrationTransaction<T>(db: SQLiteDatabase, task: () => Promise<T>) {
  if (typeof db.withTransactionAsync === 'function') {
    let result!: T;
    await db.withTransactionAsync(async () => {
      result = await task();
    });
    return result;
  }
  // Test doubles and older Expo SQLite shims may not expose transactions.
  return task();
}

/** Idempotent schema setup; never mutates or clears AsyncStorage. */
export async function migrateDatabase(db: SQLiteDatabase): Promise<DatabaseMigrationReport> {
  await db.execAsync('PRAGMA foreign_keys = ON');
  await db.execAsync('PRAGMA journal_mode = WAL');
  // Native SQLite writes can briefly overlap with knowledge-base/projection
  // persistence after analysis. Wait for the writer instead of failing the
  // user action with SQLITE_BUSY / "database is locked".
  await db.execAsync('PRAGMA busy_timeout = 10000');
  const fromVersion = await readUserVersion(db);

  if (fromVersion > DATABASE_VERSION) {
    throw new Error(
      '数据库版本 ' +
        String(fromVersion) +
        ' 高于当前应用支持的版本 ' +
        String(DATABASE_VERSION),
    );
  }

  const appliedVersions: number[] = [];
  if (fromVersion < 1) {
    await runMigrationTransaction(db, () => migrateToV1(db));
    appliedVersions.push(1);
  }
  if (fromVersion < 2) {
    await runMigrationTransaction(db, () => migrateToV2(db));
    appliedVersions.push(2);
  }
  if (fromVersion < 3) {
    await runMigrationTransaction(db, () => migrateToV3(db));
    appliedVersions.push(3);
  }
  if (fromVersion < 4) {
    await runMigrationTransaction(db, () => migrateToV4(db));
    appliedVersions.push(4);
  }
  if (fromVersion < 5) {
    await runMigrationTransaction(db, () => migrateToV5(db));
    appliedVersions.push(5);
  }
  if (fromVersion < 6) {
    await runMigrationTransaction(db, () => migrateToV6(db));
    appliedVersions.push(6);
  }
  if (fromVersion < 7) {
    await runMigrationTransaction(db, () => migrateToV7(db));
    appliedVersions.push(7);
  }
  if (fromVersion < 8) {
    await runMigrationTransaction(db, () => migrateToV8(db));
    appliedVersions.push(8);
  }
  if (fromVersion < 9) {
    await runMigrationTransaction(db, () => migrateToV9(db));
    appliedVersions.push(9);
  }
  if (fromVersion < 10) {
    await runMigrationTransaction(db, () => migrateToV10(db));
    appliedVersions.push(10);
  }
  if (fromVersion < 11) {
    await runMigrationTransaction(db, () => migrateToV11(db));
    appliedVersions.push(11);
  }
  if (fromVersion < 12) {
    await runMigrationTransaction(db, () => migrateToV12(db));
    appliedVersions.push(12);
  }
  if (fromVersion < 13) {
    await runMigrationTransaction(db, () => migrateToV13(db));
    appliedVersions.push(13);
  }
  if (fromVersion < 14) {
    await runMigrationTransaction(db, () => migrateToV14(db));
    appliedVersions.push(14);
  }
  if (fromVersion < 15) {
    await runMigrationTransaction(db, () => migrateToV15(db));
    appliedVersions.push(15);
  }
  if (fromVersion < 16) {
    await runMigrationTransaction(db, () => migrateToV16(db));
    appliedVersions.push(16);
  }

  return {
    fromVersion,
    toVersion: DATABASE_VERSION,
    appliedVersions,
  };
}

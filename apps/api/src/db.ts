import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

type Migration = {
  id: string;
  up: string;
};

const migrations: Migration[] = [
  {
    id: "001_init",
    up: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        roster_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS heroes_catalog (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_stats_json TEXT NOT NULL,
        skills_json TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_heroes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        catalog_id TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        awakens INTEGER NOT NULL DEFAULT 0,
        stats_override_json TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(catalog_id) REFERENCES heroes_catalog(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_user_heroes_user_id ON user_heroes(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_heroes_catalog_id ON user_heroes(catalog_id);

      CREATE TABLE IF NOT EXISTS teams (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        hero_ids_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_teams_user_id ON teams(user_id);

      CREATE TABLE IF NOT EXISTS npc_teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        team_snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS battle_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        seed INTEGER NOT NULL,
        engine_version TEXT NOT NULL,
        input_snapshot_json TEXT NOT NULL,
        result_summary_json TEXT NOT NULL,
        log_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_battle_logs_user_created ON battle_logs(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_battle_logs_kind_created ON battle_logs(kind, created_at);
    `
  }
];

export function migrate(db: Db) {
  // Ensure the migrations table exists before reading it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set<string>(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((r: any) => String(r.id))
  );

  const now = new Date().toISOString();
  const insert = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");

  db.transaction(() => {
    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      db.exec(m.up);
      insert.run(m.id, now);
    }
  })();
}

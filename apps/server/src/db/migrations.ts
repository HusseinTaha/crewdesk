import type { DatabaseSync } from "node:sqlite";

/** Ordered, append-only list of schema migrations. Index + 1 is the schema version. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    project_name TEXT,
    cwd TEXT,
    pid INTEGER,
    account TEXT,
    status TEXT NOT NULL,
    activity TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'NORMAL',
    message TEXT,
    payload TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY(session_id) REFERENCES agents(session_id)
  );
  CREATE INDEX idx_events_session ON events(session_id, created_at);
  CREATE INDEX idx_events_status ON events(status, created_at);

  CREATE TABLE responses (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    action TEXT NOT NULL,
    response TEXT,
    answers TEXT,
    source TEXT NOT NULL DEFAULT 'dashboard',
    created_at TEXT NOT NULL,
    FOREIGN KEY(event_id) REFERENCES events(id)
  );
  CREATE UNIQUE INDEX idx_responses_event ON responses(event_id);
  `,
];

export function migrate(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let version = row.user_version;
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]!);
      version += 1;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return version;
}

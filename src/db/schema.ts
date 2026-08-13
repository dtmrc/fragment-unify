import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
/** Default DB path: <repo>/data/unified.db (zero-config, gitignored). */
export const DEFAULT_DB_PATH =
  process.env.UNIFIED_DB_PATH ?? join(here, "..", "..", "data", "unified.db");

/**
 * Normalized schema.
 *
 * Rather than stuff merged records into one wide JSON blob, provenance lives in
 * its own row-per-field table and merged source ids in a join table. That is
 * the shape a query engine and an auditor actually want: you can ask "which
 * source won the phone for entity 12" or "which raw records fed this entity"
 * with a plain indexed join, and the `entities` table stays a clean,
 * well-typed system of record.
 */
const DDL = `
CREATE TABLE IF NOT EXISTS source_records (
  id           TEXT PRIMARY KEY,       -- e.g. "A3", "B7", "C1"
  source       TEXT NOT NULL CHECK (source IN ('A','B','C')),
  raw_json     TEXT NOT NULL,          -- original fields, verbatim
  norm_company TEXT NOT NULL,
  norm_contact TEXT NOT NULL,
  norm_email   TEXT NOT NULL,
  norm_phone   TEXT NOT NULL,
  norm_state   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company      TEXT NOT NULL,
  contactName  TEXT NOT NULL,
  email        TEXT NOT NULL,
  phone        TEXT NOT NULL,
  state        TEXT NOT NULL,
  confidence   REAL NOT NULL,
  reasoning    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS field_provenance (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,   -- company | contactName | email | phone | state
  source     TEXT NOT NULL CHECK (source IN ('A','B','C')),
  value      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_members (
  entity_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  record_id  TEXT NOT NULL REFERENCES source_records(id),
  PRIMARY KEY (entity_id, record_id)
);

-- Indexes chosen for the actual read paths:
--   * entities(state): the NL-query layer filters on state constantly
--     ("how many contacts in California?"), so it gets its own index.
--   * the two FKs power the provenance/members joins in GET /api/records.
CREATE INDEX IF NOT EXISTS idx_entities_state    ON entities(state);
CREATE INDEX IF NOT EXISTS idx_provenance_entity ON field_provenance(entity_id);
CREATE INDEX IF NOT EXISTS idx_members_entity    ON entity_members(entity_id);
`;

export type Db = Database.Database;

export function openDb(path: string = DEFAULT_DB_PATH): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function initSchema(db: Db): void {
  db.exec(DDL);
}

/** Clear all rows so a pipeline run rebuilds from scratch (idempotent runs). */
export function resetAll(db: Db): void {
  db.exec(`
    DELETE FROM entity_members;
    DELETE FROM field_provenance;
    DELETE FROM entities;
    DELETE FROM source_records;
  `);
}

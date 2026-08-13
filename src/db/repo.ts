import type { Db } from "./schema.js";
import type { SourceRecord, UnifiedEntity, Source } from "../types.js";

/** Persist the raw+normalized source records (the "fragmented" side). */
export function insertSourceRecords(db: Db, records: SourceRecord[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO source_records
       (id, source, raw_json, norm_company, norm_contact, norm_email, norm_phone, norm_state)
     VALUES (@id, @source, @raw_json, @company, @contact, @email, @phone, @state)`,
  );
  const tx = db.transaction((rows: SourceRecord[]) => {
    for (const r of rows) {
      stmt.run({
        id: r.id,
        source: r.source,
        raw_json: JSON.stringify(r.raw),
        company: r.normalized.company,
        contact: r.normalized.contactName,
        email: r.normalized.email,
        phone: r.normalized.phone,
        state: r.normalized.state,
      });
    }
  });
  tx(records);
}

/** Persist reconciled entities with provenance + membership, in one transaction. */
export function insertEntities(db: Db, entities: UnifiedEntity[]): void {
  const insEntity = db.prepare(
    `INSERT INTO entities (company, contactName, email, phone, state, confidence, reasoning)
     VALUES (@company, @contactName, @email, @phone, @state, @confidence, @reasoning)`,
  );
  const insProv = db.prepare(
    `INSERT INTO field_provenance (entity_id, field, source, value)
     VALUES (@entity_id, @field, @source, @value)`,
  );
  const insMember = db.prepare(
    `INSERT OR IGNORE INTO entity_members (entity_id, record_id) VALUES (@entity_id, @record_id)`,
  );

  const tx = db.transaction((rows: UnifiedEntity[]) => {
    for (const e of rows) {
      const info = insEntity.run({
        company: e.company,
        contactName: e.contactName,
        email: e.email,
        phone: e.phone,
        state: e.state,
        confidence: e.confidence,
        reasoning: e.reasoning,
      });
      const entityId = Number(info.lastInsertRowid);
      for (const p of e.provenance) {
        insProv.run({ entity_id: entityId, field: p.field, source: p.source, value: p.value });
      }
      for (const m of e.members) {
        insMember.run({ entity_id: entityId, record_id: m });
      }
    }
  });
  tx(entities);
}

export interface FragmentedRow {
  id: string;
  source: Source;
  raw: Record<string, string>;
  normalized: SourceRecord["normalized"];
}

/** The fragmented ("before") view: raw source rows grouped by source. */
export function getFragmented(db: Db): Record<Source, FragmentedRow[]> {
  const rows = db
    .prepare(`SELECT * FROM source_records ORDER BY id`)
    .all() as Array<Record<string, string>>;
  const grouped: Record<Source, FragmentedRow[]> = { A: [], B: [], C: [] };
  for (const r of rows) {
    grouped[r.source as Source].push({
      id: r.id!,
      source: r.source as Source,
      raw: JSON.parse(r.raw_json!),
      normalized: {
        company: r.norm_company!,
        contactName: r.norm_contact!,
        email: r.norm_email!,
        phone: r.norm_phone!,
        state: r.norm_state!,
      },
    });
  }
  return grouped;
}

export interface UnifiedRow {
  id: number;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  state: string;
  confidence: number;
  reasoning: string;
  provenance: { field: string; source: Source; value: string }[];
  members: string[];
}

/** The unified ("after") view: entities with provenance + member ids joined in. */
export function getUnified(db: Db): UnifiedRow[] {
  const entities = db
    .prepare(`SELECT * FROM entities ORDER BY company`)
    .all() as Array<Record<string, unknown>>;
  const provStmt = db.prepare(
    `SELECT field, source, value FROM field_provenance WHERE entity_id = ?`,
  );
  const memStmt = db.prepare(
    `SELECT record_id FROM entity_members WHERE entity_id = ? ORDER BY record_id`,
  );
  return entities.map((e) => {
    const id = Number(e.id);
    return {
      id,
      company: String(e.company),
      contactName: String(e.contactName),
      email: String(e.email),
      phone: String(e.phone),
      state: String(e.state),
      confidence: Number(e.confidence),
      reasoning: String(e.reasoning),
      provenance: provStmt.all(id) as UnifiedRow["provenance"],
      members: (memStmt.all(id) as Array<{ record_id: string }>).map((m) => m.record_id),
    };
  });
}

export function countEntities(db: Db): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM entities`).get() as { n: number };
  return row.n;
}

/**
 * Execute a read-only, already-parameterized query produced by the NL-query
 * compiler. The SQL is built entirely from the allowlist compiler (never from
 * user text), and we still assert SELECT-only as defense in depth.
 */
export function runReadonlyQuery(
  db: Db,
  sql: string,
  params: unknown[],
): Array<Record<string, unknown>> {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error("refusing to run a non-SELECT query");
  }
  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
}

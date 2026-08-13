import { describe, it, expect } from "vitest";
import {
  openDb,
  initSchema,
  insertSourceRecords,
  insertEntities,
  getFragmented,
  getUnified,
  countEntities,
  runReadonlyQuery,
} from "../src/db/index.js";
import { compileQuery } from "../src/query/compile.js";
import type { SourceRecord, UnifiedEntity } from "../src/types.js";

function record(id: string, source: SourceRecord["source"], company: string, state: string): SourceRecord {
  return {
    id,
    source,
    raw: { company, state },
    normalized: { company, contactName: "X", email: "x@y.com", phone: "+15125550190", state },
    blockKey: company.toLowerCase(),
  };
}

function entity(company: string, state: string, members: string[]): UnifiedEntity {
  return {
    company,
    contactName: "X",
    email: "x@y.com",
    phone: "+15125550190",
    state,
    confidence: 0.9,
    provenance: [{ field: "company", source: "A", value: company }],
    members,
    reasoning: "test",
  };
}

describe("sqlite read/write round-trip", () => {
  it("writes and reads source records + entities with provenance/members", () => {
    const db = openDb(":memory:");
    initSchema(db);

    insertSourceRecords(db, [
      record("A1", "A", "Acme", "CA"),
      record("B1", "B", "Acme", "CA"),
      record("A2", "A", "Globex", "NY"),
    ]);
    insertEntities(db, [entity("Acme", "CA", ["A1", "B1"]), entity("Globex", "NY", ["A2"])]);

    const frag = getFragmented(db);
    expect(frag.A).toHaveLength(2);
    expect(frag.B).toHaveLength(1);

    const unified = getUnified(db);
    expect(unified).toHaveLength(2);
    const acme = unified.find((e) => e.company === "Acme")!;
    expect(acme.members.sort()).toEqual(["A1", "B1"]);
    expect(acme.provenance[0]).toMatchObject({ field: "company", source: "A" });

    expect(countEntities(db)).toBe(2);
    db.close();
  });

  it("executes a compiled parameterized query against real rows", () => {
    const db = openDb(":memory:");
    initSchema(db);
    insertSourceRecords(db, [
      record("A1", "A", "Acme", "CA"),
      record("A2", "A", "Globex", "NY"),
      record("A3", "A", "Hooli", "CA"),
    ]);
    insertEntities(db, [entity("Acme", "CA", ["A1"]), entity("Globex", "NY", ["A2"]), entity("Hooli", "CA", ["A3"])]);

    const { sql, params } = compileQuery({
      operation: "count",
      filters: [{ column: "state", op: "=", value: "CA" }],
      limit: null,
      explanation: "count CA",
    });
    const rows = runReadonlyQuery(db, sql, params);
    expect(rows[0]).toEqual({ count: 2 });
    db.close();
  });

  it("refuses to run a non-SELECT statement", () => {
    const db = openDb(":memory:");
    initSchema(db);
    expect(() => runReadonlyQuery(db, "DELETE FROM entities", [])).toThrow(/non-SELECT/);
    db.close();
  });
});

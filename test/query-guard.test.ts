import { describe, it, expect } from "vitest";
import { compileQuery } from "../src/query/compile.js";
import { QuerySpecZ, type QuerySpec } from "../src/types.js";

describe("compileQuery — parameterization & allowlist guard", () => {
  it("compiles a count with a parameterized state filter", () => {
    const spec: QuerySpec = {
      operation: "count",
      filters: [{ column: "state", op: "=", value: "CA" }],
      limit: null,
      explanation: "count in CA",
    };
    const { sql, params } = compileQuery(spec);
    expect(sql).toBe("SELECT COUNT(*) AS count FROM entities WHERE state = ?");
    expect(params).toEqual(["CA"]);
  });

  it("wraps LIKE values with % and binds them", () => {
    const spec: QuerySpec = {
      operation: "select",
      filters: [{ column: "email", op: "LIKE", value: "acme" }],
      limit: 10,
      explanation: "emails containing acme",
    };
    const { sql, params } = compileQuery(spec);
    expect(sql).toContain("email LIKE ?");
    expect(sql.trim().endsWith("LIMIT ?")).toBe(true);
    expect(params).toEqual(["%acme%", 10]);
  });

  it("NEUTRALIZES an injection attempt — the payload is a bound value, not SQL", () => {
    const spec: QuerySpec = {
      operation: "select",
      filters: [{ column: "company", op: "=", value: "x'; DROP TABLE entities;--" }],
      limit: 5,
      explanation: "malicious value",
    };
    const { sql, params } = compileQuery(spec);
    // The dangerous string appears ONLY as a bound parameter, never in the SQL text.
    expect(sql).not.toContain("DROP");
    expect(sql).toContain("company = ?");
    expect(params[0]).toBe("x'; DROP TABLE entities;--");
  });

  it("rejects a column outside the allowlist (defense in depth)", () => {
    // Force-cast past the type system to simulate a compromised/hallucinated spec.
    const evil = {
      operation: "select",
      filters: [{ column: "password", op: "=", value: "y" }],
      limit: 5,
      explanation: "x",
    } as unknown as QuerySpec;
    expect(() => compileQuery(evil)).toThrow(/not allowlisted/);
  });
});

describe("QuerySpecZ schema", () => {
  it("rejects an un-allowlisted column at the schema boundary", () => {
    const parsed = QuerySpecZ.safeParse({
      operation: "select",
      filters: [{ column: "ssn", op: "=", value: "1" }],
      limit: null,
      explanation: "x",
    });
    expect(parsed.success).toBe(false);
  });
  it("rejects an un-allowlisted operator", () => {
    const parsed = QuerySpecZ.safeParse({
      operation: "count",
      filters: [{ column: "state", op: "OR 1=1", value: "1" }],
      limit: null,
      explanation: "x",
    });
    expect(parsed.success).toBe(false);
  });
  it("accepts a valid spec", () => {
    const parsed = QuerySpecZ.safeParse({
      operation: "count",
      filters: [{ column: "state", op: "=", value: "CA" }],
      limit: null,
      explanation: "x",
    });
    expect(parsed.success).toBe(true);
  });
});

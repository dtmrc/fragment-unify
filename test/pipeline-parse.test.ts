import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { InferredSchemaZ, FieldMappingZ, ReconcileResultZ } from "../src/types.js";

/**
 * The Claude-dependent stages can't be exercised without an API key, but their
 * STRUCTURED-OUTPUT PARSING can: these tests validate captured example
 * responses against the exact Zod schemas handed to the SDK. If the schema and
 * the shape the model must return ever drift apart, these fail — no key needed.
 */
const dir = dirname(fileURLToPath(import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(join(dir, "fixtures", name), "utf8"));

describe("structured-output parsing (fixtures, no API key)", () => {
  it("infer-schema fixture matches InferredSchemaZ", () => {
    const parsed = InferredSchemaZ.safeParse(load("infer-schema.json"));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.unifiedSchema.fields.length).toBe(5);
  });

  it("map-fields fixture (all sources) matches FieldMappingZ", () => {
    const arr = load("map-fields.json") as unknown[];
    expect(Array.isArray(arr)).toBe(true);
    for (const m of arr) {
      expect(FieldMappingZ.safeParse(m).success).toBe(true);
    }
  });

  it("reconcile fixture matches ReconcileResultZ, with valid provenance", () => {
    const parsed = ReconcileResultZ.safeParse(load("reconcile.json"));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const acme = parsed.data.entities[0]!;
      expect(acme.members.length).toBe(4);
      expect(acme.confidence).toBeGreaterThan(0.9);
      expect(acme.provenance.every((p) => ["A", "B", "C"].includes(p.source))).toBe(true);
    }
  });

  it("rejects a malformed reconcile response (confidence out of range)", () => {
    const bad = {
      entities: [
        {
          company: "X", contactName: "Y", email: "e", phone: "p", state: "CA",
          confidence: 1.7, provenance: [], members: [], reasoning: "r",
        },
      ],
    };
    expect(ReconcileResultZ.safeParse(bad).success).toBe(false);
  });

  it("rejects a mapping onto a non-existent unified field", () => {
    const bad = { source: "A", mappings: [{ sourceField: "X", unifiedField: "zipcode", note: "n" }] };
    expect(FieldMappingZ.safeParse(bad).success).toBe(false);
  });
});

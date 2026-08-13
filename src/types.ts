import { z } from "zod";

/**
 * Shared types + Zod schemas for the whole app.
 *
 * The Zod schemas do double duty:
 *  1. They are handed to the Anthropic SDK (`zodOutputFormat`) so every Claude
 *     response is *validated against a schema*, not free-text-parsed.
 *  2. The same schemas validate captured fixture responses in the test suite,
 *     so the structured-output parsing is tested without an API key.
 */

/** The three source identifiers, used everywhere for provenance. */
export const SOURCES = ["A", "B", "C"] as const;
export type Source = (typeof SOURCES)[number];

/**
 * The canonical unified fields the persisted store is keyed on.
 *
 * Claude *proposes* a unified schema at runtime (see infer-schema), which we
 * surface for transparency — but the SQLite store uses this fixed, well-typed
 * canonical set so the DB schema, indexes, and the NL-query allowlist are
 * stable and safe. This is a deliberate, honest design choice: agentic
 * inference for insight, a deterministic schema for the system of record.
 */
export const UNIFIED_FIELDS = [
  "company",
  "contactName",
  "email",
  "phone",
  "state",
] as const;
export type UnifiedField = (typeof UNIFIED_FIELDS)[number];

/** A single record read from a source, after deterministic normalization. */
export interface SourceRecord {
  /** Stable id, e.g. "A3", "B7", "C1". */
  id: string;
  source: Source;
  /** Raw values exactly as they appeared in the source. */
  raw: Record<string, string>;
  /** Deterministically normalized canonical view (phone/state cleaned). */
  normalized: {
    company: string;
    contactName: string;
    email: string;
    phone: string;
    state: string;
  };
  /** Deterministic blocking key used to group merge candidates. */
  blockKey: string;
}

/** Per-field provenance on a merged entity: which source won, and its value. */
export interface FieldProvenance {
  field: UnifiedField;
  source: Source;
  value: string;
}

/** A reconciled, merged real-world entity. */
export interface UnifiedEntity {
  company: string;
  contactName: string;
  email: string;
  phone: string;
  state: string;
  /** 0..1 confidence that the merged members are the same entity. */
  confidence: number;
  provenance: FieldProvenance[];
  /** Source-record ids that were merged into this entity. */
  members: string[];
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Zod schemas for Claude structured outputs
// ---------------------------------------------------------------------------

/** Stage 1 — infer-schema. Claude proposes a unified schema. */
export const InferredSchemaZ = z.object({
  unifiedSchema: z.object({
    fields: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        description: z.string(),
      }),
    ),
  }),
  rationale: z.string(),
});
export type InferredSchema = z.infer<typeof InferredSchemaZ>;

/** Stage 2 — map-fields. Claude maps one source's fields onto the unified schema. */
export const FieldMappingZ = z.object({
  source: z.enum(SOURCES),
  mappings: z.array(
    z.object({
      sourceField: z.string(),
      // null === "no sensible unified target for this source field"
      unifiedField: z.enum(UNIFIED_FIELDS).nullable(),
      note: z.string(),
    }),
  ),
});
export type FieldMapping = z.infer<typeof FieldMappingZ>;

/** Stage 3 — reconcile. Claude clusters + merges a batch of candidate records. */
export const ReconcileResultZ = z.object({
  entities: z.array(
    z.object({
      company: z.string(),
      contactName: z.string(),
      email: z.string(),
      phone: z.string(),
      state: z.string(),
      confidence: z.number().min(0).max(1),
      provenance: z.array(
        z.object({
          field: z.enum(UNIFIED_FIELDS),
          source: z.enum(SOURCES),
          value: z.string(),
        }),
      ),
      members: z.array(z.string()),
      reasoning: z.string(),
    }),
  ),
});
export type ReconcileResult = z.infer<typeof ReconcileResultZ>;

// ---------------------------------------------------------------------------
// NL query
// ---------------------------------------------------------------------------

/**
 * Columns the NL-query layer is allowed to touch. Anything outside this set is
 * rejected before a query is ever built — the first line of the injection
 * defense (the second is parameterized values; see query/compile.ts).
 */
export const QUERYABLE_COLUMNS = [
  "company",
  "contactName",
  "email",
  "phone",
  "state",
  "confidence",
] as const;
export type QueryableColumn = (typeof QUERYABLE_COLUMNS)[number];

export const QUERY_OPS = ["=", "!=", "LIKE", ">", "<", ">=", "<="] as const;
export type QueryOp = (typeof QUERY_OPS)[number];

/**
 * Claude does NOT emit raw SQL. It emits this constrained, allowlisted query
 * spec; deterministic code (query/compile.ts) compiles it into a *parameterized*
 * SQL string. This keeps NL understanding agentic while making injection
 * structurally impossible.
 */
export const QuerySpecZ = z.object({
  operation: z.enum(["count", "select"]),
  filters: z.array(
    z.object({
      column: z.enum(QUERYABLE_COLUMNS),
      op: z.enum(QUERY_OPS),
      value: z.string(),
    }),
  ),
  limit: z.number().int().positive().max(500).nullable(),
  explanation: z.string(),
});
export type QuerySpec = z.infer<typeof QuerySpecZ>;

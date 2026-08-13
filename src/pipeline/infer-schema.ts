import { callStructured } from "../config.js";
import { InferredSchemaZ, type InferredSchema, type SourceRecord } from "../types.js";

/**
 * STAGE 1 (agentic) — schema inference.
 *
 * Claude is shown a small sample of each source's RAW fields (deliberately not
 * the normalized view — we want it to see the divergence) and proposes a single
 * unified schema. This output is surfaced for transparency; the persisted store
 * uses the app's fixed canonical schema (see types.ts). Deterministic glue did
 * the parsing; the model does the cross-schema reasoning.
 */
const SYSTEM = `You are a data-integration engineer. You are given small samples from three
data sources that describe the SAME kind of real-world thing (companies and their
contacts) but with DIFFERENT field names, shapes, and formats. Propose ONE unified
schema that all three can map onto: a small set of well-named fields, each with a
type and a one-line description. Prefer concise, canonical field names.`;

function sampleFields(records: SourceRecord[], n: number): string {
  return JSON.stringify(
    records.slice(0, n).map((r) => r.raw),
    null,
    2,
  );
}

export async function inferSchema(
  a: SourceRecord[],
  b: SourceRecord[],
  c: SourceRecord[],
): Promise<InferredSchema> {
  const user = `Source A (CSV export) sample:
${sampleFields(a, 3)}

Source B (JSON API payload) sample:
${sampleFields(b, 3)}

Source C (scraped HTML table) sample:
${sampleFields(c, 3)}

Propose the unified schema.`;

  return callStructured(InferredSchemaZ, { system: SYSTEM, user, maxTokens: 2048 });
}

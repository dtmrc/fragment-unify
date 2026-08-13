import type { Db } from "../db/index.js";
import { initSchema, resetAll, insertSourceRecords, insertEntities } from "../db/index.js";
import { loadSources } from "../parse/index.js";
import type { FieldMapping, InferredSchema } from "../types.js";
import { inferSchema } from "./infer-schema.js";
import { mapAllSources } from "./map-fields.js";
import { reconcile, type ReconcileProgress } from "./reconcile.js";

export interface PipelineSummary {
  inferredSchema: InferredSchema;
  mappings: FieldMapping[];
  counts: {
    sourceRecords: number;
    bySource: { A: number; B: number; C: number };
    unifiedEntities: number;
  };
}

/**
 * Full pipeline: ingest (deterministic) -> infer schema -> map fields ->
 * reconcile (agentic), persisting the fragmented and unified views to SQLite.
 * Rebuilds from scratch each run so it is idempotent.
 */
export async function runPipeline(
  db: Db,
  onProgress?: (p: ReconcileProgress) => void,
): Promise<PipelineSummary> {
  initSchema(db);
  resetAll(db);

  // 1. Deterministic ingest + persist the fragmented side.
  const { a, b, c, all } = loadSources();
  insertSourceRecords(db, all);

  // 2. Agentic: propose a unified schema from raw samples.
  const inferredSchema = await inferSchema(a, b, c);

  // 3. Agentic: map each source's fields onto the unified schema (concurrent).
  const mappings = await mapAllSources(
    [
      { source: "A", records: a },
      { source: "B", records: b },
      { source: "C", records: c },
    ],
    inferredSchema,
  );

  // 4. Deterministic blocking + agentic reconcile (batched), then persist.
  const entities = await reconcile(all, onProgress);
  insertEntities(db, entities);

  return {
    inferredSchema,
    mappings,
    counts: {
      sourceRecords: all.length,
      bySource: { A: a.length, B: b.length, C: c.length },
      unifiedEntities: entities.length,
    },
  };
}

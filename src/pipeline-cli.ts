/**
 * CLI entry: run the full pipeline against data/unified.db and print a summary.
 *   npm run pipeline
 * Exits 1 with the exact "set ANTHROPIC_API_KEY" message if the key is unset.
 */
import { openDb } from "./db/index.js";
import { runPipeline } from "./pipeline/run.js";
import { MissingApiKeyError, hasApiKey } from "./config.js";

async function main(): Promise<void> {
  if (!hasApiKey()) {
    console.error("set ANTHROPIC_API_KEY to run the pipeline");
    process.exit(1);
  }
  const db = openDb();
  console.log("running pipeline (ingest -> infer schema -> map fields -> reconcile)...");
  const summary = await runPipeline(db, (p) => {
    console.log(`  reconcile batch ${p.batch}/${p.totalBatches} — ${p.entitiesSoFar} entities so far`);
  });

  console.log("\nProposed unified schema (from Claude):");
  for (const f of summary.inferredSchema.unifiedSchema.fields) {
    console.log(`  - ${f.name} (${f.type}): ${f.description}`);
  }
  console.log(`\nSource records: ${summary.counts.sourceRecords} ` +
    `(A=${summary.counts.bySource.A}, B=${summary.counts.bySource.B}, C=${summary.counts.bySource.C})`);
  console.log(`Unified entities: ${summary.counts.unifiedEntities}`);
  console.log("done. start the server and open the UI to explore, or query /api/query.");
}

main().catch((err) => {
  if (err instanceof MissingApiKeyError) {
    console.error(err.message);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});

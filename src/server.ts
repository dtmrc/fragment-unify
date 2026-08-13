import express, { type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb, initSchema, getFragmented, getUnified, countEntities, type Db } from "./db/index.js";
import { runPipeline } from "./pipeline/run.js";
import { nlQuery } from "./query/nl-query.js";
import { MissingApiKeyError, hasApiKey } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, "..", "public");

/** Build the Express app around an already-open DB (injectable for tests). */
export function createApp(db: Db) {
  initSchema(db);
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  // Health check for Render/Railway.
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true, hasApiKey: hasApiKey(), entities: countEntities(db) });
  });

  // Run the full ingest + reconcile pipeline.
  app.post("/api/pipeline/run", async (_req: Request, res: Response) => {
    try {
      const summary = await runPipeline(db);
      res.json({ ok: true, summary });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Before/after data for the UI: fragmented sources + unified entities.
  app.get("/api/records", (_req: Request, res: Response) => {
    res.json({
      fragmented: getFragmented(db),
      unified: getUnified(db),
      count: countEntities(db),
    });
  });

  // Natural-language query over the unified schema.
  app.post("/api/query", async (req: Request, res: Response) => {
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) {
      res.status(400).json({ ok: false, error: "missing 'question'" });
      return;
    }
    if (countEntities(db) === 0) {
      res.status(409).json({ ok: false, error: "no unified data yet — run the pipeline first" });
      return;
    }
    try {
      const result = await nlQuery(db, question);
      res.json({ ok: true, ...result });
    } catch (err) {
      handleError(res, err);
    }
  });

  return app;
}

function handleError(res: Response, err: unknown): void {
  if (err instanceof MissingApiKeyError) {
    // 400 with the exact, actionable message — never a silent mock.
    res.status(400).json({ ok: false, error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "unknown error";
  // eslint-disable-next-line no-console
  console.error("[fragment-unify] error:", err);
  res.status(500).json({ ok: false, error: message });
}

export function startServer(): void {
  const port = Number(process.env.PORT ?? 3000);
  const db = openDb();
  const app = createApp(db);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`fragment-unify listening on http://localhost:${port}`);
    if (!hasApiKey()) {
      // eslint-disable-next-line no-console
      console.log("note: ANTHROPIC_API_KEY is unset — set it to run the pipeline");
    }
  });
}

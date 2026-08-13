# Fragment→Unify

Ingests **three deliberately messy, schema-divergent sources** describing the same
real-world things (companies + their contacts) and uses an **agentic Claude
pipeline** to reconcile them into **one unified, queryable schema** — with per-field
source provenance and a natural-language query layer on top.

It's a small, honest demonstration of three things: 0→1 build speed, Claude-native
(agentic) development, and the data-fragmentation problem domain.

- **Source A** — `data/source-a.csv`: messy CSV (`Company Name`, `contact`, `Phone`, …), inconsistent casing, varied US phone/state formats, intra-source dupes.
- **Source B** — `data/source-b.json`: API-style payload with a *different shape* (`organization`, `primaryEmail`, `tel`, `hqState`), overlapping entities, a few conflicting values.
- **Source C** — `data/source-c.html`: scraped-page `<table>`, a third schema variant (`Company`, `Rep`, `Telephone`, `Location`, `Contact Email`).

---

## Architecture

```
 data/source-a.csv ─┐
 data/source-b.json ─┼─▶ [DETERMINISTIC ingest]  parse + normalize (phone→E.164,
 data/source-c.html ─┘        src/parse/*, src/normalize.ts   state→USPS, block keys)
                                        │
                                        ▼
                        ┌───────────────────────────────────┐
                        │  AGENTIC pipeline (Claude, sonnet) │
                        │  1. infer-schema   propose unified │
                        │  2. map-fields     per-source map  │
                        │  3. reconcile      cluster + merge  │  ← batched ("at scale")
                        └───────────────────────────────────┘
                                        │  UnifiedEntity[] (+provenance, confidence)
                                        ▼
                     [DETERMINISTIC] SQLite (better-sqlite3)
                     normalized schema: entities · field_provenance · entity_members
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                        ▼
      GET /api/records (before/after)        POST /api/query  NL → allowlisted
      single-page UI w/ provenance badges     QuerySpec → parameterized SQL → rows
```

### Agentic vs. deterministic — the deliberate split

The interesting decisions are split on purpose, and the code comments say which is which:

| Deterministic (plain TypeScript) | Agentic (Claude) |
| --- | --- |
| CSV / JSON / HTML parsing (`src/parse/*`) | **infer-schema** — propose a unified schema from raw samples |
| Phone → E.164, state → USPS code, email/text cleanup (`src/normalize.ts`) | **map-fields** — map each source's field names onto the unified schema |
| Blocking / dedupe keys that group merge candidates | **reconcile** — decide which records are the *same* real-world entity, merge them, resolve field conflicts, report per-field provenance + confidence |
| SQLite schema, indexes, read/write (`src/db/*`) | **nl-query** — turn a question into a constrained query spec |
| **NL-query SQL compilation** (`src/query/compile.ts`) — allowlisted columns/ops + parameterized values | |

Blocking is deterministic and cheap; Claude only ever reasons about small candidate
buckets and does the part it's genuinely good at (fuzzy entity resolution + conflict
resolution). Reconcile **batches the blocks** through the model in bounded chunks — the
nod to running "Claude at scale."

### Structured outputs, not free-text parsing

Every Claude call goes through one choke point (`src/config.ts` → `callStructured`)
that uses the SDK's `messages.parse` with a **Zod-derived JSON schema**, so each
response is validated against a schema (`parsed_output`) rather than string-parsed.
The same Zod schemas validate captured fixtures in the test suite, so the parsing is
tested **without an API key**.

### Safety of the NL-query layer

Claude never emits raw SQL. It emits an **allowlisted `QuerySpec`** (`operation`,
`filters` with allowlisted columns + operators, `limit`). Deterministic code
(`src/query/compile.ts`) compiles that into a **parameterized** SQL string: column
names are the only thing interpolated and are checked against a hardcoded allowlist;
every value is bound as a `?` parameter. An injection payload like
`California'; DROP TABLE entities;--` is passed to SQLite as an inert bound string.
The generated SQL + params are returned to the UI for transparency. See
`test/query-guard.test.ts` for the injection-neutralization proof.

---

## Run locally

```bash
npm install
cp .env.example .env          # then put your key in it (see below)
npm run dev                   # starts http://localhost:3000
```

Open http://localhost:3000 and click **Run pipeline**. The app also runs without a
key — you'll just get a clear `set ANTHROPIC_API_KEY to run the pipeline` message from
the pipeline / query endpoints instead of a silent mock.

### Run the pipeline from the CLI

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # required
npm run pipeline                        # ingest → infer → map → reconcile → SQLite
```

### Env vars

| Var | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | for the pipeline & NL query | Anthropic API key (model: `claude-sonnet-5`) |
| `PORT` | no | HTTP port (default 3000) |
| `UNIFIED_DB_PATH` | no | SQLite path (default `data/unified.db`) |

## Test

```bash
npm test        # vitest
npm run typecheck
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/pipeline/run` | Run the full ingest + reconcile pipeline |
| `GET`  | `/api/records` | Fragmented (before) + unified (after) data |
| `POST` | `/api/query` | `{ "question": "..." }` → generated SQL + rows |
| `GET`  | `/healthz` | Health check (used by Render/Railway) |

## Deploy

Two zero-fuss options — pick one:

- **Render (blueprint):** push to a Git repo, then on render.com choose *New → Blueprint*
  and point it at `render.yaml`. Set `ANTHROPIC_API_KEY` in the dashboard. Health check
  is `/healthz`.
- **Docker (Railway / anywhere):** the repo ships a `Dockerfile` (builds TypeScript,
  runs `npm start`, reads `PORT` from env, has a `HEALTHCHECK`). On Railway: *New →
  Deploy from repo*, it auto-detects the Dockerfile; add `ANTHROPIC_API_KEY`.

The SQLite DB is a local file (`data/unified.db`) created on first run — no external
database to provision. Note that on ephemeral hosts the DB resets on redeploy; click
**Run pipeline** again to rebuild it (that's fine for a demo).

---

## What's real / what's demo-scale

**Real:**
- The three Claude pipeline stages make genuine Anthropic API calls with validated
  structured outputs. No mock is presented as working — an unset key gives a clear error.
- Deterministic normalization, parsing, blocking, SQLite persistence, and the NL→SQL
  safety compiler are real, tested code (`npm test`).
- Provenance, confidence, and merge membership are persisted in a normalized schema
  and surfaced in the UI.

**Demo-scale / honest limitations:**
- Data is ~25+12+10 hand-authored, realistic-but-fake rows — small enough that blocking
  keeps every candidate bucket tiny. The batching in `reconcile.ts` is structured for
  scale (block → chunk → stream) but hasn't been load-tested at millions of records.
- The persisted store uses a **fixed canonical schema** (company, contactName, email,
  phone, state). Claude's *inferred* schema is surfaced for transparency but doesn't
  dynamically re-shape the database — a deliberate choice so the DB, indexes, and
  query allowlist stay well-typed and safe.
- The HTML parser is a small regex extractor scoped to the known table shape, not a
  general DOM parser.
- SQLite on an ephemeral host is not durable across redeploys (see Deploy note).

## Project layout

```
src/
  normalize.ts        deterministic phone/state/company/block-key normalization
  config.ts           Anthropic client + callStructured (schema-validated calls)
  types.ts            shared types + Zod schemas (SDK output + test validation)
  parse/              csv.ts · json.ts · html.ts · index.ts  (deterministic ingest)
  pipeline/
    infer-schema.ts   stage 1 (agentic)
    map-fields.ts     stage 2 (agentic)
    reconcile.ts      stage 3 (agentic) — deterministic blocking + batched merge
    run.ts            orchestrator
  db/                 schema.ts (DDL + indexes) · repo.ts (read/write) · index.ts
  query/
    compile.ts        deterministic allowlist + parameterized SQL compiler
    nl-query.ts       NL → QuerySpec (agentic) → compile → execute
  server.ts           Express app + routes
  index.ts            server entry
  pipeline-cli.ts     `npm run pipeline`
public/index.html     single-page UI (before/after + provenance badges + NL query)
data/                 source-a.csv · source-b.json · source-c.html (+ unified.db at runtime)
test/                 vitest suites + captured fixtures
```

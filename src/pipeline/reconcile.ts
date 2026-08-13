import { callStructured } from "../config.js";
import { ReconcileResultZ, type SourceRecord, type UnifiedEntity } from "../types.js";

/**
 * STAGE 3 (agentic) — entity resolution + conflict resolution.
 *
 * Split of responsibilities (this hybrid split IS the selling point):
 *
 *   DETERMINISTIC (here, plain TS):
 *     - group records into coarse "blocks" via the deterministic block key
 *       (normalize.ts). Blocking is cheap and reproducible and keeps the model's
 *       job small — it never has to consider all O(n^2) record pairs.
 *     - batch the blocks into chunks and stream them through Claude. This is the
 *       "Claude at scale" nod: real fragmentation problems have millions of
 *       records; you block, then fan the blocks through the model in bounded
 *       chunks (here BLOCKS_PER_BATCH) so no single request is unbounded.
 *
 *   AGENTIC (Claude):
 *     - WITHIN each block, decide which records are actually the same
 *       real-world entity (a block may contain a false-positive that must NOT
 *       merge, or two distinct entities) and MERGE them.
 *     - resolve field conflicts with a stated rule and report, per field, which
 *       source won + a confidence + its reasoning.
 */

/** How many candidate blocks to send per Claude call. Tune for throughput/cost. */
const BLOCKS_PER_BATCH = 8;

const CONFLICT_RULE = `When the same field has different values across the merged records,
choose the winner by this rule, in order:
  1. Prefer the most COMPLETE / specific value (non-empty, fuller name, full email).
  2. If still tied, prefer the most authoritative & recent source. Source B is a
     dated CRM export (most recent); then A (primary CSV); then C (scraped page).
Report, per unified field, which source's value you kept.`;

const SYSTEM = `You are an entity-resolution engine. You are given GROUPS of candidate
records. Records were pre-grouped by a deterministic blocking key, so records in the
SAME group are LIKELY (not guaranteed) to be the same company+contact.

For EACH group:
- Cluster the records that truly refer to the same real-world entity. A group may
  contain records that should NOT merge (keep them as separate entities), or may be
  a single record.
- Merge each cluster into one unified entity with fields: company, contactName,
  email, phone, state.
- ${CONFLICT_RULE}
- "members" is the list of record ids you merged into that entity.
- "provenance" is one entry PER unified field naming the source (A/B/C) whose value
  you kept and the value itself.
- "confidence" (0..1) is how sure you are the members are the same entity (1.0 for a
  singleton with no ambiguity).
- NEVER merge records from different groups together.
Values are already normalized (phone as +1XXXXXXXXXX, state as 2-letter code).`;

function renderRecord(r: SourceRecord): Record<string, string> {
  return {
    id: r.id,
    source: r.source,
    company: r.normalized.company,
    contactName: r.normalized.contactName,
    email: r.normalized.email,
    phone: r.normalized.phone,
    state: r.normalized.state,
  };
}

/** Deterministic blocking: group records by block key. */
export function buildBlocks(records: SourceRecord[]): SourceRecord[][] {
  const map = new Map<string, SourceRecord[]>();
  for (const r of records) {
    const list = map.get(r.blockKey);
    if (list) list.push(r);
    else map.set(r.blockKey, [r]);
  }
  return [...map.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ReconcileProgress {
  batch: number;
  totalBatches: number;
  entitiesSoFar: number;
}

/**
 * Reconcile all records into merged entities.
 * `onProgress` lets callers stream batch-by-batch progress (used by the CLI).
 */
export async function reconcile(
  records: SourceRecord[],
  onProgress?: (p: ReconcileProgress) => void,
): Promise<UnifiedEntity[]> {
  const blocks = buildBlocks(records);
  const batches = chunk(blocks, BLOCKS_PER_BATCH);
  const entities: UnifiedEntity[] = [];

  // Batches are processed sequentially to keep memory/rate-limit pressure flat;
  // within the "at scale" framing these could be a bounded-concurrency queue.
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;
    const groupsPayload = batch.map((group, gi) => ({
      group: gi,
      records: group.map(renderRecord),
    }));

    const user = `Candidate groups (${batch.length}):
${JSON.stringify(groupsPayload, null, 2)}

Resolve and merge. Return one unified entity per real-world entity.`;

    const result = await callStructured(ReconcileResultZ, {
      system: SYSTEM,
      user,
      maxTokens: 8192,
    });

    for (const e of result.entities) entities.push(e);
    onProgress?.({ batch: i + 1, totalBatches: batches.length, entitiesSoFar: entities.length });
  }

  return entities;
}

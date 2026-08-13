import { callStructured } from "../config.js";
import {
  FieldMappingZ,
  UNIFIED_FIELDS,
  type FieldMapping,
  type InferredSchema,
  type Source,
  type SourceRecord,
} from "../types.js";

/**
 * STAGE 2 (agentic) — field mapping.
 *
 * For each source independently, Claude maps that source's raw field names onto
 * the canonical unified fields. Running it per source (rather than one giant
 * call) keeps each prompt tiny and is the natural unit to parallelize.
 */
const SYSTEM = `You map one data source's field names onto a fixed unified schema.
The unified fields are exactly: ${UNIFIED_FIELDS.join(", ")}.
- company:     company / organization name
- contactName: the contact person's name
- email:       contact email address
- phone:       phone number
- state:       US state (or the state embedded in a location string)
For each raw field in the source, output which unified field it maps to, or null if
it maps to none. Add a short note per mapping.`;

export async function mapFields(
  source: Source,
  records: SourceRecord[],
  inferred: InferredSchema,
): Promise<FieldMapping> {
  const sampleRaw = records[0]?.raw ?? {};
  const user = `Unified schema proposed earlier (for context):
${JSON.stringify(inferred.unifiedSchema.fields, null, 2)}

Source ${source} raw field names and an example row:
${JSON.stringify(sampleRaw, null, 2)}

Produce the field mapping for source ${source}.`;

  return callStructured(FieldMappingZ, { system: SYSTEM, user, maxTokens: 1536 });
}

/** Map all three sources. Fired concurrently — independent calls. */
export async function mapAllSources(
  sources: { source: Source; records: SourceRecord[] }[],
  inferred: InferredSchema,
): Promise<FieldMapping[]> {
  return Promise.all(sources.map((s) => mapFields(s.source, s.records, inferred)));
}

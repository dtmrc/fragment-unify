import { callStructured } from "../config.js";
import { QuerySpecZ, QUERYABLE_COLUMNS, QUERY_OPS, type QuerySpec } from "../types.js";
import { compileQuery } from "./compile.js";
import { runReadonlyQuery, type Db } from "../db/index.js";

const SYSTEM = `You translate a natural-language question about a table of companies
and their contacts into a STRUCTURED query specification (never raw SQL).

The table "entities" has exactly these columns:
- company      (text)  company name
- contactName  (text)  the contact person's name
- email        (text)  contact email
- phone        (text)  E.164 phone, e.g. +14155550132
- state        (text)  2-letter USPS code, e.g. CA, NY, TX, WA
- confidence   (number 0..1) merge confidence

Rules:
- Choose operation "count" for "how many"/"number of" questions, else "select".
- Only reference the columns above. Only use operators: ${QUERY_OPS.join(", ")}.
- For state filters, ALWAYS use the 2-letter code (California -> CA, New York -> NY).
- For substring/partial matches use LIKE with the bare term (no % signs; those are added downstream).
- Set limit to null for counts, or a small positive integer for selects (default around 100).
- Put a one-sentence plain-English restatement in "explanation".`;

export interface NlQueryResult {
  spec: QuerySpec;
  sql: string;
  params: unknown[];
  rows: Array<Record<string, unknown>>;
}

/**
 * Natural-language query: Claude produces an allowlisted QuerySpec (agentic),
 * deterministic code compiles it to parameterized SQL and executes it. The
 * generated SQL + params are returned for transparency.
 */
export async function nlQuery(db: Db, question: string): Promise<NlQueryResult> {
  const spec = await callStructured(QuerySpecZ, {
    system: SYSTEM,
    user: `Columns available: ${QUERYABLE_COLUMNS.join(", ")}.\n\nQuestion: ${question}`,
    maxTokens: 1024,
  });
  const { sql, params } = compileQuery(spec);
  const rows = runReadonlyQuery(db, sql, params);
  return { spec, sql, params, rows };
}

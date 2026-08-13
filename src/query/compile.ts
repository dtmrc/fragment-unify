import {
  QUERYABLE_COLUMNS,
  QUERY_OPS,
  type QuerySpec,
  type QueryableColumn,
  type QueryOp,
} from "../types.js";

const COLUMN_SET = new Set<string>(QUERYABLE_COLUMNS);
const OP_SET = new Set<string>(QUERY_OPS);

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

/**
 * Compile a constrained QuerySpec into a PARAMETERIZED SQL string.
 *
 * The entire injection defense lives here and is structural, not heuristic:
 *   1. Column names are validated against a hardcoded allowlist and are the
 *      ONLY things ever interpolated into the SQL text. They can never be
 *      user-derived — an unknown column throws.
 *   2. Operators are validated against a fixed allowlist.
 *   3. Every user/model-derived VALUE is bound as a `?` parameter — it is never
 *      concatenated into the SQL string. A value like
 *      `California'; DROP TABLE entities;--` is passed to SQLite as an inert
 *      bound string and matches nothing.
 *
 * So even a fully adversarial QuerySpec cannot alter query structure.
 */
export function compileQuery(spec: QuerySpec): CompiledQuery {
  const params: unknown[] = [];
  const where: string[] = [];

  for (const f of spec.filters) {
    if (!COLUMN_SET.has(f.column)) {
      throw new Error(`column not allowlisted: ${f.column}`);
    }
    if (!OP_SET.has(f.op)) {
      throw new Error(`operator not allowlisted: ${f.op}`);
    }
    const column = f.column as QueryableColumn; // safe: verified against allowlist
    const op = f.op as QueryOp;

    if (op === "LIKE") {
      where.push(`${column} LIKE ?`);
      params.push(`%${f.value}%`);
    } else if (column === "confidence") {
      // confidence is REAL — coerce numeric comparisons, still parameterized.
      where.push(`${column} ${op} ?`);
      params.push(Number(f.value));
    } else {
      where.push(`${column} ${op} ?`);
      params.push(f.value);
    }
  }

  const whereClause = where.length ? ` WHERE ${where.join(" AND ")}` : "";

  if (spec.operation === "count") {
    return { sql: `SELECT COUNT(*) AS count FROM entities${whereClause}`, params };
  }

  const limit = spec.limit ?? 100;
  return {
    sql:
      `SELECT id, company, contactName, email, phone, state, confidence ` +
      `FROM entities${whereClause} ORDER BY company LIMIT ?`,
    params: [...params, limit],
  };
}

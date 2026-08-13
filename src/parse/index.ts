import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SourceRecord } from "../types.js";
import { parseSourceA } from "./csv.js";
import { parseSourceB } from "./json.js";
import { parseSourceC } from "./html.js";

export { parseSourceA, parseSourceB, parseSourceC };

const here = dirname(fileURLToPath(import.meta.url)); // .../src/parse (or dist/parse)
/** Repo-root data directory. Works from both src (tsx) and dist (built). */
const DATA_DIR = join(here, "..", "..", "data");

export interface LoadedSources {
  a: SourceRecord[];
  b: SourceRecord[];
  c: SourceRecord[];
  all: SourceRecord[];
}

/** Read + deterministically parse all three sources from data/. */
export function loadSources(dataDir: string = DATA_DIR): LoadedSources {
  const a = parseSourceA(readFileSync(join(dataDir, "source-a.csv"), "utf8"));
  const b = parseSourceB(readFileSync(join(dataDir, "source-b.json"), "utf8"));
  const c = parseSourceC(readFileSync(join(dataDir, "source-c.html"), "utf8"));
  return { a, b, c, all: [...a, ...b, ...c] };
}

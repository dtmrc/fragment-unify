import type { SourceRecord } from "../types.js";
import {
  blockKey,
  normalizeEmail,
  normalizePhone,
  normalizeState,
  normalizeText,
} from "../normalize.js";

/**
 * Minimal HTML table extractor (deterministic, no dependency).
 *
 * Scoped to the known scraped-page shape in data/source-c.html: a single
 * <table> whose first row is the header. It is intentionally small — a real
 * scraper would use a DOM parser, but the point here is the deterministic
 * boundary, not HTML-parser breadth.
 */
export function extractTableRows(html: string): string[][] {
  const tableMatch = /<table[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  if (!tableMatch) return [];
  const table = tableMatch[1]!;
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(table)) !== null) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    while ((cell = cellRe.exec(tr[1]!)) !== null) {
      cells.push(stripTags(cell[1]!));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function stripTags(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Source C: scraped HTML table.
 * Columns: Company, Rep, Telephone, Location, Contact Email.
 */
export function parseSourceC(html: string): SourceRecord[] {
  const rows = extractTableRows(html);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const iCompany = idx("Company");
  const iRep = idx("Rep");
  const iPhone = idx("Telephone");
  const iLoc = idx("Location");
  const iEmail = idx("Contact Email");

  const out: SourceRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]!;
    const raw = {
      Company: cols[iCompany] ?? "",
      Rep: cols[iRep] ?? "",
      Telephone: cols[iPhone] ?? "",
      Location: cols[iLoc] ?? "",
      "Contact Email": cols[iEmail] ?? "",
    };
    const normalized = {
      company: normalizeText(raw.Company),
      contactName: normalizeText(raw.Rep),
      email: normalizeEmail(raw["Contact Email"]),
      phone: normalizePhone(raw.Telephone),
      state: normalizeState(raw.Location),
    };
    out.push({
      id: `C${r}`,
      source: "C",
      raw,
      normalized,
      blockKey: blockKey(normalized.company, normalized.email),
    });
  }
  return out;
}

import type { SourceRecord } from "../types.js";
import {
  blockKey,
  normalizeEmail,
  normalizePhone,
  normalizeState,
  normalizeText,
} from "../normalize.js";

/**
 * Minimal but correct CSV tokenizer (deterministic, no dependency).
 * Handles quoted fields, escaped quotes ("") and commas/newlines inside quotes.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignore; handled by the following \n
    } else {
      field += ch;
    }
  }
  // Flush trailing field/row if the file doesn't end in a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Source A: messy companies+contacts CSV.
 * Columns: "Company Name", "contact", "Phone", "State", "Email".
 */
export function parseSourceA(text: string): SourceRecord[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iCompany = idx("Company Name");
  const iContact = idx("contact");
  const iPhone = idx("Phone");
  const iState = idx("State");
  const iEmail = idx("Email");

  const out: SourceRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]!;
    const raw = {
      "Company Name": cols[iCompany] ?? "",
      contact: cols[iContact] ?? "",
      Phone: cols[iPhone] ?? "",
      State: cols[iState] ?? "",
      Email: cols[iEmail] ?? "",
    };
    const normalized = {
      company: normalizeText(raw["Company Name"]),
      contactName: normalizeText(raw.contact),
      email: normalizeEmail(raw.Email),
      phone: normalizePhone(raw.Phone),
      state: normalizeState(raw.State),
    };
    out.push({
      id: `A${r}`,
      source: "A",
      raw,
      normalized,
      blockKey: blockKey(normalized.company, normalized.email),
    });
  }
  return out;
}

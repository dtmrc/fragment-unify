import type { SourceRecord } from "../types.js";
import {
  blockKey,
  normalizeEmail,
  normalizePhone,
  normalizeState,
  normalizeText,
} from "../normalize.js";

/**
 * Source B: API-style JSON payload with a DIFFERENT shape.
 * Shape: { records: [{ organization, contactPerson, primaryEmail, tel, hqState }] }
 */
export function parseSourceB(text: string): SourceRecord[] {
  const doc = JSON.parse(text) as {
    records?: Array<Record<string, unknown>>;
  };
  const records = Array.isArray(doc.records) ? doc.records : [];
  const out: SourceRecord[] = [];
  records.forEach((rec, i) => {
    const raw = {
      organization: String(rec.organization ?? ""),
      contactPerson: String(rec.contactPerson ?? ""),
      primaryEmail: String(rec.primaryEmail ?? ""),
      tel: String(rec.tel ?? ""),
      hqState: String(rec.hqState ?? ""),
    };
    const normalized = {
      company: normalizeText(raw.organization),
      contactName: normalizeText(raw.contactPerson),
      email: normalizeEmail(raw.primaryEmail),
      phone: normalizePhone(raw.tel),
      state: normalizeState(raw.hqState),
    };
    out.push({
      id: `B${i + 1}`,
      source: "B",
      raw,
      normalized,
      blockKey: blockKey(normalized.company, normalized.email),
    });
  });
  return out;
}

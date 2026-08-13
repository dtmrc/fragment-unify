/**
 * Deterministic normalization — plain TypeScript, NO Claude.
 *
 * These are the decisions that must be exact, cheap, and reproducible every
 * run: phone formats, US state names → codes, canonical company strings, and
 * the blocking key that groups merge candidates. Keeping them deterministic
 * (and out of the model) is a deliberate part of the design — it means the
 * agentic stages only ever reason about clean, comparable values, and the
 * behavior is unit-testable to the character.
 */

/** US state name / abbreviation / common misspelling → 2-letter USPS code. */
const STATE_MAP: Record<string, string> = {
  al: "AL", alabama: "AL",
  ak: "AK", alaska: "AK",
  az: "AZ", arizona: "AZ", ariz: "AZ",
  ar: "AR", arkansas: "AR",
  ca: "CA", california: "CA", calif: "CA", cal: "CA",
  co: "CO", colorado: "CO", colo: "CO",
  ct: "CT", connecticut: "CT", conn: "CT",
  de: "DE", delaware: "DE",
  fl: "FL", florida: "FL", fla: "FL",
  ga: "GA", georgia: "GA",
  hi: "HI", hawaii: "HI",
  id: "ID", idaho: "ID",
  il: "IL", illinois: "IL", ill: "IL",
  in: "IN", indiana: "IN",
  ia: "IA", iowa: "IA",
  ks: "KS", kansas: "KS",
  ky: "KY", kentucky: "KY",
  la: "LA", louisiana: "LA",
  me: "ME", maine: "ME",
  md: "MD", maryland: "MD",
  ma: "MA", massachusetts: "MA", mass: "MA",
  mi: "MI", michigan: "MI", mich: "MI",
  mn: "MN", minnesota: "MN", minn: "MN",
  ms: "MS", mississippi: "MS",
  mo: "MO", missouri: "MO",
  mt: "MT", montana: "MT",
  ne: "NE", nebraska: "NE", neb: "NE",
  nv: "NV", nevada: "NV",
  nh: "NH", "new hampshire": "NH",
  nj: "NJ", "new jersey": "NJ",
  nm: "NM", "new mexico": "NM",
  ny: "NY", "new york": "NY",
  nc: "NC", "north carolina": "NC",
  nd: "ND", "north dakota": "ND",
  oh: "OH", ohio: "OH",
  ok: "OK", oklahoma: "OK", okla: "OK",
  or: "OR", oregon: "OR", ore: "OR",
  pa: "PA", pennsylvania: "PA", penn: "PA",
  ri: "RI", "rhode island": "RI",
  sc: "SC", "south carolina": "SC",
  sd: "SD", "south dakota": "SD",
  tn: "TN", tennessee: "TN", tenn: "TN",
  tx: "TX", texas: "TX", tex: "TX",
  ut: "UT", utah: "UT",
  vt: "VT", vermont: "VT",
  va: "VA", virginia: "VA",
  wa: "WA", washington: "WA", wash: "WA",
  wv: "WV", "west virginia": "WV",
  wi: "WI", wisconsin: "WI", wis: "WI",
  wy: "WY", wyoming: "WY",
  dc: "DC", "district of columbia": "DC",
};

/**
 * Normalize a US state to its 2-letter USPS code.
 * Strips trailing punctuation ("Calif." -> "calif"), lowercases, and looks up.
 * Returns "" for empty input and the cleaned raw (uppercased) for unknowns —
 * we never silently invent a code.
 */
export function normalizeState(input: string | undefined | null): string {
  if (!input) return "";
  const cleaned = input.trim().replace(/\.+$/, "").replace(/\s+/g, " ").toLowerCase();
  if (cleaned === "") return "";
  const code = STATE_MAP[cleaned];
  if (code) return code;
  // Handle "City, ST" or "City, State" forms (source C locations).
  const afterComma = cleaned.split(",").pop()?.trim();
  if (afterComma && STATE_MAP[afterComma]) return STATE_MAP[afterComma];
  return cleaned.toUpperCase();
}

/**
 * Normalize a US phone number to E.164 (+1XXXXXXXXXX) when it is a plausible
 * 10-digit (or 1 + 10-digit) number; otherwise return the digits as-is so no
 * information is fabricated.
 */
export function normalizePhone(input: string | undefined | null): string {
  if (!input) return "";
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

/** Lowercase + trim an email. */
export function normalizeEmail(input: string | undefined | null): string {
  return (input ?? "").trim().toLowerCase();
}

/** Collapse whitespace and trim a free-text value (company, contact, ...). */
export function normalizeText(input: string | undefined | null): string {
  return (input ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Canonical company token used for blocking. Lowercases, strips common legal
 * suffixes and punctuation, collapses whitespace. "Acme Robotics, Inc." and
 * "ACME Robotics" both collapse to "acme robotics".
 */
export function canonicalCompany(name: string | undefined | null): string {
  const base = (name ?? "").toLowerCase();
  return base
    .replace(/[.,]/g, " ")
    .replace(
      /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|systems|labs|laboratories|partners|holdings|plc|llp)\b/g,
      " ",
    )
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic blocking key. Coarse on purpose: it groups *candidates* that
 * MIGHT be the same entity so Claude only reasons within small buckets, but it
 * does NOT decide the final clustering — Claude does that inside each block.
 *
 * Strategy: first two significant tokens of the canonical company name. Falls
 * back to the email domain when the company name is empty.
 */
export function blockKey(company: string, email: string): string {
  const canon = canonicalCompany(company);
  if (canon) {
    return canon.split(" ").slice(0, 2).join(" ");
  }
  const domain = normalizeEmail(email).split("@")[1];
  return domain ?? "__unblocked__";
}

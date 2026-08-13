import { describe, it, expect } from "vitest";
import { parseCsv, parseSourceA } from "../src/parse/csv.js";
import { parseSourceB } from "../src/parse/json.js";
import { extractTableRows, parseSourceC } from "../src/parse/html.js";
import { loadSources } from "../src/parse/index.js";

describe("parseCsv", () => {
  it("handles quoted fields with embedded commas and quotes", () => {
    const rows = parseCsv('a,b,c\n"x,1","y""2",z\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x,1", 'y"2', "z"],
    ]);
  });
});

describe("parseSourceA (CSV)", () => {
  it("parses rows with normalized fields and stable ids", () => {
    const text = `Company Name,contact,Phone,State,Email
Acme Robotics Inc,Dana Whitfield,(415) 555-0132,CA,Dana@Acme.com
Initech LLC,Milton Fry,5125550190,Tex.,milton@initech.io`;
    const recs = parseSourceA(text);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      id: "A1",
      source: "A",
      normalized: { company: "Acme Robotics Inc", email: "dana@acme.com", phone: "+14155550132", state: "CA" },
    });
    expect(recs[1]!.normalized.state).toBe("TX");
  });
});

describe("parseSourceB (JSON)", () => {
  it("maps the divergent shape onto the canonical view", () => {
    const text = JSON.stringify({
      records: [
        { organization: "Globex Corp", contactPerson: "Art Pennington", primaryEmail: "a@globex.com", tel: "212-555-0171", hqState: "NJ" },
      ],
    });
    const recs = parseSourceB(text);
    expect(recs[0]).toMatchObject({
      id: "B1",
      source: "B",
      normalized: { company: "Globex Corp", contactName: "Art Pennington", phone: "+12125550171", state: "NJ" },
    });
  });
});

describe("parseSourceC (HTML)", () => {
  it("extracts table rows", () => {
    const html = `<table><tr><th>Company</th><th>Rep</th></tr><tr><td>Acme</td><td>Dana</td></tr></table>`;
    expect(extractTableRows(html)).toEqual([
      ["Company", "Rep"],
      ["Acme", "Dana"],
    ]);
  });
  it("parses the scraped shape and pulls state from the location", () => {
    const html = `<table>
      <tr><th>Company</th><th>Rep</th><th>Telephone</th><th>Location</th><th>Contact Email</th></tr>
      <tr><td>Stark Industries</td><td>Pepper Hogan</td><td>310-555-0166</td><td>Los Angeles, CA</td><td>P@stark-ind.com</td></tr>
    </table>`;
    const recs = parseSourceC(html);
    expect(recs[0]).toMatchObject({
      id: "C1",
      source: "C",
      normalized: { company: "Stark Industries", phone: "+13105550166", state: "CA", email: "p@stark-ind.com" },
    });
  });
});

describe("loadSources (real data files)", () => {
  it("loads all three sources with overlapping entities", () => {
    const { a, b, c, all } = loadSources();
    expect(a.length).toBeGreaterThanOrEqual(20);
    expect(b.length).toBeGreaterThan(0);
    expect(c.length).toBeGreaterThan(0);
    expect(all.length).toBe(a.length + b.length + c.length);
    // Acme appears in all three sources under different shapes -> same block key.
    const acmeKeys = all.filter((r) => r.normalized.company.toLowerCase().includes("acme")).map((r) => r.blockKey);
    expect(new Set(acmeKeys).size).toBe(1);
    expect(acmeKeys.length).toBeGreaterThanOrEqual(3);
  });
});

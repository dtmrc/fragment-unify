import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  normalizeState,
  normalizeEmail,
  canonicalCompany,
  blockKey,
} from "../src/normalize.js";

describe("normalizePhone", () => {
  it("normalizes varied US formats to E.164", () => {
    for (const p of ["(415) 555-0132", "415.555.0132", "415 555 0132", "4155550132", "+1 415-555-0132"]) {
      expect(normalizePhone(p)).toBe("+14155550132");
    }
  });
  it("handles a leading country code", () => {
    expect(normalizePhone("1-415-555-0132")).toBe("+14155550132");
  });
  it("does not fabricate for non-10-digit input", () => {
    expect(normalizePhone("555-0132")).toBe("5550132");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(undefined)).toBe("");
  });
});

describe("normalizeState", () => {
  it("maps names, abbreviations, and misspellings to USPS codes", () => {
    expect(normalizeState("California")).toBe("CA");
    expect(normalizeState("Calif.")).toBe("CA");
    expect(normalizeState("CA")).toBe("CA");
    expect(normalizeState("New York")).toBe("NY");
    expect(normalizeState("Tex.")).toBe("TX");
    expect(normalizeState("Washington")).toBe("WA");
  });
  it("extracts the state from a 'City, ST' location", () => {
    expect(normalizeState("Los Angeles, CA")).toBe("CA");
    expect(normalizeState("Los Angeles, California")).toBe("CA");
    expect(normalizeState("Scranton, PA")).toBe("PA");
  });
  it("returns empty for empty input", () => {
    expect(normalizeState("")).toBe("");
    expect(normalizeState(null)).toBe("");
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Dana@Acme.COM ")).toBe("dana@acme.com");
  });
});

describe("canonicalCompany", () => {
  it("collapses legal suffixes, punctuation, and casing", () => {
    expect(canonicalCompany("Acme Robotics, Inc.")).toBe("acme robotics");
    expect(canonicalCompany("ACME Robotics")).toBe("acme robotics");
    expect(canonicalCompany("Globex Corporation")).toBe("globex");
  });
});

describe("blockKey", () => {
  it("groups name variants of the same company", () => {
    const a = blockKey("Acme Robotics, Inc.", "dana@acmerobotics.com");
    const b = blockKey("ACME Robotics", "d.whitfield@acmerobotics.com");
    expect(a).toBe(b);
  });
  it("falls back to email domain when company is empty", () => {
    expect(blockKey("", "someone@hooli.xyz")).toBe("hooli.xyz");
  });
});

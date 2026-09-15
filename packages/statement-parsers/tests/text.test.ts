import { describe, expect, test } from "vitest";
import {
  collapseWhitespace,
  decodeBytes,
  detectFormat,
  maskAccountRef,
  stripBom,
} from "../src/text.ts";

describe("decodeBytes", () => {
  test("CP1252 accents are not read as UTF-8 mojibake", () => {
    // "ÉPICERIE" in CP1252: É is the single byte 0xC9, which is not valid UTF-8.
    const cp1252 = new Uint8Array([0xc9, 0x50, 0x49, 0x43, 0x45, 0x52, 0x49, 0x45]);
    expect(decodeBytes(cp1252)).toBe("ÉPICERIE");
    expect(decodeBytes(cp1252, "windows-1252")).toBe("ÉPICERIE");
  });

  test("valid UTF-8 is never misidentified as CP1252", () => {
    const utf8 = new TextEncoder().encode("ÉPICERIE MÉTRO");
    expect(decodeBytes(utf8)).toBe("ÉPICERIE MÉTRO");
  });
});

describe("detectFormat", () => {
  test("recognises an OFX header", () => {
    expect(detectFormat(new TextEncoder().encode("OFXHEADER:100\r\n\r\n<OFX>"))).toBe("ofx");
  });

  test("treats anything else as CSV", () => {
    expect(detectFormat(new TextEncoder().encode("caisse,folio,product\r\n"))).toBe("csv");
  });
});

describe("stripBom", () => {
  test("removes a leading UTF-8 BOM", () => {
    expect(stripBom("\uFEFFhello")).toBe("hello");
  });

  test("leaves unmarked text unchanged", () => {
    expect(stripBom("hello")).toBe("hello");
  });
});

describe("collapseWhitespace", () => {
  test("collapses runs of whitespace and trims", () => {
    expect(collapseWhitespace("  EPICERIE   METRO \n")).toBe("EPICERIE METRO");
  });

  test("treats non-breaking spaces as whitespace", () => {
    expect(collapseWhitespace("A\u00A0B\u202FC")).toBe("A B C");
  });
});

describe("maskAccountRef", () => {
  test("masks a long account number to its last four digits", () => {
    expect(maskAccountRef("123456")).toBe("3456");
  });

  test("returns short values as-is", () => {
    expect(maskAccountRef("3456")).toBe("3456");
  });

  test("returns null for empty input", () => {
    expect(maskAccountRef("")).toBeNull();
    expect(maskAccountRef("   ")).toBeNull();
  });
});

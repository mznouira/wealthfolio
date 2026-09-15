import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  IMPORT_HASH_VERSION,
  accountKey,
  importHash,
  importHashPreimage,
  normaliseForHash,
  type ImportHashInput,
} from "../src/hash.ts";
import { sha256Hex } from "../src/sha256.ts";
import { calendarDate } from "../src/types.ts";

const BASE: ImportHashInput = {
  accountKey: "synthbank/1234",
  occurredOn: calendarDate("2026-01-12"),
  amountMinor: -19865,
  currency: "CAD",
  description: "Achat par carte /Épicerie du Coin",
};

function withField(overrides: Partial<ImportHashInput>): string {
  return importHash({ ...BASE, ...overrides });
}

describe("normaliseForHash", () => {
  test("folds accents, which is the decision item 3 turns on", () => {
    expect(normaliseForHash("Épicerie")).toBe(normaliseForHash("Epicerie"));
    expect(normaliseForHash("Prêt")).toBe(normaliseForHash("Pret"));
    expect(normaliseForHash("Intérêt créditeur")).toBe(normaliseForHash("Interet crediteur"));
    expect(normaliseForHash("Dépôt")).toBe(normaliseForHash("Depot"));
  });

  test("case normalisation is what makes the fold complete", () => {
    // `É` folds to `E` and `é` folds to `e`, so without the uppercase step the two
    // charset variants would still differ for any lowercase accented letter.
    expect(normaliseForHash("Compte Épargne")).toBe(normaliseForHash("compte epargne"));
  });

  test("collapses padding, which varies between renderings of one statement line", () => {
    expect(normaliseForHash("  EPICERIE   METRO ")).toBe("EPICERIE METRO");
  });

  test("keeps everything that is not a rendering difference", () => {
    // Digits, punctuation and word order are real content and must survive.
    expect(normaliseForHash("Réf 000111 QC")).toBe("REF 000111 QC");
    expect(normaliseForHash("A B")).not.toBe(normaliseForHash("B A"));
  });
});

describe("importHash", () => {
  test("is deterministic", () => {
    expect(importHash(BASE)).toBe(importHash({ ...BASE }));
    expect(importHash(BASE)).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("changes when any identifying field changes", () => {
    const base = importHash(BASE);
    expect(withField({ accountKey: "synthbank/9876" })).not.toBe(base);
    expect(withField({ occurredOn: calendarDate("2026-01-13") })).not.toBe(base);
    expect(withField({ amountMinor: -19866 })).not.toBe(base);
    expect(withField({ currency: "USD" })).not.toBe(base);
    expect(withField({ description: "Achat par carte /Boulangerie" })).not.toBe(base);
  });

  test("a sign flip is not the same transaction", () => {
    // -198.65 and +198.65 on one day is a purchase and its refund, not one row.
    expect(withField({ amountMinor: 19865 })).not.toBe(importHash(BASE));
  });

  test("does not change when only the accents change", () => {
    // The whole point. Two AccèsD downloads of the same month, same transaction.
    expect(withField({ description: "Achat par carte /Epicerie du Coin" })).toBe(importHash(BASE));
  });

  /**
   * Length-prefixed framing, not a delimiter join. With any separator `S`, the tuples
   * ("A", "B"+S+"C") and ("A"+S+"B", "C") flatten to the same string; a bank
   * description containing `S` would then hash as some other transaction.
   */
  test("field boundaries cannot be forged by field content", () => {
    const a = importHash({ ...BASE, accountKey: "synthbank/1234", description: "X" });
    for (const separator of ["|", "", " ", ":", "/"]) {
      const b = importHash({
        ...BASE,
        accountKey: `synthbank/1234${separator}X`,
        description: "",
      });
      expect(b).not.toBe(a);
    }
  });

  test("the pre-image is versioned, so a recipe change is loud rather than silent", () => {
    expect(importHashPreimage(BASE).startsWith(`1:${IMPORT_HASH_VERSION}`)).toBe(true);
  });

  /**
   * A pinned pre-image. Not decoration: it is what turns an accidental edit to the
   * field list, the field order or the normalisation into a failing test instead of a
   * ledger where yesterday's hashes and today's no longer compare.
   */
  test("the recipe is pinned", () => {
    expect(importHashPreimage(BASE)).toBe(
      "1:1" +
        "14:synthbank/1234" +
        "10:2026-01-12" +
        "6:-19865" +
        "3:CAD" +
        "33:ACHAT PAR CARTE /EPICERIE DU COIN",
    );
    expect(importHash(BASE)).toBe(
      createHash("sha256").update(importHashPreimage(BASE), "utf8").digest("hex"),
    );
  });
});

describe("sha256", () => {
  test("known vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  test("matches node:crypto on non-ASCII and multi-block inputs", () => {
    for (const value of ["portage", "Épicerie du Coin, 1 234,56 $", "a".repeat(1000)] as const) {
      expect(sha256Hex(value)).toBe(createHash("sha256").update(value, "utf8").digest("hex"));
    }
  });
});

describe("accountKey", () => {
  test("uses the institution slug and the durable external ref", () => {
    expect(accountKey("desjardins", "3456-EOP", 7)).toBe("desjardins/3456-EOP");
  });

  test("two institutions do not collide on a four-digit mask", () => {
    expect(accountKey("desjardins", "1234", 1)).not.toBe(accountKey("synthbank", "1234", 1));
  });

  test("falls back to the row id only when there is no external ref", () => {
    // Not stable across a rebuild, and cannot be: an account with no external
    // reference has no durable identity to borrow.
    expect(accountKey("synthbank", null, 7)).toBe("synthbank#7");
    expect(accountKey("synthbank", null, 7)).not.toBe(accountKey("synthbank", "7", 7));
  });
});

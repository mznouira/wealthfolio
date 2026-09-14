import { describe, expect, test } from "vitest";

import {
  buildPageLines,
  CELL_GAP_FACTOR,
  Y_TOLERANCE,
  type TextItemLike,
} from "../src/pdf/lines.ts";

function item(str: string, x: number, y: number, width: number, height = 8): TextItemLike {
  return { str, transform: [0, 0, 0, 0, x, y], width, height };
}

describe("buildPageLines", () => {
  test("drops blank or whitespace-only items", () => {
    const lines = buildPageLines(1, [
      item("A", 0, 100, 10),
      { str: "   ", transform: [0, 0, 0, 0, 0, 100], width: 10, height: 8 },
      { str: "\t\n", transform: [0, 0, 0, 0, 0, 100], width: 10, height: 8 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.cells[0]?.text).toBe("A");
  });

  test("sorts out-of-order items by y desc then x asc", () => {
    const lines = buildPageLines(1, [item("B", 0, 80, 10), item("A", 0, 100, 10)]);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.cells[0]?.text).toBe("A");
    expect(lines[1]?.cells[0]?.text).toBe("B");
  });

  test("clusters items on the same baseline", () => {
    const lines = buildPageLines(1, [item("A", 0, 100, 10), item("B", 20, 100, 10)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.cells.map((cell) => cell.text)).toEqual(["A", "B"]);
  });

  test("clusters items within the y tolerance", () => {
    const lines = buildPageLines(1, [item("A", 0, 100, 10), item("B", 0, 100 - Y_TOLERANCE, 10)]);
    expect(lines).toHaveLength(1);
  });

  test("splits distinct rows when the y gap exceeds the tolerance", () => {
    const lines = buildPageLines(1, [
      item("A", 0, 100, 10),
      item("B", 0, 100 - Y_TOLERANCE - 0.1, 10),
    ]);
    expect(lines).toHaveLength(2);
  });

  test("merges adjacent word gaps at exactly the threshold", () => {
    const height = 8;
    const threshold = CELL_GAP_FACTOR * height;
    const lines = buildPageLines(1, [
      item("A", 0, 100, 10, height),
      item("B", 10 + threshold, 100, 10, height),
    ]);
    expect(lines[0]?.cells).toHaveLength(1);
    expect(lines[0]?.cells[0]?.text).toBe("A B");
  });

  test("splits adjacent cells when the gap is just above the threshold", () => {
    const height = 8;
    const threshold = CELL_GAP_FACTOR * height;
    const lines = buildPageLines(1, [
      item("A", 0, 100, 10, height),
      item("B", 10 + threshold + 0.1, 100, 10, height),
    ]);
    expect(lines[0]?.cells).toHaveLength(2);
  });

  test("merges overlapping items with negative gaps", () => {
    const lines = buildPageLines(1, [item("A", 0, 100, 10), item("B", 8, 100, 10)]);
    expect(lines[0]?.cells).toHaveLength(1);
    expect(lines[0]?.cells[0]?.text).toBe("A B");
  });

  test("collapses whitespace inside a cell", () => {
    const lines = buildPageLines(1, [item("A", 0, 100, 10), item("B", 12, 100, 10)]);
    expect(lines[0]?.cells[0]?.text).toBe("A B");
  });

  test("keeps a single-item line", () => {
    const lines = buildPageLines(1, [item("Only", 5, 50, 20)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.y).toBe(50);
    expect(lines[0]?.cells).toEqual([{ x: 5, text: "Only" }]);
  });
});

import { collapseWhitespace } from "../text.ts";

export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

export interface PageCell {
  readonly x: number;
  readonly text: string;
}

export interface PageLine {
  readonly page: number;
  readonly y: number;
  readonly cells: readonly PageCell[];
}

export const Y_TOLERANCE = 2;
export const CELL_GAP_FACTOR = 0.5;

interface PositionedItem {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly str: string;
}

export function buildPageLines(page: number, items: TextItemLike[]): PageLine[] {
  const positioned: PositionedItem[] = items
    .filter((item) => item.str.trim() !== "")
    .map((item) => ({
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: item.width,
      height: item.height,
      str: item.str,
    }));

  positioned.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: PageLine[] = [];
  let lineItems: PositionedItem[] = [];
  let previousY: number | undefined;

  for (const item of positioned) {
    if (previousY === undefined || Math.abs(previousY - item.y) <= Y_TOLERANCE) {
      lineItems.push(item);
    } else {
      lines.push(finishLine(page, lineItems));
      lineItems = [item];
    }
    previousY = item.y;
  }

  if (lineItems.length > 0) {
    lines.push(finishLine(page, lineItems));
  }

  return lines;
}

function finishLine(page: number, items: PositionedItem[]): PageLine {
  const lineY = items.reduce((max, item) => (item.y > max ? item.y : max), items[0]?.y ?? 0);
  const sorted = items.slice().sort((a, b) => a.x - b.x);

  const cells: PageCell[] = [];
  let current: {
    readonly x: number;
    texts: string[];
    right: number;
    height: number;
  } | null = null;

  for (const item of sorted) {
    if (current === null) {
      current = {
        x: item.x,
        texts: [item.str],
        right: item.x + item.width,
        height: item.height,
      };
      continue;
    }

    const gap = item.x - current.right;
    const threshold = CELL_GAP_FACTOR * Math.max(current.height, item.height);

    if (gap > threshold) {
      cells.push({ x: current.x, text: collapseWhitespace(current.texts.join(" ")) });
      current = {
        x: item.x,
        texts: [item.str],
        right: item.x + item.width,
        height: item.height,
      };
    } else {
      current.texts.push(item.str);
      current.right = item.x + item.width;
      if (item.height > current.height) {
        current.height = item.height;
      }
    }
  }

  if (current !== null) {
    cells.push({ x: current.x, text: collapseWhitespace(current.texts.join(" ")) });
  }

  return { page, y: lineY, cells };
}

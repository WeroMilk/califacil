import type { CalifacilOmrScanGeometry, OmrNormRect } from '@/lib/omrScan';

/** Extract normalized row line Ys and column edge Xs from cell grid. */
export function extractLinesFromGeometry(
  geometry: CalifacilOmrScanGeometry,
  rows: number,
  cols: number
): { rowLines: number[]; colEdges: number[] } {
  const rowLines: number[] = [];
  for (let r = 0; r <= rows; r++) {
    if (r === 0) {
      const cell = geometry.cells[0]?.[0];
      rowLines.push(cell?.y ?? 0);
    } else if (r === rows) {
      const cell = geometry.cells[rows - 1]?.[0];
      rowLines.push(cell ? cell.y + cell.h : 1);
    } else {
      const above = geometry.cells[r - 1]?.[0];
      const below = geometry.cells[r]?.[0];
      if (above && below) {
        rowLines.push((above.y + above.h + below.y) * 0.5);
      } else {
        rowLines.push((r / rows) * 0.5);
      }
    }
  }

  const colEdges: number[] = [];
  const refRow = geometry.cells[0] ?? [];
  for (let c = 0; c <= cols; c++) {
    if (c === 0) {
      colEdges.push(refRow[0]?.x ?? 0);
    } else if (c === cols) {
      const last = refRow[cols - 1];
      colEdges.push(last ? last.x + last.w : 1);
    } else {
      const left = refRow[c - 1];
      const right = refRow[c];
      colEdges.push(left && right ? (left.x + left.w + right.x) * 0.5 : c / cols);
    }
  }

  return { rowLines, colEdges };
}

/** Rebuild cell bounds from normalized row lines and column edges. */
export function buildCellsFromNormLines(
  rowLines: number[],
  colEdges: number[],
  rows: number,
  cols: number
): OmrNormRect[][] {
  const cells: OmrNormRect[][] = [];
  for (let r = 0; r < rows; r++) {
    const y0 = rowLines[r] ?? 0;
    const y1 = rowLines[r + 1] ?? 1;
    const rowRects: OmrNormRect[] = [];
    for (let c = 0; c < cols; c++) {
      const x0 = colEdges[c] ?? 0;
      const x1 = colEdges[c + 1] ?? 1;
      rowRects.push({
        x: x0,
        y: y0,
        w: Math.max(0.001, x1 - x0),
        h: Math.max(0.001, y1 - y0),
      });
    }
    cells.push(rowRects);
  }
  return cells;
}

export function shiftNormLines(
  rowLines: number[],
  colEdges: number[],
  dx: number,
  dy: number
): { rowLines: number[]; colEdges: number[] } {
  return {
    rowLines: rowLines.map((y) => Math.max(0, Math.min(1, y + dy))),
    colEdges: colEdges.map((x) => Math.max(0, Math.min(1, x + dx))),
  };
}

export function scaleRowLines(rowLines: number[], centerY: number, scale: number): number[] {
  return rowLines.map((y) => centerY + (y - centerY) * scale);
}

export function scaleColEdges(colEdges: number[], centerX: number, scale: number): number[] {
  return colEdges.map((x) => centerX + (x - centerX) * scale);
}

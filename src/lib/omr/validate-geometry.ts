import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

export type AnswerSheetGeometryValidation = {
  ok: boolean;
  issues: string[];
};

/** Valida paralelismo de filas/columnas antes de leer burbujas. */
export function validateAnswerSheetGeometry(
  geometry: CalifacilOmrScanGeometry,
  rowCount: number
): AnswerSheetGeometryValidation {
  const issues: string[] = [];
  const rows = Math.min(Math.max(0, rowCount), geometry.cells.length);
  if (rows < 2) {
    return { ok: false, issues: ['too_few_rows'] };
  }

  const rowHeights: number[] = [];
  const rowTops: number[] = [];
  const colLefts: number[] = [];

  for (let r = 0; r < rows; r++) {
    const rowCells = geometry.cells[r];
    if (!rowCells?.length) {
      issues.push('missing_row');
      continue;
    }
    const first = rowCells[0]!;
    rowHeights.push(first.h);
    rowTops.push(first.y);
    if (r === 0) {
      for (const cell of rowCells) colLefts.push(cell.x);
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const meanH = rowHeights.reduce((a, b) => a + b, 0) / rowHeights.length;
  const maxHDev = Math.max(...rowHeights.map((h) => Math.abs(h - meanH)));
  if (meanH > 0 && maxHDev / meanH > 0.1) {
    issues.push('row_height_uneven');
  }

  if (rowTops.length >= 2) {
    const spacings: number[] = [];
    for (let i = 1; i < rowTops.length; i++) {
      spacings.push(rowTops[i]! - rowTops[i - 1]!);
    }
    const meanSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
    const maxSpacingDev = Math.max(...spacings.map((s) => Math.abs(s - meanSpacing)));
    if (meanSpacing > 0 && maxSpacingDev / meanSpacing > 0.12) {
      issues.push('row_spacing_uneven');
    }
  }

  if (rows >= 2) {
    const topRow = geometry.cells[0]!;
    const botRow = geometry.cells[rows - 1]!;
    for (let c = 0; c < Math.min(topRow.length, botRow.length); c++) {
      const dx = Math.abs(topRow[c]!.x - botRow[c]!.x);
      if (dx > 0.02) {
        issues.push('columns_not_parallel');
        break;
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

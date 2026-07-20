import type { BubbleSample, GeometryQualityReport } from '@/lib/omr/engine/types';
import type { OmrScanRowDetail } from '@/lib/omrScan';
import { scoreAnswerSheetGeometryBubbleFitForEngine } from '@/lib/omr/engine/omr-bridge';
import { validateAnswerSheetGeometry } from '@/lib/omr/validate-geometry';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

export type ObjectiveWeights = {
  pickSeparation: number;
  contrast: number;
  stability: number;
  bubbleFit: number;
  spatialConsistency: number;
  centerDisplacement: number;
  sameColumn: number;
  ambiguous: number;
};

export const DEFAULT_OBJECTIVE_WEIGHTS: ObjectiveWeights = {
  pickSeparation: 2.4,
  contrast: 1.2,
  stability: 1.0,
  bubbleFit: 2.0,
  spatialConsistency: 1.1,
  centerDisplacement: 0.8,
  sameColumn: 1.5,
  ambiguous: 2.2,
};

function meanPickSeparation(rows: OmrScanRowDetail[]): number {
  let sum = 0;
  let n = 0;
  for (const row of rows) {
    if (row.pick === null || !row.inkFractions?.length) continue;
    const fracs = row.inkFractions;
    const pickInk = fracs[row.pick] ?? 0;
    let second = 0;
    for (let c = 0; c < fracs.length; c++) {
      if (c === row.pick) continue;
      second = Math.max(second, fracs[c] ?? 0);
    }
    sum += pickInk - second;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

function geometryStability(rowLines: number[], colEdges: number[]): number {
  if (rowLines.length < 3 || colEdges.length < 3) return 0;
  const rowGaps: number[] = [];
  for (let i = 1; i < rowLines.length; i++) {
    rowGaps.push(rowLines[i]! - rowLines[i - 1]!);
  }
  const colGaps: number[] = [];
  for (let i = 1; i < colEdges.length; i++) {
    colGaps.push(colEdges[i]! - colEdges[i - 1]!);
  }
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
  const std = (arr: number[], m: number) =>
    Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, arr.length));
  const rowStd = std(rowGaps, mean(rowGaps));
  const colStd = std(colGaps, mean(colGaps));
  return Math.max(0, 1 - (rowStd + colStd) * 8);
}

function spatialConsistency(bubbles: BubbleSample[][]): number {
  if (bubbles.length < 2) return 0;
  const cols = bubbles[0]?.length ?? 0;
  if (cols < 2) return 0;
  let colVarSum = 0;
  for (let c = 0; c < cols; c++) {
    const cxs = bubbles.map((row) => row[c]?.cx ?? 0);
    const mean = cxs.reduce((a, b) => a + b, 0) / cxs.length;
    colVarSum += cxs.reduce((s, x) => s + (x - mean) ** 2, 0) / cxs.length;
  }
  return Math.max(0, 1 - colVarSum * 200);
}

function meanContrast(bubbles: BubbleSample[][]): number {
  let sum = 0;
  let n = 0;
  for (const row of bubbles) {
    for (const b of row) {
      sum += b.fillDark - b.ringDark;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function sameColumnPenalty(picks: (number | null)[]): number {
  const tally = new Map<number, number>();
  for (const p of picks) {
    if (p !== null) tally.set(p, (tally.get(p) ?? 0) + 1);
  }
  let max = 0;
  tally.forEach((v) => {
    max = Math.max(max, v);
  });
  return max / Math.max(1, picks.length);
}

export function computeGeometryQuality(
  geometry: CalifacilOmrScanGeometry,
  rowLines: number[],
  colEdges: number[],
  bubbles: BubbleSample[][],
  rows: number,
  imageData: Uint8ClampedArray | null,
  W: number,
  H: number
): GeometryQualityReport {
  const validation = validateAnswerSheetGeometry(geometry, rows);
  const bubbleFit = imageData
    ? scoreAnswerSheetGeometryBubbleFitForEngine(imageData, W, H, geometry, rows)
    : 0;
  const stability = geometryStability(rowLines, colEdges);
  const spatial = spatialConsistency(bubbles);
  const score = bubbleFit * 0.45 + stability * 0.25 + spatial * 0.3;
  return {
    score,
    bubbleFit,
    stability,
    spatialConsistency: spatial,
    validationOk: validation.ok,
    issues: validation.issues,
  };
}

export function computeObjectiveScore(params: {
  picks: (number | null)[];
  rows: OmrScanRowDetail[];
  bubbles: BubbleSample[][];
  rowLines: number[];
  colEdges: number[];
  geometry: CalifacilOmrScanGeometry;
  rowCount: number;
  imageData: Uint8ClampedArray | null;
  canvasW: number;
  canvasH: number;
  initialBubbles?: BubbleSample[][];
  weights?: ObjectiveWeights;
}): number {
  const w = params.weights ?? DEFAULT_OBJECTIVE_WEIGHTS;
  const quality = computeGeometryQuality(
    params.geometry,
    params.rowLines,
    params.colEdges,
    params.bubbles,
    params.rowCount,
    params.imageData,
    params.canvasW,
    params.canvasH
  );

  const sep = meanPickSeparation(params.rows);
  const contrast = meanContrast(params.bubbles);
  const ambiguous = params.rows.filter((r) => r.ambiguous).length / Math.max(1, params.rowCount);
  const sameCol = sameColumnPenalty(params.picks);

  let displacement = 0;
  if (params.initialBubbles) {
    let sum = 0;
    let n = 0;
    for (let r = 0; r < params.bubbles.length; r++) {
      for (let c = 0; c < (params.bubbles[r]?.length ?? 0); c++) {
        const a = params.bubbles[r]![c]!;
        const b = params.initialBubbles[r]?.[c];
        if (!b) continue;
        sum += Math.hypot(a.cx - b.cx, a.cy - b.cy);
        n++;
      }
    }
    displacement = n > 0 ? sum / n : 0;
  }

  return (
    w.pickSeparation * sep +
    w.contrast * contrast +
    w.stability * quality.stability +
    w.bubbleFit * quality.bubbleFit +
    w.spatialConsistency * quality.spatialConsistency -
    w.centerDisplacement * displacement * 4 -
    w.sameColumn * sameCol * 0.5 -
    w.ambiguous * ambiguous
  );
}

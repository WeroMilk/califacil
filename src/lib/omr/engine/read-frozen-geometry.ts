import type { FrozenOmrGeometry, UnifiedReadResult } from '@/lib/omr/engine/types';
import type { OmrScanRowDetail } from '@/lib/omrScan';
import {
  getOmrCanvasImageDataForEngine,
  sampleAnnulusDarknessForEngine,
  sampleDiskDarknessForEngine,
  UNIFIED_FRAME_SCAN_THRESHOLDS,
  refineAnswerSheetGeometryToBubblePeaks,
  readAnswerSheetPicksFromTemplateGeometry,
} from '@/lib/omr/engine/omr-bridge';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

const CALIFACIL_ANSWER_SHEET_ABSOLUTE = {
  blankMaxInk: 0.11,
  minInkFraction: 0.14,
  minInkGap: 0.06,
  minFillDarkness: 0.1,
  minScoreAbsolute: 0.04,
  minScoreGap: 0.035,
};

function pixelGray255(data: Uint8ClampedArray, idx: number): number {
  return Math.round(0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!);
}

function sampleDiskInkFractionAtThreshold(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number,
  grayThreshold: number
): number {
  let ink = 0;
  let n = 0;
  const r2 = radiusPx * radiusPx;
  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      if (pixelGray255(data, i) < grayThreshold) ink++;
      n++;
    }
  }
  return n > 0 ? ink / n : 0;
}

function sampleBubbleAtCenter(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  cxPx: number,
  cyPx: number,
  radiusPx: number,
  otsuT: number
): { fillDark: number; ringDark: number; inkFrac: number; score: number } {
  const r = Math.max(2, radiusPx);
  const rw = UNIFIED_FRAME_SCAN_THRESHOLDS.ringDarknessWeight;
  const fillDark = sampleDiskDarknessForEngine(
    data,
    W,
    H,
    cxPx,
    cyPx,
    Math.max(2, Math.round(r * 0.52))
  );
  const ringDark = sampleAnnulusDarknessForEngine(
    data,
    W,
    H,
    cxPx,
    cyPx,
    Math.max(1, Math.round(r * 0.58)),
    Math.max(2, Math.round(r * 0.98))
  );
  const diskRInk = Math.max(2, Math.round(r * 0.5));
  const inkFrac = sampleDiskInkFractionAtThreshold(
    data,
    W,
    H,
    cxPx,
    cyPx,
    diskRInk,
    otsuT
  );
  return { fillDark, ringDark, inkFrac, score: fillDark - ringDark * rw };
}

function otsuThreshold256(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }
  return threshold;
}

function buildRowGrayHistogram(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  step: number
): { hist: number[]; total: number } {
  const hist = new Array(256).fill(0);
  let total = 0;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const i = (y * width + x) * 4;
      const lum = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
      hist[lum]!++;
      total++;
    }
  }
  return { hist, total };
}

function pickRowFromSamples(
  inkFracs: number[],
  fills: number[],
  scores: number[],
  cols: number
): { pick: number | null; ambiguous: boolean; confidence: number } {
  const fillBestIdx = fills.reduce(
    (best, v, i, arr) => ((arr[i] ?? 0) > (arr[best] ?? 0) ? i : best),
    0
  );
  const fillSecondIdx = fills.reduce((best, v, i) => {
    if (i === fillBestIdx) return best;
    return (fills[i] ?? 0) > (fills[best] ?? 0) ? i : best;
  }, fillBestIdx === 0 ? 1 : 0);
  const fillValBest = fills[fillBestIdx] ?? 0;
  const fillGapBest = fillValBest - (fills[fillSecondIdx] ?? 0);
  if (fillValBest >= 0.09 && fillGapBest >= 0.035) {
    return {
      pick: fillBestIdx,
      ambiguous: fillGapBest < 0.05,
      confidence: fillValBest + fillGapBest,
    };
  }

  const maxInk = inkFracs.reduce((a, b) => Math.max(a, b), 0);
  if (maxInk < CALIFACIL_ANSWER_SHEET_ABSOLUTE.blankMaxInk) {
    return { pick: null, ambiguous: false, confidence: 0 };
  }

  let inkBest = 0;
  for (let c = 1; c < cols; c++) {
    if ((inkFracs[c] ?? 0) > (inkFracs[inkBest] ?? 0)) inkBest = c;
  }
  let inkSecond = inkBest === 0 ? 1 : 0;
  for (let c = 0; c < cols; c++) {
    if (c === inkBest) continue;
    if ((inkFracs[c] ?? 0) > (inkFracs[inkSecond] ?? 0)) inkSecond = c;
  }
  const inkVal = inkFracs[inkBest] ?? 0;
  const inkGap = inkVal - (inkFracs[inkSecond] ?? 0);

  let scoreBest = 0;
  for (let c = 1; c < cols; c++) {
    if ((scores[c] ?? 0) > (scores[scoreBest] ?? 0)) scoreBest = c;
  }
  let scoreSecond = scoreBest === 0 ? 1 : 0;
  for (let c = 0; c < cols; c++) {
    if (c === scoreBest) continue;
    if ((scores[c] ?? 0) > (scores[scoreSecond] ?? 0)) scoreSecond = c;
  }
  const scoreVal = scores[scoreBest] ?? 0;
  const scoreGap = scoreVal - (scores[scoreSecond] ?? 0);
  const fillBest = fills[scoreBest] ?? 0;

  const inkOk =
    inkVal >= CALIFACIL_ANSWER_SHEET_ABSOLUTE.minInkFraction &&
    inkGap >= CALIFACIL_ANSWER_SHEET_ABSOLUTE.minInkGap;
  const scoreOk =
    fillBest >= CALIFACIL_ANSWER_SHEET_ABSOLUTE.minFillDarkness &&
    scoreVal >= CALIFACIL_ANSWER_SHEET_ABSOLUTE.minScoreAbsolute &&
    scoreGap >= CALIFACIL_ANSWER_SHEET_ABSOLUTE.minScoreGap;

  if (inkOk && scoreOk && inkBest === scoreBest) {
    return {
      pick: inkBest,
      ambiguous: inkGap < CALIFACIL_ANSWER_SHEET_ABSOLUTE.minInkGap * 1.2,
      confidence: inkVal + scoreGap,
    };
  }
  if (!inkOk && !scoreOk) return { pick: null, ambiguous: false, confidence: 0 };

  const ambiguous =
    maxInk > CALIFACIL_ANSWER_SHEET_ABSOLUTE.blankMaxInk * 1.35 &&
    (inkOk || scoreOk) &&
    inkBest !== scoreBest;
  if (ambiguous) return { pick: null, ambiguous: true, confidence: 0 };

  const pick = scoreOk ? scoreBest : inkOk ? inkBest : null;
  return {
    pick,
    ambiguous: pick !== null && inkGap < CALIFACIL_ANSWER_SHEET_ABSOLUTE.minInkGap * 1.15,
    confidence: inkVal + scoreGap,
  };
}

/**
 * Single authoritative read — peaked template geometry, same thresholds as legacy sweep.
 */
export function readFrozenGeometry(
  canvas: HTMLCanvasElement,
  geometry: FrozenOmrGeometry,
  rows: number,
  cols: number
): UnifiedReadResult {
  const data = getOmrCanvasImageDataForEngine(canvas);
  const emptyRows = (): OmrScanRowDetail[] =>
    Array.from({ length: rows }, () => ({ pick: null, ambiguous: false, inkFractions: [] }));

  if (!data || !geometry.cells?.length) {
    return {
      picks: Array(rows).fill(null),
      rows: emptyRows(),
      geometry,
      globalConfidence: 0,
      ambiguousCount: 0,
      maxSameColumnCount: 0,
      usedFallback: false,
    };
  }

  const scanGeom: CalifacilOmrScanGeometry = {
    imageWidth: geometry.imageWidth,
    imageHeight: geometry.imageHeight,
    cells: geometry.cells,
    bubbles: geometry.bubbles,
    frame: geometry.frame,
    rowLines: geometry.rowLines,
    colEdges: geometry.colEdges,
  };
  const peaked = refineAnswerSheetGeometryToBubblePeaks(canvas, scanGeom, data);
  const templateRead = readAnswerSheetPicksFromTemplateGeometry(
    canvas,
    peaked,
    UNIFIED_FRAME_SCAN_THRESHOLDS,
    rows,
    cols
  );
  const ambiguousCount = templateRead.rows.filter((r) => r.ambiguous).length;

  return {
    picks: templateRead.picks,
    rows: templateRead.rows,
    geometry,
    globalConfidence: templateRead.confidenceSum / Math.max(1, rows),
    ambiguousCount,
    maxSameColumnCount: templateRead.maxSameColumnCount,
    usedFallback: false,
  };
}

export function meanCenterErrorPx(geometry: FrozenOmrGeometry): number {
  const W = geometry.imageWidth;
  const H = geometry.imageHeight;
  let sum = 0;
  let n = 0;
  for (let r = 0; r < geometry.bubbles.length; r++) {
    for (let c = 0; c < (geometry.bubbles[r]?.length ?? 0); c++) {
      const cell = geometry.cells[r]?.[c];
      const b = geometry.bubbles[r]![c]!;
      if (!cell) continue;
      const cellCx = (cell.x + cell.w * 0.5) * W;
      const cellCy = (cell.y + cell.h * 0.5) * H;
      sum += Math.hypot(b.cx * W - cellCx, b.cy * H - cellCy);
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

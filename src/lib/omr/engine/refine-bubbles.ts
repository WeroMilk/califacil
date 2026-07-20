import type { CalifacilOmrScanGeometry, OmrNormRect } from '@/lib/omrScan';
import {
  getOmrCanvasImageDataForEngine,
  geometryCellsForBubbleSamplingForEngine,
  sampleBubbleMarkAtCellForEngine,
  refineAnswerSheetGeometryToBubblePeaks,
  refineBubbleCenterInCellForEngine,
  UNIFIED_FRAME_SCAN_THRESHOLDS,
} from '@/lib/omr/engine/omr-bridge';
import { buildCellsFromNormLines } from '@/lib/omr/engine/geometry-lines';
import type { BubbleSample } from '@/lib/omr/engine/types';

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

export type RefineBubblesInput = {
  canvas: HTMLCanvasElement;
  geometry: CalifacilOmrScanGeometry;
  rowLines: number[];
  colEdges: number[];
  rows: number;
  cols: number;
  /** align = printed ring; read = student ink (post-freeze). */
  mode?: 'align' | 'read';
};

/**
 * Refine all bubbles visually — 120 samples with cx/cy/r and ink metrics.
 */
export function refineAllBubbles(input: RefineBubblesInput): BubbleSample[][] {
  const { canvas, rows, cols, mode = 'align' } = input;
  const W = canvas.width;
  const H = canvas.height;
  const data = getOmrCanvasImageDataForEngine(canvas);
  if (!data) return [];

  let geometry = input.geometry;
  if (mode === 'align') {
    geometry = refineAnswerSheetGeometryToBubblePeaks(canvas, geometry, data, {
      preferInk: false,
    });
  }

  const cells =
    mode === 'align' && geometry.cells.length === rows
      ? geometry.cells
      : buildCellsFromNormLines(input.rowLines, input.colEdges, rows, cols);
  const samplingGeom = geometryCellsForBubbleSamplingForEngine({
    ...geometry,
    imageWidth: W,
    imageHeight: H,
    cells,
  });

  const bubbles: BubbleSample[][] = [];

  for (let r = 0; r < rows; r++) {
    const rowCells = samplingGeom.cells[r];
    if (!rowCells?.length) {
      bubbles.push([]);
      continue;
    }

    let rowX0 = W;
    let rowX1 = 0;
    let rowY0 = H;
    let rowY1 = 0;
    for (let c = 0; c < cols; c++) {
      const cell = rowCells[c];
      if (!cell) continue;
      rowX0 = Math.min(rowX0, cell.x * W);
      rowX1 = Math.max(rowX1, (cell.x + cell.w) * W);
      rowY0 = Math.min(rowY0, cell.y * H);
      rowY1 = Math.max(rowY1, (cell.y + cell.h) * H);
    }

    const { hist, total } = buildRowGrayHistogram(
      data,
      W,
      H,
      Math.max(0, Math.floor(rowX0)),
      Math.min(W - 1, Math.ceil(rowX1)),
      Math.max(0, Math.floor(rowY0)),
      Math.min(H - 1, Math.ceil(rowY1)),
      2
    );
    const otsuT = otsuThreshold256(hist, Math.max(1, total));

    const rowBubbles: BubbleSample[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = rowCells[c] ?? rowCells[0]!;
      const bounds: OmrNormRect = cells[r]![c]!;
      const sample = sampleBubbleMarkAtCellForEngine(
        data,
        W,
        H,
        cell,
        otsuT,
        UNIFIED_FRAME_SCAN_THRESHOLDS
      );
      // Centros de overlay: anillo impreso (no centro crudo de celda expandida).
      const ringCenter =
        mode === 'align'
          ? refineBubbleCenterInCellForEngine(data, W, H, cell, { preferInk: false })
          : null;
      const cx = ringCenter ? ringCenter.x / W : cell.x + cell.w * 0.5;
      const cy = ringCenter ? ringCenter.y / H : cell.y + cell.h * 0.5;
      const minDim = Math.min(cell.w * W, cell.h * H);
      const radiusNorm = Math.max(0.002, (minDim * 0.38) / Math.min(W, H));
      const contrast = sample.fillDark - sample.ringDark;
      rowBubbles.push({
        cx,
        cy,
        r: radiusNorm,
        bounds,
        inkFrac: sample.inkFrac,
        fillDark: sample.fillDark,
        ringDark: sample.ringDark,
        score: sample.score,
        confidence: sample.inkFrac + contrast * 0.5,
      });
    }
    bubbles.push(rowBubbles);
  }

  return bubbles;
}

export function bubblesToGeometry(
  canvas: HTMLCanvasElement,
  rowLines: number[],
  colEdges: number[],
  bubbles: BubbleSample[][],
  frame: OmrNormRect,
  rows: number,
  cols: number
): CalifacilOmrScanGeometry {
  const cells = buildCellsFromNormLines(rowLines, colEdges, rows, cols);
  return {
    imageWidth: canvas.width,
    imageHeight: canvas.height,
    cells,
    bubbles,
    frame,
    rowLines,
    colEdges,
  };
}

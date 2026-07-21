import type { CalifacilOmrScanGeometry, OmrNormRect } from '@/lib/omrScan';
import {
  clampCalifacilOmrRowCount,
  buildRegisteredAnswerSheetGeometry,
  detectFullCanvasTableGeometry,
} from '@/lib/omrScan';
import {
  getOmrCanvasImageDataForEngine,
  sampleAnnulusDarknessForEngine,
  sampleDiskDarknessForEngine,
  refineBubbleCenterInCellForEngine,
  pickFooterAnswerSheetGeometryForEngine,
} from '@/lib/omr/engine/omr-bridge';
import { buildCellsFromNormLines, extractLinesFromGeometry } from '@/lib/omr/engine/geometry-lines';
import type { BubbleSample } from '@/lib/omr/engine/types';
import type { InitialGeometryResult } from '@/lib/omr/engine/detect-initial-geometry';
import { validateAnswerSheetGeometry } from '@/lib/omr/validate-geometry';

type CircleHit = { x: number; y: number; r: number; score: number };

function subsampleImageData(
  data: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.min(srcH - 1, Math.floor(y * sy));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.min(srcW - 1, Math.floor(x * sx));
      const si = (sy0 * srcW + sx0) * 4;
      const di = (y * dstW + x) * 4;
      out[di] = data[si]!;
      out[di + 1] = data[si + 1]!;
      out[di + 2] = data[si + 2]!;
      out[di + 3] = data[si + 3]!;
    }
  }
  return out;
}

function scorePrintedBubbleRing(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number
): number {
  const r = Math.max(2, radiusPx);
  const ring = sampleAnnulusDarknessForEngine(
    data,
    width,
    height,
    cx,
    cy,
    Math.max(1, Math.round(r * 0.55)),
    Math.max(2, Math.round(r * 0.95))
  );
  const center = sampleDiskDarknessForEngine(
    data,
    width,
    height,
    cx,
    cy,
    Math.max(1, Math.round(r * 0.42))
  );
  // Anillo vacío (centro claro) o bolita rellena (centro oscuro, papel alrededor).
  const emptyRing = ring * 1.35 - center * 0.45;
  const outer = sampleAnnulusDarknessForEngine(
    data,
    width,
    height,
    cx,
    cy,
    Math.max(2, Math.round(r * 1.15)),
    Math.max(3, Math.round(r * 1.55))
  );
  const filledDisk = center * 1.45 - outer * 0.85;
  return Math.max(emptyRing, filledDisk);
}

function nonMaxSuppress(hits: CircleHit[], minDistPx: number): CircleHit[] {
  const sorted = [...hits].sort((a, b) => b.score - a.score);
  const kept: CircleHit[] = [];
  for (const h of sorted) {
    if (kept.some((k) => Math.hypot(k.x - h.x, k.y - h.y) < minDistPx)) continue;
    kept.push(h);
  }
  return kept;
}

function scanForRingHits(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  opts?: { yStartRatio?: number; yEndRatio?: number }
): CircleHit[] {
  const minDim = Math.min(W, H);
  const minR = Math.max(2, Math.round(minDim * 0.005));
  const maxR = Math.max(minR + 1, Math.round(minDim * 0.014));
  const y0 = Math.floor(H * (opts?.yStartRatio ?? 0.04));
  const y1 = Math.floor(H * (opts?.yEndRatio ?? 0.99));
  const step = Math.max(2, Math.round(minR * 0.85));
  const radii = [minR, Math.round((minR + maxR) / 2), maxR];

  const hits: CircleHit[] = [];
  for (let y = y0; y <= y1; y += step) {
    for (let x = minR; x < W - minR; x += step) {
      let bestLocal: CircleHit | null = null;
      for (const r of radii) {
        const score = scorePrintedBubbleRing(data, W, H, x, y, r);
        if (score < 0.08) continue;
        if (!bestLocal || score > bestLocal.score) {
          bestLocal = { x, y, r, score };
        }
      }
      if (bestLocal) hits.push(bestLocal);
    }
  }
  return nonMaxSuppress(hits, Math.round(minR * 1.25));
}

function refineHitAtFullRes(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  hit: CircleHit
): CircleHit {
  const searchR = Math.max(2, Math.round(hit.r * 0.85));
  const radii = [hit.r, Math.round(hit.r * 0.95), Math.round(hit.r * 1.05)];
  let best = hit;
  for (let dy = -searchR; dy <= searchR; dy += 3) {
    for (let dx = -searchR; dx <= searchR; dx += 3) {
      const x = hit.x + dx;
      const y = hit.y + dy;
      for (const r of radii) {
        const score = scorePrintedBubbleRing(data, W, H, x, y, r);
        if (score > best.score) {
          best = { x, y, r, score };
        }
      }
    }
  }
  return best;
}

/** Escanea la imagen buscando anillos de burbuja impresos (sin plantilla ni márgenes). */
export function detectPrintedBubbleHits(
  canvas: HTMLCanvasElement,
  opts?: { yStartRatio?: number; yEndRatio?: number }
): CircleHit[] {
  const fullData = getOmrCanvasImageDataForEngine(canvas);
  if (!fullData) return [];
  const W = canvas.width;
  const H = canvas.height;
  const maxDim = Math.max(W, H);
  const targetDim = 720;
  const scale = maxDim > targetDim ? targetDim / maxDim : 1;
  const smallW = Math.max(64, Math.round(W * scale));
  const smallH = Math.max(64, Math.round(H * scale));
  const smallData =
    scale < 1 ? subsampleImageData(fullData, W, H, smallW, smallH) : fullData;

  const coarse = scanForRingHits(smallData, smallW, smallH, opts);
  const inv = 1 / scale;
  const minDim = Math.min(W, H);
  const minR = Math.max(2, Math.round(minDim * 0.005));
  const capped = nonMaxSuppress(
    coarse.map((h) => ({ x: h.x * inv, y: h.y * inv, r: h.r * inv, score: h.score })),
    Math.round(minR * 1.2)
  )
    .sort((a, b) => b.score - a.score)
    .slice(0, 160);
  const refined = capped.map((h) => refineHitAtFullRes(fullData, W, H, h));
  return nonMaxSuppress(refined, Math.round(minR * 1.2));
}

function kMeans1D(values: number[], k: number, iterations = 14): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const centers: number[] = [];
  for (let i = 0; i < k; i++) {
    centers.push(sorted[Math.floor(((i + 0.5) / k) * sorted.length)]!);
  }
  for (let iter = 0; iter < iterations; iter++) {
    const buckets: number[][] = Array.from({ length: k }, () => []);
    for (const v of values) {
      let best = 0;
      let bestD = Math.abs(v - centers[0]!);
      for (let c = 1; c < k; c++) {
        const d = Math.abs(v - centers[c]!);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      buckets[best]!.push(v);
    }
    for (let c = 0; c < k; c++) {
      const b = buckets[c]!;
      if (b.length > 0) {
        centers[c] = b.reduce((a, v) => a + v, 0) / b.length;
      }
    }
  }
  return centers.sort((a, b) => a - b);
}

function nearestCenterIndex(v: number, centers: number[]): number {
  let best = 0;
  let bestD = Math.abs(v - centers[0]!);
  for (let i = 1; i < centers.length; i++) {
    const d = Math.abs(v - centers[i]!);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function findBubbleNear(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  cx: number,
  cy: number,
  r: number
): CircleHit | null {
  const searchR = Math.max(3, Math.round(r * 1.8));
  let best: CircleHit | null = null;
  for (let dy = -searchR; dy <= searchR; dy += 3) {
    for (let dx = -searchR; dx <= searchR; dx += 3) {
      const x = cx + dx;
      const y = cy + dy;
      const score = scorePrintedBubbleRing(data, W, H, x, y, r);
      if (score < 0.06) continue;
      if (!best || score > best.score) {
        best = { x, y, r, score };
      }
    }
  }
  return best;
}

function filterHitsToAnswerTableBand(hits: CircleHit[], height: number): CircleHit[] {
  if (hits.length < 50) return hits;
  const binCount = 48;
  const bins = new Array<number>(binCount).fill(0);
  for (const h of hits) {
    const bin = Math.min(binCount - 1, Math.max(0, Math.floor((h.y / height) * binCount)));
    bins[bin]!++;
  }
  const windowBins = Math.max(12, Math.round(binCount * 0.42));
  let bestStart = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i <= binCount - windowBins; i++) {
    let sum = 0;
    for (let j = i; j < i + windowBins; j++) sum += bins[j]!;
    const centerY = (i + windowBins * 0.5) / binCount;
    // No penalizar tablas altas (foto de monitor / hoja en pantalla).
    const footerPenalty = centerY > 0.78 ? (centerY - 0.78) * 3 : 0;
    const headerPenalty = centerY < 0.08 ? (0.08 - centerY) * 2 : 0;
    const score = sum - (footerPenalty + headerPenalty) * hits.length * 0.1;
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }
  const y0 = (bestStart / binCount) * height;
  const y1 = ((bestStart + windowBins) / binCount) * height;
  const pad = height * 0.025;
  const filtered = hits.filter((h) => h.y >= y0 - pad && h.y <= y1 + pad);
  return filtered.length >= hits.length * 0.35 ? filtered : hits;
}

/** Agrupa círculos detectados en una rejilla rows × cols. */
export function clusterCirclesToGrid(
  hits: CircleHit[],
  rows: number,
  cols: number,
  width: number,
  height: number,
  data?: Uint8ClampedArray | null
): BubbleSample[][] | null {
  const expected = rows * cols;
  const bandHits = filterHitsToAnswerTableBand(hits, height);
  if (bandHits.length < expected * 0.35) return null;

  const rowCenters = kMeans1D(
    bandHits.map((h) => h.y),
    rows
  );
  const colCenters = kMeans1D(
    bandHits.map((h) => h.x),
    cols
  );

  const grid: (CircleHit | null)[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(null)
  );

  for (const hit of bandHits) {
    const r = nearestCenterIndex(hit.y, rowCenters);
    const c = nearestCenterIndex(hit.x, colCenters);
    const existing = grid[r]![c];
    if (!existing || hit.score > existing.score) {
      grid[r]![c] = hit;
    }
  }

  const medianR =
    bandHits.length > 0
      ? bandHits.map((h) => h.r).sort((a, b) => a - b)[Math.floor(bandHits.length / 2)]!
      : Math.min(width, height) * 0.008;

  if (data) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r]![c]) continue;
        const cx = colCenters[c]!;
        const cy = rowCenters[r]!;
        const found = findBubbleNear(data, width, height, cx, cy, medianR);
        if (found) grid[r]![c] = found;
      }
    }
  }

  let filled = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell) filled++;
    }
  }
  if (filled < expected * 0.5) return null;

  const bubbles: BubbleSample[][] = [];
  for (let r = 0; r < rows; r++) {
    const rowBubbles: BubbleSample[] = [];
    for (let c = 0; c < cols; c++) {
      const hit = grid[r]![c];
      if (!hit) {
        rowBubbles.push({
          cx: colCenters[c]! / width,
          cy: rowCenters[r]! / height,
          r: medianR / Math.min(width, height),
          bounds: { x: 0, y: 0, w: 0, h: 0 },
          inkFrac: 0,
          fillDark: 0,
          ringDark: 0,
          score: 0,
          confidence: 0,
        });
        continue;
      }
      const cxN = hit.x / width;
      const cyN = hit.y / height;
      const rN = hit.r / Math.min(width, height);
      const pad = hit.r * 1.8;
      const bounds: OmrNormRect = {
        x: Math.max(0, (hit.x - pad) / width),
        y: Math.max(0, (hit.y - pad) / height),
        w: Math.min(1, (pad * 2) / width),
        h: Math.min(1, (pad * 2) / height),
      };
      rowBubbles.push({
        cx: cxN,
        cy: cyN,
        r: rN,
        bounds,
        inkFrac: 0,
        fillDark: 0,
        ringDark: 0,
        score: hit.score,
        confidence: hit.score,
      });
    }
    bubbles.push(rowBubbles);
  }

  return bubbles;
}

function findBubbleInCell(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  cell: OmrNormRect
): CircleHit | null {
  const x0 = cell.x * W;
  const y0 = cell.y * H;
  const x1 = (cell.x + cell.w) * W;
  const y1 = (cell.y + cell.h) * H;
  const cellW = x1 - x0;
  const cellH = y1 - y0;
  const minDim = Math.min(cellW, cellH);
  const minR = Math.max(2, Math.round(minDim * 0.14));
  const maxR = Math.max(minR + 1, Math.round(minDim * 0.36));
  const cx0 = (x0 + x1) * 0.5;
  const cy0 = (y0 + y1) * 0.5;
  const searchR = Math.max(2, Math.round(minDim * 0.32));
  const radii = [minR, Math.round((minR + maxR) / 2), maxR];
  let best: CircleHit | null = null;
  for (let dy = -searchR; dy <= searchR; dy += 2) {
    for (let dx = -searchR; dx <= searchR; dx += 2) {
      for (const r of radii) {
        const x = cx0 + dx;
        const y = cy0 + dy;
        const score = scorePrintedBubbleRing(data, W, H, x, y, r);
        if (score < 0.05) continue;
        if (!best || score > best.score) {
          best = { x, y, r, score };
        }
      }
    }
  }
  return best;
}

function detectBubblesInTableCells(
  canvas: HTMLCanvasElement,
  geometry: CalifacilOmrScanGeometry,
  rows: number,
  cols: number,
  data: Uint8ClampedArray
): BubbleSample[][] | null {
  const W = canvas.width;
  const H = canvas.height;
  const bubbles: BubbleSample[][] = [];
  let filled = 0;
  for (let r = 0; r < rows; r++) {
    const rowBubbles: BubbleSample[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = geometry.cells[r]?.[c];
      if (!cell) {
        rowBubbles.push({
          cx: 0,
          cy: 0,
          r: 0,
          bounds: { x: 0, y: 0, w: 0, h: 0 },
          inkFrac: 0,
          fillDark: 0,
          ringDark: 0,
          score: 0,
          confidence: 0,
        });
        continue;
      }
      const hit = findBubbleInCell(data, W, H, cell);
      if (!hit) {
        rowBubbles.push({
          cx: (cell.x + cell.w * 0.5),
          cy: (cell.y + cell.h * 0.5),
          r: Math.min(cell.w, cell.h) * 0.2,
          bounds: cell,
          inkFrac: 0,
          fillDark: 0,
          ringDark: 0,
          score: 0,
          confidence: 0,
        });
        continue;
      }
      filled++;
      const cxN = hit.x / W;
      const cyN = hit.y / H;
      const rN = hit.r / Math.min(W, H);
      const pad = hit.r * 1.6;
      rowBubbles.push({
        cx: cxN,
        cy: cyN,
        r: rN,
        bounds: {
          x: Math.max(0, (hit.x - pad) / W),
          y: Math.max(0, (hit.y - pad) / H),
          w: Math.min(1, (pad * 2) / W),
          h: Math.min(1, (pad * 2) / H),
        },
        inkFrac: 0,
        fillDark: 0,
        ringDark: 0,
        score: hit.score,
        confidence: hit.score,
      });
    }
    bubbles.push(rowBubbles);
  }
  if (filled < rows * cols * 0.45) return null;
  return bubbles;
}

function bubblesToGeometry(
  canvas: HTMLCanvasElement,
  bubbles: BubbleSample[][],
  rows: number,
  cols: number,
  baseGeometry?: CalifacilOmrScanGeometry
): CalifacilOmrScanGeometry {
  const W = canvas.width;
  const H = canvas.height;

  if (baseGeometry) {
    const cells = bubbles.map((row, ri) =>
      row.map((bubble, ci) => {
        if (bubble.r <= 0) return baseGeometry.cells[ri]?.[ci] ?? bubble.bounds;
        return {
          x: Math.max(0, bubble.cx - bubble.r * 0.55),
          y: Math.max(0, bubble.cy - bubble.r * 0.55),
          w: Math.min(1, bubble.r * 1.1),
          h: Math.min(1, bubble.r * 1.1),
        };
      })
    );
    return {
      ...baseGeometry,
      imageWidth: W,
      imageHeight: H,
      cells,
      bubbles,
      frozen: true,
      source: 'unified-engine',
    };
  }

  const data = getOmrCanvasImageDataForEngine(canvas);

  const rowLines: number[] = [];
  for (let r = 0; r <= rows; r++) {
    if (r === 0) {
      const b = bubbles[0]?.find((x) => x.r > 0);
      rowLines.push(Math.max(0, (b?.cy ?? 0.3) - (b?.r ?? 0.01)));
    } else if (r === rows) {
      const b = bubbles[rows - 1]?.find((x) => x.r > 0);
      rowLines.push(Math.min(1, (b?.cy ?? 0.9) + (b?.r ?? 0.01)));
    } else {
      const above = bubbles[r - 1]?.find((x) => x.r > 0);
      const below = bubbles[r]?.find((x) => x.r > 0);
      rowLines.push(((above?.cy ?? 0) + (below?.cy ?? 0)) * 0.5);
    }
  }

  const colEdges: number[] = [];
  const refRow = bubbles.find((row) => row.some((b) => b.r > 0)) ?? bubbles[0] ?? [];
  for (let c = 0; c <= cols; c++) {
    if (c === 0) {
      const b = refRow.find((x) => x.r > 0) ?? refRow[0];
      colEdges.push(Math.max(0, (b?.cx ?? 0.1) - (b?.r ?? 0.01)));
    } else if (c === cols) {
      const b = refRow[cols - 1];
      colEdges.push(Math.min(1, (b?.cx ?? 0.9) + (b?.r ?? 0.01)));
    } else {
      const left = refRow[c - 1];
      const right = refRow[c];
      colEdges.push(((left?.cx ?? 0) + (right?.cx ?? 0)) * 0.5);
    }
  }

  let cells = buildCellsFromNormLines(rowLines, colEdges, rows, cols);

  if (data) {
    bubbles.forEach((row, ri) => {
      row.forEach((bubble, ci) => {
        if (bubble.r <= 0) return;
        const cell = cells[ri]?.[ci];
        if (!cell) return;
        const refined = refineBubbleCenterInCellForEngine(data, W, H, cell, { preferInk: false });
        bubble.cx = refined.x / W;
        bubble.cy = refined.y / H;
        cells[ri]![ci] = {
          x: Math.max(0, bubble.cx - bubble.r * 0.55),
          y: Math.max(0, bubble.cy - bubble.r * 0.55),
          w: Math.min(1, bubble.r * 1.1),
          h: Math.min(1, bubble.r * 1.1),
        };
      });
    });
  }

  return {
    imageWidth: W,
    imageHeight: H,
    cells,
    bubbles,
    rowLines,
    colEdges,
    frozen: true,
    source: 'unified-engine',
  };
}

function meanBubbleRingScore(
  data: Uint8ClampedArray,
  W: number,
  H: number,
  bubbles: BubbleSample[][]
): number {
  let sum = 0;
  let n = 0;
  for (const row of bubbles) {
    for (const b of row) {
      if (b.r <= 0) continue;
      sum += scorePrintedBubbleRing(data, W, H, b.cx * W, b.cy * H, b.r * Math.min(W, H));
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function geometryRow1YNorm(geometry: CalifacilOmrScanGeometry): number {
  const b = geometry.bubbles?.[0]?.find((x) => x.r > 0);
  if (b) return b.cy;
  const cell = geometry.cells[0]?.[0];
  return cell ? cell.y + cell.h * 0.5 : 1;
}

function buildHitsGridResult(
  canvas: HTMLCanvasElement,
  hits: CircleHit[],
  rows: number,
  cols: number,
  data: Uint8ClampedArray
): InitialGeometryResult | null {
  const bubbles = clusterCirclesToGrid(hits, rows, cols, canvas.width, canvas.height, data);
  if (!bubbles) return null;
  const geometry = bubblesToGeometry(canvas, bubbles, rows, cols);
  const validation = validateAnswerSheetGeometry(geometry, rows);
  const { rowLines, colEdges } = extractLinesFromGeometry(geometry, rows, cols);
  let filled = 0;
  for (const row of bubbles) {
    for (const b of row) {
      if (b.r > 0) filled++;
    }
  }
  const xs = hits.map((h) => h.x / canvas.width);
  const ys = hits.map((h) => h.y / canvas.height);
  const frame: OmrNormRect = {
    x: Math.max(0, Math.min(...xs) - 0.02),
    y: Math.max(0, Math.min(...ys) - 0.02),
    w: Math.min(1, Math.max(...xs) - Math.min(...xs) + 0.04),
    h: Math.min(1, Math.max(...ys) - Math.min(...ys) + 0.04),
  };
  return {
    geometry,
    rowLines,
    colEdges,
    frame,
    bubbleFit: filled / Math.max(1, rows * cols),
    validationOk: validation.ok,
  };
}

function detectLocalBubblesOnStructure(
  canvas: HTMLCanvasElement,
  rows: number,
  cols: number,
  data: Uint8ClampedArray,
  geometry: CalifacilOmrScanGeometry,
  frame: OmrNormRect
): InitialGeometryResult | null {
  const tableBubbles = detectBubblesInTableCells(canvas, geometry, rows, cols, data);
  if (!tableBubbles) return null;
  const merged = bubblesToGeometry(canvas, tableBubbles, rows, cols, geometry);
  const validation = validateAnswerSheetGeometry(merged, rows);
  const { rowLines, colEdges } = extractLinesFromGeometry(merged, rows, cols);
  let filled = 0;
  for (const row of tableBubbles) {
    for (const b of row) {
      if (b.score > 0) filled++;
    }
  }
  return {
    geometry: merged,
    rowLines,
    colEdges,
    frame,
    bubbleFit: filled / Math.max(1, rows * cols),
    validationOk: validation.ok,
  };
}

/**
 * Detecta círculos directamente en la imagen subida y construye geometría inicial.
 */
export function detectCircleGridGeometry(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number
): InitialGeometryResult | null {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const data = getOmrCanvasImageDataForEngine(canvas);
  if (!data) return null;

  const hits = detectPrintedBubbleHits(canvas);
  const hitsGrid = buildHitsGridResult(canvas, hits, rows, cols, data);

  // Preferir siempre la rejilla de círculos reales (donde estén en la imagen).
  if (hitsGrid && hitsGrid.bubbleFit >= 0.55) {
    return hitsGrid;
  }

  const table = detectFullCanvasTableGeometry(canvas, rows, cols);
  if (table?.geometry) {
    const tableLocal = detectLocalBubblesOnStructure(
      canvas,
      rows,
      cols,
      data,
      table.geometry,
      table.tableFrame
    );
    // Aceptar tabla en cualquier altura (no solo pie de hoja carta).
    if (tableLocal && tableLocal.bubbleFit >= 0.7) {
      return tableLocal;
    }
  }

  if (hitsGrid && hitsGrid.bubbleFit >= 0.35) {
    return hitsGrid;
  }

  const structCandidates: { geometry: CalifacilOmrScanGeometry; frame: OmrNormRect }[] = [];
  if (table?.geometry) {
    structCandidates.push({ geometry: table.geometry, frame: table.tableFrame });
  }
  const footer = pickFooterAnswerSheetGeometryForEngine([], rows, columns, canvas);
  if (footer) {
    structCandidates.push({
      geometry: footer,
      frame: {
        x: footer.cells[0]?.[0]?.x ?? 0.05,
        y: footer.cells[0]?.[0]?.y ?? 0.1,
        w: (footer.cells[0]?.[cols - 1]?.x ?? 0.9) + (footer.cells[0]?.[cols - 1]?.w ?? 0.05) - (footer.cells[0]?.[0]?.x ?? 0.05),
        h: (footer.cells[rows - 1]?.[0]?.y ?? 0.9) + (footer.cells[rows - 1]?.[0]?.h ?? 0.02) - (footer.cells[0]?.[0]?.y ?? 0.1),
      },
    });
  }
  const registered = buildRegisteredAnswerSheetGeometry(canvas, rows, cols);
  if (validateAnswerSheetGeometry(registered, rows).ok) {
    structCandidates.push({
      geometry: registered,
      frame: {
        x: registered.cells[0]?.[0]?.x ?? 0.05,
        y: registered.cells[0]?.[0]?.y ?? 0.1,
        w: 0.9,
        h: 0.85,
      },
    });
  }

  let bestLocal: InitialGeometryResult | null = null;
  let bestLocalScore = -1;
  for (const candidate of structCandidates) {
    const local = detectLocalBubblesOnStructure(
      canvas,
      rows,
      cols,
      data,
      candidate.geometry,
      candidate.frame
    );
    if (!local) continue;
    const ringScore = meanBubbleRingScore(
      data,
      canvas.width,
      canvas.height,
      local.geometry.bubbles as BubbleSample[][]
    );
    const row1y = geometryRow1YNorm(local.geometry);
    const minHitY = hits.length ? Math.min(...hits.map((h) => h.y / canvas.height)) : row1y;
    const alignPenalty = row1y > minHitY + 0.14 ? 0.35 : 0;
    const score = ringScore - alignPenalty;
    if (!bestLocal || score > bestLocalScore) {
      bestLocal = local;
      bestLocalScore = score;
    }
  }

  if (hitsGrid) {
    const ringScore = meanBubbleRingScore(
      data,
      canvas.width,
      canvas.height,
      hitsGrid.geometry.bubbles as BubbleSample[][]
    );
    const row1y = geometryRow1YNorm(hitsGrid.geometry);
    const minHitY = hits.length ? Math.min(...hits.map((h) => h.y / canvas.height)) : row1y;
    const alignPenalty = row1y > minHitY + 0.14 ? 0.35 : 0;
    const score = ringScore - alignPenalty + hitsGrid.bubbleFit * 0.05;
    if (!bestLocal || score > bestLocalScore) {
      return hitsGrid;
    }
  }

  if (bestLocal) return bestLocal;

  const bubbles = clusterCirclesToGrid(hits, rows, cols, canvas.width, canvas.height, data);
  if (!bubbles) return null;

  const geometry = bubblesToGeometry(canvas, bubbles, rows, cols);
  const validation = validateAnswerSheetGeometry(geometry, rows);
  const { rowLines, colEdges } = extractLinesFromGeometry(geometry, rows, cols);

  let filled = 0;
  for (const row of bubbles) {
    for (const b of row) {
      if (b.r > 0) filled++;
    }
  }
  const bubbleFit = filled / Math.max(1, rows * cols);

  const xs = hits.map((h) => h.x / canvas.width);
  const ys = hits.map((h) => h.y / canvas.height);
  const frame: OmrNormRect = {
    x: Math.max(0, Math.min(...xs) - 0.02),
    y: Math.max(0, Math.min(...ys) - 0.02),
    w: Math.min(1, Math.max(...xs) - Math.min(...xs) + 0.04),
    h: Math.min(1, Math.max(...ys) - Math.min(...ys) + 0.04),
  };

  return {
    geometry,
    rowLines,
    colEdges,
    frame,
    bubbleFit,
    validationOk: validation.ok,
  };
}

/**
 * Recorta al bbox de la rejilla de bolitas detectadas (quita mesa, taskbar, márgenes).
 * Así preview + OMR + overlay comparten el mismo espacio centrado en las negras.
 */
export function cropCanvasToPrintedBubbleTable(
  canvas: HTMLCanvasElement,
  opts?: { minHits?: number }
): HTMLCanvasElement {
  if (typeof document === 'undefined') return canvas;
  const hits = detectPrintedBubbleHits(canvas);
  const minHits = opts?.minHits ?? 10;
  if (hits.length < minHits) return canvas;

  const W = canvas.width;
  const H = canvas.height;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const h of hits) {
    minX = Math.min(minX, h.x - h.r);
    minY = Math.min(minY, h.y - h.r);
    maxX = Math.max(maxX, h.x + h.r);
    maxY = Math.max(maxY, h.y + h.r);
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return canvas;

  const gridW = maxX - minX;
  const gridH = maxY - minY;
  // Incluir columna de números y un poco de encabezado A–D.
  const padX = Math.max(8, gridW * 0.28);
  const padY = Math.max(8, gridH * 0.22);
  const x0 = Math.max(0, Math.floor(minX - padX));
  const y0 = Math.max(0, Math.floor(minY - padY));
  const x1 = Math.min(W, Math.ceil(maxX + padX * 0.45));
  const y1 = Math.min(H, Math.ceil(maxY + padY * 0.35));
  const cw = x1 - x0;
  const ch = y1 - y0;
  if (cw < 64 || ch < 64) return canvas;
  // Solo recortar si quitamos márgenes reales (taskbar / bezel).
  if (cw >= W * 0.94 && ch >= H * 0.94) return canvas;
  if (cw < W * 0.2 || ch < H * 0.12) return canvas;

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return out;
}

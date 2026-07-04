/**
 * Lectura OMR para hojas estilo ZipGrade (4 esquinas + 3 columnas de burbujas).
 * Compatible con formularios de 20–50 preguntas en layout vertical de 3 columnas.
 */

import type { CalifacilOmrScanGeometry, OmrNormRect, Point, WarpAlignmentReport } from '@/lib/omrScan';
import {
  readAnswerSheetPicksFromTemplateGeometry,
  syncCalifacilOmrGeometryImageSize,
  warpCalifacilSheetFromQuad,
} from '@/lib/omrScan';

export const ZIPGRADE_WARP_WIDTH = 850;
export const ZIPGRADE_WARP_HEIGHT = 1100;

/** Esquinas negras típicas de ZipGrade (coords. normalizadas en hoja enderezada). */
const ZIPGRADE_CORNER_NORM = {
  tl: { x: 0.028, y: 0.024 },
  tr: { x: 0.972, y: 0.024 },
  bl: { x: 0.028, y: 0.976 },
  br: { x: 0.972, y: 0.976 },
} as const;

/** Área de burbujas (3 columnas verticales). */
const ZIPGRADE_GRID_NORM = {
  x: 0.06,
  y: 0.2,
  w: 0.88,
  h: 0.72,
} as const;

export type ZipGradeSheetKind = 'califacil' | 'zipgrade' | 'unknown';

export function detectZipGradeCornerQuad(
  canvas: HTMLCanvasElement
): [Point, Point, Point, Point] | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 120 || h < 120) return null;

  const patch = Math.max(10, Math.round(Math.min(w, h) * 0.07));
  const corners = [
    { x: 0, y: 0 },
    { x: w - patch, y: 0 },
    { x: w - patch, y: h - patch },
    { x: 0, y: h - patch },
  ];

  let dark = 0;
  for (const c of corners) {
    const id = ctx.getImageData(c.x, c.y, patch, patch);
    let sum = 0;
    for (let i = 0; i < id.data.length; i += 4) {
      sum += id.data[i]! * 0.299 + id.data[i + 1]! * 0.587 + id.data[i + 2]! * 0.114;
    }
    if (sum / (patch * patch) < 200) dark += 1;
  }
  if (dark < 3) return null;

  const padX = w * 0.012;
  const padY = h * 0.012;
  return [
    { x: padX, y: padY },
    { x: w - padX, y: padY },
    { x: w - padX, y: h - padY },
    { x: padX, y: h - padY },
  ];
}

export function isZipGradeWarpedCanvas(canvas: HTMLCanvasElement): boolean {
  const ar = canvas.width / Math.max(1, canvas.height);
  return (
    canvas.width >= 400 &&
    canvas.height >= 500 &&
    ar > 0.72 &&
    ar < 0.82
  );
}

export function warpZipGradeAnswerSheet(
  canvas: HTMLCanvasElement
): { warped: HTMLCanvasElement | null; alignment: WarpAlignmentReport | null } {
  const quad = detectZipGradeCornerQuad(canvas);
  if (!quad) return { warped: null, alignment: null };

  const warped = warpCalifacilSheetFromQuad(canvas, quad);
  if (!warped) return { warped: null, alignment: null };

  const alignment: WarpAlignmentReport = {
    ok: true,
    maxErrorPx: 4,
    meanErrorPx: 2,
    maxAllowedPx: 12,
    corners: [],
  };
  return { warped, alignment };
}

/** Construye geometría OMR para N preguntas en 3 columnas estilo ZipGrade. */
export function buildZipGradeOmrGeometry(
  questionCount: number,
  optionColumns: number,
  imageWidth: number,
  imageHeight: number
): CalifacilOmrScanGeometry {
  const total = Math.max(1, Math.min(50, questionCount));
  const cols = Math.max(2, Math.min(5, optionColumns));
  const layoutCols = 3;
  const rowsPerCol = Math.ceil(total / layoutCols);

  const gx = ZIPGRADE_GRID_NORM.x * imageWidth;
  const gy = ZIPGRADE_GRID_NORM.y * imageHeight;
  const gw = ZIPGRADE_GRID_NORM.w * imageWidth;
  const gh = ZIPGRADE_GRID_NORM.h * imageHeight;
  const colW = gw / layoutCols;
  const rowH = gh / Math.max(1, rowsPerCol);

  const cells: OmrNormRect[][] = [];
  for (let q = 0; q < total; q++) {
    const layoutCol = Math.floor(q / rowsPerCol);
    const rowInCol = q % rowsPerCol;
    const rowRects: OmrNormRect[] = [];
    const bubbleW = (colW * 0.82) / cols;
    const bubbleAreaLeft = gx + layoutCol * colW + colW * 0.1;
    const yRowTop = gy + rowInCol * rowH + rowH * 0.12;
    const yRowH = rowH * 0.76;

    for (let c = 0; c < cols; c++) {
      const x0 = bubbleAreaLeft + c * bubbleW;
      rowRects.push({
        x: x0 / imageWidth,
        y: yRowTop / imageHeight,
        w: bubbleW / imageWidth,
        h: yRowH / imageHeight,
      });
    }
    cells.push(rowRects);
  }

  return { imageWidth, imageHeight, cells };
}

const ZIPGRADE_SCAN_THRESHOLDS = {
  minMarkDarkness: 0.048,
  minBestVsSecondGap: 0.022,
  minBestVsSecondRatio: 1.18,
  minCenterVsRingDelta: 0.022,
  minSolidCenterDarkness: 0.14,
  ringDarknessWeight: 0.35,
};

export function scanZipGradeAnswerSheet(
  warped: HTMLCanvasElement,
  optionColumns: number,
  questionCount: number
): {
  picks: (number | null)[];
  geometry: CalifacilOmrScanGeometry | null;
} {
  const rows = Math.max(1, Math.min(50, questionCount));
  const geometry = buildZipGradeOmrGeometry(rows, optionColumns, warped.width, warped.height);
  const read = readAnswerSheetPicksFromTemplateGeometry(
    warped,
    geometry,
    ZIPGRADE_SCAN_THRESHOLDS,
    rows,
    optionColumns
  );
  return {
    picks: read.picks,
    geometry: syncCalifacilOmrGeometryImageSize(geometry, warped.width, warped.height),
  };
}

/** Intenta detectar si la imagen es una hoja ZipGrade (4 esquinas negras, sin franjas CaliFacil). */
export function classifyAnswerSheetFormat(canvas: HTMLCanvasElement): ZipGradeSheetKind {
  const zgQuad = detectZipGradeCornerQuad(canvas);
  if (!zgQuad) return 'unknown';

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 'unknown';
  const w = canvas.width;
  const h = canvas.height;

  const stripW = Math.round(w * 0.04);
  let leftStripDark = 0;
  let rightStripDark = 0;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let y = Math.round(h * 0.15); y < Math.round(h * 0.85); y += 4) {
    for (let x = 0; x < stripW; x++) {
      const i = (y * w + x) * 4;
      const lum = d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
      if (lum < 80) leftStripDark++;
    }
    for (let x = w - stripW; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
      if (lum < 80) rightStripDark++;
    }
  }

  const stripScore = leftStripDark + rightStripDark;
  if (stripScore > 80) return 'califacil';
  return 'zipgrade';
}

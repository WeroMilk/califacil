/**
 * Lectura aproximada de la banda CaliFacil del pie de hoja impresa.
 * Debe coincidir con el layout de `printExam.ts` (tabla N filas × columnas de burbujas).
 */

import {
  buildCalifacilAnswerSheetOmrTemplate,
  buildMarkerAnchoredAnswerSheetTemplate,
  CALIFACIL_CONTROL_NUMBER_DIGIT_COUNT,
  CALIFACIL_FIDUCIAL_CENTERS_NORM,
  CALIFACIL_VIEWFINDER_GUIDE,
  CALIFACIL_WARP_PAGE_FRAME_NORM,
  CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM,
  CALIFACIL_ALIGN_STRIPS_NORM,
  califacilAnswerSheetAlignFrameAspect,
  CALIFACIL_PRINT_MAX_QUESTIONS,
  getControlNumberBlockPageRatios,
  markerAnchoredTemplateToPageRatios,
} from '@/lib/printExam';
import { controlNumberDigitsToString } from '@/lib/controlNumberOmr';
import { preprocessForSheetDetection } from '@/lib/omr/preprocess';
import { validateAnswerSheetGeometry } from '@/lib/omr/validate-geometry';
import {
  REFINE_WARP_MAX_ITERATIONS,
  REFINE_WARP_TARGET_MAX_ERROR_PX,
  refineWarpedSheetFiducials,
} from '@/lib/omr/refine-warp';

export const CALIFACIL_OMR_DEFAULT_ROWS = 10;
export const CALIFACIL_OMR_MAX_ROWS = CALIFACIL_PRINT_MAX_QUESTIONS;

export function clampCalifacilOmrRowCount(raw?: number): number {
  const n = Math.round(raw ?? CALIFACIL_OMR_DEFAULT_ROWS);
  return Math.min(CALIFACIL_OMR_MAX_ROWS, Math.max(2, n));
}

export const CALIFACIL_OMR_SCAN = {
  /** Fracción inferior de la imagen donde cae el recuadro CaliFacil impreso */
  bottomBandRatio: 0.46,
  /** Incluye título + cabecera A–D; el muestreo de 10 filas usa solo el cuerpo de la tabla. */
  titleStripRatioOfBand: 0.19,
  /** Ancho relativo reservado a la columna del número de pregunta */
  qnumWidthRatio: 0.09,
  /**
   * Peso del anillo en (fillDark - ringDark * R). Menor R = mejor para burbujas bien
   * rellenas (centro y anillo igual de oscuros); con R≈0.9 el score quedaba casi 0 y
   * se rechazaban marcas claras a simple vista.
   */
  ringDarknessWeight: 0.68,
  /** Intensidad mínima de relleno real (score fill − weight·ring tras elegir mejor columna) */
  minMarkDarkness: 0.045,
  /** Ventaja mínima de la mejor burbuja contra la segunda */
  minBestVsSecondGap: 0.028,
  /** Relación mínima entre mejor y segunda para evitar dobles marcas */
  minBestVsSecondRatio: 1.2,
  /** Diferencia mínima centro-anillo para confirmar anillo impreso + centro claro (no relleno) */
  minCenterVsRingDelta: 0.03,
  /** Si el disco interior es tan oscuro, damos por válida una marca aunque centro≈anillo (tinta llena). */
  minSolidCenterDarkness: 0.19,
  /** Tras binarizar (Otsu por fila), fracción mínima de píxeles oscuros en disco para considerar marca. */
  minBubbleInkFraction: 0.4,
  /** Diferencia mínima entre la mayor y la segunda fracción de tinta en la fila. */
  minInkFractionGap: 0.15,
  /** Dos columnas por encima de esto (binario) ⇒ posible doble marca / ambigüedad. */
  ambiguousInkTwinFloor: 0.3,
  /**
   * Franja horizontal por columna (toda la celda A–D): ventaja mínima de la mejor columna
   * sobre la segunda tras restar la mediana por fila (anula sombras / viñeteado).
   */
  minStripMedianGap: 0.034,
  /** Mínimo exceso sobre la mediana por fila en la franja elegida para contar como marca. */
  minStripAboveMedian: 0.028,
  /** Fracción mínima de tinta (Otsu) en la celda ganadora de la franja; evita elegir columna con solo ruido. */
  minStripWinnerRawFrac: 0.12,
  /** Fracción mínima en el interior de casilla (path cuadrado) para aceptar lectura por interior. */
  minInnerWinnerRawFrac: 0.26,
  /** Si la tinta máxima en la fila es muy baja, tratar como sin respuesta (evita falsas «A»). */
  maxStripFracBlankRow: 0.095,
} as const;

/** Umbrales absolutos para hoja de respuestas: nunca elegir la columna «menos blanca». */
const CALIFACIL_ANSWER_SHEET_ABSOLUTE = {
  minInkFraction: 0.24,
  minInkGap: 0.075,
  minFillDarkness: 0.12,
  minScoreAbsolute: 0.032,
  minScoreGap: 0.018,
  blankMaxInk: 0.07,
} as const;

/**
 * Parámetros inspirados en [OMRChecker](https://github.com/Udayraj123/OMRChecker)
 * (CLAHE, GAMMA_LOW, normalización) para fotos de móvil con sombras / bajo contraste.
 */
const OMRCHECKER_STYLE_PRE = {
  claheClipLimit: 5,
  tileW: 16,
  tileH: 16,
  /** `threshold_params.GAMMA_LOW` en OMRChecker `defaults/config.py` */
  gammaLow: 0.7,
} as const;

/**
 * Barrido del ancho relativo de la columna N.º (debe alinear con impresión ~9%).
 * Evita lecturas sistemáticas en una sola columna (p. ej. todo "D") cuando la foto está desplazada.
 */
const QNUM_WIDTH_SWEEP = [0.065, 0.075, 0.085, 0.09, 0.1, 0.11, 0.125, 0.14] as const;

/** Subconjunto para cámara en vivo: alineado con barrido completo para no perder el candidato óptimo. */
const QNUM_WIDTH_SWEEP_LIVE = QNUM_WIDTH_SWEEP;

/**
 * Traslación horizontal del área de burbujas en px (corrige desalineación cámara vs rejilla).
 * Se combina con el barrido de `qnumWidthRatio`.
 */
const COLUMN_SHIFT_PX_SWEEP = [-18, -14, -10, -6, -3, 0, 3, 6, 10, 14, 18] as const;
const COLUMN_SHIFT_PX_LIVE = COLUMN_SHIFT_PX_SWEEP;

export type CalifacilScanOptions = {
  /** Si true, no recorta al marco guía (la imagen ya pasó por prepare/autoOrient). */
  skipGuideCrop?: boolean;
  /** Barrido de `qnumWidthRatio`; `live` usa el mismo conjunto que `full` (rendimiento similar). */
  qnumSweep?: 'full' | 'live';
  /** Barrido de desplazamiento horizontal en px; `live` coincide con `full`. */
  columnShiftSweep?: 'full' | 'live';
  /**
   * Controla qué perfiles geométricos probar:
   * - `fullSheet`: fuerza tabla en banda inferior (hoja completa).
   * - `croppedBox`: fuerza tabla ocupando el recorte completo.
   * - `auto` (default): decide según variante/heurística.
   */
  geometryMode?: 'auto' | 'fullSheet' | 'croppedBox';
  /**
   * Si true, usa exactamente el canvas de entrada para medir/dibujar geometría:
   * sin corrección de perspectiva ni variantes derivadas.
   */
  preserveInputCanvas?: boolean;
  /** Anclaje por plantilla fija para la hoja escaneada de formato constante. */
  fixedTemplateAnchor?: boolean;
  /** Solo plantillas de hoja de respuestas dedicada (sin pie legado de hoja mixta). */
  answerSheetTemplateOnly?: boolean;
  /** Filas de la tabla impresa (2–30). Por defecto 10. */
  rowCount?: number;
  /** Incluye métricas de alineación fiducial en el resultado (modo depuración). */
  includeWarpAlignment?: boolean;
};

type ScanThresholds = {
  minMarkDarkness: number;
  minBestVsSecondGap: number;
  minBestVsSecondRatio?: number;
  minCenterVsRingDelta?: number;
  minSolidCenterDarkness?: number;
  ringDarknessWeight?: number;
};

export type OmrScanRowDetail = {
  pick: number | null;
  /** Lectura dudosa: conviene segunda opinión (p. ej. visión). */
  ambiguous: boolean;
  /** Fracción de píxeles "tinta" por columna (0–1), tras umbral Otsu en la franja de la fila. */
  inkFractions: number[];
};

export type OmrScanMetaResult = {
  picks: (number | null)[];
  rows: OmrScanRowDetail[];
  /** Hay filas ambiguas donde la visión puede ayudar. */
  needsVisionAssist: boolean;
  /** Máximo de filas que el OMR local asignó a la misma columna (posible desalineación). */
  maxSameColumnCount: number;
  /** Geometría de celdas del barrido ganador (coordenadas normalizadas 0–1). */
  geometry: CalifacilOmrScanGeometry | null;
  /**
   * Mismos píxeles que la lectura y que `geometry` (misma anchura/alto que `geometry.imageWidth/Height`).
   * Si no es null, la vista previa debe mostrar esta imagen para que la cuadrícula SVG coincida.
   */
  reviewSourceCanvas: HTMLCanvasElement | null;
  /** Error de alineación fiducial tras warp (si se solicitó). */
  warpAlignment?: WarpAlignmentReport | null;
  /** Dígitos leídos del bloque de número de control (8 columnas). */
  controlNumberDigits: (number | null)[];
  /** Número de control completo si los 8 dígitos fueron leídos con confianza. */
  controlNumber: string | null;
};

/** Máximo error en píxeles entre fiduciales detectados y plantilla tras warp. */
export const MAX_WARP_ALIGNMENT_ERROR_PX = 8;

export type WarpAlignmentCornerId = 'tl' | 'tr' | 'br' | 'bl';

export type WarpAlignmentReport = {
  ok: boolean;
  maxErrorPx: number;
  meanErrorPx: number;
  maxAllowedPx: number;
  corners: Array<{
    id: WarpAlignmentCornerId;
    expected: Point;
    detected: Point | null;
    errorPx: number;
  }>;
};

/** Rectángulo normalizado 0–1 respecto al canvas escaneado (misma relación de aspecto que la foto de revisión). */
export type OmrNormRect = { x: number; y: number; w: number; h: number };

export type CalifacilOmrScanGeometry = {
  /** Dimensiones del canvas usado en la lectura (puede estar escalado respecto a la foto original). */
  imageWidth: number;
  imageHeight: number;
  /** N filas × `cols` celdas de opción (solo cuerpo de tabla, sin cabecera). */
  cells: OmrNormRect[][];
};

/**
 * Rectángulo normalizado (0–1) del mismo marco que el visor (hoja carta completa), para superponer o recortar.
 */
export function califacilViewfinderNormRect(W: number, H: number): OmrNormRect | null {
  if (W < 80 || H < 80) return null;
  const { widthFrac, centerXFrac, centerYFrac, aspectRatio: ar, maxHeightFrac } =
    CALIFACIL_VIEWFINDER_GUIDE;
  const maxW = Math.min(W * widthFrac, W - 2);
  const maxH = H * (maxHeightFrac ?? 0.98);
  let rectW = maxW;
  let rectH = rectW / ar;
  if (rectH > maxH) {
    rectH = maxH;
    rectW = rectH * ar;
  }
  if (rectW < 80 || rectH < 80) return null;
  const cx = W * centerXFrac;
  const cy = H * centerYFrac;
  let left = Math.round(cx - rectW / 2);
  let top = Math.round(cy - rectH / 2);
  const rw = Math.round(rectW);
  const rh = Math.round(rectH);
  left = Math.max(0, Math.min(left, W - rw));
  top = Math.max(0, Math.min(top, H - rh));
  if (rw < 100 || rh < 48 || left + rw > W || top + rh > H) return null;
  return { x: left / W, y: top / H, w: rw / W, h: rh / H };
}

/** Rectángulo guía hoja de respuestas (proporción ancho carta × alto franja negra). */
export function califacilAnswerSheetAlignNormRect(W: number, H: number): OmrNormRect | null {
  if (W < 80 || H < 80) return null;
  const { widthFrac, centerXFrac, centerYFrac, maxHeightFrac } = CALIFACIL_VIEWFINDER_GUIDE;
  const ar = califacilAnswerSheetAlignFrameAspect();
  const maxW = Math.min(W * widthFrac, W - 2);
  const maxH = H * (maxHeightFrac ?? 0.98);
  let rectW = maxW;
  let rectH = rectW / ar;
  if (rectH > maxH) {
    rectH = maxH;
    rectW = rectH * ar;
  }
  if (rectW < 80 || rectH < 80) return null;
  const cx = W * centerXFrac;
  const cy = H * centerYFrac;
  let left = Math.round(cx - rectW / 2);
  let top = Math.round(cy - rectH / 2);
  const rw = Math.round(rectW);
  const rh = Math.round(rectH);
  left = Math.max(0, Math.min(left, W - rw));
  top = Math.max(0, Math.min(top, H - rh));
  if (rw < 100 || rh < 48 || left + rw > W || top + rh > H) return null;
  return { x: left / W, y: top / H, w: rw / W, h: rh / H };
}

export type CalifacilVideoLetterbox = {
  offsetX: number;
  offsetY: number;
  displayW: number;
  displayH: number;
  frameW: number;
  frameH: number;
};

/** Mapeo object-cover: fotograma de cámara → caja visible en pantalla. */
export function getObjectCoverVideoMapping(
  frameW: number,
  frameH: number,
  displayW: number,
  displayH: number
): { scale: number; cropX: number; cropY: number } {
  const scale = Math.max(displayW / frameW, displayH / frameH);
  const scaledW = frameW * scale;
  const scaledH = frameH * scale;
  return {
    scale,
    cropX: (scaledW - displayW) / 2,
    cropY: (scaledH - displayH) / 2,
  };
}

/** Marco guía hoja de respuestas (franja negra) en píxeles dentro del video en pantalla. */
export function califacilMobileAnswerSheetGuideInViewportPx(
  letterbox: CalifacilVideoLetterbox
): { left: number; top: number; width: number; height: number } | null {
  const norm = califacilAnswerSheetAlignNormRect(letterbox.frameW, letterbox.frameH);
  if (!norm) return null;
  const { scale, cropX, cropY } = getObjectCoverVideoMapping(
    letterbox.frameW,
    letterbox.frameH,
    letterbox.displayW,
    letterbox.displayH
  );
  return {
    left: letterbox.offsetX + norm.x * letterbox.frameW * scale - cropX,
    top: letterbox.offsetY + norm.y * letterbox.frameH * scale - cropY,
    width: norm.w * letterbox.frameW * scale,
    height: norm.h * letterbox.frameH * scale,
  };
}

/** Mapea coords. 0–1 de página carta al marco de alineación en pantalla. */
export function mapPageNormToAlignGuideViewport(
  nx: number,
  ny: number,
  guideRect: { left: number; top: number; width: number; height: number },
  frame = CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM
): { x: number; y: number } {
  return {
    x: guideRect.left + ((nx - frame.x) / frame.w) * guideRect.width,
    y: guideRect.top + ((ny - frame.y) / frame.h) * guideRect.height,
  };
}

export type CalifacilSheetCornerGuidePx = {
  left: number;
  top: number;
  size: number;
};

/** Visores de esquina fijos en el marco de alineación (no siguen la detección en vivo). */
export function califacilStaticFiducialCornerGuidesInViewportPx(
  guideRect: { left: number; top: number; width: number; height: number }
): CalifacilSheetCornerGuidePx[] {
  const size = Math.max(52, Math.min(80, Math.round(guideRect.width * 0.12)));
  const half = size / 2;
  const corners = [
    CALIFACIL_FIDUCIAL_CENTERS_NORM.tl,
    CALIFACIL_FIDUCIAL_CENTERS_NORM.tr,
    CALIFACIL_FIDUCIAL_CENTERS_NORM.bl,
    CALIFACIL_FIDUCIAL_CENTERS_NORM.br,
  ];
  return corners.map((c) => {
    const p = mapPageNormToAlignGuideViewport(c.x, c.y, guideRect);
    return { left: p.x - half, top: p.y - half, size };
  });
}

/** Marco guía hoja carta (píxeles) dentro del área de video en pantalla. */
export function califacilViewfinderGuideInViewportPx(
  letterbox: CalifacilVideoLetterbox
): { left: number; top: number; width: number; height: number } | null {
  const norm = califacilViewfinderNormRect(letterbox.frameW, letterbox.frameH);
  if (!norm) return null;
  const { scale, cropX, cropY } = getObjectCoverVideoMapping(
    letterbox.frameW,
    letterbox.frameH,
    letterbox.displayW,
    letterbox.displayH
  );
  return {
    left: letterbox.offsetX + norm.x * letterbox.frameW * scale - cropX,
    top: letterbox.offsetY + norm.y * letterbox.frameH * scale - cropY,
    width: norm.w * letterbox.frameW * scale,
    height: norm.h * letterbox.frameH * scale,
  };
}

function countDarkCornerPatches(
  ctx: CanvasRenderingContext2D,
  corners: { x: number; y: number }[],
  patchW: number,
  patchH: number
): number {
  let darkCorners = 0;
  for (const { x, y } of corners) {
    const px = Math.max(0, Math.round(x));
    const py = Math.max(0, Math.round(y));
    const id = ctx.getImageData(px, py, patchW, patchH);
    let darkCount = 0;
    const total = patchW * patchH;
    for (let i = 0; i < id.data.length; i += 4) {
      const lum = id.data[i]! * 0.299 + id.data[i + 1]! * 0.587 + id.data[i + 2]! * 0.114;
      if (lum < 95) darkCount++;
    }
    if (darkCount / total >= 0.07) darkCorners++;
  }
  return darkCorners;
}

function isWarpedLetterCanvas(W: number, H: number): boolean {
  const aspect = W / Math.max(1, H);
  return aspect > 0.72 && aspect < 0.86;
}

/** Parches de esquina en coords. de fiduciales impresos (hoja carta enderezada). */
function printedFiducialCornerPatches(
  W: number,
  H: number
): { corners: { x: number; y: number }[]; patchW: number; patchH: number } {
  const patchW = Math.max(8, Math.round(W * 0.068));
  const patchH = Math.max(8, Math.round(H * 0.068));
  const ids = ['tl', 'tr', 'bl', 'br'] as const;
  const corners = ids.map((id) => {
    const c = CALIFACIL_FIDUCIAL_CENTERS_NORM[id];
    return {
      x: Math.max(0, Math.min(W - patchW, c.x * W - patchW * 0.5)),
      y: Math.max(0, Math.min(H - patchH, c.y * H - patchH * 0.5)),
    };
  });
  return { corners, patchW, patchH };
}

function cornerMarkerPatchesForCanvas(
  W: number,
  H: number
): { corners: { x: number; y: number }[]; patchW: number; patchH: number } | null {
  if (isWarpedLetterCanvas(W, H)) {
    return printedFiducialCornerPatches(W, H);
  }
  return viewfinderGuideCornerPatches(W, H);
}

/** Cuántos de los 4 cuadros negros de esquina impresos son visibles (0–4). */
export function countCalifacilCornerMarkers(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  const W = canvas.width;
  const H = canvas.height;
  if (W < 80 || H < 80) return 0;

  const patches = cornerMarkerPatchesForCanvas(W, H);
  if (patches) {
    return countDarkCornerPatches(ctx, patches.corners, patches.patchW, patches.patchH);
  }

  const patchW = Math.max(5, Math.round(W * 0.06));
  const patchH = Math.max(5, Math.round(H * 0.06));
  const ix = Math.round(W * 0.028);
  const iy = Math.round(H * 0.028);
  const corners = [
    { x: ix, y: iy },
    { x: W - patchW - ix, y: iy },
    { x: ix, y: H - patchH - iy },
    { x: W - patchW - ix, y: H - patchH - iy },
  ];
  return countDarkCornerPatches(ctx, corners, patchW, patchH);
}

function meanPatchDarkFraction(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): number {
  const px = Math.max(0, Math.round(x));
  const py = Math.max(0, Math.round(y));
  const pw = Math.max(1, Math.min(Math.round(w), ctx.canvas.width - px));
  const ph = Math.max(1, Math.min(Math.round(h), ctx.canvas.height - py));
  const id = ctx.getImageData(px, py, pw, ph);
  let dark = 0;
  const total = pw * ph;
  for (let i = 0; i < id.data.length; i += 4) {
    const lum = id.data[i]! * 0.299 + id.data[i + 1]! * 0.587 + id.data[i + 2]! * 0.114;
    if (lum < 95) dark++;
  }
  return dark / Math.max(1, total);
}

/** Franjas negras verticales impresas a izquierda y derecha de la tabla OMR. */
export function hasCalifacilAlignStrips(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const W = canvas.width;
  const H = canvas.height;
  if (W < 80 || H < 80) return false;

  let found = 0;
  for (const strip of CALIFACIL_ALIGN_STRIPS_NORM) {
    const x0 = strip.left * W;
    const y0 = strip.top * H;
    const sw = Math.max(3, strip.width * W);
    const sh = Math.max(12, strip.height * H);
    if (meanPatchDarkFraction(ctx, x0, y0, sw, sh) >= 0.18) found++;
  }
  return found >= 2;
}

function viewfinderGuideCornerPatches(
  W: number,
  H: number
): { corners: { x: number; y: number }[]; patchW: number; patchH: number } | null {
  const norm = califacilViewfinderNormRect(W, H);
  if (!norm) return null;
  const patchW = Math.max(6, Math.round(norm.w * W * 0.09));
  const patchH = Math.max(6, Math.round(norm.h * H * 0.09));
  const x0 = norm.x * W;
  const y0 = norm.y * H;
  const x1 = (norm.x + norm.w) * W;
  const y1 = (norm.y + norm.h) * H;
  return {
    patchW,
    patchH,
    corners: [
      { x: x0, y: y0 },
      { x: x1 - patchW, y: y0 },
      { x: x0, y: y1 - patchH },
      { x: x1 - patchW, y: y1 - patchH },
    ],
  };
}

/** Layout CSS object-contain del video dentro de un contenedor. */
export type ObjectContainVideoLayout = {
  offsetX: number;
  offsetY: number;
  displayW: number;
  displayH: number;
  scale: number;
};

/** Calcula posición y tamaño del video visible con object-contain. */
export function getObjectContainVideoLayout(
  videoW: number,
  videoH: number,
  containerW: number,
  containerH: number
): ObjectContainVideoLayout {
  const vw = Math.max(1, videoW);
  const vh = Math.max(1, videoH);
  const cw = Math.max(1, containerW);
  const ch = Math.max(1, containerH);
  const scale = Math.min(cw / vw, ch / vh);
  const displayW = vw * scale;
  const displayH = vh * scale;
  return {
    offsetX: (cw - displayW) / 2,
    offsetY: (ch - displayH) / 2,
    displayW,
    displayH,
    scale,
  };
}

/**
 * Caja que envuelve todas las celdas OMR (coords. normalizadas 0–1).
 * `pad` en fracción de imagen (p. ej. 0 = borde exacto de las celdas del overlay).
 */
function boundsFromOmrCells(
  geometry: CalifacilOmrScanGeometry,
  rowCount: number,
  pad: number
): OmrNormRect | null {
  const rows = Math.min(Math.max(0, rowCount), geometry.cells.length);
  if (rows <= 0) return null;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (let r = 0; r < rows; r++) {
    const rowCells = geometry.cells[r];
    if (!rowCells?.length) continue;
    for (let c = 0; c < rowCells.length; c++) {
      const cell = rowCells[c];
      if (!cell) continue;
      any = true;
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x + cell.w);
      maxY = Math.max(maxY, cell.y + cell.h);
    }
  }
  if (!any || minX >= maxX || minY >= maxY) return null;
  const x = Math.max(0, minX - pad);
  const y = Math.max(0, minY - pad);
  const x2 = Math.min(1, maxX + pad);
  const y2 = Math.min(1, maxY + pad);
  return { x, y, w: x2 - x, h: y2 - y };
}

/**
 * Marco naranja de revisión: bounding box exacto de {@link geometry.cells}
 * (misma geometría que usa el calificador y la cuadrícula azul).
 */
export function califacilOmrOrangeFrameRect(
  geometry: CalifacilOmrScanGeometry,
  rowCount: number
): OmrNormRect | null {
  return boundsFromOmrCells(geometry, rowCount, 0);
}

/**
 * Caja que envuelve todas las celdas OMR detectadas (más un pequeño margen), para alinear
 * el marco naranja de revisión con el overlay verde/rojo.
 */
export function califacilGeometryTableBounds(
  geometry: CalifacilOmrScanGeometry,
  rowCount: number
): OmrNormRect | null {
  return boundsFromOmrCells(geometry, rowCount, 0.012);
}

type ScanDetailedResult = {
  picks: (number | null)[];
  resolvedCount: number;
  confidenceSum: number;
  rows: OmrScanRowDetail[];
  /** Suma de gaps mediana-franja por filas con lectura por franja (mayor = columnas mejor alineadas). */
  clarityStripGapSum: number;
  /** Máximo de filas con la misma columna elegida (penaliza desalineación que da todo igual). */
  maxSameColumnCount: number;
  /** Se detectaron 11 líneas horizontales de la tabla (más fiable que interpolar filas uniformes). */
  hasDetectedRowLines: boolean;
  /** Se detectaron bordes verticales de columnas desde líneas impresas. */
  hasDetectedColumnEdges: boolean;
  geometry: CalifacilOmrScanGeometry | null;
};

/** Elige el mejor barrido perfil×qnw×colShift: claridad agregada y penalización si todo coincide en una columna. */
function omrSweepCandidateScore(d: ScanDetailedResult): number {
  const avgConf = d.resolvedCount > 0 ? d.confidenceSum / d.resolvedCount : 0;
  const samePenalty =
    d.maxSameColumnCount >= 10 ? 520 : d.maxSameColumnCount >= 8 ? 240 : d.maxSameColumnCount >= 7 ? 90 : 0;
  return (
    d.resolvedCount * 52 +
    d.confidenceSum * 11 +
    avgConf * 72 +
    d.clarityStripGapSum * 125 -
    samePenalty +
    (d.hasDetectedRowLines ? 185 : -240) +
    (d.hasDetectedColumnEdges ? 90 : -70)
  );
}

type OmrGeometryProfile = {
  bottomBandRatio: number;
  titleStripRatioOfBand: number;
  qnumWidthRatio: number;
};

type OmrFixedTemplate = {
  tableLeftRatio: number;
  tableTopRatio: number;
  tableWidthRatio: number;
  tableHeightRatio: number;
  titleStripRatioOfTable: number;
  qnumWidthRatio: number;
};

function compactPeakPositions(values: number[], minGap: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i]!;
    const last = out[out.length - 1]!;
    if (v - last <= minGap) {
      out[out.length - 1] = Math.round((last + v) * 0.5);
    } else {
      out.push(v);
    }
  }
  return out;
}

/**
 * Detecta el recuadro de la tabla OMR en una franja vertical de la hoja.
 */
function detectTableBandInVerticalRange(
  canvas: HTMLCanvasElement,
  yStartRatio: number,
  yEndRatio: number,
  minTableHeightRatio: number,
  maxTableHeightRatio: number
): OmrFixedTemplate | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 300 || height < 450) return null;
  const img = ctx.getImageData(0, 0, width, height).data;
  const rowCounts = new Array<number>(height).fill(0);

  const yStart = Math.floor(height * yStartRatio);
  const yEnd = Math.min(height - 1, Math.floor(height * yEndRatio));
  const darkThr = 122;
  for (let y = yStart; y <= yEnd; y++) {
    let c = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const g = pixelGray255(img, i);
      if (g < darkThr) c++;
    }
    rowCounts[y] = c;
  }

  const rowMin = Math.floor(width * 0.12);
  const rowPeaksRaw: number[] = [];
  for (let y = yStart; y <= yEnd; y++) {
    if (rowCounts[y] >= rowMin) rowPeaksRaw.push(y);
  }
  const rowPeaks = compactPeakPositions(rowPeaksRaw, 3);
  if (rowPeaks.length < 8) return null;

  const topY = Math.max(yStart, rowPeaks[0]! - 2);
  const bottomY = Math.min(height - 1, rowPeaks[rowPeaks.length - 1]! + 2);
  const tableH = bottomY - topY;
  if (tableH < height * minTableHeightRatio || tableH > height * maxTableHeightRatio) return null;

  const colCounts = new Array<number>(width).fill(0);
  for (let x = 0; x < width; x++) {
    let c = 0;
    for (let y = topY; y <= bottomY; y++) {
      const i = (y * width + x) * 4;
      const g = pixelGray255(img, i);
      if (g < darkThr) c++;
    }
    colCounts[x] = c;
  }
  const colMin = Math.floor(tableH * 0.18);
  const colPeaksRaw: number[] = [];
  for (let x = 0; x < width; x++) {
    if (colCounts[x] >= colMin) colPeaksRaw.push(x);
  }
  const colPeaks = compactPeakPositions(colPeaksRaw, 4);
  if (colPeaks.length < 6) return null;

  const leftX = Math.max(0, colPeaks[0]! - 2);
  const rightX = Math.min(width - 1, colPeaks[colPeaks.length - 1]! + 2);
  const tableW = rightX - leftX;
  if (tableW < width * 0.45 || tableW > width * 0.96) return null;

  const innerRowPeaks = rowPeaks.filter((y) => y >= topY + 8);
  const headerBottom = innerRowPeaks.length > 0 ? innerRowPeaks[0]! : topY + tableH * 0.08;
  const titleStrip = Math.max(0.04, Math.min(0.22, (headerBottom - topY) / Math.max(1, tableH)));

  const innerCols = colPeaks.filter((x) => x > leftX + 8);
  const qnumDivider = innerCols.length > 0 ? innerCols[0]! : leftX + tableW * 0.1;
  const qnumRatio = Math.max(0.07, Math.min(0.16, (qnumDivider - leftX) / Math.max(1, tableW)));

  return {
    tableLeftRatio: leftX / width,
    tableTopRatio: topY / height,
    tableWidthRatio: tableW / width,
    tableHeightRatio: tableH / height,
    titleStripRatioOfTable: titleStrip,
    qnumWidthRatio: qnumRatio,
  };
}

/**
 * Detecta el recuadro real de la tabla CaliFacil en hoja completa escaneada
 * y lo convierte a plantilla fija para alinear overlay y lectura OMR.
 */
function detectFullSheetFixedTemplate(canvas: HTMLCanvasElement): OmrFixedTemplate | null {
  /** Hoja de respuestas dedicada: tabla alta en el centro de la página. */
  const answerSheet = detectTableBandInVerticalRange(canvas, 0.07, 0.99, 0.52, 0.94);
  if (answerSheet) return answerSheet;
  /** Hoja mixta legada: tabla en el pie. */
  return detectTableBandInVerticalRange(canvas, 0.48, 0.99, 0.12, 0.42);
}

type Point = { x: number; y: number };
export type { Point };

type LineXFromY = { m: number; b: number }; // x = m*y + b
type LineYFromX = { m: number; b: number }; // y = m*x + b

function sampleDiskDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radiusPx: number
): number {
  let sum = 0;
  let n = 0;
  const r2 = radiusPx * radiusPx;
  for (let dy = -radiusPx; dy <= radiusPx; dy++) {
    for (let dx = -radiusPx; dx <= radiusPx; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += 1 - lum;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function sampleAnnulusDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  innerRadiusPx: number,
  outerRadiusPx: number
): number {
  let sum = 0;
  let n = 0;
  const in2 = innerRadiusPx * innerRadiusPx;
  const out2 = outerRadiusPx * outerRadiusPx;
  for (let dy = -outerRadiusPx; dy <= outerRadiusPx; dy++) {
    for (let dx = -outerRadiusPx; dx <= outerRadiusPx; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > out2 || d2 < in2) continue;
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += 1 - lum;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function pixelGray255(data: Uint8ClampedArray, idx: number): number {
  return Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
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
): { hist: Uint32Array; total: number } {
  const hist = new Uint32Array(256);
  let total = 0;
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  for (let y = ya; y <= yb; y += step) {
    for (let x = xa; x <= xb; x += step) {
      const i = (y * width + x) * 4;
      const g = pixelGray255(data, i);
      hist[g]++;
      total++;
    }
  }
  return { hist, total };
}

function otsuThreshold256(hist: Uint32Array, total: number): number {
  if (total < 8) return 140;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
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

function medianOfNumbers(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Mejor columna y separación entre 1.º y 2.º tras restar mediana (franjas A/B/C/D). */
function bestMedianStripPick(adj: number[]): {
  bestIdx: number;
  gap: number;
  aboveMed: number;
} {
  if (adj.length === 0) return { bestIdx: 0, gap: 0, aboveMed: 0 };
  let bestIdx = 0;
  for (let c = 1; c < adj.length; c++) {
    if (adj[c]! > adj[bestIdx]!) bestIdx = c;
  }
  let second = -Infinity;
  for (let c = 0; c < adj.length; c++) {
    if (c === bestIdx) continue;
    second = Math.max(second, adj[c]!);
  }
  return {
    bestIdx,
    gap: adj[bestIdx]! - second,
    aboveMed: adj[bestIdx]!,
  };
}

/** Fracción de píxeles oscuros (Otsu) en rectángulo; paso 2 para fotos grandes. */
function sampleRectInkFractionAtThreshold(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  grayThreshold: number,
  step = 2
): number {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  if (xb < xa || yb < ya) return 0;
  let ink = 0;
  let n = 0;
  for (let y = ya; y <= yb; y += step) {
    for (let x = xa; x <= xb; x += step) {
      const i = (y * width + x) * 4;
      if (pixelGray255(data, i) < grayThreshold) ink++;
      n++;
    }
  }
  return n > 0 ? ink / n : 0;
}

/** Franjas por columna usando bordes x medidos (rejilla real A|B|C|D). */
function columnStripInkFractionsForEdges(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edges: number[],
  cols: number,
  y0: number,
  y1: number,
  grayThreshold: number
): number[] {
  const out: number[] = [];
  for (let c = 0; c < cols; c++) {
    const xL = edges[c]!;
    const xR = edges[c + 1]!;
    const cw = Math.max(1, xR - xL);
    const margin = cw * 0.07;
    const xa = xL + margin;
    const xb = xR - margin;
    out.push(sampleRectInkFractionAtThreshold(data, width, height, xa, xb, y0, y1, grayThreshold));
  }
  return out;
}

/**
 * Interior de cada celda (casilla cuadrada rellena): ignora bordes impresos gruesos y muestrea el centro.
 * Mejor que la franja completa cuando la marca llena la casilla.
 */
function columnInnerBubbleInkFractions(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edges: number[],
  cols: number,
  yRowTop: number,
  yRowBot: number,
  grayThreshold: number
): number[] {
  const out: number[] = [];
  const rowH = Math.max(1, yRowBot - yRowTop);
  for (let c = 0; c < cols; c++) {
    const xL = edges[c]!;
    const xR = edges[c + 1]!;
    const cw = Math.max(1, xR - xL);
    const marginX = cw * 0.14;
    const marginY = rowH * 0.13;
    const xa = xL + marginX;
    const xb = xR - marginX;
    const ya = yRowTop + marginY;
    const yb = yRowBot - marginY;
    out.push(
      sampleRectInkFractionAtThreshold(data, width, height, xa, xb, ya, yb, grayThreshold, 2)
    );
  }
  return out;
}

function sampleRectMeanDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step = 2
): number {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width - 1, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  if (xb < xa || yb < ya) return 0;
  let sum = 0;
  let n = 0;
  for (let y = ya; y <= yb; y += step) {
    for (let x = xa; x <= xb; x += step) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      sum += 1 - lum;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/** Oscuridad media en el interior de cada celda (relleno de casilla), para combinar con modelo circular. */
function columnInnerRectMeanDarkness(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  edges: number[],
  cols: number,
  yRowTop: number,
  yRowBot: number
): number[] {
  const out: number[] = [];
  const rowH = Math.max(1, yRowBot - yRowTop);
  for (let c = 0; c < cols; c++) {
    const xL = edges[c]!;
    const xR = edges[c + 1]!;
    const cw = Math.max(1, xR - xL);
    const marginX = cw * 0.14;
    const marginY = rowH * 0.13;
    out.push(
      sampleRectMeanDarkness(
        data,
        width,
        height,
        xL + marginX,
        yRowTop + marginY,
        xR - marginX,
        yRowBot - marginY
      )
    );
  }
  return out;
}

function drawSourceToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  maxSide = 1400
): HTMLCanvasElement | null {
  const srcW =
    source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const srcH =
    source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  if (srcW < 40 || srcH < 40) return null;

  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
  return canvas;
}

function rotateCanvas(canvas: HTMLCanvasElement, angleDeg: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (angleDeg === 0) return canvas;
  const out = document.createElement('canvas');
  const srcW = canvas.width;
  const srcH = canvas.height;
  if (angleDeg === 180) {
    out.width = srcW;
    out.height = srcH;
  } else {
    out.width = srcH;
    out.height = srcW;
  }
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  if (angleDeg === 90) {
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (angleDeg === 180) {
    ctx.translate(out.width, out.height);
    ctx.rotate(Math.PI);
  } else {
    ctx.translate(0, out.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(canvas, 0, 0);
  return out;
}

function rotateCanvasByDegrees(canvas: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const outW = Math.max(1, Math.round(canvas.width * cos + canvas.height * sin));
  const outH = Math.max(1, Math.round(canvas.width * sin + canvas.height * cos));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;

  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(rad);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function fitLineXFromY(points: Point[]): LineXFromY | null {
  if (points.length < 6) return null;
  let sumY = 0;
  let sumX = 0;
  let sumYY = 0;
  let sumYX = 0;
  for (const p of points) {
    sumY += p.y;
    sumX += p.x;
    sumYY += p.y * p.y;
    sumYX += p.y * p.x;
  }
  const n = points.length;
  const den = n * sumYY - sumY * sumY;
  if (Math.abs(den) < 1e-6) return null;
  const m = (n * sumYX - sumY * sumX) / den;
  const b = (sumX - m * sumY) / n;
  return { m, b };
}

function fitLineYFromX(points: Point[]): LineYFromX | null {
  if (points.length < 6) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }
  const n = points.length;
  const den = n * sumXX - sumX * sumX;
  if (Math.abs(den) < 1e-6) return null;
  const m = (n * sumXY - sumX * sumY) / den;
  const b = (sumY - m * sumX) / n;
  return { m, b };
}

function intersectLineXFromYAndYFromX(lineX: LineXFromY, lineY: LineYFromX): Point | null {
  const den = 1 - lineX.m * lineY.m;
  if (Math.abs(den) < 1e-6) return null;
  const x = (lineX.m * lineY.b + lineX.b) / den;
  const y = lineY.m * x + lineY.b;
  return { x, y };
}

function solveLinearSystem8(matrix: number[][], rhs: number[]): number[] | null {
  const n = 8;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-10) return null;
    if (pivot !== col) {
      const tmp = a[col];
      a[col] = a[pivot];
      a[pivot] = tmp;
    }
    const div = a[col][col];
    for (let c = col; c <= n; c++) a[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c];
    }
  }
  return a.map((row) => row[n]);
}

function computeHomographyFromRectToQuad(
  dstWidth: number,
  dstHeight: number,
  quad: [Point, Point, Point, Point]
): number[] | null {
  const srcPts: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: dstWidth - 1, y: 0 },
    { x: dstWidth - 1, y: dstHeight - 1 },
    { x: 0, y: dstHeight - 1 },
  ];
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const u = srcPts[i].x;
    const v = srcPts[i].y;
    const x = quad[i].x;
    const y = quad[i].y;
    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    rhs.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    rhs.push(y);
  }
  const sol = solveLinearSystem8(matrix, rhs);
  if (!sol) return null;
  return sol; // [a,b,c,d,e,f,g,h]
}

function applyHomography8ToPoint(h: number[], u: number, v: number): Point | null {
  const [a, b, c, d, e, f, g, hh] = h;
  const den = g * u + hh * v + 1;
  if (Math.abs(den) < 1e-9) return null;
  return { x: (a * u + b * v + c) / den, y: (d * u + e * v + f) / den };
}

function sampleBilinear(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const v00 = data[i00 + c];
    const v10 = data[i10 + c];
    const v01 = data[i01 + c];
    const v11 = data[i11 + c];
    const v0 = v00 * (1 - tx) + v10 * tx;
    const v1 = v01 * (1 - tx) + v11 * tx;
    out[c] = v0 * (1 - ty) + v1 * ty;
  }
  return out;
}

/** Proyectivo a partir de bordes del papel claro (hoja sobre fondo negro / mesa oscura). */
function detectCalifacilQuadFromBrightPaper(
  d: Uint8ClampedArray,
  width: number,
  height: number,
  lumMin: number
): [Point, Point, Point, Point] | null {
  const rowBright = new Uint32Array(height);
  const colBright = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
        rowBright[y]++;
        colBright[x]++;
      }
    }
  }

  const rbMin = Math.max(10, Math.floor(width * 0.024));
  const cbMin = Math.max(10, Math.floor(height * 0.024));
  let top = -1;
  let bottom = -1;
  let left = -1;
  let right = -1;
  for (let y = 0; y < height; y++) {
    if (rowBright[y] >= rbMin) {
      top = y;
      break;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (rowBright[y] >= rbMin) {
      bottom = y;
      break;
    }
  }
  for (let x = 0; x < width; x++) {
    if (colBright[x] >= cbMin) {
      left = x;
      break;
    }
  }
  for (let x = width - 1; x >= 0; x--) {
    if (colBright[x] >= cbMin) {
      right = x;
      break;
    }
  }
  if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;
  if (bottom - top < height * 0.18 || right - left < width * 0.18) return null;

  const y0 = Math.max(0, top - Math.floor(height * 0.03));
  const y1 = Math.min(height - 1, bottom + Math.floor(height * 0.03));
  const x0 = Math.max(0, left - Math.floor(width * 0.03));
  const x1 = Math.min(width - 1, right + Math.floor(width * 0.03));

  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  const leftPts: Point[] = [];
  const rightPts: Point[] = [];
  const topPts: Point[] = [];
  const bottomPts: Point[] = [];

  for (let y = y0; y <= y1; y += 2) {
    let lx = -1;
    for (let x = 0; x <= midX; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
        lx = x;
        break;
      }
    }
    if (lx >= 0) leftPts.push({ x: lx, y });

    let rx = -1;
    for (let x = width - 1; x >= midX; x--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
        rx = x;
        break;
      }
    }
    if (rx >= 0) rightPts.push({ x: rx, y });
  }

  for (let x = x0; x <= x1; x += 2) {
    let ty = -1;
    for (let y = 0; y <= midY; y++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
        ty = y;
        break;
      }
    }
    if (ty >= 0) topPts.push({ x, y: ty });

    let by = -1;
    for (let y = height - 1; y >= midY; y--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (lum >= lumMin) {
        by = y;
        break;
      }
    }
    if (by >= 0) bottomPts.push({ x, y: by });
  }

  const l = fitLineXFromY(leftPts);
  const r = fitLineXFromY(rightPts);
  const t = fitLineYFromX(topPts);
  const b = fitLineYFromX(bottomPts);
  if (!l || !r || !t || !b) return null;

  const tl = intersectLineXFromYAndYFromX(l, t);
  const tr = intersectLineXFromYAndYFromX(r, t);
  const br = intersectLineXFromYAndYFromX(r, b);
  const bl = intersectLineXFromYAndYFromX(l, b);
  if (!tl || !tr || !br || !bl) return null;

  const quad: [Point, Point, Point, Point] = [tl, tr, br, bl];
  const inside = quad.every(
    (p) => p.x >= -width * 0.1 && p.x <= width * 1.1 && p.y >= -height * 0.1 && p.y <= height * 1.1
  );
  if (!inside) return null;
  const area =
    Math.abs(
      tl.x * tr.y +
        tr.x * br.y +
        br.x * bl.y +
        bl.x * tl.y -
        (tr.x * tl.y + br.x * tr.y + bl.x * br.y + tl.x * bl.y)
    ) * 0.5;
  if (area < width * height * 0.06) return null;
  return quad;
}

/** Proyectivo a partir de tinta/borde oscuro sobre papel claro (caso típico). */
function detectCalifacilQuadFromDarkInk(
  d: Uint8ClampedArray,
  width: number,
  height: number
): [Point, Point, Point, Point] | null {
  const rowCounts = new Array<number>(height).fill(0);
  const colCounts = new Array<number>(width).fill(0);

  let darkSum = 0;
  const n = width * height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const darkness = 1 - lum;
      darkSum += darkness;
    }
  }
  const avgDark = darkSum / Math.max(1, n);
  const darkThreshold = Math.min(0.5, Math.max(0.22, avgDark + 0.16));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const darkness = 1 - lum;
      if (darkness >= darkThreshold) {
        rowCounts[y]++;
        colCounts[x]++;
      }
    }
  }

  const rowMin = Math.max(8, Math.floor(width * 0.1));
  const colMin = Math.max(8, Math.floor(height * 0.1));
  let top = -1;
  let bottom = -1;
  let left = -1;
  let right = -1;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y] >= rowMin) {
      top = y;
      break;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    if (rowCounts[y] >= rowMin) {
      bottom = y;
      break;
    }
  }
  for (let x = 0; x < width; x++) {
    if (colCounts[x] >= colMin) {
      left = x;
      break;
    }
  }
  for (let x = width - 1; x >= 0; x--) {
    if (colCounts[x] >= colMin) {
      right = x;
      break;
    }
  }
  if (top < 0 || bottom < 0 || left < 0 || right < 0) return null;
  if (bottom - top < height * 0.22 || right - left < width * 0.22) return null;

  const y0 = Math.max(0, top - Math.floor(height * 0.03));
  const y1 = Math.min(height - 1, bottom + Math.floor(height * 0.03));
  const x0 = Math.max(0, left - Math.floor(width * 0.03));
  const x1 = Math.min(width - 1, right + Math.floor(width * 0.03));

  const leftPts: Point[] = [];
  const rightPts: Point[] = [];
  const topPts: Point[] = [];
  const bottomPts: Point[] = [];
  const midX = Math.floor((x0 + x1) / 2);
  const midY = Math.floor((y0 + y1) / 2);

  for (let y = y0; y <= y1; y += 2) {
    let lx = -1;
    for (let x = x0; x <= midX; x++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        lx = x;
        break;
      }
    }
    if (lx >= 0) leftPts.push({ x: lx, y });

    let rx = -1;
    for (let x = x1; x >= midX; x--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        rx = x;
        break;
      }
    }
    if (rx >= 0) rightPts.push({ x: rx, y });
  }

  for (let x = x0; x <= x1; x += 2) {
    let ty = -1;
    for (let y = y0; y <= midY; y++) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        ty = y;
        break;
      }
    }
    if (ty >= 0) topPts.push({ x, y: ty });

    let by = -1;
    for (let y = y1; y >= midY; y--) {
      const i = (y * width + x) * 4;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      if (1 - lum >= darkThreshold) {
        by = y;
        break;
      }
    }
    if (by >= 0) bottomPts.push({ x, y: by });
  }

  const l = fitLineXFromY(leftPts);
  const r = fitLineXFromY(rightPts);
  const t = fitLineYFromX(topPts);
  const b = fitLineYFromX(bottomPts);
  if (!l || !r || !t || !b) return null;

  const tl = intersectLineXFromYAndYFromX(l, t);
  const tr = intersectLineXFromYAndYFromX(r, t);
  const br = intersectLineXFromYAndYFromX(r, b);
  const bl = intersectLineXFromYAndYFromX(l, b);
  if (!tl || !tr || !br || !bl) return null;

  const quad: [Point, Point, Point, Point] = [tl, tr, br, bl];
  const inside = quad.every(
    (p) => p.x >= -width * 0.1 && p.x <= width * 1.1 && p.y >= -height * 0.1 && p.y <= height * 1.1
  );
  if (!inside) return null;
  const area =
    Math.abs(
      tl.x * tr.y +
        tr.x * br.y +
        br.x * bl.y +
        bl.x * tl.y -
        (tr.x * tl.y + br.x * tr.y + bl.x * br.y + tl.x * bl.y)
    ) * 0.5;
  if (area < width * height * 0.08) return null;
  return quad;
}

/** Centro del parche más oscuro en una esquina (fiducial impreso, no texto del examen). */
function findCornerMarkerPoint(
  d: Uint8ClampedArray,
  width: number,
  height: number,
  regionX: number,
  regionY: number,
  regionW: number,
  regionH: number
): Point | null {
  const x0 = Math.max(0, regionX);
  const y0 = Math.max(0, regionY);
  const x1 = Math.min(width, regionX + regionW);
  const y1 = Math.min(height, regionY + regionH);
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < 8 || rh < 8) return null;

  const patchSize = Math.max(4, Math.round(Math.min(rw, rh) * 0.22));
  const step = Math.max(2, Math.floor(patchSize / 2));
  let bestScore = 0;
  let bestCenter: Point | null = null;

  for (let py = y0; py <= y1 - patchSize; py += step) {
    for (let px = x0; px <= x1 - patchSize; px += step) {
      let dark = 0;
      const total = patchSize * patchSize;
      for (let dy = 0; dy < patchSize; dy++) {
        for (let dx = 0; dx < patchSize; dx++) {
          const i = ((py + dy) * width + (px + dx)) * 4;
          const lum = d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
          if (lum < 85) dark++;
        }
      }
      const score = dark / total;
      if (score > bestScore) {
        bestScore = score;
        bestCenter = { x: px + patchSize / 2, y: py + patchSize / 2 };
      }
    }
  }
  if (bestScore < 0.28) return null;
  return bestCenter;
}

/** Luminancia media 0..1 (muestreo rápido) para detectar fotogramas negros. */
export function estimateCanvasMeanLuminance(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 1;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 2 || h < 2) return 0;
  const step = Math.max(4, Math.floor(Math.sqrt((w * h) / 3600)));
  const id = ctx.getImageData(0, 0, w, h);
  const data = id.data;
  let sum = 0;
  let n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      sum += (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) / 255;
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

function validateCornerMarkerQuad(
  quad: [Point, Point, Point, Point],
  width: number,
  height: number
): [Point, Point, Point, Point] | null {
  const [tl, tr, br, bl] = quad;
  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);
  const area =
    Math.abs(
      tl.x * tr.y +
        tr.x * br.y +
        br.x * bl.y +
        bl.x * tl.y -
        (tr.x * tl.y + br.x * tr.y + bl.x * br.y + tl.x * bl.y)
    ) * 0.5;
  const avgW = (topW + bottomW) * 0.5;
  const avgH = (leftH + rightH) * 0.5;
  if (area < width * height * 0.08 || avgW < width * 0.28 || avgH < height * 0.28) return null;
  return quad;
}

/**
 * Localiza los cuatro cuadros negros de esquina (`.sheet-align-corner`) y devuelve el cuadrilátero
 * [TL, TR, BR, BL] para homografía — más fiable que heurísticas de papel/tinta en móvil.
 */
function detectCalifacilQuadFromCornerMarkers(
  canvas: HTMLCanvasElement
): [Point, Point, Point, Point] | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 80 || height < 80) return null;

  const id = ctx.getImageData(0, 0, width, height);
  const d = id.data;
  const regionW = Math.max(12, Math.round(width * 0.12));
  const regionH = Math.max(12, Math.round(height * 0.12));

  const tryPageCornerMarkers = (): [Point, Point, Point, Point] | null => {
    const tl = findCornerMarkerPoint(d, width, height, 0, 0, regionW, regionH);
    const tr = findCornerMarkerPoint(d, width, height, width - regionW, 0, regionW, regionH);
    const br = findCornerMarkerPoint(
      d,
      width,
      height,
      width - regionW,
      height - regionH,
      regionW,
      regionH
    );
    const bl = findCornerMarkerPoint(d, width, height, 0, height - regionH, regionW, regionH);
    if (!tl || !tr || !br || !bl) return null;
    return validateCornerMarkerQuad([tl, tr, br, bl], width, height);
  };

  const aspect = width / Math.max(1, height);
  const letterWarped = height >= 800 && aspect > 0.74 && aspect < 0.82;
  if (letterWarped) {
    const pageQuad = tryPageCornerMarkers();
    if (pageQuad) return pageQuad;
  }

  const norm = califacilViewfinderNormRect(width, height);
  if (norm) {
    const gx = norm.x * width;
    const gy = norm.y * height;
    const gw = norm.w * width;
    const gh = norm.h * height;
    const tl = findCornerMarkerPoint(d, width, height, gx, gy, regionW, regionH);
    const tr = findCornerMarkerPoint(d, width, height, gx + gw - regionW, gy, regionW, regionH);
    const br = findCornerMarkerPoint(
      d,
      width,
      height,
      gx + gw - regionW,
      gy + gh - regionH,
      regionW,
      regionH
    );
    const bl = findCornerMarkerPoint(d, width, height, gx, gy + gh - regionH, regionW, regionH);
    if (tl && tr && br && bl) {
      const quad = validateCornerMarkerQuad([tl, tr, br, bl], width, height);
      if (quad) return quad;
    }
  }

  return tryPageCornerMarkers();
}

function detectCalifacilQuad(canvas: HTMLCanvasElement): [Point, Point, Point, Point] | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 120 || height < 120) return null;

  const id = ctx.getImageData(0, 0, width, height);
  const d = id.data;

  let darkSum = 0;
  const nPix = width * height;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) / 255;
    darkSum += 1 - lum;
  }
  const avgDark = darkSum / Math.max(1, nPix);

  /** Escenas con mucho negro alrededor de la hoja: encajar bordes claros antes que tinta. */
  const preferPaperFirst = avgDark >= 0.29;
  if (preferPaperFirst) {
    const qHi = detectCalifacilQuadFromBrightPaper(d, width, height, 0.61);
    if (qHi) return qHi;
    const qLo = detectCalifacilQuadFromBrightPaper(d, width, height, 0.52);
    if (qLo) return qLo;
  }

  const ink = detectCalifacilQuadFromDarkInk(d, width, height);
  if (ink) return ink;

  if (!preferPaperFirst) {
    const qHi = detectCalifacilQuadFromBrightPaper(d, width, height, 0.61);
    if (qHi) return qHi;
    const qLo = detectCalifacilQuadFromBrightPaper(d, width, height, 0.52);
    if (qLo) return qLo;
  }

  return null;
}

function warpPerspectiveToRect(
  canvas: HTMLCanvasElement,
  quad: [Point, Point, Point, Point],
  outWOverride?: number,
  outHOverride?: number
): HTMLCanvasElement | null {
  const topW = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const bottomW = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
  const leftH = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  const rightH = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
  const outW = outWOverride ?? Math.max(120, Math.round((topW + bottomW) * 0.5));
  const outH = outHOverride ?? Math.max(120, Math.round((leftH + rightH) * 0.5));

  const h = computeHomographyFromRectToQuad(outW, outH, quad);
  if (!h) return null;
  const [a, b, c, d, e, f, g, hh] = h;

  const srcCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return null;
  const src = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
  const srcData = src.data;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext('2d', { willReadFrequently: true });
  if (!outCtx) return null;
  const outId = outCtx.createImageData(outW, outH);
  const outData = outId.data;

  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const den = g * u + hh * v + 1;
      if (Math.abs(den) < 1e-9) continue;
      const x = (a * u + b * v + c) / den;
      const y = (d * u + e * v + f) / den;
      const outIdx = (v * outW + u) * 4;
      if (x < 0 || y < 0 || x >= canvas.width - 1 || y >= canvas.height - 1) {
        outData[outIdx] = 255;
        outData[outIdx + 1] = 255;
        outData[outIdx + 2] = 255;
        outData[outIdx + 3] = 255;
        continue;
      }
      const [r, gg, bb, aa] = sampleBilinear(srcData, canvas.width, canvas.height, x, y);
      outData[outIdx] = r;
      outData[outIdx + 1] = gg;
      outData[outIdx + 2] = bb;
      outData[outIdx + 3] = aa;
    }
  }
  outCtx.putImageData(outId, 0, 0);
  return out;
}

function applyPerspectiveCorrection(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const cornerQuad = detectCalifacilQuadFromCornerMarkers(canvas);
  if (cornerQuad) {
    const warped = warpPerspectiveToRect(canvas, cornerQuad);
    if (warped) return warped;
  }
  const quad = detectCalifacilQuad(canvas);
  if (!quad) return canvas;
  return warpPerspectiveToRect(canvas, quad) ?? canvas;
}

/**
 * Recorta la región equivalente al marco guía en Calificar (hoja carta, CALIFACIL_VIEWFINDER_GUIDE).
 * Alinea el análisis OMR con lo que el usuario encuadra en cámara.
 */
export function cropCanvasToCalifacilGuideOverlay(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const W = canvas.width;
  const H = canvas.height;
  const norm = califacilViewfinderNormRect(W, H);
  if (!norm) return null;
  const left = Math.round(norm.x * W);
  const top = Math.round(norm.y * H);
  const rw = Math.round(norm.w * W);
  const rh = Math.round(norm.h * H);
  if (rw < 100 || rh < 48 || left + rw > W || top + rh > H) return null;
  const out = document.createElement('canvas');
  out.width = rw;
  out.height = rh;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(canvas, left, top, rw, rh, 0, 0, rw, rh);
  return out;
}

export type CaptureCalifacilGuideFrameOptions = {
  /** Escala el recorte guía para que el lado largo no supere este valor (p. ej. 720 en vivo). */
  maxSide?: number;
};

/** Fotograma completo del sensor (sin recorte al marco guía). */
export function captureVideoFullFrame(
  video: HTMLVideoElement,
  opts?: CaptureCalifacilGuideFrameOptions
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const fw = video.videoWidth;
  const fh = video.videoHeight;
  if (fw < 40 || fh < 40) return null;

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fw;
  fullCanvas.height = fh;
  const ctx = fullCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, fw, fh);

  const maxSide = opts?.maxSide;
  if (maxSide && maxSide > 0) {
    return drawSourceToCanvas(fullCanvas, maxSide);
  }
  return drawSourceToCanvas(fullCanvas, 1400);
}

/**
 * Captura el fotograma del video recortado al marco guía CaliFacil.
 * Con object-contain el fotograma completo coincide con el área visible; el recorte guía
 * alinea OMR con las esquinas naranjas del visor móvil.
 */
export function captureCalifacilGuideFrame(
  video: HTMLVideoElement,
  opts?: CaptureCalifacilGuideFrameOptions
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const fw = video.videoWidth;
  const fh = video.videoHeight;
  if (fw < 40 || fh < 40) return null;

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fw;
  fullCanvas.height = fh;
  const ctx = fullCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, fw, fh);

  const cropped = cropCanvasToCalifacilGuideOverlay(fullCanvas);
  if (!cropped) return null;

  const maxSide = opts?.maxSide;
  if (maxSide && maxSide > 0) {
    return drawSourceToCanvas(cropped, maxSide);
  }
  return drawSourceToCanvas(cropped, 1400);
}

/** Resolución máxima del lado largo al analizar el ROI en vivo (velocidad móvil). */
export const MOBILE_ROI_DETECT_MAX_SIDE = 800;

export type MobileGuideRoiCapture = {
  roiCanvas: HTMLCanvasElement;
  /** Recorte guía en coordenadas del fotograma del sensor (píxeles). */
  roiRect: { left: number; top: number; width: number; height: number };
  frameW: number;
  frameH: number;
};

/**
 * Extrae SOLO el marco guía del video y lo escala a baja resolución.
 * No dibuja ni analiza el fotograma completo.
 */
export function captureVideoGuideRoiFrame(
  video: HTMLVideoElement,
  opts?: { maxSide?: number }
): MobileGuideRoiCapture | null {
  if (typeof document === 'undefined') return null;
  const fw = video.videoWidth;
  const fh = video.videoHeight;
  if (fw < 40 || fh < 40) return null;

  const norm = califacilAnswerSheetAlignNormRect(fw, fh);
  if (!norm) return null;

  const sx = norm.x * fw;
  const sy = norm.y * fh;
  const sw = norm.w * fw;
  const sh = norm.h * fh;
  if (sw < 80 || sh < 80) return null;

  const maxSide = opts?.maxSide ?? MOBILE_ROI_DETECT_MAX_SIDE;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const outW = Math.max(1, Math.round(sw * scale));
  const outH = Math.max(1, Math.round(sh * scale));

  const roiCanvas = document.createElement('canvas');
  roiCanvas.width = outW;
  roiCanvas.height = outH;
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);

  return {
    roiCanvas,
    roiRect: { left: sx, top: sy, width: sw, height: sh },
    frameW: fw,
    frameH: fh,
  };
}

function quadShoelaceArea(quad: [Point, Point, Point, Point]): number {
  const [tl, tr, br, bl] = quad;
  return (
    Math.abs(
      tl.x * tr.y +
        tr.x * br.y +
        br.x * bl.y +
        bl.x * tl.y -
        (tr.x * tl.y + br.x * tr.y + bl.x * br.y + tl.x * bl.y)
    ) * 0.5
  );
}

/** Fiduciales en las cuatro esquinas del ROI (hoja ≈ tamaño del recorte guía). */
function detectCornerMarkersOnRoiCanvas(
  canvas: HTMLCanvasElement
): [Point, Point, Point, Point] | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 80 || height < 80) return null;

  const id = ctx.getImageData(0, 0, width, height);
  const d = id.data;
  const regionW = Math.max(8, Math.round(width * 0.12));
  const regionH = Math.max(8, Math.round(height * 0.12));

  const tl = findCornerMarkerPoint(d, width, height, 0, 0, regionW, regionH);
  const tr = findCornerMarkerPoint(d, width, height, width - regionW, 0, regionW, regionH);
  const br = findCornerMarkerPoint(
    d,
    width,
    height,
    width - regionW,
    height - regionH,
    regionW,
    regionH
  );
  const bl = findCornerMarkerPoint(d, width, height, 0, height - regionH, regionW, regionH);
  if (!tl || !tr || !br || !bl) return null;
  return [tl, tr, br, bl];
}

/** Detección de bordes (Sobel) + contorno rectangular más grande dentro del ROI. */
function detectLargestQuadViaRoiEdges(
  canvas: HTMLCanvasElement
): [Point, Point, Point, Point] | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  if (w < 80 || h < 80) return null;

  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const step = 2;
  const edge = new Uint8Array(w * h);

  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const i = (y * w + x) * 4;
      const lum =
        d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114;
      const iL = (y * w + (x - step)) * 4;
      const iR = (y * w + (x + step)) * 4;
      const iU = ((y - step) * w + x) * 4;
      const iD = ((y + step) * w + x) * 4;
      const gx =
        (d[iR]! * 0.299 + d[iR + 1]! * 0.587 + d[iR + 2]! * 0.114) -
        (d[iL]! * 0.299 + d[iL + 1]! * 0.587 + d[iL + 2]! * 0.114);
      const gy =
        (d[iD]! * 0.299 + d[iD + 1]! * 0.587 + d[iD + 2]! * 0.114) -
        (d[iU]! * 0.299 + d[iU + 1]! * 0.587 + d[iU + 2]! * 0.114);
      const mag = Math.hypot(gx, gy);
      if (mag >= 22 && lum >= 40 && lum <= 245) {
        edge[y * w + x] = 1;
      }
    }
  }

  const edgeD = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ei = y * w + x;
      const di = ei * 4;
      const v = edge[ei] ? 0 : 255;
      edgeD[di] = v;
      edgeD[di + 1] = v;
      edgeD[di + 2] = v;
      edgeD[di + 3] = 255;
    }
  }

  const ink = detectCalifacilQuadFromDarkInk(edgeD, w, h);
  if (ink) return ink;

  const paper = detectCalifacilQuadFromBrightPaper(edgeD, w, h, 0.55);
  if (paper) return paper;

  return detectCalifacilQuadFromBrightPaper(d, w, h, 0.58);
}

/**
 * Encuentra el cuadrilátero de hoja más grande dentro del ROI (baja resolución).
 * Orden: fiduciales → bordes/contornos → heurística de papel.
 */
export function detectLargestQuadInRoiCanvas(
  roiCanvas: HTMLCanvasElement
): [Point, Point, Point, Point] | null {
  const w = roiCanvas.width;
  const h = roiCanvas.height;
  if (w < 80 || h < 80) return null;

  const preprocessed = preprocessForSheetDetection(roiCanvas);
  const sources = preprocessed ? [preprocessed, roiCanvas] : [roiCanvas];

  let best: [Point, Point, Point, Point] | null = null;
  let bestArea = 0;
  for (const src of sources) {
    const candidates: ([Point, Point, Point, Point] | null)[] = [
      detectCornerMarkersOnRoiCanvas(src),
      detectLargestQuadViaRoiEdges(src),
      detectCalifacilQuad(src),
    ];
    for (const quad of candidates) {
      if (!quad || !isValidMobileRoiQuad(quad, w, h)) continue;
      const area = quadShoelaceArea(quad);
      if (area > bestArea) {
        bestArea = area;
        best = quad;
      }
    }
  }
  return best;
}

/** Mínimo de área de hoja dentro del ROI (0–1) para permitir captura automática. */
export const MOBILE_MIN_ROI_FILL_RATIO = 0.15;
/** Mínimo de esquinas negras fiduciales visibles (de 4) para considerar hoja alineada en vivo. */
export const MOBILE_MIN_FIDUCIAL_CORNERS = 3;

export function measureRoiSheetFillRatio(
  quad: [Point, Point, Point, Point],
  roiW: number,
  roiH: number
): number {
  return quadShoelaceArea(quad) / Math.max(1, roiW * roiH);
}

/** 0 = uniforme; valores altos ⇒ sombra fuerte (p. ej. mitad oscura de la hoja). */
export function estimateCanvasShadowAsymmetry(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  const { width: w, height: h } = canvas;
  if (w < 40 || h < 40) return 0;
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const mid = Math.floor(w / 2);
  const step = Math.max(4, Math.floor(Math.sqrt((w * h) / 2800)));
  let leftSum = 0;
  let rightSum = 0;
  let ln = 0;
  let rn = 0;
  for (let y = Math.floor(h * 0.08); y < Math.floor(h * 0.92); y += step) {
    for (let x = 0; x < mid; x += step) {
      const i = (y * w + x) * 4;
      leftSum += (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) / 255;
      ln++;
    }
    for (let x = mid; x < w; x += step) {
      const i = (y * w + x) * 4;
      rightSum += (d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114) / 255;
      rn++;
    }
  }
  if (ln < 1 || rn < 1) return 0;
  const left = leftSum / ln;
  const right = rightSum / rn;
  return Math.abs(left - right) / Math.max(0.18, (left + right) * 0.5);
}

/** Estado por esquina [TL, TR, BL, BR] de fiduciales negros en parches de esquina. */
function detectFiducialsAtCornerPatches(
  ctx: CanvasRenderingContext2D,
  corners: { x: number; y: number }[],
  patchW: number,
  patchH: number
): [boolean, boolean, boolean, boolean] {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const detected: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  for (let i = 0; i < 4; i++) {
    const c = corners[i]!;
    const px = Math.max(0, Math.min(W - patchW, Math.round(c.x - patchW / 2)));
    const py = Math.max(0, Math.min(H - patchH, Math.round(c.y - patchH / 2)));
    const id = ctx.getImageData(px, py, patchW, patchH);
    let darkCount = 0;
    let lumSum = 0;
    const total = patchW * patchH;
    for (let j = 0; j < id.data.length; j += 4) {
      const lum = id.data[j]! * 0.299 + id.data[j + 1]! * 0.587 + id.data[j + 2]! * 0.114;
      lumSum += lum;
      if (lum < 88) darkCount++;
    }
    const darkFrac = darkCount / total;
    const meanLum = lumSum / total;
    detected[i] = darkFrac >= 0.1 && meanLum < 175;
  }
  return detected;
}

/** Fiduciales en las esquinas del cuadrilátero de hoja detectado (no del ROI completo). */
export function detectAnswerSheetFiducialsAtQuad(
  canvas: HTMLCanvasElement,
  quad: [Point, Point, Point, Point]
): [boolean, boolean, boolean, boolean] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [false, false, false, false];
  const W = canvas.width;
  const H = canvas.height;
  const [tl, tr, br, bl] = quad;
  const cx = (tl.x + tr.x + br.x + bl.x) * 0.25;
  const cy = (tl.y + tr.y + br.y + bl.y) * 0.25;
  const inset = (c: Point): Point => ({
    x: c.x + (cx - c.x) * 0.12,
    y: c.y + (cy - c.y) * 0.12,
  });
  const patch = Math.max(8, Math.round(Math.min(W, H) * 0.07));
  return detectFiducialsAtCornerPatches(
    ctx,
    [inset(tl), inset(tr), inset(bl), inset(br)],
    patch,
    patch
  );
}

/** Estado por esquina [TL, TR, BL, BR] de fiduciales negros visibles en el ROI. */
export function detectAnswerSheetFiducialsInRoi(
  canvas: HTMLCanvasElement,
  sheetQuad: [Point, Point, Point, Point] | null = null
): [boolean, boolean, boolean, boolean] {
  if (sheetQuad) {
    return detectAnswerSheetFiducialsAtQuad(canvas, sheetQuad);
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [false, false, false, false];
  const W = canvas.width;
  const H = canvas.height;
  if (W < 80 || H < 80) return [false, false, false, false];
  const patchW = Math.max(8, Math.round(W * 0.085));
  const patchH = Math.max(8, Math.round(H * 0.085));
  const inset = Math.max(4, Math.round(W * 0.022));
  const corners = [
    { x: inset, y: inset },
    { x: W - patchW - inset, y: inset },
    { x: inset, y: H - patchH - inset },
    { x: W - patchW - inset, y: H - patchH - inset },
  ];
  return detectFiducialsAtCornerPatches(ctx, corners, patchW, patchH);
}

/** Cuenta cuadros negros de esquina impresos visibles en las esquinas del ROI. */
export function countAnswerSheetFiducialsInRoi(canvas: HTMLCanvasElement): number {
  return detectAnswerSheetFiducialsInRoi(canvas).filter(Boolean).length;
}

/** CLAHE + gamma para fotos de cámara con sombras antes del escaneo OMR. */
export function prepareAnswerSheetCaptureCanvas(
  canvas: HTMLCanvasElement
): HTMLCanvasElement | null {
  return applyOmrcheckerStylePreprocess(canvas);
}

/**
 * Vista previa legible para el usuario: conserva color y luz natural.
 * El preprocesado OMR (CLAHE) se usa solo internamente para leer casillas.
 */
export function prepareAnswerSheetDisplayCanvas(
  canvas: HTMLCanvasElement
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'grayscale(1) contrast(1.38) brightness(1.1)';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  ctx.filter = 'none';
  return out;
}

function buildAnswerSheetCaptureVariants(
  canvas: HTMLCanvasElement
): Array<{ canvas: HTMLCanvasElement; preferFullSheetFirst: boolean }> {
  const out: Array<{ canvas: HTMLCanvasElement; preferFullSheetFirst: boolean }> = [
    { canvas, preferFullSheetFirst: true },
  ];
  const pre = applyOmrcheckerStylePreprocess(canvas);
  if (pre && pre !== canvas) {
    out.push({ canvas: pre, preferFullSheetFirst: true });
  }
  return out;
}

/** Valida cuadrilátero detectado: 4 esquinas y área mínima dentro del ROI. */
export function isValidMobileRoiQuad(
  quad: [Point, Point, Point, Point],
  roiW: number,
  roiH: number
): boolean {
  const [tl, tr, br, bl] = quad;
  const corners = [tl, tr, br, bl];
  for (const p of corners) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  const minDist = Math.min(roiW, roiH) * 0.08;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(corners[i]!.x - corners[j]!.x, corners[i]!.y - corners[j]!.y) < minDist) {
        return false;
      }
    }
  }

  const area = quadShoelaceArea(quad);
  if (area < roiW * roiH * 0.14) return false;

  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottomW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);
  const avgW = (topW + bottomW) * 0.5;
  const avgH = (leftH + rightH) * 0.5;
  if (avgW < roiW * 0.2 || avgH < roiH * 0.2) return false;

  const aspect = avgW / Math.max(1, avgH);
  if (aspect < 0.45 || aspect > 1.15) return false;

  return true;
}

/** Suaviza cuadrilátero ROI entre frames para reducir jitter de detección. */
export function smoothMobileRoiQuad(
  prev: [Point, Point, Point, Point] | null,
  next: [Point, Point, Point, Point],
  alpha = 0.5
): [Point, Point, Point, Point] {
  if (!prev) return next;
  const t = Math.max(0.12, Math.min(0.88, alpha));
  return next.map((p, i) => ({
    x: prev[i]!.x * (1 - t) + p.x * t,
    y: prev[i]!.y * (1 - t) + p.y * t,
  })) as [Point, Point, Point, Point];
}

/** Compara dos cuads consecutivos en el ROI para exigir estabilidad temporal. */
export function mobileRoiQuadsAreStable(
  prev: [Point, Point, Point, Point] | null,
  next: [Point, Point, Point, Point],
  roiW: number,
  roiH: number,
  maxCornerShiftFrac = 0.12
): boolean {
  if (!prev) return false;
  const maxShift = Math.max(roiW, roiH) * maxCornerShiftFrac;
  for (let i = 0; i < 4; i++) {
    const dx = next[i]!.x - prev[i]!.x;
    const dy = next[i]!.y - prev[i]!.y;
    if (Math.hypot(dx, dy) > maxShift) return false;
  }
  return true;
}

/** Lleva esquinas del ROI escalado a coordenadas del fotograma completo del sensor. */
export function mapRoiQuadToFrame(
  quad: [Point, Point, Point, Point],
  roiRect: { left: number; top: number; width: number; height: number },
  roiCanvasW: number,
  roiCanvasH: number
): [Point, Point, Point, Point] {
  const sx = roiRect.width / Math.max(1, roiCanvasW);
  const sy = roiRect.height / Math.max(1, roiCanvasH);
  return quad.map((p) => ({
    x: roiRect.left + p.x * sx,
    y: roiRect.top + p.y * sy,
  })) as [Point, Point, Point, Point];
}

/** Esquinas del cuadrilátero de hoja → píxeles en pantalla (object-cover). */
export function mapRoiQuadCornersToViewportPx(
  quad: [Point, Point, Point, Point],
  roiCapture: MobileGuideRoiCapture,
  letterbox: CalifacilVideoLetterbox,
  cornerBoxSize = 76
): Array<{ left: number; top: number; size: number }> {
  const roiW = roiCapture.roiCanvas.width;
  const roiH = roiCapture.roiCanvas.height;
  const frameQuad = mapRoiQuadToFrame(quad, roiCapture.roiRect, roiW, roiH);
  const { scale, cropX, cropY } = getObjectCoverVideoMapping(
    roiCapture.frameW,
    roiCapture.frameH,
    letterbox.displayW,
    letterbox.displayH
  );
  const toViewport = (p: Point) => ({
    left: letterbox.offsetX + p.x * scale - cropX - cornerBoxSize / 2,
    top: letterbox.offsetY + p.y * scale - cropY - cornerBoxSize / 2,
    size: cornerBoxSize,
  });
  const [tl, tr, br, bl] = frameQuad;
  return [toViewport(tl), toViewport(tr), toViewport(bl), toViewport(br)];
}

export type ViewportAnswerBubble = {
  x: number;
  y: number;
  r: number;
  row: number;
  col: number;
  /** Columna de la clave del examen para esta fila (resaltada en verde). */
  isKeyColumn: boolean;
};

/**
 * Proyecta las burbujas de la plantilla CaliFacil (850×1100) al visor de cámara
 * usando el cuadrilátero detectado — guía de alineación en vivo.
 * @deprecated Usar detección en ROI vía {@link mapAnswerSheetBubblesToViewport} con roiCanvas.
 */
export function mapTemplateAnswerSheetBubblesToViewport(
  quad: [Point, Point, Point, Point],
  roiCapture: MobileGuideRoiCapture,
  letterbox: CalifacilVideoLetterbox,
  rowCount: number,
  columns: number,
  expectedColByRow?: (number | null)[]
): ViewportAnswerBubble[] | null {
  const roiW = roiCapture.roiCanvas.width;
  const roiH = roiCapture.roiCanvas.height;
  const frameQuad = mapRoiQuadToFrame(quad, roiCapture.roiRect, roiW, roiH);
  const h = computeHomographyFromRectToQuad(
    CALIFACIL_WARP_LETTER_WIDTH,
    CALIFACIL_WARP_LETTER_HEIGHT,
    frameQuad
  );
  if (!h) return null;

  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const geometry = buildAnswerSheetOmrGeometry(
    rows,
    cols,
    CALIFACIL_WARP_LETTER_WIDTH,
    CALIFACIL_WARP_LETTER_HEIGHT
  );
  const { scale, cropX, cropY } = getObjectCoverVideoMapping(
    roiCapture.frameW,
    roiCapture.frameH,
    letterbox.displayW,
    letterbox.displayH
  );
  const frameToViewport = (fx: number, fy: number) => ({
    x: letterbox.offsetX + fx * scale - cropX,
    y: letterbox.offsetY + fy * scale - cropY,
  });

  const bubbles: ViewportAnswerBubble[] = [];
  const W = geometry.imageWidth;
  const H = geometry.imageHeight;

  for (let row = 0; row < rows; row++) {
    const expectedCol = expectedColByRow?.[row] ?? null;
    const rowCells = geometry.cells[row];
    if (!rowCells) continue;
    for (let col = 0; col < cols; col++) {
      const cell = rowCells[col];
      if (!cell) continue;
      const cx = (cell.x + cell.w * 0.5) * W;
      const cy = (cell.y + cell.h * 0.5) * H;
      const frameCenter = applyHomography8ToPoint(h, cx, cy);
      if (!frameCenter) continue;
      const vp = frameToViewport(frameCenter.x, frameCenter.y);
      const cxEdge = (cell.x + cell.w) * W;
      const frameEdge = applyHomography8ToPoint(h, cxEdge, cy);
      const vpEdge = frameEdge ? frameToViewport(frameEdge.x, frameEdge.y) : null;
      const r = vpEdge ? Math.max(5, Math.min(24, Math.abs(vpEdge.x - vp.x) * 0.4)) : 9;
      bubbles.push({
        x: vp.x,
        y: vp.y,
        r,
        row,
        col,
        isKeyColumn: expectedCol !== null && expectedCol === col,
      });
    }
  }
  return bubbles.length > 0 ? bubbles : null;
}

type AnswerSheetTableTemplate = {
  tableLeftRatio: number;
  tableTopRatio: number;
  tableWidthRatio: number;
  tableHeightRatio: number;
  titleStripRatioOfTable: number;
  qnumWidthRatio: number;
};

function buildAnswerSheetOmrGeometryFromTemplate(
  template: AnswerSheetTableTemplate,
  rowCount: number,
  columns: number,
  imageWidth: number,
  imageHeight: number
): CalifacilOmrScanGeometry {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);

  const tableLeft = width * template.tableLeftRatio;
  const tableTop = height * template.tableTopRatio;
  const tableW = width * template.tableWidthRatio;
  const tableH = height * template.tableHeightRatio;
  const dataTop = tableTop + tableH * template.titleStripRatioOfTable;
  const dataHeight = tableH * (1 - template.titleStripRatioOfTable);
  const rowH = dataHeight / rows;
  const qNumW = tableW * template.qnumWidthRatio;
  const rightStripW = tableW * CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO;
  const bubbleAreaLeft = Math.max(2, Math.round(tableLeft + qNumW));
  const bubbleAreaW = Math.max(18, tableW - qNumW - rightStripW);
  const cellW = bubbleAreaW / cols;

  const cells: OmrNormRect[][] = [];
  for (let row = 0; row < rows; row++) {
    const yRowTop = dataTop + row * rowH;
    const yRowBot = dataTop + (row + 1) * rowH;
    const rowRects: OmrNormRect[] = [];
    for (let c = 0; c < cols; c++) {
      const x0 = bubbleAreaLeft + c * cellW;
      const x1 = c === cols - 1 ? bubbleAreaLeft + bubbleAreaW : bubbleAreaLeft + (c + 1) * cellW;
      rowRects.push({
        x: x0 / width,
        y: yRowTop / height,
        w: Math.max(0, (x1 - x0) / width),
        h: Math.max(0, (yRowBot - yRowTop) / height),
      });
    }
    cells.push(rowRects);
  }

  return { imageWidth: width, imageHeight: height, cells };
}

function detectTableGridWithTemplate(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  rowCount: number,
  columns: number,
  template: AnswerSheetTableTemplate
): CalifacilOmrScanGeometry | null {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));

  const tableLeft = width * template.tableLeftRatio;
  const tableTop = height * template.tableTopRatio;
  const tableW = width * template.tableWidthRatio;
  const tableH = height * template.tableHeightRatio;
  const dataTop = tableTop + tableH * template.titleStripRatioOfTable;
  const dataHeight = tableH * (1 - template.titleStripRatioOfTable);
  const rowH = dataHeight / rows;
  const qNumW = tableW * template.qnumWidthRatio;
  const rightStripW = tableW * CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO;
  const bubbleAreaLeft = Math.max(2, Math.round(tableLeft + qNumW));
  const bubbleAreaW = Math.max(18, tableW - qNumW - rightStripW);
  const cellW = bubbleAreaW / cols;

  const uniformColEdges = buildUniformBubbleColumnEdges(
    bubbleAreaLeft,
    bubbleAreaW,
    cols,
    width
  );

  let lineYs = refineOmrRowBoundariesFromTableLines(
    imageData,
    width,
    height,
    bubbleAreaLeft,
    dataTop,
    dataHeight,
    rows
  );
  let colEdges = inferColumnEdgesFromVerticalLines(
    imageData,
    width,
    height,
    bubbleAreaLeft,
    bubbleAreaW,
    cols,
    dataTop,
    rowH
  );

  if (lineYs && lineYs.length === rows + 1) {
    let rowAligned = true;
    let avgDev = 0;
    for (let i = 0; i < rows + 1; i++) {
      const expected = dataTop + i * rowH;
      const dev = Math.abs(lineYs[i]! - expected);
      avgDev += dev;
      if (dev > rowH * 0.92) rowAligned = false;
    }
    avgDev /= rows + 1;
    const uniformRows = lineYsHaveUniformSpacing(lineYs);
    if (!rowAligned && !uniformRows) {
      lineYs = null;
    } else if (rowAligned) {
      const detectedWeight = avgDev < rowH * 0.22 ? 0.82 : 0.65;
      lineYs = lineYs.map((y, i) => {
        const expected = dataTop + i * rowH;
        return Math.round(y * detectedWeight + expected * (1 - detectedWeight));
      });
    }
  } else {
    lineYs = null;
  }

  if (colEdges && colEdges.length === cols + 1) {
    let maxEdgeDev = 0;
    for (let i = 0; i <= cols; i++) {
      maxEdgeDev = Math.max(maxEdgeDev, Math.abs(colEdges[i]! - uniformColEdges[i]!));
    }
    const span = colEdges[cols]! - colEdges[0]!;
    if (span < bubbleAreaW * 0.62 || span > bubbleAreaW * 1.38 || maxEdgeDev > cellW * 0.62) {
      colEdges = null;
    } else {
      colEdges = colEdges.map((x, i) => Math.round(x * 0.72 + uniformColEdges[i]! * 0.28));
    }
  } else {
    colEdges = null;
  }

  if (!lineYs) return null;

  const columnEdges = colEdges ?? uniformColEdges;
  return buildCellsFromTableLines(lineYs, columnEdges, width, height, cols);
}

/** Detecta la rejilla impresa en el ROI de cámara (líneas horizontales/verticales de la tabla). */
export function detectLiveAnswerSheetGridGeometry(
  canvas: HTMLCanvasElement,
  rowCount: number,
  columns: number
): CalifacilOmrScanGeometry | null {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const width = canvas.width;
  const height = canvas.height;
  if (width < 40 || height < 40) return null;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const imageData = ctx.getImageData(0, 0, width, height).data;

  const swept = sweepAnswerSheetTableGrid(imageData, width, height, rowCount, columns);
  let sweptGeom: CalifacilOmrScanGeometry | null = null;
  if (swept) {
    sweptGeom = buildCellsFromTableLines(swept.lineYs, swept.colEdges, width, height, cols);
    if (validateAnswerSheetGeometry(sweptGeom, rows).ok) return sweptGeom;
    if (swept.lineYs.length === rows + 1) return sweptGeom;
  }

  const anchored = buildMarkerAnchoredAnswerSheetTemplate(rowCount);
  const anchoredGeom = detectTableGridWithTemplate(
    imageData,
    width,
    height,
    rowCount,
    columns,
    anchored
  );
  if (anchoredGeom && validateAnswerSheetGeometry(anchoredGeom, rows).ok) return anchoredGeom;

  const pageTemplate = buildCalifacilAnswerSheetOmrTemplate(rowCount);
  const pageGeom = detectTableGridWithTemplate(
    imageData,
    width,
    height,
    rowCount,
    columns,
    pageTemplate
  );
  if (pageGeom && validateAnswerSheetGeometry(pageGeom, rows).ok) return pageGeom;

  return (
    sweptGeom ??
    anchoredGeom ??
    pageGeom ??
    buildAnswerSheetOmrGeometryFromTemplate(anchored, rowCount, columns, width, height)
  );
}

function pixelLuminance(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
  const ix = Math.max(0, Math.min(width - 1, x));
  const iy = Math.max(0, Math.min(height - 1, y));
  const i = (iy * width + ix) * 4;
  return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
}

function meanDiskLuminance(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number
): number {
  let sum = 0;
  let n = 0;
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      sum += pixelLuminance(data, width, height, x, y);
      n++;
    }
  }
  return n > 0 ? sum / n : 255;
}

/** Busca el centro más oscuro (burbuja impresa) dentro de la celda detectada. */
function refineBubbleCenterInCell(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cell: OmrNormRect
): Point {
  const cx0 = (cell.x + cell.w * 0.5) * width;
  const cy0 = (cell.y + cell.h * 0.5) * height;
  const cellW = cell.w * width;
  const cellH = cell.h * height;
  const searchR = Math.max(2, Math.round(Math.min(cellW, cellH) * 0.44));
  const diskR = Math.max(1, Math.round(Math.min(cellW, cellH) * 0.24));
  const step = Math.max(1, Math.round(searchR / 5));
  let bestX = cx0;
  let bestY = cy0;
  let bestLum = 255;
  for (let dy = -searchR; dy <= searchR; dy += step) {
    for (let dx = -searchR; dx <= searchR; dx += step) {
      const px = Math.round(cx0 + dx);
      const py = Math.round(cy0 + dy);
      const lum = meanDiskLuminance(data, width, height, px, py, diskR);
      if (lum < bestLum) {
        bestLum = lum;
        bestX = px;
        bestY = py;
      }
    }
  }
  return { x: bestX, y: bestY };
}

export function mapRoiCanvasPointToViewport(
  roiX: number,
  roiY: number,
  roiCapture: MobileGuideRoiCapture,
  letterbox: CalifacilVideoLetterbox
): { x: number; y: number } {
  const roiW = roiCapture.roiCanvas.width;
  const roiH = roiCapture.roiCanvas.height;
  const fx = roiCapture.roiRect.left + (roiX / Math.max(1, roiW)) * roiCapture.roiRect.width;
  const fy = roiCapture.roiRect.top + (roiY / Math.max(1, roiH)) * roiCapture.roiRect.height;
  const { scale, cropX, cropY } = getObjectCoverVideoMapping(
    roiCapture.frameW,
    roiCapture.frameH,
    letterbox.displayW,
    letterbox.displayH
  );
  return {
    x: letterbox.offsetX + fx * scale - cropX,
    y: letterbox.offsetY + fy * scale - cropY,
  };
}

/**
 * Detecta la rejilla impresa en el ROI de cámara y proyecta cada burbuja al visor.
 */
export function mapAnswerSheetBubblesToViewport(
  roiCanvas: HTMLCanvasElement,
  roiCapture: MobileGuideRoiCapture,
  letterbox: CalifacilVideoLetterbox,
  rowCount: number,
  columns: number,
  expectedColByRow?: (number | null)[]
): ViewportAnswerBubble[] | null {
  const geometry = detectLiveAnswerSheetGridGeometry(roiCanvas, rowCount, columns);
  if (!geometry) return null;

  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx?.getImageData(0, 0, roiCanvas.width, roiCanvas.height).data ?? null;
  const roiW = roiCanvas.width;
  const roiH = roiCanvas.height;
  const rows = Math.min(clampCalifacilOmrRowCount(rowCount), geometry.cells.length);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const bubbles: ViewportAnswerBubble[] = [];

  for (let row = 0; row < rows; row++) {
    const expectedCol = expectedColByRow?.[row] ?? null;
    const rowCells = geometry.cells[row];
    if (!rowCells) continue;
    for (let col = 0; col < cols; col++) {
      const cell = rowCells[col];
      if (!cell) continue;
      const center = imageData
        ? refineBubbleCenterInCell(imageData, roiW, roiH, cell)
        : { x: (cell.x + cell.w * 0.5) * roiW, y: (cell.y + cell.h * 0.5) * roiH };
      const vp = mapRoiCanvasPointToViewport(center.x, center.y, roiCapture, letterbox);
      const vpEdge = mapRoiCanvasPointToViewport(
        (cell.x + cell.w) * roiW,
        center.y,
        roiCapture,
        letterbox
      );
      const r = Math.max(5, Math.min(24, Math.abs(vpEdge.x - vp.x) * 0.4));
      bubbles.push({
        x: vp.x,
        y: vp.y,
        r,
        row,
        col,
        isKeyColumn: expectedCol !== null && expectedCol === col,
      });
    }
  }
  return bubbles.length > 0 ? bubbles : null;
}

/** Cuadrilátero detectado → polígono en píxeles de pantalla (object-cover). */
export function mapRoiQuadPolygonToViewportPx(
  quad: [Point, Point, Point, Point],
  roiCapture: MobileGuideRoiCapture,
  letterbox: CalifacilVideoLetterbox
): Array<{ x: number; y: number }> {
  const roiW = roiCapture.roiCanvas.width;
  const roiH = roiCapture.roiCanvas.height;
  const frameQuad = mapRoiQuadToFrame(quad, roiCapture.roiRect, roiW, roiH);
  const { scale, cropX, cropY } = getObjectCoverVideoMapping(
    roiCapture.frameW,
    roiCapture.frameH,
    letterbox.displayW,
    letterbox.displayH
  );
  const toViewport = (p: Point) => ({
    x: letterbox.offsetX + p.x * scale - cropX,
    y: letterbox.offsetY + p.y * scale - cropY,
  });
  const [tl, tr, br, bl] = frameQuad;
  return [toViewport(tl), toViewport(tr), toViewport(br), toViewport(bl)];
}

/** Escala un cuadrilátero cuando el canvas de captura se redimensionó respecto al sensor. */
export function scaleQuadToCanvas(
  quad: [Point, Point, Point, Point],
  frameW: number,
  frameH: number,
  canvasW: number,
  canvasH: number
): [Point, Point, Point, Point] {
  const sx = canvasW / Math.max(1, frameW);
  const sy = canvasH / Math.max(1, frameH);
  return quad.map((p) => ({ x: p.x * sx, y: p.y * sy })) as [Point, Point, Point, Point];
}

/** Endereza la hoja con un cuadrilátero ya detectado (tras captura en alta resolución). */
export function warpCalifacilSheetFromQuad(
  canvas: HTMLCanvasElement,
  quad: [Point, Point, Point, Point]
): HTMLCanvasElement | null {
  return warpPerspectiveToRect(
    canvas,
    quad,
    CALIFACIL_WARP_LETTER_WIDTH,
    CALIFACIL_WARP_LETTER_HEIGHT
  );
}

/** Detecta centros de fiduciales en imagen ya enderezada (850×1100). */
export function detectWarpedFiducialCenters(
  warpedCanvas: HTMLCanvasElement
): Record<WarpAlignmentCornerId, Point | null> {
  const ctx = warpedCanvas.getContext('2d', { willReadFrequently: true });
  const empty = { tl: null, tr: null, bl: null, br: null } as Record<
    WarpAlignmentCornerId,
    Point | null
  >;
  if (!ctx) return empty;
  const { width, height } = warpedCanvas;
  if (width < 80 || height < 80) return empty;
  const id = ctx.getImageData(0, 0, width, height);
  const d = id.data;
  const regionW = Math.max(12, Math.round(width * 0.12));
  const regionH = Math.max(12, Math.round(height * 0.12));
  const corners: Array<{ id: WarpAlignmentCornerId; x: number; y: number }> = [
    { id: 'tl', x: 0, y: 0 },
    { id: 'tr', x: width - regionW, y: 0 },
    { id: 'br', x: width - regionW, y: height - regionH },
    { id: 'bl', x: 0, y: height - regionH },
  ];
  const out = { ...empty };
  for (const c of corners) {
    out[c.id] = findCornerMarkerPoint(d, width, height, c.x, c.y, regionW, regionH);
  }
  return out;
}

/** Mide error en px entre fiduciales detectados y la plantilla PDF/carta. */
export function measureWarpedFiducialAlignment(
  warpedCanvas: HTMLCanvasElement,
  maxAllowedPx = MAX_WARP_ALIGNMENT_ERROR_PX
): WarpAlignmentReport {
  const w = warpedCanvas.width;
  const h = warpedCanvas.height;
  const detected = detectWarpedFiducialCenters(warpedCanvas);
  const ids: WarpAlignmentCornerId[] = ['tl', 'tr', 'br', 'bl'];
  const corners = ids.map((id) => {
    const norm = CALIFACIL_FIDUCIAL_CENTERS_NORM[id];
    const expected = { x: norm.x * w, y: norm.y * h };
    const det = detected[id];
    const errorPx = det ? Math.hypot(det.x - expected.x, det.y - expected.y) : Infinity;
    return { id, expected, detected: det, errorPx };
  });
  const finite = corners.filter((c) => Number.isFinite(c.errorPx));
  const maxErrorPx = finite.length ? Math.max(...finite.map((c) => c.errorPx)) : Infinity;
  const meanErrorPx =
    finite.length > 0
      ? finite.reduce((s, c) => s + c.errorPx, 0) / finite.length
      : Infinity;
  const ok =
    finite.length === 4 && maxErrorPx <= maxAllowedPx && Number.isFinite(maxErrorPx);
  return { ok, maxErrorPx, meanErrorPx, maxAllowedPx, corners };
}

export type WarpCalifacilSheetResult = {
  warped: HTMLCanvasElement | null;
  alignment: WarpAlignmentReport | null;
};

/** Micro-rotación ±N° para minimizar error fiducial residual tras warp. */
export function deskewWarpedCalifacilSheet(
  warped: HTMLCanvasElement,
  maxDegrees = 6
): HTMLCanvasElement {
  let best = warped;
  let bestErr = measureWarpedFiducialAlignment(warped, 99).maxErrorPx;
  for (let deg = -maxDegrees; deg <= maxDegrees; deg++) {
    if (deg === 0) continue;
    const rotated = rotateCanvasByDegrees(warped, deg);
    const err = measureWarpedFiducialAlignment(rotated, 99).maxErrorPx;
    if (err < bestErr - 0.15) {
      bestErr = err;
      best = rotated;
    }
  }
  return best;
}

/** Warp a carta + validación de homografía por fiduciales + refinamiento iterativo. */
export function warpAndValidateCalifacilSheet(
  canvas: HTMLCanvasElement,
  quad: [Point, Point, Point, Point],
  maxErrorPx = MAX_WARP_ALIGNMENT_ERROR_PX
): WarpCalifacilSheetResult {
  const warped = warpCalifacilSheetFromQuad(canvas, quad);
  if (!warped) return { warped: null, alignment: null };
  const refined = refineWarpedCalifacilSheet(warped, { maxAllowedPx: maxErrorPx });
  return { warped: refined.canvas, alignment: refined.alignment };
}

/**
 * Refina una hoja ya enderezada (850×1100) alineando fiduciales con la plantilla impresa.
 * Aplica hasta {@link REFINE_WARP_MAX_ITERATIONS} homografías de corrección.
 */
export function refineWarpedCalifacilSheet(
  warped: HTMLCanvasElement,
  opts?: {
    maxIterations?: number;
    targetMaxErrorPx?: number;
    maxAllowedPx?: number;
    /** Omite deskew y limita iteraciones — captura móvil en tiempo real. */
    fast?: boolean;
  }
): { canvas: HTMLCanvasElement; alignment: WarpAlignmentReport; iterations: number } {
  const maxAllowedPx = opts?.maxAllowedPx ?? MAX_WARP_ALIGNMENT_ERROR_PX;
  const maxIterations = opts?.fast ? 1 : (opts?.maxIterations ?? REFINE_WARP_MAX_ITERATIONS);
  const refined = refineWarpedSheetFiducials(
    warped,
    detectWarpedFiducialCenters,
    (canvas, maxPx) => {
      const r = measureWarpedFiducialAlignment(canvas, maxPx);
      return {
        ok: r.ok,
        maxErrorPx: r.maxErrorPx,
        meanErrorPx: r.meanErrorPx,
        maxAllowedPx: r.maxAllowedPx,
      };
    },
    {
      maxIterations,
      targetMaxErrorPx: opts?.targetMaxErrorPx ?? REFINE_WARP_TARGET_MAX_ERROR_PX,
      maxAllowedPx,
    }
  );
  if (opts?.fast) {
    return {
      canvas: refined.canvas,
      alignment: measureWarpedFiducialAlignment(refined.canvas, maxAllowedPx),
      iterations: refined.iterations,
    };
  }
  const deskewed = deskewWarpedCalifacilSheet(refined.canvas);
  const deskewRefined = refineWarpedSheetFiducials(
    deskewed,
    detectWarpedFiducialCenters,
    (canvas, maxPx) => {
      const r = measureWarpedFiducialAlignment(canvas, maxPx);
      return {
        ok: r.ok,
        maxErrorPx: r.maxErrorPx,
        meanErrorPx: r.meanErrorPx,
        maxAllowedPx: r.maxAllowedPx,
      };
    },
    {
      maxIterations: 1,
      targetMaxErrorPx: opts?.targetMaxErrorPx ?? REFINE_WARP_TARGET_MAX_ERROR_PX,
      maxAllowedPx,
    }
  );
  return {
    canvas: deskewRefined.canvas,
    alignment: measureWarpedFiducialAlignment(deskewRefined.canvas, maxAllowedPx),
    iterations: refined.iterations + deskewRefined.iterations,
  };
}

export type PrepareMobileCameraScanOptions = {
  /** En vivo omitimos barrido fino de inclinación por rendimiento. */
  live?: boolean;
};

/**
 * Prepara fotograma de cámara móvil: orientación automática + detección de hoja.
 * Usa el fotograma completo (no recorte guía) para que la perspectiva encuentre el papel.
 */
export function prepareMobileCameraScanCanvas(
  source: HTMLCanvasElement,
  columns: number,
  opts?: PrepareMobileCameraScanOptions
): { canvas: HTMLCanvasElement; sheetLikely: boolean } {
  const oriented =
    autoOrientCalifacilSheet(source, columns, {
      useGuideCrop: false,
      allowTiltSweep: !opts?.live,
    }) ?? source;
  const canvas =
    oriented instanceof HTMLCanvasElement ? oriented : drawSourceToCanvas(oriented, 1400);
  const safe = canvas ?? source;
  return {
    canvas: safe,
    sheetLikely: isCalifacilExamSheetLikely(safe, columns),
  };
}

/** Opciones para preparar imagen antes de orientar / escanear CaliFacil */
export type PrepareCalifacilScanInputOptions = {
  /**
   * Si es true (predeterminado), recorta al encuadre de hoja carta del visor móvil.
   * Pon `false` para fotos ya recortadas o archivo subido desde escritorio.
   */
  useGuideCrop?: boolean;
};

/** Escala, opcionalmente recorta al marco guía y devuelve imagen lista para orientar/escanear. */
export function prepareCalifacilScanInput(
  source: HTMLImageElement | HTMLCanvasElement,
  opts?: PrepareCalifacilScanInputOptions
): HTMLCanvasElement | null {
  const base = drawSourceToCanvas(source, 1400);
  if (!base) return null;
  if (opts?.useGuideCrop === false) return base;
  return cropCanvasToCalifacilGuideOverlay(base) ?? base;
}

/** Opciones para {@link autoOrientCalifacilSheet}. */
export type AutoOrientCalifacilSheetOptions = PrepareCalifacilScanInputOptions & {
  /**
   * Si false, evita barridos de inclinación fina (útil para escaneos de escritorio ya rectos).
   * Por defecto true.
   */
  allowTiltSweep?: boolean;
};

function normalizeMinMaxInPlaceGray(gray: Uint8Array): void {
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) return;
  const scale = 255 / (max - min);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round((gray[i]! - min) * scale);
  }
}

function gammaCorrectGrayInPlace(gray: Uint8Array, gamma: number): void {
  const invGamma = 1 / gamma;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]! / 255;
    gray[i] = Math.round(Math.pow(v, invGamma) * 255);
  }
}

/** CLAHE por teselas (similar a `cv2.createCLAHE` en OMRChecker). */
function claheGrayToNewBuffer(
  src: Uint8Array,
  w: number,
  h: number,
  tileW: number,
  tileH: number,
  clipLimit: number
): Uint8Array {
  const dst = new Uint8Array(w * h);
  const tilesX = Math.ceil(w / tileW);
  const tilesY = Math.ceil(h / tileH);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = Math.min(w, x0 + tileW);
      const y1 = Math.min(h, y0 + tileH);
      let tilePixels = 0;
      const hist = new Uint32Array(256);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[src[y * w + x]!]++;
          tilePixels++;
        }
      }
      const limit = Math.max(1, Math.floor((clipLimit * tilePixels) / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i]! > limit) {
          excess += hist[i]! - limit;
          hist[i] = limit;
        }
      }
      const add = Math.floor(excess / 256);
      for (let i = 0; i < 256; i++) {
        hist[i] += add;
      }
      let rem = excess - add * 256;
      for (let i = 0; i < 256 && rem > 0; i++) {
        const space = limit - hist[i]!;
        if (space > 0) {
          const take = Math.min(space, rem);
          hist[i] += take;
          rem -= take;
        }
      }
      const cdf = new Uint32Array(256);
      cdf[0] = hist[0]!;
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1]! + hist[i]!;
      let cdfMin = 0;
      for (let i = 0; i < 256; i++) {
        if (cdf[i]! > 0) {
          cdfMin = cdf[i]!;
          break;
        }
      }
      const denom = Math.max(1, tilePixels - cdfMin);
      const lut = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        lut[i] = Math.min(255, Math.round(((cdf[i]! - cdfMin) * 255) / denom));
      }
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          dst[y * w + x] = lut[src[y * w + x]!]!;
        }
      }
    }
  }
  return dst;
}

function grayBufferToRgbCanvas(gray: Uint8Array, w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const id = ctx.createImageData(w, h);
  const d = id.data;
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const g = gray[i]!;
    d[j] = g;
    d[j + 1] = g;
    d[j + 2] = g;
    d[j + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return canvas;
}

function getGrayBufferFromCanvas(canvas: HTMLCanvasElement): { gray: Uint8Array; w: number; h: number } | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 32 || h < 32) return null;
  const id = ctx.getImageData(0, 0, w, h);
  const src = id.data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    gray[j] = Math.round(0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!);
  }
  return { gray, w, h };
}

/**
 * Cadena similar a OMRChecker `read_omr_response` (CLAHE → gamma → normalize) antes de leer medias.
 * Mejora fotos de cámara con sombras; se combina con el escaneo original y se elige la lectura con mejor puntuación.
 */
function applyOmrcheckerStylePreprocess(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  return preprocessForSheetDetection(canvas);
}

/**
 * Pasa bajo suave vía downscale + upscale: reduce moiré/subpixel en fotos de pantalla LCD
 * donde la franja completa por columna puede engañar al OMR.
 */
function applyAntiMoirLowPass(
  canvas: HTMLCanvasElement,
  scale: number
): HTMLCanvasElement | null {
  const w = canvas.width;
  const h = canvas.height;
  if (w < 32 || h < 32 || scale <= 0.55 || scale >= 0.98) return null;
  const sw = Math.max(16, Math.round(w * scale));
  const sh = Math.max(16, Math.round(h * scale));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  if (!sctx) return null;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, sw, sh);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) return null;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(small, 0, 0, w, h);
  return out;
}

const ANTI_MOIR_DOWN_SCALE = 0.84 as const;

/**
 * Variantes a probar: original / corrección de perspectiva / mismas con preprocesado estilo OMRChecker.
 * `preferFullSheetFirst`: orden de perfiles geométricos (igual que antes para raw vs corregido).
 */
function buildOmrScanCanvasVariants(
  canvas: HTMLCanvasElement,
  corrected: HTMLCanvasElement
): Array<{ canvas: HTMLCanvasElement; preferFullSheetFirst: boolean }> {
  const out: Array<{ canvas: HTMLCanvasElement; preferFullSheetFirst: boolean }> = [];
  const pushUnique = (c: HTMLCanvasElement, preferFullFirst: boolean) => {
    if (!out.some((o) => o.canvas === c)) {
      out.push({ canvas: c, preferFullSheetFirst: preferFullFirst });
    }
  };
  pushUnique(canvas, true);
  if (corrected !== canvas) {
    pushUnique(corrected, false);
  }
  const preOrig = applyOmrcheckerStylePreprocess(canvas);
  if (preOrig) {
    pushUnique(preOrig, true);
  }
  if (corrected !== canvas) {
    const preCorr = applyOmrcheckerStylePreprocess(corrected);
    if (preCorr) {
      pushUnique(preCorr, false);
    }
  }
  const antiOrig = applyAntiMoirLowPass(canvas, ANTI_MOIR_DOWN_SCALE);
  if (antiOrig) {
    pushUnique(antiOrig, true);
  }
  if (corrected !== canvas) {
    const antiCorr = applyAntiMoirLowPass(corrected, ANTI_MOIR_DOWN_SCALE);
    if (antiCorr) {
      pushUnique(antiCorr, false);
    }
  }
  return out;
}

/**
 * Variantes que conservan exactamente la geometría del input (sin warp/rotación):
 * original + mejoras de contraste/suavizado para robustez.
 */
function buildPreservedInputVariants(
  canvas: HTMLCanvasElement
): Array<{ canvas: HTMLCanvasElement; preferFullSheetFirst: boolean }> {
  const out: Array<{ canvas: HTMLCanvasElement; preferFullSheetFirst: boolean }> = [];
  const pushUnique = (c: HTMLCanvasElement) => {
    if (!out.some((o) => o.canvas === c)) out.push({ canvas: c, preferFullSheetFirst: true });
  };
  pushUnique(canvas);
  const pre = applyOmrcheckerStylePreprocess(canvas);
  if (pre) pushUnique(pre);
  const anti = applyAntiMoirLowPass(canvas, ANTI_MOIR_DOWN_SCALE);
  if (anti) pushUnique(anti);
  return out;
}

function isLikelyFullSheetPhoto(canvas: HTMLCanvasElement): boolean {
  const w = Math.max(1, canvas.width);
  const h = Math.max(1, canvas.height);
  // Hoja completa en vertical suele ser claramente más alta que ancha.
  return h / w >= 1.2;
}

function buildAnswerSheetFixedTemplateCandidates(rowCount = CALIFACIL_PRINT_MAX_QUESTIONS): OmrFixedTemplate[] {
  const anchored = buildMarkerAnchoredAnswerSheetTemplate(rowCount);
  const base = markerAnchoredTemplateToPageRatios(anchored);
  const nudge = (
    t: OmrFixedTemplate,
    dLeft: number,
    dTop: number,
    dWidth: number,
    dHeight: number,
    dTitle: number,
    dQnum: number
  ): OmrFixedTemplate => ({
    tableLeftRatio: t.tableLeftRatio + dLeft,
    tableTopRatio: t.tableTopRatio + dTop,
    tableWidthRatio: t.tableWidthRatio + dWidth,
    tableHeightRatio: t.tableHeightRatio + dHeight,
    titleStripRatioOfTable: Math.max(0.03, t.titleStripRatioOfTable + dTitle),
    qnumWidthRatio: Math.max(0.07, Math.min(0.12, t.qnumWidthRatio + dQnum)),
  });
  return [
    base,
    nudge(base, -0.004, -0.01, 0.006, 0.004, 0.004, 0),
    nudge(base, 0.004, 0.01, -0.006, -0.004, -0.004, 0),
    nudge(base, 0, -0.014, 0, 0.003, 0.006, 0),
    nudge(base, 0, 0.014, 0, -0.003, -0.006, 0),
    nudge(base, 0, 0.008, 0, 0, 0.01, 0),
    nudge(base, 0, 0.012, 0, 0, 0.014, 0),
    nudge(base, -0.006, 0, 0.012, 0, 0, 0.002),
    nudge(base, 0.006, 0, -0.012, 0, 0, -0.002),
  ];
}

function buildLegacyFooterFixedTemplateCandidates(): OmrFixedTemplate[] {
  // Plantillas calibradas con escaneo real del formato Sonora/CaliFacil enviado por el usuario.
  // Recuadro detectado aprox: left 0.172, top 0.609, width 0.684, height 0.249.
  return [
    {
      tableLeftRatio: 0.166,
      tableTopRatio: 0.602,
      tableWidthRatio: 0.692,
      tableHeightRatio: 0.252,
      titleStripRatioOfTable: 0.17,
      qnumWidthRatio: 0.105,
    },
    {
      tableLeftRatio: 0.172,
      tableTopRatio: 0.609,
      tableWidthRatio: 0.684,
      tableHeightRatio: 0.249,
      titleStripRatioOfTable: 0.17,
      qnumWidthRatio: 0.104,
    },
    {
      tableLeftRatio: 0.178,
      tableTopRatio: 0.616,
      tableWidthRatio: 0.676,
      tableHeightRatio: 0.246,
      titleStripRatioOfTable: 0.17,
      qnumWidthRatio: 0.103,
    },
  ];
}

function buildFullSheetFixedTemplateCandidates(rowCount = CALIFACIL_PRINT_MAX_QUESTIONS): OmrFixedTemplate[] {
  return [
    ...buildAnswerSheetFixedTemplateCandidates(rowCount),
    ...buildLegacyFooterFixedTemplateCandidates(),
  ];
}

function resolveFixedTemplateCandidates(
  canvas: HTMLCanvasElement,
  opts: CalifacilScanOptions | undefined,
  rowCount: number
): OmrFixedTemplate[] {
  if (opts?.answerSheetTemplateOnly) {
    return [buildCalifacilAnswerSheetOmrTemplate(rowCount)];
  }
  const strictFixedTemplateMode =
    opts?.geometryMode === 'fullSheet' && Boolean(opts?.fixedTemplateAnchor);
  if (!strictFixedTemplateMode) return [];
  const detectedTemplate = detectFullSheetFixedTemplate(canvas);
  return [
    ...(detectedTemplate ? [detectedTemplate] : []),
    ...buildFullSheetFixedTemplateCandidates(rowCount),
  ];
}

/**
 * Proyección de borde horizontal: promedio de |I(y,x) − I(y−1,x)| en la franja de burbujas.
 * Los trazos negros de la tabla producen picos en y.
 */
function buildHorizontalEdgeProjection(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): Float64Array {
  const proj = new Float64Array(height);
  const ya = Math.max(1, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(width - 1, Math.ceil(x1));
  const denom = Math.max(1, xb - xa);
  for (let y = ya; y < yb; y++) {
    let s = 0;
    for (let x = xa; x < xb; x++) {
      const i1 = (y * width + x) * 4;
      const i0 = ((y - 1) * width + x) * 4;
      s += Math.abs(pixelGray255(data, i1) - pixelGray255(data, i0));
    }
    proj[y] = s / denom;
  }
  return proj;
}

/**
 * Proyección de borde vertical: promedio de |I(y,x) − I(y,x−1)| en la franja de la tabla.
 * Los trazos verticales entre columnas A–D producen picos en x.
 */
function buildVerticalEdgeProjection(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): Float64Array {
  const proj = new Float64Array(width);
  const xa = Math.max(1, Math.floor(x0));
  const xb = Math.min(width - 2, Math.ceil(x1));
  const ya = Math.max(1, Math.floor(y0));
  const yb = Math.min(height - 1, Math.ceil(y1));
  const denom = Math.max(1, yb - ya);
  for (let x = xa; x <= xb; x++) {
    let s = 0;
    for (let y = ya; y < yb; y++) {
      const i1 = (y * width + x) * 4;
      const i0 = (y * width + (x - 1)) * 4;
      s += Math.abs(pixelGray255(data, i1) - pixelGray255(data, i0));
    }
    proj[x] = s / denom;
  }
  return proj;
}

function boxSmoothInRangeX(proj: Float64Array, x0: number, x1: number, radius: number): void {
  if (radius < 1) return;
  const lo = Math.max(0, x0);
  const hi = Math.min(proj.length - 1, x1);
  const tmp = new Float64Array(hi - lo + 1);
  for (let i = lo; i <= hi; i++) tmp[i - lo] = proj[i];
  const w = radius * 2 + 1;
  for (let x = lo + radius; x <= hi - radius; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[x - lo + k];
    proj[x] = sum / w;
  }
}

function boxSmoothInRange(proj: Float64Array, y0: number, y1: number, radius: number): void {
  if (radius < 1) return;
  const lo = Math.max(0, y0);
  const hi = Math.min(proj.length - 1, y1);
  const tmp = new Float64Array(hi - lo + 1);
  for (let i = lo; i <= hi; i++) tmp[i - lo] = proj[i];
  const w = radius * 2 + 1;
  for (let y = lo + radius; y <= hi - radius; y++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[y - lo + k];
    proj[y] = sum / w;
  }
}

/** Picos locales con fusión de vecinos demasiado cercanos (se queda el más alto). */
function findHorizontalLinePeaks(
  proj: Float64Array,
  y0: number,
  y1: number,
  minDist: number,
  minRel: number
): number[] {
  let peakMax = 0;
  for (let y = y0 + 2; y < y1 - 2; y++) peakMax = Math.max(peakMax, proj[y]);
  const thr = Math.max(peakMax * minRel, 1e-6);
  const raw: number[] = [];
  for (let y = y0 + 2; y < y1 - 2; y++) {
    const v = proj[y];
    if (v < thr) continue;
    if (v <= proj[y - 1] || v < proj[y + 1]) continue;
    raw.push(y);
  }
  raw.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const y of raw) {
    if (merged.length === 0) {
      merged.push(y);
      continue;
    }
    const last = merged[merged.length - 1]!;
    if (y - last < minDist) {
      if (proj[y] > proj[last]) merged[merged.length - 1] = y;
    } else {
      merged.push(y);
    }
  }
  return merged;
}

function findVerticalLinePeaks(
  proj: Float64Array,
  x0: number,
  x1: number,
  minDist: number,
  minRel: number
): number[] {
  let peakMax = 0;
  for (let x = x0 + 2; x < x1 - 2; x++) peakMax = Math.max(peakMax, proj[x]);
  const thr = Math.max(peakMax * minRel, 1e-6);
  const raw: number[] = [];
  for (let x = x0 + 2; x < x1 - 2; x++) {
    const v = proj[x];
    if (v < thr) continue;
    if (v <= proj[x - 1] || v < proj[x + 1]) continue;
    raw.push(x);
  }
  raw.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const x of raw) {
    if (merged.length === 0) {
      merged.push(x);
      continue;
    }
    const last = merged[merged.length - 1]!;
    if (x - last < minDist) {
      if (proj[x] > proj[last]) merged[merged.length - 1] = x;
    } else {
      merged.push(x);
    }
  }
  return merged;
}

/**
 * Infiere bordes x entre columnas A… usando líneas verticales impresas (cols+1 valores).
 */
function inferColumnEdgesFromVerticalLines(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bubbleAreaLeft: number,
  bubbleAreaW: number,
  cols: number,
  dataTop: number,
  rowH: number
): number[] | null {
  const cellGuess = bubbleAreaW / Math.max(1, cols);
  const y0 = Math.max(1, Math.floor(dataTop + 1.2 * rowH));
  const y1 = Math.min(height - 1, Math.ceil(dataTop + 8.8 * rowH));
  const xLo = Math.max(1, Math.floor(bubbleAreaLeft - cellGuess * 0.2));
  const xHi = Math.min(width - 2, Math.ceil(bubbleAreaLeft + bubbleAreaW + cellGuess * 0.25));
  if (y1 <= y0 + 6 || xHi <= xLo + 24) return null;

  const proj = buildVerticalEdgeProjection(data, width, height, xLo, xHi, y0, y1);
  boxSmoothInRangeX(proj, xLo, xHi, 2);

  const minDist = Math.max(3, cellGuess * 0.26);
  const peaks = findVerticalLinePeaks(proj, xLo, xHi, minDist, 0.088);
  const need = cols + 1;
  if (peaks.length < need) return null;

  peaks.sort((a, b) => a - b);
  let bestWindow: number[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let s = 0; s <= peaks.length - need; s++) {
    const w = peaks.slice(s, s + need);
    const gaps: number[] = [];
    for (let i = 0; i < need - 1; i++) gaps.push(w[i + 1]! - w[i]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (mean < cellGuess * 0.52 || mean > cellGuess * 1.55) continue;
    const var_ = gaps.reduce((acc, g) => acc + (g - mean) * (g - mean), 0) / gaps.length;
    const cv = mean > 1e-6 ? Math.sqrt(var_) / mean : 1;
    if (cv > 0.44) continue;
    const score =
      var_ + (Math.abs(mean - cellGuess) / (cellGuess + 1e-6)) * cellGuess * cellGuess * 0.15;
    if (score < bestScore) {
      bestScore = score;
      bestWindow = w;
    }
  }
  if (!bestWindow) return null;

  const left0 = bestWindow[0]!;
  if (Math.abs(left0 - bubbleAreaLeft) > bubbleAreaW * 0.5) return null;

  return bestWindow;
}

/**
 * Fallback para hoja completa: infiere columnas buscando una ventana de (cols+1) líneas
 * verticales casi equiespaciadas en toda la anchura de la imagen.
 */
function inferColumnEdgesGlobalFromVerticalLines(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cols: number,
  dataTop: number,
  rowH: number
): number[] | null {
  const y0 = Math.max(1, Math.floor(dataTop + 1.2 * rowH));
  const y1 = Math.min(height - 1, Math.ceil(dataTop + 8.8 * rowH));
  const xLo = 1;
  const xHi = Math.max(2, width - 2);
  if (y1 <= y0 + 6 || xHi <= xLo + 24) return null;

  const proj = buildVerticalEdgeProjection(data, width, height, xLo, xHi, y0, y1);
  boxSmoothInRangeX(proj, xLo, xHi, 2);

  const minDist = Math.max(5, width * 0.04);
  const peaks = findVerticalLinePeaks(proj, xLo, xHi, minDist, 0.094);
  const need = cols + 1;
  if (peaks.length < need) return null;

  peaks.sort((a, b) => a - b);
  let best: number[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let s = 0; s <= peaks.length - need; s++) {
    const w = peaks.slice(s, s + need);
    const gaps: number[] = [];
    for (let i = 0; i < need - 1; i++) gaps.push(w[i + 1]! - w[i]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (mean < width * 0.08 || mean > width * 0.28) continue;
    const var_ = gaps.reduce((acc, g) => acc + (g - mean) * (g - mean), 0) / gaps.length;
    const cv = mean > 1e-6 ? Math.sqrt(var_) / mean : 1;
    if (cv > 0.34) continue;

    const left = w[0]!;
    const right = w[need - 1]!;
    if (left < width * 0.03 || left > width * 0.5) continue;
    if (right < width * 0.45 || right > width * 0.99) continue;

    const center = (left + right) * 0.5;
    const centerPenalty = Math.abs(center - width * 0.56) / Math.max(1, width);
    const strength = w.reduce((acc, x) => acc + proj[x]!, 0);
    const score =
      strength * 1.8 -
      var_ * 2.2 -
      centerPenalty * 260 -
      Math.abs(mean - width * 0.17) * 0.24;
    if (score > bestScore) {
      bestScore = score;
      best = w;
    }
  }
  return best;
}

/**
 * Elige 11 líneas horizontales coherentes con el espaciado esperado (~altura de fila).
 * Devuelve y ordenadas de arriba abajo o null.
 */
function pickUniformTableLines(
  peaks: number[],
  rowCount: number,
  expectedGap: number,
  dataTop: number,
  dataHeight: number
): number[] | null {
  const lineCount = rowCount + 1;
  if (peaks.length < lineCount) return null;
  peaks = [...peaks].sort((a, b) => a - b);
  const yMin = dataTop - dataHeight * 0.08;
  const yMax = dataTop + dataHeight * 1.08;
  const filtered = peaks.filter((y) => y >= yMin && y <= yMax);
  if (filtered.length < lineCount) return null;

  let best: number[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const n = filtered.length;
  for (let s = 0; s <= n - lineCount; s++) {
    const window = filtered.slice(s, s + lineCount);
    const gaps: number[] = [];
    for (let i = 0; i < rowCount; i++) gaps.push(window[i + 1]! - window[i]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / rowCount;
    if (mean < expectedGap * 0.42 || mean > expectedGap * 2.2) continue;
    const var_ = gaps.reduce((acc, g) => acc + (g - mean) * (g - mean), 0) / rowCount;
    const cv = mean > 1e-6 ? Math.sqrt(var_) / mean : 1;
    if (cv > 0.42) continue;
    const spacingPenalty =
      Math.abs(mean - expectedGap) / (expectedGap + 1e-6);
    const score = var_ + spacingPenalty * expectedGap * expectedGap * 0.35;
    if (score < bestScore) {
      bestScore = score;
      best = window;
    }
  }
  return best;
}

function lineYsHaveUniformSpacing(lineYs: number[], tolerance = 0.2): boolean {
  if (lineYs.length < 3) return false;
  const gaps: number[] = [];
  for (let i = 1; i < lineYs.length; i++) gaps.push(lineYs[i]! - lineYs[i - 1]!);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avg < 2) return false;
  return gaps.every((g) => Math.abs(g - avg) <= avg * tolerance);
}

type SweptAnswerSheetGrid = {
  lineYs: number[];
  colEdges: number[];
};

/**
 * Busca la tabla de respuestas en toda la imagen (útil cuando el warp no coincide con la plantilla carta).
 */
function sweepAnswerSheetTableGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rowCount: number,
  columns: number
): SweptAnswerSheetGrid | null {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const profiles: OmrGeometryProfile[] = [
    {
      bottomBandRatio: CALIFACIL_OMR_SCAN.bottomBandRatio,
      titleStripRatioOfBand: CALIFACIL_OMR_SCAN.titleStripRatioOfBand,
      qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
    },
    { bottomBandRatio: 0.52, titleStripRatioOfBand: 0.2, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 0.58, titleStripRatioOfBand: 0.17, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 0.65, titleStripRatioOfBand: 0.14, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.1, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.05, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
  ];
  const shifts = [0, -6, 6, -8, 8, -12, 12, -18, 18, -24, 24];

  let best: SweptAnswerSheetGrid | null = null;
  let bestScore = -1;

  for (const profile of profiles) {
    const bandH = height * profile.bottomBandRatio;
    const bandTop = height - bandH;
    const dataTop = bandTop + bandH * profile.titleStripRatioOfBand;
    const dataHeight = bandH * (1 - profile.titleStripRatioOfBand);
    const qNumW = width * profile.qnumWidthRatio;
    for (const colShift of shifts) {
      const bubbleAreaLeft = Math.max(2, Math.min(width * 0.48, Math.round(qNumW + colShift)));
      const rightMargin = Math.round(width * (CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO + 0.035));
      const bubbleAreaW = Math.max(24, width - bubbleAreaLeft - rightMargin);
      const lineYs = refineOmrRowBoundariesFromTableLines(
        data,
        width,
        height,
        bubbleAreaLeft,
        dataTop,
        dataHeight,
        rows
      );
      if (!lineYs || lineYs.length !== rows + 1) continue;
      const colEdges = buildUniformBubbleColumnEdges(bubbleAreaLeft, bubbleAreaW, cols, width);
      const span = lineYs[rows]! - lineYs[0]!;
      const score = span + (lineYsHaveUniformSpacing(lineYs) ? 120 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { lineYs, colEdges };
      }
    }
  }
  return best;
}

function buildCellsFromTableLines(
  lineYs: number[],
  columnEdges: number[],
  width: number,
  height: number,
  cols: number
): CalifacilOmrScanGeometry {
  const rows = lineYs.length - 1;
  const cells: OmrNormRect[][] = [];
  for (let row = 0; row < rows; row++) {
    const yRowTop = lineYs[row]!;
    const yRowBot = lineYs[row + 1]!;
    const rowRects: OmrNormRect[] = [];
    for (let c = 0; c < cols; c++) {
      const x0 = columnEdges[c]!;
      const x1 = columnEdges[c + 1]!;
      rowRects.push({
        x: x0 / width,
        y: yRowTop / height,
        w: Math.max(0, (x1 - x0) / width),
        h: Math.max(0, (yRowBot - yRowTop) / height),
      });
    }
    cells.push(rowRects);
  }
  return { imageWidth: width, imageHeight: height, cells };
}

/**
 * Detecta líneas horizontales de la rejilla impresa y devuelve sus y (N+1 bordes → N filas).
 */
function refineOmrRowBoundariesFromTableLines(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bubbleAreaLeft: number,
  dataTop: number,
  dataHeight: number,
  rowCount: number
): number[] | null {
  const rowHGuess = dataHeight / rowCount;
  const pad = Math.max(3, rowHGuess * 0.12);
  const yStart = Math.max(1, Math.floor(dataTop - pad));
  const yEnd = Math.min(height - 2, Math.ceil(dataTop + dataHeight + pad));
  const xPad = Math.max(2, width * 0.015);
  const x0 = Math.min(width - 10, bubbleAreaLeft + xPad);
  const x1 = width - 2;
  if (x1 <= x0 + 12 || yEnd <= yStart + rowHGuess * 4) return null;

  const proj = buildHorizontalEdgeProjection(data, width, height, x0, x1, yStart, yEnd);
  boxSmoothInRange(proj, yStart, yEnd, 2);

  const minDist = Math.max(2, rowHGuess * 0.38);
  const peaks = findHorizontalLinePeaks(proj, yStart, yEnd, minDist, 0.14);
  const lines = pickUniformTableLines(peaks, rowCount, rowHGuess, dataTop, dataHeight);
  if (!lines) return null;

  for (let i = 0; i < rowCount; i++) {
    const g = lines[i + 1]! - lines[i]!;
    if (g < 3 || g > rowHGuess * 2.5) return null;
  }
  return lines;
}

/**
 * Comprueba si la imagen (recorte guía CaliFacil ya orientado) muestra la rejilla impresa
 * de la tabla de respuestas (~11 líneas horizontales coherentes). Las escenas sin examen
 * suelen no cumplir esto, así que sirve para no “leer” basura con la cámara.
 *
 * En **hoja impresa completa**, la tabla está solo en la parte inferior; si analizamos
 * casi toda la altura (`bottomBandRatio: 1`), los trazos del enunciado añaden picos y
 * casi nunca salen exactamente 11 líneas. Por eso probamos primero la misma franja inferior
 * que usa el escaneo OMR (`printExam`), y dejamos `bottomBandRatio: 1` para fotos ya
 * recortadas al recuadro.
 */
export function hasCalifacilPrintedTableGrid(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount?: number
): boolean {
  void columns;
  const rowCountsToTry = rowCount
    ? [clampCalifacilOmrRowCount(rowCount)]
    : [10, 20, 30, CALIFACIL_OMR_DEFAULT_ROWS];
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const { width, height } = canvas;
  if (width < 80 || height < 80) return false;
  const id = ctx.getImageData(0, 0, width, height);
  const { data } = id;

  const profiles: OmrGeometryProfile[] = [
    {
      bottomBandRatio: CALIFACIL_OMR_SCAN.bottomBandRatio,
      titleStripRatioOfBand: CALIFACIL_OMR_SCAN.titleStripRatioOfBand,
      qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
    },
    {
      bottomBandRatio: 0.52,
      titleStripRatioOfBand: 0.2,
      qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
    },
    {
      bottomBandRatio: 0.58,
      titleStripRatioOfBand: 0.17,
      qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
    },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.12, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.05, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
  ];
  const shifts = [0, -6, 6, -8, 8, -14, 14, -20, 20];

  for (const rows of rowCountsToTry) {
    for (const profile of profiles) {
      const bandH = height * profile.bottomBandRatio;
      const bandTop = height - bandH;
      const dataTop = bandTop + bandH * profile.titleStripRatioOfBand;
      const dataHeight = bandH * (1 - profile.titleStripRatioOfBand);
      const qNumW = width * profile.qnumWidthRatio;
      for (const colShift of shifts) {
        const bubbleAreaLeft = Math.max(
          2,
          Math.min(width * 0.45, Math.round(qNumW + colShift))
        );
        const lineYs = refineOmrRowBoundariesFromTableLines(
          data,
          width,
          height,
          bubbleAreaLeft,
          dataTop,
          dataHeight,
          rows
        );
        if (lineYs && lineYs.length === rows + 1) return true;
      }
    }
  }
  return false;
}

/**
 * True si parece una hoja CaliFacil impresa (rejilla detectable). Aplica la misma
 * corrección de perspectiva que el escaneo OMR.
 */
export function isCalifacilExamSheetLikely(
  canvas: HTMLCanvasElement,
  columns: number
): boolean {
  if (typeof document === 'undefined') return false;
  const corrected = applyPerspectiveCorrection(canvas);
  if (hasCalifacilPrintedTableGrid(corrected, columns)) return true;
  /** Página muy cargada o borde mal inferido: la homografía puede estropear líneas; probar imagen previa al warp. */
  if (corrected !== canvas && hasCalifacilPrintedTableGrid(canvas, columns)) return true;
  return false;
}

/** Comprueba los cuatro cuadros negros de esquina impresos (`.sheet-align-corner`). */
export function hasCalifacilCornerMarkers(
  canvas: HTMLCanvasElement,
  opts?: { insetFrac?: number }
): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const W = canvas.width;
  const H = canvas.height;
  if (W < 80 || H < 80) return false;

  const guidePatches = cornerMarkerPatchesForCanvas(W, H);
  if (guidePatches && countDarkCornerPatches(ctx, guidePatches.corners, guidePatches.patchW, guidePatches.patchH) >= 3) {
    return true;
  }

  const insetFrac = Math.max(0, Math.min(0.2, opts?.insetFrac ?? 0));
  const patchW = Math.max(5, Math.round(W * 0.06));
  const patchH = Math.max(5, Math.round(H * 0.06));
  const ix = Math.round(W * insetFrac);
  const iy = Math.round(H * insetFrac);
  const corners = [
    { x: ix, y: iy },
    { x: W - patchW - ix, y: iy },
    { x: ix, y: H - patchH - iy },
    { x: W - patchW - ix, y: H - patchH - iy },
  ];

  return countDarkCornerPatches(ctx, corners, patchW, patchH) >= 3;
}

/** Visores móviles: esquinas negras impresas alineadas con el marco guía hoja carta. */
export function areMobileViewfinderCornersAligned(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const W = canvas.width;
  const H = canvas.height;
  if (W < 80 || H < 80) return false;

  const insetFrac = 0.028;
  const patchW = Math.max(8, Math.round(W * 0.068));
  const patchH = Math.max(8, Math.round(H * 0.068));
  const ix = Math.round(W * insetFrac);
  const iy = Math.round(H * insetFrac);
  const screenCorners = [
    { x: ix, y: iy },
    { x: W - patchW - ix, y: iy },
    { x: ix, y: H - patchH - iy },
    { x: W - patchW - ix, y: H - patchH - iy },
  ];
  if (countDarkCornerPatches(ctx, screenCorners, patchW, patchH) >= 4) return true;

  return hasCalifacilCornerMarkers(canvas);
}

export function detectCalifacilSheetCornerQuad(
  canvas: HTMLCanvasElement
): [Point, Point, Point, Point] | null {
  return detectCalifacilSheetCornerQuadRobust(canvas);
}

/** Detección robusta: preprocesado + fiduciales + heurística de papel. */
export function detectCalifacilSheetCornerQuadRobust(
  canvas: HTMLCanvasElement,
  opts?: { skipPreprocess?: boolean }
): [Point, Point, Point, Point] | null {
  const sources: HTMLCanvasElement[] = [];
  if (!opts?.skipPreprocess) {
    const pre = preprocessForSheetDetection(canvas);
    if (pre) sources.push(pre);
  }
  sources.push(canvas);
  for (const src of sources) {
    const quad = detectCalifacilQuadFromCornerMarkers(src);
    if (quad) return quad;
  }
  for (const src of sources) {
    const quad = detectCalifacilQuad(src);
    if (quad) return quad;
  }
  return null;
}

/** Salida estándar tras warp por fiduciales (carta vertical 8.5×11). */
export const CALIFACIL_WARP_LETTER_WIDTH = 850;
export const CALIFACIL_WARP_LETTER_HEIGHT = Math.round(
  CALIFACIL_WARP_LETTER_WIDTH * (11 / 8.5)
);

export type AnswerSheetTemplateGuide = {
  geometry: CalifacilOmrScanGeometry;
  /** Recuadro de la tabla OMR (incluye franja de título) en coords 0–1 de página carta. */
  tableBoundsNorm: OmrNormRect;
  /** Marco de hoja completa (fiduciales incluidos) en coords 0–1 de página carta. */
  pageFrameNorm: OmrNormRect;
};

/**
 * Cuadrícula OMR de hoja de respuestas alineada con el marco naranja (plantilla PDF base).
 */
export function buildAnswerSheetOmrGeometry(
  rowCount: number,
  columns: number,
  imageWidth: number,
  imageHeight: number
): CalifacilOmrScanGeometry {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const template = buildCalifacilAnswerSheetOmrTemplate(rowCount);
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);

  const tableLeft = width * template.tableLeftRatio;
  const tableTop = height * template.tableTopRatio;
  const tableW = width * template.tableWidthRatio;
  const tableH = height * template.tableHeightRatio;
  const dataTop = tableTop + tableH * template.titleStripRatioOfTable;
  const dataHeight = tableH * (1 - template.titleStripRatioOfTable);
  const rowH = dataHeight / rows;
  const qNumW = tableW * template.qnumWidthRatio;
  const rightStripW = tableW * CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO;
  const bubbleAreaLeft = Math.max(2, Math.round(tableLeft + qNumW));
  const bubbleAreaW = Math.max(18, tableW - qNumW - rightStripW);
  const cellW = bubbleAreaW / cols;

  const cells: OmrNormRect[][] = [];
  for (let row = 0; row < rows; row++) {
    const yRowTop = dataTop + row * rowH;
    const yRowBot = dataTop + (row + 1) * rowH;
    const rowRects: OmrNormRect[] = [];
    for (let c = 0; c < cols; c++) {
      const x0 = bubbleAreaLeft + c * cellW;
      const x1 = c === cols - 1 ? bubbleAreaLeft + bubbleAreaW : bubbleAreaLeft + (c + 1) * cellW;
      rowRects.push({
        x: x0 / width,
        y: yRowTop / height,
        w: Math.max(0, (x1 - x0) / width),
        h: Math.max(0, (yRowBot - yRowTop) / height),
      });
    }
    cells.push(rowRects);
  }

  return { imageWidth: width, imageHeight: height, cells };
}

/** Franja negra derecha del recuadro impreso (no forma parte del área de burbujas). */
const CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO = 0.1;

function buildUniformBubbleColumnEdges(
  bubbleAreaLeft: number,
  bubbleAreaW: number,
  cols: number,
  imageWidth: number
): number[] {
  return Array.from({ length: cols + 1 }, (_, c) =>
    c === cols
      ? Math.min(imageWidth - 1, Math.round(bubbleAreaLeft + bubbleAreaW))
      : Math.round(bubbleAreaLeft + (c * bubbleAreaW) / cols)
  );
}

const FRAME_GRID_SCAN_THRESHOLDS: ScanThresholds = {
  minMarkDarkness: 0.072,
  minBestVsSecondGap: 0.038,
  minBestVsSecondRatio: 1.35,
  minCenterVsRingDelta: 0.04,
  minSolidCenterDarkness: 0.24,
  ringDarknessWeight: CALIFACIL_OMR_SCAN.ringDarknessWeight,
};

function uniqueFrameProfiles(values: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of values) {
    const key = Math.round(v * 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function scoreOmrMetaPicks(meta: OmrScanMetaResult, rowCount: number): number {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const resolved = meta.picks.filter((p) => p !== null).length;
  const same = meta.maxSameColumnCount ?? 0;
  const samePenalty =
    same >= rows * 0.8 ? 520 : same >= rows * 0.6 ? 220 : same >= rows * 0.45 ? 80 : 0;
  const geomPenalty =
    meta.geometry && !validateAnswerSheetGeometry(meta.geometry, rows).ok ? 420 : 0;
  const unresolvedPenalty = (rows - resolved) * 18;
  return resolved * 92 - samePenalty - geomPenalty - unresolvedPenalty + (meta.geometry ? 48 : 0);
}

/** Marco naranja inicial: tabla completa según plantilla impresa (coords. 0–1). */
export function califacilOmrTableFrameNormRect(rowCount: number): OmrNormRect {
  const t = buildCalifacilAnswerSheetOmrTemplate(rowCount);
  return {
    x: t.tableLeftRatio,
    y: t.tableTopRatio,
    w: t.tableWidthRatio,
    h: t.tableHeightRatio,
  };
}

/**
 * Detecta líneas de la rejilla impresa dentro de un marco naranja (tabla completa o burbujas).
 */
function sweepAnswerSheetGridInNormFrame(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  frame: OmrNormRect,
  rowCount: number,
  columns: number,
  canvas?: HTMLCanvasElement | null
): { lineYs: number[]; colEdges: number[] } | null {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const template = buildCalifacilAnswerSheetOmrTemplate(rowCount);

  const fx = Math.max(0, Math.min(1, frame.x));
  const fy = Math.max(0, Math.min(1, frame.y));
  const fw = Math.max(0.05, Math.min(1 - fx, frame.w));
  const fh = Math.max(0.05, Math.min(1 - fy, frame.h));
  const frameLeft = fx * imageWidth;
  const frameTop = fy * imageHeight;
  const frameW = fw * imageWidth;
  const frameH = fh * imageHeight;

  const titleStrips = uniqueFrameProfiles([
    0,
    0.035,
    0.05,
    0.07,
    0.09,
    0.11,
    template.titleStripRatioOfTable,
  ]);
  const qnumFracs = uniqueFrameProfiles([
    template.qnumWidthRatio,
    template.qnumWidthRatio + 0.02,
    template.qnumWidthRatio - 0.02,
    0.07,
    0.11,
    0.14,
    0.16,
  ]);
  const rightStripFracs = uniqueFrameProfiles([0.08, 0.1, 0.12, 0.14]);

  let best: { lineYs: number[]; colEdges: number[]; score: number } | null = null;

  for (const titleStrip of titleStrips) {
    for (const qnumFrac of qnumFracs) {
      for (const rightStrip of rightStripFracs) {
        const dataTop = frameTop + frameH * titleStrip;
        const dataHeight = frameH * (1 - titleStrip);
        const bubbleAreaLeft = frameLeft + frameW * qnumFrac;
        const bubbleAreaW = frameW * (1 - qnumFrac - rightStrip - 0.015);
        if (dataHeight < rows * 2.5 || bubbleAreaW < cols * 6) continue;

        const lineYs = refineOmrRowBoundariesFromTableLines(
          data,
          imageWidth,
          imageHeight,
          bubbleAreaLeft,
          dataTop,
          dataHeight,
          rows
        );
        if (!lineYs || lineYs.length !== rows + 1) continue;

        const colEdges = buildUniformBubbleColumnEdges(
          bubbleAreaLeft,
          bubbleAreaW,
          cols,
          imageWidth
        );

        const span = lineYs[rows]! - lineYs[0]!;
        const rowUniform = lineYsHaveUniformSpacing(lineYs) ? 95 : 0;
        const inFrame =
          lineYs[0]! >= frameTop - 3 && lineYs[rows]! <= frameTop + frameH + 4 ? 55 : 0;
        const colSpan = colEdges[cols]! - colEdges[0]!;
        const colFit =
          colSpan > bubbleAreaW * 0.68 && colSpan < bubbleAreaW * 1.18 ? 60 : -30;
        const qnumFit =
          Math.abs(qnumFrac - template.qnumWidthRatio) < 0.025 ? 40 : 0;
        let score = span + rowUniform + inFrame + colFit + qnumFit;

        if (canvas) {
          const geom = buildCellsFromTableLines(lineYs, colEdges, imageWidth, imageHeight, cols);
          const read = readAnswerSheetPicksFromTemplateGeometry(
            canvas,
            geometryCellsForBubbleSampling(geom),
            FRAME_GRID_SCAN_THRESHOLDS,
            rows,
            cols
          );
          const samePenalty =
            read.maxSameColumnCount >= rows * 0.65
              ? 280
              : read.maxSameColumnCount >= rows * 0.45
                ? 90
                : 0;
          score += read.resolvedCount * 88 + read.confidenceSum * 6 - samePenalty;
        }

        if (!best || score > best.score) {
          best = { lineYs, colEdges, score };
        }
      }
    }
  }

  return best ? { lineYs: best.lineYs, colEdges: best.colEdges } : null;
}

function buildUniformBubbleGridInNormFrame(
  frame: OmrNormRect,
  rowCount: number,
  columns: number,
  imageWidth: number,
  imageHeight: number
): CalifacilOmrScanGeometry {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  const template = buildCalifacilAnswerSheetOmrTemplate(rowCount);

  const fx = Math.max(0, Math.min(1, frame.x));
  const fy = Math.max(0, Math.min(1, frame.y));
  const fw = Math.max(0.05, Math.min(1 - fx, frame.w));
  const fh = Math.max(0.05, Math.min(1 - fy, frame.h));

  const dataTop = (fy + fh * template.titleStripRatioOfTable) * height;
  const dataHeight = fh * height * (1 - template.titleStripRatioOfTable);
  const rightStrip = CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO;
  const bubbleAreaLeft = (fx + fw * template.qnumWidthRatio) * width;
  const bubbleAreaW = fw * width * (1 - template.qnumWidthRatio - rightStrip - 0.018);

  const lineYs = Array.from({ length: rows + 1 }, (_, i) => Math.round(dataTop + (i * dataHeight) / rows));
  const colEdges = buildUniformBubbleColumnEdges(bubbleAreaLeft, bubbleAreaW, cols, width);
  return buildCellsFromTableLines(lineYs, colEdges, width, height, cols);
}

/**
 * Cuadrícula alineada a la plantilla dentro del marco naranja (columnas uniformes).
 */
function buildTemplateAlignedGeometryInNormFrame(
  frame: OmrNormRect,
  rowCount: number,
  columns: number,
  imageWidth: number,
  imageHeight: number,
  data: Uint8ClampedArray,
  canvas: HTMLCanvasElement
): CalifacilOmrScanGeometry | null {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const template = buildCalifacilAnswerSheetOmrTemplate(rowCount);

  const fx = Math.max(0, Math.min(1, frame.x));
  const fy = Math.max(0, Math.min(1, frame.y));
  const fw = Math.max(0.05, Math.min(1 - fx, frame.w));
  const fh = Math.max(0.05, Math.min(1 - fy, frame.h));
  const frameLeft = fx * imageWidth;
  const frameTop = fy * imageHeight;
  const frameW = fw * imageWidth;
  const frameH = fh * imageHeight;

  const titleStrip = template.titleStripRatioOfTable;
  const qnum = template.qnumWidthRatio;
  const rightStrip = CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO;
  const dataTop = frameTop + frameH * titleStrip;
  const dataHeight = frameH * (1 - titleStrip);
  const bubbleAreaLeft = frameLeft + frameW * qnum;
  const bubbleAreaW = frameW * (1 - qnum - rightStrip - 0.015);
  if (dataHeight < rows * 2 || bubbleAreaW < cols * 8) return null;

  const detected = refineOmrRowBoundariesFromTableLines(
    data,
    imageWidth,
    imageHeight,
    bubbleAreaLeft,
    dataTop,
    dataHeight,
    rows
  );
  const lineYs =
    detected && detected.length === rows + 1
      ? detected
      : Array.from({ length: rows + 1 }, (_, i) => Math.round(dataTop + (i * dataHeight) / rows));

  const colEdges = buildUniformBubbleColumnEdges(bubbleAreaLeft, bubbleAreaW, cols, imageWidth);
  const geom = buildCellsFromTableLines(lineYs, colEdges, imageWidth, imageHeight, cols);
  const read = readAnswerSheetPicksFromTemplateGeometry(
    canvas,
    geometryCellsForBubbleSampling(geom),
    FRAME_GRID_SCAN_THRESHOLDS,
    rows,
    cols
  );
  if (read.resolvedCount >= rows * 0.35 && read.maxSameColumnCount < rows * 0.75) {
    return geom;
  }
  if (validateAnswerSheetGeometry(geom, rows).ok && read.resolvedCount >= rows * 0.2) {
    return geom;
  }
  return null;
}

/**
 * Cuadrícula OMR dentro de un marco naranja: detecta líneas impresas y respeta
 * franja de título + columna N.º (no divide el marco en una cuadrícula ciega).
 */
export function buildAnswerSheetOmrGeometryInNormRect(
  frame: OmrNormRect,
  rowCount: number,
  columns: number,
  imageWidth: number,
  imageHeight: number,
  canvas?: HTMLCanvasElement | null
): CalifacilOmrScanGeometry {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);

  if (canvas && canvas.width === width && canvas.height === height) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      const data = ctx.getImageData(0, 0, width, height).data;
      const templateAligned = buildTemplateAlignedGeometryInNormFrame(
        frame,
        rowCount,
        columns,
        width,
        height,
        data,
        canvas
      );
      if (templateAligned) return templateAligned;

      const swept = sweepAnswerSheetGridInNormFrame(
        data,
        width,
        height,
        frame,
        rowCount,
        columns,
        canvas
      );
      if (swept) {
        const geom = buildCellsFromTableLines(swept.lineYs, swept.colEdges, width, height, cols);
        const validation = validateAnswerSheetGeometry(geom, rows);
        if (validation.ok || swept.lineYs.length === rows + 1) {
          return geom;
        }
      }
    }
  }

  const fullFallback =
    canvas && frame.w >= 0.82 && frame.h >= 0.75
      ? sweepFullCanvasTableGeometry(canvas, rowCount, columns)
      : null;
  if (fullFallback) {
    return fullFallback.geometry;
  }

  return buildUniformBubbleGridInNormFrame(frame, rowCount, columns, width, height);
}

/**
 * Cuadrícula de calificación anclada al marco naranja (escala al mover o redimensionar el marco).
 */
export function buildAnswerSheetGradingGeometryFromNormFrame(
  frame: OmrNormRect,
  rowCount: number,
  columns: number,
  imageWidth: number,
  imageHeight: number
): CalifacilOmrScanGeometry {
  const base = buildUniformBubbleGridInNormFrame(
    frame,
    rowCount,
    columns,
    imageWidth,
    imageHeight
  );
  return geometryCellsForBubbleSampling(base);
}

/** Expansión de celda para muestreo (más alto en Y por deriva vertical del warp). */
const CALIFACIL_OMR_CELL_SAMPLE_EXPAND_X = 0.14;
const CALIFACIL_OMR_CELL_SAMPLE_EXPAND_Y = 0.34;

/**
 * Amplía cada celda para muestrear burbujas con margen extra (especialmente en altura).
 */
function geometryCellsForBubbleSampling(
  geometry: CalifacilOmrScanGeometry,
  expandX = CALIFACIL_OMR_CELL_SAMPLE_EXPAND_X,
  expandY = CALIFACIL_OMR_CELL_SAMPLE_EXPAND_Y
): CalifacilOmrScanGeometry {
  const cells = geometry.cells.map((row) =>
    row.map((cell) => {
      const x = Math.max(0, cell.x - cell.w * (expandX / 2));
      const y = Math.max(0, cell.y - cell.h * (expandY / 2));
      const w = Math.min(1 - x, cell.w * (1 + expandX));
      const h = Math.min(1 - y, cell.h * (1 + expandY));
      return { x, y, w, h };
    })
  );
  return { ...geometry, cells };
}

function expandControlNumberGeometryForSampling(
  geometry: CalifacilControlNumberGeometry
): CalifacilControlNumberGeometry {
  const expandX = CALIFACIL_OMR_CELL_SAMPLE_EXPAND_X;
  const expandY = CALIFACIL_OMR_CELL_SAMPLE_EXPAND_Y;
  const cells = geometry.cells.map((col) =>
    col.map((cell) => {
      const x = Math.max(0, cell.x - cell.w * (expandX / 2));
      const y = Math.max(0, cell.y - cell.h * (expandY / 2));
      const w = Math.min(1 - x, cell.w * (1 + expandX));
      const h = Math.min(1 - y, cell.h * (1 + expandY));
      return { x, y, w, h };
    })
  );
  return { ...geometry, cells };
}

/** Lee el número de control OMR (8 dígitos) en hoja enderezada 850×1100. */
export function readAnswerSheetControlNumberFromCanvas(
  canvas: HTMLCanvasElement,
  rowCount = CALIFACIL_OMR_DEFAULT_ROWS,
  thresholds: ScanThresholds = FRAME_GRID_SCAN_THRESHOLDS
): { digits: (number | null)[]; controlNumber: string | null } {
  if (canvas.width < 40 || canvas.height < 40) {
    return { digits: [], controlNumber: null };
  }
  const geom = expandControlNumberGeometryForSampling(
    buildAnswerSheetControlNumberGeometry(canvas.width, canvas.height, CALIFACIL_CONTROL_NUMBER_DIGIT_COUNT, rowCount)
  );
  return readControlNumberFromTemplateGeometry(canvas, geom, thresholds);
}

function tableFrameFromBubbleGeometry(
  geometry: CalifacilOmrScanGeometry,
  rowCount: number
): OmrNormRect | null {
  const bubble = boundsFromOmrCells(geometry, rowCount, 0);
  if (!bubble) return null;
  const t = buildCalifacilAnswerSheetOmrTemplate(rowCount);
  const padTop = bubble.h * (t.titleStripRatioOfTable / Math.max(0.2, 1 - t.titleStripRatioOfTable));
  const padLeft = bubble.w * (t.qnumWidthRatio / Math.max(0.2, 1 - t.qnumWidthRatio));
  const x = Math.max(0, bubble.x - padLeft);
  const y = Math.max(0, bubble.y - padTop);
  return {
    x,
    y,
    w: Math.min(1 - x, bubble.w + padLeft + bubble.w * 0.025),
    h: Math.min(1 - y, bubble.h + padTop + bubble.h * 0.015),
  };
}

function omrMetaFromGeometry(
  canvas: HTMLCanvasElement,
  geometry: CalifacilOmrScanGeometry,
  rowCount: number,
  columns: number
): OmrScanMetaResult {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const readGeometry = geometryCellsForBubbleSampling(geometry);
  const templateRead = readAnswerSheetPicksFromTemplateGeometry(
    canvas,
    readGeometry,
    FRAME_GRID_SCAN_THRESHOLDS,
    rows,
    columns
  );
  const controlRead = readAnswerSheetControlNumberFromCanvas(canvas, rows);
  return {
    picks: templateRead.picks,
    rows: templateRead.rows,
    needsVisionAssist: false,
    maxSameColumnCount: templateRead.maxSameColumnCount,
    geometry: readGeometry,
    reviewSourceCanvas: canvas,
    controlNumberDigits: controlRead.digits,
    controlNumber: controlRead.controlNumber,
  };
}

/** Detecta la tabla en toda la imagen (capturas recortadas al marco guía). */
function sweepFullCanvasTableGeometry(
  canvas: HTMLCanvasElement,
  rowCount: number,
  columns: number
): { geometry: CalifacilOmrScanGeometry; tableFrame: OmrNormRect } | null {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 40 || height < 40) return null;
  const data = ctx.getImageData(0, 0, width, height).data;
  const swept = sweepAnswerSheetTableGrid(data, width, height, rowCount, columns);
  if (!swept || swept.lineYs.length !== rows + 1) return null;
  const geometry = buildCellsFromTableLines(swept.lineYs, swept.colEdges, width, height, cols);
  const tableFrame =
    tableFrameFromBubbleGeometry(geometry, rows) ??
    califacilGeometryTableBounds(geometry, rows) ?? {
      x: 0.03,
      y: 0.04,
      w: 0.94,
      h: 0.92,
    };
  return { geometry, tableFrame };
}

/**
 * Prueba varios marcos candidatos y elige el que más filas lee con claridad.
 */
export function scanWarpedWithBestTableFrame(
  warped: HTMLCanvasElement,
  columns: number,
  rowCount: number
): { meta: OmrScanMetaResult; orangeFrameNorm: OmrNormRect } {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const templateFrame = califacilOmrTableFrameNormRect(rows);
  const candidates: OmrNormRect[] = [
    templateFrame,
    { x: 0.03, y: 0.04, w: 0.94, h: 0.92 },
    { x: 0.05, y: 0.06, w: 0.9, h: 0.88 },
    { x: 0.02, y: 0.1, w: 0.96, h: 0.86 },
  ];
  for (const dy of [-0.03, -0.02, -0.015, 0.015, 0.02, 0.03]) {
    for (const dx of [-0.025, -0.015, 0.015, 0.025]) {
      candidates.push({
        x: Math.max(0, Math.min(0.92, templateFrame.x + dx)),
        y: Math.max(0, Math.min(0.92, templateFrame.y + dy)),
        w: templateFrame.w,
        h: templateFrame.h,
      });
    }
  }

  let bestMeta: OmrScanMetaResult | null = null;
  let bestFrame = templateFrame;
  let bestScore = Number.NEGATIVE_INFINITY;

  const fullSweep = sweepFullCanvasTableGeometry(warped, rows, columns);
  if (fullSweep) {
    const meta = omrMetaFromGeometry(warped, fullSweep.geometry, rows, columns);
    const score = scoreOmrMetaPicks(meta, rows);
    if (score > bestScore) {
      bestScore = score;
      bestMeta = meta;
      bestFrame = fullSweep.tableFrame;
    }
    candidates.push(fullSweep.tableFrame);
  }

  const hybrid = buildRegisteredAnswerSheetGeometry(warped, rows, columns);
  if (validateAnswerSheetGeometry(hybrid, rows).ok) {
    const meta = omrMetaFromGeometry(warped, hybrid, rows, columns);
    const score = scoreOmrMetaPicks(meta, rows);
    if (score > bestScore) {
      bestScore = score;
      bestMeta = meta;
      bestFrame = tableFrameFromBubbleGeometry(hybrid, rows) ?? templateFrame;
    }
  }

  const bubbleBbox = califacilOmrOrangeFrameRect(hybrid, rows);
  const tableBbox = califacilGeometryTableBounds(hybrid, rows);
  if (bubbleBbox) candidates.push(bubbleBbox);
  if (tableBbox) candidates.push(tableBbox);

  if (bubbleBbox) {
    const t = buildCalifacilAnswerSheetOmrTemplate(rows);
    const padTop = bubbleBbox.h * (t.titleStripRatioOfTable / Math.max(0.2, 1 - t.titleStripRatioOfTable));
    const padLeft = bubbleBbox.w * (t.qnumWidthRatio / Math.max(0.2, 1 - t.qnumWidthRatio));
    const x = Math.max(0, bubbleBbox.x - padLeft);
    const y = Math.max(0, bubbleBbox.y - padTop);
    candidates.push({
      x,
      y,
      w: Math.min(1 - x, bubbleBbox.w + padLeft + bubbleBbox.w * 0.025),
      h: Math.min(1 - y, bubbleBbox.h + padTop + bubbleBbox.h * 0.015),
    });
  }

  for (const frame of candidates) {
    const meta = scanWarpedWithNormTableFrame(warped, columns, rows, frame);
    const score = scoreOmrMetaPicks(meta, rows);
    if (score > bestScore) {
      bestScore = score;
      bestMeta = meta;
      bestFrame = frame;
    }
  }

  const meta = bestMeta ?? scanWarpedWithNormTableFrame(warped, columns, rows, templateFrame);
  return { meta, orangeFrameNorm: bestFrame };
}

/**
 * Lectura OMR usando un marco de tabla definido manualmente (vista previa móvil).
 */
export function scanWarpedWithNormTableFrame(
  warped: HTMLCanvasElement,
  columns: number,
  rowCount: number,
  tableFrame: OmrNormRect
): OmrScanMetaResult {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const emptyRows = (): OmrScanRowDetail[] =>
    Array.from({ length: rows }, () => ({ pick: null, ambiguous: false, inkFractions: [] }));
  if (typeof document === 'undefined' || warped.width < 40 || warped.height < 40) {
    return {
      picks: Array(rows).fill(null),
      rows: emptyRows(),
      needsVisionAssist: false,
      maxSameColumnCount: 0,
      geometry: null,
      reviewSourceCanvas: null,
      controlNumberDigits: [],
      controlNumber: null,
    };
  }
  const geometry = buildAnswerSheetOmrGeometryInNormRect(
    tableFrame,
    rows,
    columns,
    warped.width,
    warped.height,
    warped
  );
  return omrMetaFromGeometry(warped, geometry, rows, columns);
}

/**
 * Cuadrícula híbrida: plantilla PDF + líneas internas detectadas tras warp refinado.
 */
export function buildRegisteredAnswerSheetGeometry(
  canvas: HTMLCanvasElement,
  rowCount: number,
  columns: number
): CalifacilOmrScanGeometry {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const width = Math.max(1, canvas.width);
  const height = Math.max(1, canvas.height);
  const template = buildCalifacilAnswerSheetOmrTemplate(rowCount);

  const tableLeft = width * template.tableLeftRatio;
  const tableTop = height * template.tableTopRatio;
  const tableW = width * template.tableWidthRatio;
  const tableH = height * template.tableHeightRatio;
  const dataTop = tableTop + tableH * template.titleStripRatioOfTable;
  const dataHeight = tableH * (1 - template.titleStripRatioOfTable);
  const rowH = dataHeight / rows;
  const qNumW = tableW * template.qnumWidthRatio;
  const rightStripW = tableW * CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO;
  const bubbleAreaLeft = Math.max(2, Math.round(tableLeft + qNumW));
  const bubbleAreaW = Math.max(18, tableW - qNumW - rightStripW);

  const uniformColEdges = buildUniformBubbleColumnEdges(
    bubbleAreaLeft,
    bubbleAreaW,
    cols,
    width
  );

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let lineYs: number[] | null = null;
  let imageData: Uint8ClampedArray | null = null;
  if (ctx) {
    imageData = ctx.getImageData(0, 0, width, height).data;
    lineYs = refineOmrRowBoundariesFromTableLines(
      imageData,
      width,
      height,
      bubbleAreaLeft,
      dataTop,
      dataHeight,
      rows
    );
  }

  if (lineYs && lineYs.length === rows + 1) {
    let rowAligned = true;
    let avgDev = 0;
    for (let i = 0; i < rows + 1; i++) {
      const expected = dataTop + i * rowH;
      const dev = Math.abs(lineYs[i]! - expected);
      avgDev += dev;
      if (dev > rowH * 0.92) rowAligned = false;
    }
    avgDev /= rows + 1;
    const uniformRows = lineYsHaveUniformSpacing(lineYs);
    if (!rowAligned && !uniformRows) {
      lineYs = null;
    } else if (rowAligned) {
      const detectedWeight = avgDev < rowH * 0.22 ? 0.82 : 0.65;
      lineYs = lineYs.map((y, i) => {
        const expected = dataTop + i * rowH;
        return Math.round(y * detectedWeight + expected * (1 - detectedWeight));
      });
    }
  } else {
    lineYs = null;
  }

  if (!lineYs && imageData) {
    const swept = sweepAnswerSheetTableGrid(imageData, width, height, rowCount, columns);
    if (swept) {
      return buildCellsFromTableLines(swept.lineYs, swept.colEdges, width, height, cols);
    }
  }

  if (!lineYs) {
    return buildAnswerSheetOmrGeometry(rowCount, columns, width, height);
  }

  const columnEdges = uniformColEdges;
  const cells: OmrNormRect[][] = [];
  for (let row = 0; row < rows; row++) {
    const yRowTop = lineYs[row]!;
    const yRowBot = lineYs[row + 1]!;
    const rowRects: OmrNormRect[] = [];
    for (let c = 0; c < cols; c++) {
      const x0 = columnEdges[c]!;
      const x1 = columnEdges[c + 1]!;
      rowRects.push({
        x: x0 / width,
        y: yRowTop / height,
        w: Math.max(0, (x1 - x0) / width),
        h: Math.max(0, (yRowBot - yRowTop) / height),
      });
    }
    cells.push(rowRects);
  }

  return { imageWidth: width, imageHeight: height, cells };
}

export type CalifacilControlNumberGeometry = {
  imageWidth: number;
  imageHeight: number;
  digitCount: number;
  /** cells[column][digitRow 0–9] */
  cells: OmrNormRect[][];
};

/** Cuadrícula OMR del número de control alineada con la plantilla impresa. */
export function buildAnswerSheetControlNumberGeometry(
  imageWidth: number,
  imageHeight: number,
  digitCount = CALIFACIL_CONTROL_NUMBER_DIGIT_COUNT,
  rowCount = CALIFACIL_OMR_DEFAULT_ROWS
): CalifacilControlNumberGeometry {
  const cols = Math.max(1, Math.min(12, Math.round(digitCount)));
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  const bounds = getControlNumberBlockPageRatios(rowCount);

  const blockLeft = width * bounds.left;
  const blockTop = height * bounds.top;
  const blockW = width * bounds.width;
  const blockH = height * bounds.height;
  const titleH = blockH * bounds.titleFrac;
  const tableTop = blockTop + titleH;
  const tableH = blockH - titleH;
  const headerH = tableH * bounds.headerFrac;
  const dataTop = tableTop + headerH;
  const dataH = tableH - headerH;
  const rowH = dataH / 10;
  const cornerW = blockW * bounds.cornerColFrac;
  const dataLeft = blockLeft + cornerW;
  const dataW = blockW - cornerW;
  const colW = dataW / cols;

  const cells: OmrNormRect[][] = [];
  for (let col = 0; col < cols; col++) {
    const colCells: OmrNormRect[] = [];
    for (let d = 0; d <= 9; d++) {
      const x0 = dataLeft + col * colW;
      const x1 = col === cols - 1 ? dataLeft + dataW : dataLeft + (col + 1) * colW;
      const y0 = dataTop + d * rowH;
      const y1 = dataTop + (d + 1) * rowH;
      colCells.push({
        x: x0 / width,
        y: y0 / height,
        w: Math.max(0, (x1 - x0) / width),
        h: Math.max(0, (y1 - y0) / height),
      });
    }
    cells.push(colCells);
  }

  return { imageWidth: width, imageHeight: height, digitCount: cols, cells };
}

function readControlNumberFromTemplateGeometry(
  canvas: HTMLCanvasElement,
  geometry: CalifacilControlNumberGeometry,
  thresholds: ScanThresholds
): { digits: (number | null)[]; controlNumber: string | null } {
  const cols = geometry.digitCount;
  const digits: (number | null)[] = Array(cols).fill(null);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { digits, controlNumber: null };
  }

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const W = Math.max(1, geometry.imageWidth);
  const H = Math.max(1, geometry.imageHeight);
  const rw = thresholds.ringDarknessWeight ?? CALIFACIL_OMR_SCAN.ringDarknessWeight;

  for (let col = 0; col < cols; col++) {
    const colCells = geometry.cells[col];
    if (!colCells?.length) continue;

    let colX0 = W;
    let colX1 = 0;
    let colY0 = H;
    let colY1 = 0;
    for (const cell of colCells) {
      colX0 = Math.min(colX0, cell.x * W);
      colX1 = Math.max(colX1, (cell.x + cell.w) * W);
      colY0 = Math.min(colY0, cell.y * H);
      colY1 = Math.max(colY1, (cell.y + cell.h) * H);
    }
    const { hist, total } = buildRowGrayHistogram(
      data,
      width,
      height,
      Math.max(0, Math.floor(colX0)),
      Math.min(width - 1, Math.ceil(colX1)),
      Math.max(0, Math.floor(colY0)),
      Math.min(height - 1, Math.ceil(colY1)),
      2
    );
    const otsuT = otsuThreshold256(hist, Math.max(1, total));

    const fills: number[] = [];
    const scores: number[] = [];
    const inkFracs: number[] = [];

    for (let d = 0; d <= 9; d++) {
      const cell = colCells[d];
      if (!cell) {
        fills.push(0);
        scores.push(0);
        inkFracs.push(0);
        continue;
      }
      const cellW = Math.max(1, cell.w * W);
      const cellH = Math.max(1, cell.h * H);
      const marginX = 0.08;
      const marginY = 0.04;
      const xa = cell.x * W + cellW * marginX;
      const xb = cell.x * W + cellW * (1 - marginX);
      const ya = cell.y * H + cellH * marginY;
      const yb = cell.y * H + cellH * (1 - marginY);
      const cx = cell.x * W + cellW * 0.5;
      const cy = cell.y * H + cellH * 0.5;
      const radiusPx = Math.max(2, Math.min(cellW, cellH) * 0.34);

      const fillDark = sampleRectMeanDarkness(data, width, height, xa, ya, xb, yb);
      const ringDark = sampleAnnulusDarkness(
        data,
        width,
        height,
        cx,
        cy,
        Math.max(1, Math.round(radiusPx * 0.62)),
        Math.max(2, Math.round(radiusPx))
      );
      fills.push(fillDark);
      scores.push(fillDark - ringDark * rw);
      inkFracs.push(
        sampleRectInkFractionAtThreshold(data, width, height, xa, ya, xb, yb, otsuT, 2)
      );
    }

    const abs = pickAnswerSheetRowAbsolute({ inkFracs, fills, scores, cols: 10 });
    digits[col] = abs.pick;
  }

  return { digits, controlNumber: controlNumberDigitsToString(digits) };
}

/**
 * Posiciones de burbujas y margen de tabla según la plantilla impresa (sin escanear imagen).
 * Sirve para superponer la guía de 120 círculos en el visor de cámara.
 */
export function buildAnswerSheetTemplateGuide(
  rowCount: number,
  columns: number,
  pageW = CALIFACIL_WARP_LETTER_WIDTH,
  pageH = CALIFACIL_WARP_LETTER_HEIGHT
): AnswerSheetTemplateGuide {
  const template = buildCalifacilAnswerSheetOmrTemplate(rowCount);
  const geometry = buildAnswerSheetOmrGeometry(rowCount, columns, pageW, pageH);

  return {
    geometry,
    tableBoundsNorm: {
      x: template.tableLeftRatio,
      y: template.tableTopRatio,
      w: template.tableWidthRatio,
      h: template.tableHeightRatio,
    },
    pageFrameNorm: CALIFACIL_WARP_PAGE_FRAME_NORM,
  };
}

type ViewportPoint = { x: number; y: number };

/** Esquinas de hoja detectada → puntos en pantalla (centro de cada visor de esquina). */
export function sheetCornerGuidesToViewportQuad(
  guides: Array<{ left: number; top: number; size: number }>
): { tl: ViewportPoint; tr: ViewportPoint; br: ViewportPoint; bl: ViewportPoint } | null {
  if (guides.length !== 4) return null;
  const center = (g: { left: number; top: number; size: number }) => ({
    x: g.left + g.size / 2,
    y: g.top + g.size / 2,
  });
  return {
    tl: center(guides[0]!),
    tr: center(guides[1]!),
    bl: center(guides[2]!),
    br: center(guides[3]!),
  };
}

/** Endereza la hoja usando los cuatro marcadores negros de esquina y refina fiduciales. */
export function warpCalifacilSheetFromCornerMarkers(
  canvas: HTMLCanvasElement
): HTMLCanvasElement | null {
  const quad = detectCalifacilQuadFromCornerMarkers(canvas);
  if (!quad) return null;
  const warped = warpPerspectiveToRect(
    canvas,
    quad,
    CALIFACIL_WARP_LETTER_WIDTH,
    CALIFACIL_WARP_LETTER_HEIGHT
  );
  if (!warped) return null;
  return refineWarpedCalifacilSheet(warped).canvas;
}

export type CalifacilSheetQualityProbe = {
  hasGrid: boolean;
  hasCornerMarkers: boolean;
  hasRowLines: boolean;
  hasColumnEdges: boolean;
};

/** Sondeo rápido de calidad OMR (líneas, columnas) para validación en cámara móvil. */
export function probeCalifacilSheetQuality(
  canvas: HTMLCanvasElement,
  columns: number
): CalifacilSheetQualityProbe {
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const hasGrid = hasCalifacilPrintedTableGrid(canvas, cols);
  const hasCornerMarkers = hasCalifacilCornerMarkers(canvas);
  const detail = scanCalifacilOmrCanvasDetailed(canvas, cols, {
    minMarkDarkness: CALIFACIL_OMR_SCAN.minMarkDarkness,
    minBestVsSecondGap: CALIFACIL_OMR_SCAN.minBestVsSecondGap,
  });
  return {
    hasGrid,
    hasCornerMarkers,
    hasRowLines: detail.hasDetectedRowLines,
    hasColumnEdges: detail.hasDetectedColumnEdges,
  };
}

/**
 * Validación estricta para cámara móvil: rejilla + esquinas + estructura de tabla detectable.
 * Evita falsos positivos en paredes o texturas sin hoja CaliFacil.
 */
export function isCalifacilExamSheetStrict(
  canvas: HTMLCanvasElement,
  columns: number
): boolean {
  if (!isCalifacilExamSheetLikely(canvas, columns)) return false;
  if (!hasCalifacilCornerMarkers(canvas)) return false;
  const probe = probeCalifacilSheetQuality(canvas, columns);
  return probe.hasRowLines && probe.hasColumnEdges;
}

/**
 * Diagnóstico de captura móvil (mensajes para UI).
 */
export function diagnoseCalifacilAnswerSheetReadiness(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount?: number,
  warpAlignment?: WarpAlignmentReport | null
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (warpAlignment && Number.isFinite(warpAlignment.maxErrorPx) && warpAlignment.maxErrorPx > 18) {
    issues.push('alineación imprecisa');
  }
  const corners = countCalifacilCornerMarkers(canvas);
  if (corners < 3) issues.push('faltan esquinas negras');
  const strips = hasCalifacilAlignStrips(canvas);
  if (!strips) issues.push('no se ven las franjas negras laterales');
  const grid = hasCalifacilPrintedTableGrid(canvas, columns, rowCount);
  if (!grid) issues.push('no se detecta la tabla de respuestas');
  const probe = probeCalifacilSheetQuality(canvas, columns);
  if (!probe.hasRowLines) issues.push('faltan líneas de filas');
  if (!probe.hasColumnEdges) issues.push('faltan columnas A–D');

  const structureOk = grid && probe.hasRowLines && probe.hasColumnEdges;
  const finalOk = structureOk && corners >= 3 && (strips || corners >= 4);

  return { ok: finalOk, issues };
}

/**
 * Validación antes de calificar captura móvil: evita paredes sin bloquear hojas reales.
 */
export function isCalifacilAnswerSheetReadyForGrading(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount?: number,
  warpAlignment?: WarpAlignmentReport | null
): boolean {
  return diagnoseCalifacilAnswerSheetReadiness(canvas, columns, rowCount, warpAlignment).ok;
}

function scanCalifacilOmrCanvasDetailed(
  canvas: HTMLCanvasElement,
  columns: number,
  thresholds: ScanThresholds,
  rowCount = CALIFACIL_OMR_DEFAULT_ROWS
): ScanDetailedResult {
  return scanCalifacilOmrCanvasDetailedWithProfile(
    canvas,
    columns,
    thresholds,
    CALIFACIL_OMR_SCAN,
    0,
    undefined,
    rowCount
  );
}

function sampleAnswerSheetRowAtCy(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  columnEdges: number[],
  cols: number,
  cy: number,
  radiusPx: number,
  diskRInk: number,
  otsuT: number,
  thresholds: ScanThresholds
): { fills: number[]; scores: number[]; inkFracs: number[] } {
  const fills: number[] = [];
  const scores: number[] = [];
  const inkFracs: number[] = [];
  const rw = thresholds.ringDarknessWeight ?? CALIFACIL_OMR_SCAN.ringDarknessWeight;
  for (let c = 0; c < cols; c++) {
    const cx = (columnEdges[c]! + columnEdges[c + 1]!) * 0.5;
    const fillDark = sampleDiskDarkness(
      data,
      width,
      height,
      cx,
      cy,
      Math.max(2, Math.round(radiusPx * 0.5))
    );
    const ringDark = sampleAnnulusDarkness(
      data,
      width,
      height,
      cx,
      cy,
      Math.max(1, Math.round(radiusPx * 0.62)),
      Math.max(2, Math.round(radiusPx))
    );
    fills.push(fillDark);
    scores.push(fillDark - ringDark * rw);
    inkFracs.push(
      sampleDiskInkFractionAtThreshold(data, width, height, cx, cy, diskRInk, otsuT)
    );
  }
  return { fills, scores, inkFracs };
}

function pickAnswerSheetRowAbsolute(params: {
  inkFracs: number[];
  fills: number[];
  scores: number[];
  cols: number;
}): { pick: number | null; ambiguous: boolean; confidence: number } {
  const { inkFracs, fills, scores, cols } = params;
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

  /** Tinta clara aunque el anillo falle (sombra / desalineación leve). */
  if (inkOk && inkVal >= 0.28 && inkGap >= 0.06) {
    return {
      pick: inkBest,
      ambiguous: !scoreOk || inkBest !== scoreBest,
      confidence: inkVal + inkGap * 0.5,
    };
  }

  /** Centro oscuro sin Otsu fuerte — típico en filas superiores mal alineadas. */
  if (scoreOk && fillBest >= 0.14 && scoreGap >= 0.014) {
    return {
      pick: scoreBest,
      ambiguous: !inkOk || inkBest !== scoreBest,
      confidence: fillBest + scoreGap,
    };
  }

  if (!inkOk && !scoreOk) {
    return { pick: null, ambiguous: false, confidence: 0 };
  }

  const ambiguous =
    maxInk > CALIFACIL_ANSWER_SHEET_ABSOLUTE.blankMaxInk * 1.35 &&
    (inkOk || scoreOk) &&
    inkBest !== scoreBest;
  return { pick: null, ambiguous, confidence: 0 };
}

/**
 * Lee marcas solo dentro de las celdas de la plantilla (mismo marco que el overlay naranja).
 * Evita falsos positivos en las franjas negras laterales o fuera de la tabla.
 */
function readAnswerSheetPicksFromTemplateGeometry(
  canvas: HTMLCanvasElement,
  geometry: CalifacilOmrScanGeometry,
  thresholds: ScanThresholds,
  rowCount: number,
  columns: number
): Pick<
  ScanDetailedResult,
  'picks' | 'rows' | 'resolvedCount' | 'confidenceSum' | 'maxSameColumnCount'
> {
  const rows = Math.min(clampCalifacilOmrRowCount(rowCount), geometry.cells.length);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const out: (number | null)[] = Array(rows).fill(null);
  const rowMetas: OmrScanRowDetail[] = [];
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    for (let i = 0; i < rows; i++) {
      rowMetas.push({ pick: null, ambiguous: false, inkFractions: [] });
    }
    return {
      picks: out,
      rows: rowMetas,
      resolvedCount: 0,
      confidenceSum: 0,
      maxSameColumnCount: 0,
    };
  }

  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const W = Math.max(1, geometry.imageWidth);
  const H = Math.max(1, geometry.imageHeight);
  const rw = thresholds.ringDarknessWeight ?? CALIFACIL_OMR_SCAN.ringDarknessWeight;

  let resolvedCount = 0;
  let confidenceSum = 0;

  for (let row = 0; row < rows; row++) {
    const rowCells = geometry.cells[row];
    if (!rowCells?.length) {
      rowMetas.push({ pick: null, ambiguous: false, inkFractions: [] });
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
      width,
      height,
      Math.max(0, Math.floor(rowX0)),
      Math.min(width - 1, Math.ceil(rowX1)),
      Math.max(0, Math.floor(rowY0)),
      Math.min(height - 1, Math.ceil(rowY1)),
      2
    );
    const otsuT = otsuThreshold256(hist, Math.max(1, total));

    const fills: number[] = [];
    const scores: number[] = [];
    const inkFracs: number[] = [];

    for (let c = 0; c < cols; c++) {
      const cell = rowCells[c];
      if (!cell) {
        fills.push(0);
        scores.push(0);
        inkFracs.push(0);
        continue;
      }
      const cellW = Math.max(1, cell.w * W);
      const cellH = Math.max(1, cell.h * H);
      const marginX = c === 0 || c === cols - 1 ? 0.08 : 0.05;
      const marginY = 0.03;
      const xa = cell.x * W + cellW * marginX;
      const xb = cell.x * W + cellW * (1 - marginX);
      const ya = cell.y * H + cellH * marginY;
      const yb = cell.y * H + cellH * (1 - marginY);
      const cx = cell.x * W + cellW * 0.5;
      const cy = cell.y * H + cellH * 0.5;
      const radiusPx = Math.max(2, Math.min(cellW, cellH) * 0.34);

      const fillDark = sampleRectMeanDarkness(data, width, height, xa, ya, xb, yb);
      const ringDark = sampleAnnulusDarkness(
        data,
        width,
        height,
        cx,
        cy,
        Math.max(1, Math.round(radiusPx * 0.62)),
        Math.max(2, Math.round(radiusPx))
      );
      fills.push(fillDark);
      scores.push(fillDark - ringDark * rw);
      inkFracs.push(
        sampleRectInkFractionAtThreshold(data, width, height, xa, ya, xb, yb, otsuT, 2)
      );
    }

    const abs = pickAnswerSheetRowAbsolute({ inkFracs, fills, scores, cols });
    out[row] = abs.pick;
    rowMetas.push({
      pick: abs.pick,
      ambiguous: abs.ambiguous,
      inkFractions: [...inkFracs],
    });
    if (abs.pick !== null) {
      resolvedCount++;
      confidenceSum += abs.confidence;
    }
  }

  let maxSameColumnCount = 0;
  const colTally = new Map<number, number>();
  for (const p of out) {
    if (p !== null) colTally.set(p, (colTally.get(p) ?? 0) + 1);
  }
  colTally.forEach((v) => {
    maxSameColumnCount = Math.max(maxSameColumnCount, v);
  });

  return { picks: out, rows: rowMetas, resolvedCount, confidenceSum, maxSameColumnCount };
}

function scanCalifacilOmrCanvasDetailedWithProfile(
  canvas: HTMLCanvasElement,
  columns: number,
  thresholds: ScanThresholds,
  profile: OmrGeometryProfile,
  columnShiftPx = 0,
  fixedTemplate?: OmrFixedTemplate,
  rowCount = CALIFACIL_OMR_DEFAULT_ROWS,
  templateGridOnly = false
): ScanDetailedResult {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns)));
  const out: (number | null)[] = Array(rows).fill(null);
  const rowMetas: OmrScanRowDetail[] = [];
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    for (let i = 0; i < rows; i++) {
      rowMetas.push({ pick: null, ambiguous: false, inkFractions: [] });
    }
    return {
      picks: out,
      resolvedCount: 0,
      confidenceSum: 0,
      rows: rowMetas,
      clarityStripGapSum: 0,
      maxSameColumnCount: 0,
      hasDetectedRowLines: false,
      hasDetectedColumnEdges: false,
      geometry: null,
    };
  }
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = id;

  const tableLeft = fixedTemplate ? width * fixedTemplate.tableLeftRatio : 0;
  const tableTop = fixedTemplate ? height * fixedTemplate.tableTopRatio : 0;
  const tableW = fixedTemplate ? width * fixedTemplate.tableWidthRatio : 0;
  const tableH = fixedTemplate ? height * fixedTemplate.tableHeightRatio : 0;
  const bandH = fixedTemplate ? tableH : height * profile.bottomBandRatio;
  const bandTop = fixedTemplate ? tableTop : height - bandH;
  const dataTop = fixedTemplate
    ? bandTop + bandH * fixedTemplate.titleStripRatioOfTable
    : bandTop + bandH * profile.titleStripRatioOfBand;
  const dataHeight = fixedTemplate
    ? bandH * (1 - fixedTemplate.titleStripRatioOfTable)
    : bandH * (1 - profile.titleStripRatioOfBand);
  const rowH = dataHeight / rows;

  const qNumW = fixedTemplate ? tableW * fixedTemplate.qnumWidthRatio : width * profile.qnumWidthRatio;
  const maxRight = fixedTemplate ? Math.min(width - 2, tableLeft + tableW - 3) : width * 0.45;
  const bubbleAreaLeft = Math.max(
    2,
    Math.min(maxRight, Math.round((fixedTemplate ? tableLeft : 0) + qNumW + columnShiftPx))
  );
  const bubbleAreaW = fixedTemplate
    ? Math.max(18, tableW - qNumW - tableW * CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO)
    : width - bubbleAreaLeft - Math.round(width * (CALIFACIL_BUBBLE_RIGHT_STRIP_RATIO + 0.035));
  const cellW = bubbleAreaW / cols;

  const uniformColEdges: number[] = [];
  for (let c = 0; c <= cols; c++) {
    uniformColEdges.push(
      c === cols
        ? Math.min(width - 1, Math.round(bubbleAreaLeft + bubbleAreaW))
        : Math.round(bubbleAreaLeft + (c * bubbleAreaW) / cols)
    );
  }
  // Refinamiento de filas por líneas horizontales impresas.
  // En hoja de respuestas calibrada, la cuadrícula de plantilla evita falsos positivos por moiré.
  let lineYs = templateGridOnly
    ? null
    : refineOmrRowBoundariesFromTableLines(
        data,
        width,
        height,
        bubbleAreaLeft,
        dataTop,
        dataHeight,
        rows
      );
  if (lineYs && fixedTemplate && !templateGridOnly) {
    let rowAligned = true;
    let avgDev = 0;
    for (let i = 0; i < rows + 1; i++) {
      const expected = dataTop + i * rowH;
      const dev = Math.abs(lineYs[i]! - expected);
      avgDev += dev;
      const maxDev = rowH * 0.92;
      if (dev > maxDev) {
        rowAligned = false;
        break;
      }
    }
    avgDev /= rows + 1;
    if (!rowAligned) {
      lineYs = null;
    } else {
      const detectedWeight = avgDev < rowH * 0.22 ? 0.82 : 0.65;
      lineYs = lineYs.map((y, i) => {
        const expected = dataTop + i * rowH;
        const blended = y * detectedWeight + expected * (1 - detectedWeight);
        return Math.round(blended);
      });
    }
  }

  const inferredColEdgesLocal = templateGridOnly
    ? null
    : inferColumnEdgesFromVerticalLines(
        data,
        width,
        height,
        bubbleAreaLeft,
        bubbleAreaW,
        cols,
        dataTop,
        rowH
      );
  const inferredColEdgesGlobal =
    templateGridOnly || fixedTemplate || profile.bottomBandRatio >= 0.95
      ? null
      : inferColumnEdgesGlobalFromVerticalLines(data, width, height, cols, dataTop, rowH);
  let inferredColEdges = inferredColEdgesLocal ?? inferredColEdgesGlobal;
  if (inferredColEdges && fixedTemplate && !templateGridOnly) {
    const span = inferredColEdges[inferredColEdges.length - 1]! - inferredColEdges[0]!;
    let maxEdgeDev = 0;
    for (let i = 0; i <= cols; i++) {
      maxEdgeDev = Math.max(maxEdgeDev, Math.abs(inferredColEdges[i]! - uniformColEdges[i]!));
    }
    // En template fijo, aceptar solo detecciones cercanas al layout esperado.
    if (span < bubbleAreaW * 0.62 || span > bubbleAreaW * 1.38 || maxEdgeDev > cellW * 0.62) {
      inferredColEdges = null;
    } else {
      inferredColEdges = inferredColEdges.map((x, i) =>
        Math.round(x * 0.72 + uniformColEdges[i]! * 0.28)
      );
    }
  } else if (inferredColEdges && !fixedTemplate && profile.bottomBandRatio < 0.95) {
    const span = inferredColEdges[inferredColEdges.length - 1]! - inferredColEdges[0]!;
    // En hoja completa, un span demasiado corto suele ser un falso positivo sobre el texto.
    if (span < width * 0.56) inferredColEdges = null;
  }
  const columnEdges = inferredColEdges ?? uniformColEdges;
  const bubbleAreaRight = Math.max(
    bubbleAreaLeft + 8,
    Math.min(width - 1, Math.round(columnEdges[columnEdges.length - 1] ?? width - 1))
  );
  const hasDetectedRowLines = Boolean(lineYs && lineYs.length === rows + 1);
  const hasDetectedColumnEdges = Boolean(inferredColEdges && inferredColEdges.length === cols + 1);
  const minCellW = Math.min(
    ...Array.from({ length: cols }, (_, c) => Math.max(1, columnEdges[c + 1]! - columnEdges[c]!))
  );

  const minInkFrac = CALIFACIL_OMR_SCAN.minBubbleInkFraction;
  const minInkGap = CALIFACIL_OMR_SCAN.minInkFractionGap;
  const twinFloor = CALIFACIL_OMR_SCAN.ambiguousInkTwinFloor;

  let resolvedCount = 0;
  let confidenceSum = 0;
  let clarityStripGapSum = 0;
  const cells: OmrNormRect[][] = [];
  for (let row = 0; row < rows; row++) {
    let yRowTop: number;
    let yRowBot: number;
    let cy: number;
    if (lineYs && lineYs.length === rows + 1) {
      yRowTop = lineYs[row]!;
      yRowBot = lineYs[row + 1]!;
      cy = (yRowTop + yRowBot) * 0.5;
      if (row === rows - 1) {
        let sumG = 0;
        for (let i = 0; i < rows - 1; i++) {
          sumG += lineYs[i + 1]! - lineYs[i]!;
        }
        const meanGap = sumG / Math.max(1, rows - 1);
        const lastGap = lineYs[rows]! - lineYs[rows - 1]!;
        if (lastGap < meanGap * 0.68 || lastGap > meanGap * 1.42) {
          yRowTop = dataTop + (rows - 1) * rowH;
          yRowBot = dataTop + rows * rowH;
          cy = dataTop + (rows - 0.5) * rowH;
        }
      }
    } else {
      yRowTop = dataTop + row * rowH;
      yRowBot = dataTop + (row + 1) * rowH;
      cy = dataTop + (row + 0.5) * rowH;
    }
    const localRowH = Math.max(1, yRowBot - yRowTop);
    const radiusPx = Math.max(2, Math.min(minCellW, localRowH) * 0.22);
    const diskRInk = Math.max(2, Math.round(radiusPx * 0.9));

    const { hist, total } = buildRowGrayHistogram(
      data,
      width,
      height,
      bubbleAreaLeft,
      bubbleAreaRight,
      yRowTop,
      yRowBot,
      2
    );
    const otsuT = otsuThreshold256(hist, Math.max(1, total));

    const stripPad = Math.max(1, Math.floor(localRowH * 0.2));
    let stripY0 = Math.min(height - 1, Math.ceil(yRowTop + stripPad));
    let stripY1 = Math.max(stripY0, Math.floor(yRowBot - stripPad));
    let stripFracs = columnStripInkFractionsForEdges(
      data,
      width,
      height,
      columnEdges,
      cols,
      stripY0,
      stripY1,
      otsuT
    );
    if (row === rows - 1 && lineYs && lineYs.length === rows + 1) {
      const y0g = Math.min(height - 1, Math.ceil(dataTop + (rows - 1) * rowH + stripPad));
      const y1g = Math.max(y0g, Math.floor(dataTop + rows * rowH - stripPad));
      const stripGeo = columnStripInkFractionsForEdges(
        data,
        width,
        height,
        columnEdges,
        cols,
        y0g,
        y1g,
        otsuT
      );
      const medAdj = (arr: number[]) => arr.map((f) => f - medianOfNumbers(arr));
      const pLine = bestMedianStripPick(medAdj(stripFracs));
      const pGeo = bestMedianStripPick(medAdj(stripGeo));
      if (pGeo.gap > pLine.gap + 0.006) stripFracs = stripGeo;
    }

    const innerFracs = columnInnerBubbleInkFractions(
      data,
      width,
      height,
      columnEdges,
      cols,
      yRowTop,
      yRowBot,
      otsuT
    );
    const innerMedianAdj = innerFracs.map((f) => f - medianOfNumbers(innerFracs));
    const innerPickInfo = bestMedianStripPick(innerMedianAdj);
    const innerRectDark = columnInnerRectMeanDarkness(
      data,
      width,
      height,
      columnEdges,
      cols,
      yRowTop,
      yRowBot
    );
    let innerRectBest = 0;
    for (let c = 1; c < cols; c++) {
      if (innerRectDark[c]! > innerRectDark[innerRectBest]!) innerRectBest = c;
    }
    let innerRectSecond = innerRectBest === 0 ? 1 : 0;
    for (let c = 0; c < cols; c++) {
      if (c === innerRectBest) continue;
      if (innerRectDark[c]! > innerRectDark[innerRectSecond]!) innerRectSecond = c;
    }
    const rectGap =
      (innerRectDark[innerRectBest] ?? 0) - (innerRectDark[innerRectSecond] ?? 0);
    const rectMean = innerRectDark.reduce((a, b) => a + b, 0) / Math.max(1, cols);
    const dynamicRectMin = Math.max(0.048, rectMean + 0.022);
    const rectRulePick: number | null =
      (innerRectDark[innerRectBest] ?? 0) >= dynamicRectMin &&
      rectGap >= 0.036 &&
      (innerRectDark[innerRectBest] ?? 0) / Math.max(0.001, (innerRectDark[innerRectSecond] ?? 0) + 0.001) >= 1.22
        ? innerRectBest
        : null;

    const scores: number[] = [];
    const fills: number[] = [];
    const rings: number[] = [];
    const inkFracs: number[] = [];
    for (let c = 0; c < cols; c++) {
      const cx = (columnEdges[c]! + columnEdges[c + 1]!) * 0.5;
      const fillDark = sampleDiskDarkness(
        data,
        width,
        height,
        cx,
        cy,
        Math.max(2, Math.round(radiusPx * 0.5))
      );
      const ringDark = sampleAnnulusDarkness(
        data,
        width,
        height,
        cx,
        cy,
        Math.max(1, Math.round(radiusPx * 0.62)),
        Math.max(2, Math.round(radiusPx))
      );
      fills.push(fillDark);
      rings.push(ringDark);
      const rw = thresholds.ringDarknessWeight ?? CALIFACIL_OMR_SCAN.ringDarknessWeight;
      scores.push(fillDark - ringDark * rw);
      inkFracs.push(
        sampleDiskInkFractionAtThreshold(data, width, height, cx, cy, diskRInk, otsuT)
      );
    }

    let bestIdx = 0;
    for (let c = 1; c < cols; c++) {
      if (scores[c] > scores[bestIdx]) bestIdx = c;
    }
    let secondIdx = bestIdx === 0 ? 1 : 0;
    for (let c = 0; c < cols; c++) {
      if (c === bestIdx) continue;
      if (scores[c] > scores[secondIdx]) secondIdx = c;
    }

    const best = scores[bestIdx] ?? 0;
    const second = scores[secondIdx] ?? -1;
    const gap = best - second;
    const rowMean = scores.reduce((sum, s) => sum + s, 0) / Math.max(1, scores.length);
    const dynamicMin = Math.max(thresholds.minMarkDarkness, rowMean + 0.012);
    const dynamicGap = Math.max(thresholds.minBestVsSecondGap, Math.abs(best) * 0.26);
    const ratio = best / Math.max(0.001, second + 0.001);
    const fillBest = fills[bestIdx] ?? 0;
    const ringBest = rings[bestIdx] ?? 0;
    const centerVsRing = fillBest - ringBest;
    const minRatio = thresholds.minBestVsSecondRatio ?? CALIFACIL_OMR_SCAN.minBestVsSecondRatio;
    const minCenterVsRingDelta =
      thresholds.minCenterVsRingDelta ?? CALIFACIL_OMR_SCAN.minCenterVsRingDelta;
    const solidCenterMin =
      thresholds.minSolidCenterDarkness ?? CALIFACIL_OMR_SCAN.minSolidCenterDarkness;

    let rulePick: number | null = null;
    if (
      best >= dynamicMin &&
      !(cols >= 2 && (gap < dynamicGap || ratio < minRatio)) &&
      !(second > dynamicMin * 0.92 && gap < dynamicGap * 1.25) &&
      (centerVsRing >= minCenterVsRingDelta || fillBest >= solidCenterMin)
    ) {
      rulePick = bestIdx;
    }

    let inkBestIdx = 0;
    for (let c = 1; c < cols; c++) {
      if (inkFracs[c] > inkFracs[inkBestIdx]) inkBestIdx = c;
    }
    let inkSecondIdx = inkBestIdx === 0 ? 1 : 0;
    for (let c = 0; c < cols; c++) {
      if (c === inkBestIdx) continue;
      if (inkFracs[c] > inkFracs[inkSecondIdx]) inkSecondIdx = c;
    }
    const maxInk = inkFracs[inkBestIdx] ?? 0;
    const secondInk = inkFracs[inkSecondIdx] ?? 0;
    const inkGap = maxInk - secondInk;

    let inkPick: number | null = null;
    if (maxInk >= minInkFrac && inkGap >= minInkGap) {
      inkPick = inkBestIdx;
    }

    const medianAdj = stripFracs.map((f) => f - medianOfNumbers(stripFracs));
    const stripPickInfo = bestMedianStripPick(medianAdj);
    const minStripGap = CALIFACIL_OMR_SCAN.minStripMedianGap;
    const minAbove = CALIFACIL_OMR_SCAN.minStripAboveMedian;
    const maxStripRaw = stripFracs.reduce((a, b) => Math.max(a, b), 0);
    const stripWinnerRaw = stripFracs[stripPickInfo.bestIdx] ?? 0;
    const minStripWin = CALIFACIL_OMR_SCAN.minStripWinnerRawFrac;
    let stripPrimaryPick: number | null = null;
    if (
      stripPickInfo.aboveMed >= minAbove &&
      stripPickInfo.gap >= minStripGap &&
      stripWinnerRaw >= minStripWin &&
      !(maxStripRaw < CALIFACIL_OMR_SCAN.maxStripFracBlankRow && stripPickInfo.gap < 0.055)
    ) {
      stripPrimaryPick = stripPickInfo.bestIdx;
    }

    let pick: number | null = null;
    let ambiguous = false;

    if (templateGridOnly) {
      let abs = pickAnswerSheetRowAbsolute({ inkFracs, fills, scores, cols });
      if (abs.pick === null) {
        for (const dy of [4, 3, 2, -2, -3, -4, 5, -5, 6, -6, 8, -8]) {
          const retryCy = Math.max(
            yRowTop + 2,
            Math.min(yRowBot - 2, Math.round(cy + dy))
          );
          if (retryCy === Math.round(cy)) continue;
          const retry = sampleAnswerSheetRowAtCy(
            data,
            width,
            height,
            columnEdges,
            cols,
            retryCy,
            radiusPx,
            diskRInk,
            otsuT,
            thresholds
          );
          const retryAbs = pickAnswerSheetRowAbsolute({
            inkFracs: retry.inkFracs,
            fills: retry.fills,
            scores: retry.scores,
            cols,
          });
          if (retryAbs.pick !== null) {
            abs = retryAbs;
            break;
          }
        }
      }
      pick = abs.pick;
      ambiguous = abs.ambiguous;
      if (pick !== null) {
        resolvedCount++;
        confidenceSum += abs.confidence;
        clarityStripGapSum += abs.confidence * 0.4;
      }
    } else {
    const innerWinnerRaw = innerFracs[innerPickInfo.bestIdx] ?? 0;
    const minInnerWin = CALIFACIL_OMR_SCAN.minInnerWinnerRawFrac;

    const innerStrong =
      innerPickInfo.aboveMed >= minAbove * 0.95 &&
      innerPickInfo.gap >= minStripGap * 0.92 &&
      innerWinnerRaw >= minInnerWin &&
      !(maxStripRaw < CALIFACIL_OMR_SCAN.maxStripFracBlankRow && innerPickInfo.gap < 0.048);

    if (stripPrimaryPick !== null) {
      const preferInner =
        innerStrong &&
        innerPickInfo.bestIdx !== stripPrimaryPick &&
        innerPickInfo.gap >= 0.042 &&
        (innerPickInfo.gap + 0.005 >= stripPickInfo.gap ||
          innerWinnerRaw >= stripWinnerRaw + 0.035);

      if (preferInner) {
        /** Pantalla/moiré: la franja completa a veces elige mal columna; el interior del cuadrado suele acertar. */
        pick = innerPickInfo.bestIdx;
        clarityStripGapSum += innerPickInfo.gap * 0.95;
        const twinsIn = innerFracs.filter((f) => f >= twinFloor * 0.95).length;
        ambiguous = twinsIn >= 2 && innerPickInfo.gap < 0.058;
      } else {
        pick = stripPrimaryPick;
        clarityStripGapSum += stripPickInfo.gap;
        const twinsStrip = stripFracs.filter((f) => f >= twinFloor).length;
        ambiguous = twinsStrip >= 2 && stripPickInfo.gap < 0.065;
      }
    } else if (innerStrong) {
      /** Casillas cuadradas rellenas: el interior de la celda marca mejor que la franja completa. */
      pick = innerPickInfo.bestIdx;
      clarityStripGapSum += innerPickInfo.gap * 0.95;
      const twinsIn = innerFracs.filter((f) => f >= twinFloor * 0.95).length;
      ambiguous = twinsIn >= 2 && innerPickInfo.gap < 0.058;
    } else if (
      rectRulePick !== null &&
      (inkPick === null || inkPick === rectRulePick || rulePick === rectRulePick)
    ) {
      pick = rectRulePick;
      const twinsR = innerFracs.filter((f) => f >= twinFloor * 0.92).length;
      ambiguous = twinsR >= 2 && rectGap < 0.048;
    } else {
      const twins = inkFracs.filter((f) => f >= twinFloor).length;
      if (rulePick !== null && inkPick !== null) {
        if (rulePick === inkPick) {
          pick = rulePick;
          ambiguous = twins >= 2 && inkGap < 0.19;
        } else {
          pick = null;
          ambiguous = true;
        }
      } else if (rulePick !== null && inkPick === null) {
        /** Solo modelo anular: exigir señal fuerte para no inventar columna. */
        const strongRule =
          best >= dynamicMin * 1.22 &&
          gap >= dynamicGap * 1.18 &&
          ratio >= minRatio * 1.12 &&
          (centerVsRing >= minCenterVsRingDelta * 1.15 || fillBest >= solidCenterMin * 1.05);
        if (strongRule) {
          pick = rulePick;
          ambiguous = twins >= 2;
        } else {
          pick = null;
          ambiguous = false;
        }
      } else if (inkPick !== null && rulePick === null) {
        /** Solo tinta binaria: umbrales ya altos en CALIFACIL_OMR_SCAN. */
        pick = inkPick;
        ambiguous = twins >= 2 || inkGap < minInkGap + 0.05;
      } else {
        pick = null;
        ambiguous = maxInk > 0.22 && (twins >= 2 || inkGap < 0.09);
      }
    }

      if (pick !== null) {
        resolvedCount++;
        const scoredAsInner =
          pick === innerPickInfo.bestIdx &&
          innerStrong &&
          (stripPrimaryPick === null || innerPickInfo.bestIdx !== stripPrimaryPick);

        if (scoredAsInner) {
          const maxIn = innerFracs.reduce((a, b) => Math.max(a, b), 0);
          confidenceSum +=
            innerPickInfo.aboveMed * 1.05 + innerPickInfo.gap * 2.5 + maxIn * 0.18;
        } else if (stripPrimaryPick !== null && pick === stripPrimaryPick) {
          const maxStrip = stripFracs.reduce((a, b) => Math.max(a, b), 0);
          confidenceSum +=
            stripPickInfo.aboveMed + stripPickInfo.gap * 2.5 + maxStrip * 0.2;
        } else if (
          pick === innerPickInfo.bestIdx &&
          innerPickInfo.aboveMed >= minAbove * 0.95 &&
          innerPickInfo.gap >= minStripGap * 0.92
        ) {
          const maxIn = innerFracs.reduce((a, b) => Math.max(a, b), 0);
          confidenceSum +=
            innerPickInfo.aboveMed * 1.05 + innerPickInfo.gap * 2.5 + maxIn * 0.18;
        } else if (rectRulePick !== null && pick === rectRulePick) {
          confidenceSum += rectGap * 18 + (innerRectDark[pick] ?? 0) * 12;
        } else {
          confidenceSum += best + gap + maxInk * 0.15;
        }
      }
    }

    out[row] = pick;
    rowMetas.push({
      pick,
      ambiguous,
      inkFractions: [...(templateGridOnly ? inkFracs : stripFracs)],
    });

    const rowRects: OmrNormRect[] = [];
    for (let c = 0; c < cols; c++) {
      const x0 = columnEdges[c]!;
      const x1 = columnEdges[c + 1]!;
      rowRects.push({
        x: x0 / width,
        y: yRowTop / height,
        w: Math.max(0, (x1 - x0) / width),
        h: Math.max(0, (yRowBot - yRowTop) / height),
      });
    }
    cells.push(rowRects);
  }
  let maxSameColumnCount = 0;
  const colTally = new Map<number, number>();
  for (const p of out) {
    if (p !== null) colTally.set(p, (colTally.get(p) ?? 0) + 1);
  }
  colTally.forEach((v) => {
    maxSameColumnCount = Math.max(maxSameColumnCount, v);
  });

  const geometry: CalifacilOmrScanGeometry = templateGridOnly
    ? buildAnswerSheetOmrGeometry(rows, cols, width, height)
    : { imageWidth: width, imageHeight: height, cells };

  return {
    picks: out,
    resolvedCount,
    confidenceSum,
    rows: rowMetas,
    clarityStripGapSum,
    maxSameColumnCount,
    hasDetectedRowLines,
    hasDetectedColumnEdges,
    geometry,
  };
}

function estimateBottomBandInk(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  const w = canvas.width;
  const h = canvas.height;
  const y0 = Math.max(0, Math.floor(h * (1 - CALIFACIL_OMR_SCAN.bottomBandRatio)));
  const hh = Math.max(1, h - y0);
  const id = ctx.getImageData(0, y0, w, hh);
  const d = id.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    sum += 1 - lum;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * @param columns — Número de columnas de burbujas impresas (2–5)
 * @returns Una entrada por fila impresa: índice de columna elegida (0 = A) o null
 */
export function scanCalifacilOmrSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number,
  opts?: CalifacilScanOptions
): (number | null)[] {
  const rowCount = clampCalifacilOmrRowCount(opts?.rowCount);
  if (typeof document === 'undefined') return Array(rowCount).fill(null);
  let canvas = drawSourceToCanvas(source);
  if (!canvas) return Array(rowCount).fill(null);
  if (!opts?.skipGuideCrop) {
    const cropped = cropCanvasToCalifacilGuideOverlay(canvas);
    if (cropped) canvas = cropped;
  }

  const thresholds: ScanThresholds = {
    minMarkDarkness: CALIFACIL_OMR_SCAN.minMarkDarkness,
    minBestVsSecondGap: CALIFACIL_OMR_SCAN.minBestVsSecondGap,
    minBestVsSecondRatio: CALIFACIL_OMR_SCAN.minBestVsSecondRatio,
    minCenterVsRingDelta: CALIFACIL_OMR_SCAN.minCenterVsRingDelta,
    minSolidCenterDarkness: CALIFACIL_OMR_SCAN.minSolidCenterDarkness,
    ringDarknessWeight: CALIFACIL_OMR_SCAN.ringDarknessWeight,
  };
  const templateGridOnly = Boolean(opts?.answerSheetTemplateOnly);

  const fullSheetProfile: OmrGeometryProfile = {
    bottomBandRatio: CALIFACIL_OMR_SCAN.bottomBandRatio,
    titleStripRatioOfBand: CALIFACIL_OMR_SCAN.titleStripRatioOfBand,
    qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
  };
  const croppedBoxProfiles: OmrGeometryProfile[] = [
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.12, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.05, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
  ];

  const corrected = opts?.preserveInputCanvas ? canvas : applyPerspectiveCorrection(canvas);
  const variants = opts?.preserveInputCanvas
    ? buildPreservedInputVariants(canvas)
    : buildOmrScanCanvasVariants(canvas, corrected);

  const emptyRows: OmrScanRowDetail[] = Array.from({ length: rowCount }, () => ({
    pick: null,
    ambiguous: false,
    inkFractions: [],
  }));
  let best: ScanDetailedResult = {
    picks: Array(rowCount).fill(null),
    resolvedCount: 0,
    confidenceSum: Number.NEGATIVE_INFINITY,
    rows: emptyRows,
    clarityStripGapSum: 0,
    maxSameColumnCount: 0,
    hasDetectedRowLines: false,
    hasDetectedColumnEdges: false,
    geometry: null,
  };
  let bestSweepScore = Number.NEGATIVE_INFINITY;

  const qnumSweep =
    opts?.qnumSweep === 'live' ? QNUM_WIDTH_SWEEP_LIVE : QNUM_WIDTH_SWEEP;
  const colSweep =
    opts?.columnShiftSweep === 'live' ? COLUMN_SHIFT_PX_LIVE : COLUMN_SHIFT_PX_SWEEP;
  const geometryMode = opts?.geometryMode ?? 'auto';
  const fullSheetSweepProfiles: OmrGeometryProfile[] = [
    { bottomBandRatio: 0.32, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 0.36, titleStripRatioOfBand: 0.19, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    fullSheetProfile,
  ];
  const fullSheetQnumSweep = [0.085, 0.1, 0.115, 0.13, 0.15] as const;
  const fullSheetColSweep = [-80, -50, -25, 0, 25, 50, 80] as const;
  const selectedVariants =
    opts?.preserveInputCanvas
      ? variants
      : geometryMode === 'fullSheet'
      ? [{ canvas: corrected, preferFullSheetFirst: true }]
      : variants;
  const strictFixedTemplateMode =
    Boolean(opts?.answerSheetTemplateOnly) ||
    (geometryMode === 'fullSheet' && Boolean(opts?.fixedTemplateAnchor));
  const fixedTemplateShifts = strictFixedTemplateMode
    ? templateGridOnly
      ? ([0] as const)
      : ([-10, -6, -3, 0, 3, 6, 10] as const)
    : ([-16, -8, 0, 8, 16] as const);

  for (const { canvas: c, preferFullSheetFirst } of selectedVariants) {
    const fixedTemplates = strictFixedTemplateMode
      ? resolveFixedTemplateCandidates(c, opts, rowCount)
      : [];
    if (fixedTemplates.length > 0) {
      for (const fixedTemplate of fixedTemplates) {
        for (const colShift of fixedTemplateShifts) {
          const detail = scanCalifacilOmrCanvasDetailedWithProfile(
            c,
            columns,
            thresholds,
            fullSheetProfile,
            colShift,
            fixedTemplate,
            rowCount,
            templateGridOnly
          );
          const fixedBonus = templateGridOnly
            ? 480
            : detail.hasDetectedRowLines
              ? 260 + (opts?.answerSheetTemplateOnly ? 140 : 0)
              : opts?.answerSheetTemplateOnly
                ? -340
                : 40;
          const detailScore = omrSweepCandidateScore(detail) + fixedBonus;
          if (detailScore > bestSweepScore) {
            best = detail;
            bestSweepScore = detailScore;
          }
        }
      }
      if (strictFixedTemplateMode) continue;
    }
    const likelyFullSheet = geometryMode === 'auto' ? isLikelyFullSheetPhoto(c) : geometryMode === 'fullSheet';
    const orderedProfiles =
      geometryMode === 'fullSheet'
        ? fullSheetSweepProfiles
        : geometryMode === 'croppedBox'
          ? [...croppedBoxProfiles]
          : preferFullSheetFirst || likelyFullSheet
            ? [fullSheetProfile, ...croppedBoxProfiles]
            : [...croppedBoxProfiles, fullSheetProfile];
    const qSweep = geometryMode === 'fullSheet' ? fullSheetQnumSweep : qnumSweep;
    const cSweep = geometryMode === 'fullSheet' ? fullSheetColSweep : colSweep;
    for (const profile of orderedProfiles) {
      const profilePrior =
        likelyFullSheet && profile.bottomBandRatio >= 0.99
          ? -260
          : !likelyFullSheet && profile.bottomBandRatio < 0.95
            ? -95
            : profile.bottomBandRatio < 0.95
              ? 18
              : 0;
      for (const qnw of qSweep) {
        for (const colShift of cSweep) {
          const profileQ: OmrGeometryProfile = { ...profile, qnumWidthRatio: qnw };
          const detail = scanCalifacilOmrCanvasDetailedWithProfile(
            c,
            columns,
            thresholds,
            profileQ,
            colShift,
            undefined,
            rowCount
          );
          const detailScore = omrSweepCandidateScore(detail) + profilePrior;
          if (detailScore > bestSweepScore) {
            best = detail;
            bestSweepScore = detailScore;
          }
        }
      }
    }
  }

  return best.picks;
}

/**
 * Lectura OMR rápida en hoja ya enderezada (p. ej. 850×1100) para vista previa móvil.
 * Evita el barrido pesado de {@link scanCalifacilOmrSheetWithMeta}.
 */
export function scanWarpedMobileAnswerSheetFast(
  warped: HTMLCanvasElement,
  columns: number,
  rowCount?: number
): OmrScanMetaResult {
  const rows = clampCalifacilOmrRowCount(rowCount);
  const emptyRows = (): OmrScanRowDetail[] =>
    Array.from({ length: rows }, () => ({ pick: null, ambiguous: false, inkFractions: [] }));
  if (typeof document === 'undefined' || warped.width < 40 || warped.height < 40) {
    return {
      picks: Array(rows).fill(null),
      rows: emptyRows(),
      needsVisionAssist: false,
      maxSameColumnCount: 0,
      geometry: null,
      reviewSourceCanvas: null,
      controlNumberDigits: [],
      controlNumber: null,
    };
  }
  let geometry = buildRegisteredAnswerSheetGeometry(warped, rows, columns);
  const gridValidation = validateAnswerSheetGeometry(geometry, rows);
  if (!gridValidation.ok) {
    geometry = buildAnswerSheetOmrGeometry(rows, columns, warped.width, warped.height);
  }
  const thresholds: ScanThresholds = {
    minMarkDarkness: 0.072,
    minBestVsSecondGap: 0.038,
    minBestVsSecondRatio: 1.35,
    minCenterVsRingDelta: 0.04,
    minSolidCenterDarkness: 0.24,
    ringDarknessWeight: CALIFACIL_OMR_SCAN.ringDarknessWeight,
  };
  const templateRead = readAnswerSheetPicksFromTemplateGeometry(
    warped,
    geometry,
    thresholds,
    rows,
    columns
  );
  return {
    picks: templateRead.picks,
    rows: templateRead.rows,
    needsVisionAssist: false,
    maxSameColumnCount: templateRead.maxSameColumnCount,
    geometry,
    reviewSourceCanvas: warped,
    controlNumberDigits: [],
    controlNumber: null,
  };
}

/** Reduce un canvas para lectura OMR móvil sin bloquear el hilo principal tanto tiempo. */
export function downscaleCanvasForOmrScan(
  source: HTMLCanvasElement,
  maxSide = 960
): HTMLCanvasElement {
  return drawSourceToCanvas(source, maxSide) ?? source;
}

/** JPEG en data URL para vista previa móvil (síncrono, tamaño acotado). */
export function canvasPreviewDataUrl(
  source: HTMLCanvasElement,
  maxSide = 1200,
  quality = 0.85
): string | null {
  const scaled = drawSourceToCanvas(source, maxSide);
  if (!scaled) return null;
  try {
    return scaled.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

/**
 * Igual que {@link scanCalifacilOmrSheet} pero expone filas, fracción de tinta y si conviene asistencia por visión.
 */
export function scanCalifacilOmrSheetWithMeta(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number,
  opts?: CalifacilScanOptions
): OmrScanMetaResult {
  const rowCount = clampCalifacilOmrRowCount(opts?.rowCount);
  const emptyMetaRows = () =>
    Array.from({ length: rowCount }, () => ({ pick: null, ambiguous: false, inkFractions: [] }));
  if (typeof document === 'undefined') {
    return {
      picks: Array(rowCount).fill(null),
      rows: emptyMetaRows(),
      needsVisionAssist: false,
      maxSameColumnCount: 0,
      geometry: null,
      reviewSourceCanvas: null,
      controlNumberDigits: [],
      controlNumber: null,
    };
  }
  let canvas =
    opts?.preserveInputCanvas && source instanceof HTMLCanvasElement
      ? source
      : drawSourceToCanvas(source);
  if (!canvas) {
    return {
      picks: Array(rowCount).fill(null),
      rows: emptyMetaRows(),
      needsVisionAssist: false,
      maxSameColumnCount: 0,
      geometry: null,
      reviewSourceCanvas: null,
      controlNumberDigits: [],
      controlNumber: null,
    };
  }
  if (!opts?.skipGuideCrop) {
    const cropped = cropCanvasToCalifacilGuideOverlay(canvas);
    if (cropped) canvas = cropped;
  }

  const templateGridOnly = Boolean(opts?.answerSheetTemplateOnly);
  const thresholds: ScanThresholds = templateGridOnly
    ? {
        minMarkDarkness: 0.072,
        minBestVsSecondGap: 0.038,
        minBestVsSecondRatio: 1.35,
        minCenterVsRingDelta: 0.04,
        minSolidCenterDarkness: 0.24,
        ringDarknessWeight: CALIFACIL_OMR_SCAN.ringDarknessWeight,
      }
    : {
        minMarkDarkness: CALIFACIL_OMR_SCAN.minMarkDarkness,
        minBestVsSecondGap: CALIFACIL_OMR_SCAN.minBestVsSecondGap,
        minBestVsSecondRatio: CALIFACIL_OMR_SCAN.minBestVsSecondRatio,
        minCenterVsRingDelta: CALIFACIL_OMR_SCAN.minCenterVsRingDelta,
        minSolidCenterDarkness: CALIFACIL_OMR_SCAN.minSolidCenterDarkness,
        ringDarknessWeight: CALIFACIL_OMR_SCAN.ringDarknessWeight,
      };

  const fullSheetProfile: OmrGeometryProfile = {
    bottomBandRatio: CALIFACIL_OMR_SCAN.bottomBandRatio,
    titleStripRatioOfBand: CALIFACIL_OMR_SCAN.titleStripRatioOfBand,
    qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio,
  };
  const croppedBoxProfiles: OmrGeometryProfile[] = [
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.12, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 1, titleStripRatioOfBand: 0.05, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
  ];

  const corrected = opts?.preserveInputCanvas ? canvas : applyPerspectiveCorrection(canvas);
  const variants = opts?.preserveInputCanvas
    ? templateGridOnly
      ? [{ canvas, preferFullSheetFirst: true }]
      : buildPreservedInputVariants(canvas)
    : buildOmrScanCanvasVariants(canvas, corrected);

  const emptyRows: OmrScanRowDetail[] = Array.from({ length: rowCount }, () => ({
    pick: null,
    ambiguous: false,
    inkFractions: [],
  }));
  let best: ScanDetailedResult = {
    picks: Array(rowCount).fill(null),
    resolvedCount: 0,
    confidenceSum: Number.NEGATIVE_INFINITY,
    rows: emptyRows,
    clarityStripGapSum: 0,
    maxSameColumnCount: 0,
    hasDetectedRowLines: false,
    hasDetectedColumnEdges: false,
    geometry: null,
  };
  let bestSweepScore = Number.NEGATIVE_INFINITY;
  /** Canvas de la variante que produjo `best`; debe ser la misma imagen que la vista previa con overlay. */
  let bestReviewCanvas: HTMLCanvasElement | null = null;
  let bestColShift = 0;
  let bestFixedTemplate: OmrFixedTemplate | undefined;

  const qnumSweep =
    opts?.qnumSweep === 'live' ? QNUM_WIDTH_SWEEP_LIVE : QNUM_WIDTH_SWEEP;
  const colSweep =
    opts?.columnShiftSweep === 'live' ? COLUMN_SHIFT_PX_LIVE : COLUMN_SHIFT_PX_SWEEP;
  const geometryMode = opts?.geometryMode ?? 'auto';
  const fullSheetSweepProfiles: OmrGeometryProfile[] = [
    { bottomBandRatio: 0.32, titleStripRatioOfBand: 0.18, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    { bottomBandRatio: 0.36, titleStripRatioOfBand: 0.19, qnumWidthRatio: CALIFACIL_OMR_SCAN.qnumWidthRatio },
    fullSheetProfile,
  ];
  const fullSheetQnumSweep = [0.085, 0.1, 0.115, 0.13, 0.15] as const;
  const fullSheetColSweep = [-80, -50, -25, 0, 25, 50, 80] as const;
  const selectedVariants =
    opts?.preserveInputCanvas
      ? variants
      : geometryMode === 'fullSheet'
      ? [{ canvas: corrected, preferFullSheetFirst: true }]
      : variants;
  const strictFixedTemplateMode =
    Boolean(opts?.answerSheetTemplateOnly) ||
    (geometryMode === 'fullSheet' && Boolean(opts?.fixedTemplateAnchor));
  const fixedTemplateShifts = strictFixedTemplateMode
    ? templateGridOnly
      ? ([0] as const)
      : ([-10, -6, -3, 0, 3, 6, 10] as const)
    : ([-16, -8, 0, 8, 16] as const);

  for (const { canvas: c, preferFullSheetFirst } of selectedVariants) {
    const fixedTemplates = strictFixedTemplateMode
      ? resolveFixedTemplateCandidates(c, opts, rowCount)
      : [];
    if (fixedTemplates.length > 0) {
      for (const fixedTemplate of fixedTemplates) {
        for (const colShift of fixedTemplateShifts) {
          const detail = scanCalifacilOmrCanvasDetailedWithProfile(
            c,
            columns,
            thresholds,
            fullSheetProfile,
            colShift,
            fixedTemplate,
            rowCount,
            templateGridOnly
          );
          const fixedBonus = templateGridOnly
            ? 480
            : detail.hasDetectedRowLines
              ? 260 + (opts?.answerSheetTemplateOnly ? 140 : 0)
              : opts?.answerSheetTemplateOnly
                ? -340
                : 40;
          const detailScore =
            omrSweepCandidateScore(detail) +
            fixedBonus +
            (templateGridOnly && c === canvas ? 220 : 0);
          if (detailScore > bestSweepScore) {
            best = detail;
            bestReviewCanvas = c;
            bestColShift = colShift;
            bestFixedTemplate = fixedTemplate;
            bestSweepScore = detailScore;
          }
        }
      }
      if (strictFixedTemplateMode) continue;
    }
    const likelyFullSheet = geometryMode === 'auto' ? isLikelyFullSheetPhoto(c) : geometryMode === 'fullSheet';
    const orderedProfiles =
      geometryMode === 'fullSheet'
        ? fullSheetSweepProfiles
        : geometryMode === 'croppedBox'
          ? [...croppedBoxProfiles]
          : preferFullSheetFirst || likelyFullSheet
            ? [fullSheetProfile, ...croppedBoxProfiles]
            : [...croppedBoxProfiles, fullSheetProfile];
    const qSweep = geometryMode === 'fullSheet' ? fullSheetQnumSweep : qnumSweep;
    const cSweep = geometryMode === 'fullSheet' ? fullSheetColSweep : colSweep;
    for (const profile of orderedProfiles) {
      const profilePrior =
        likelyFullSheet && profile.bottomBandRatio >= 0.99
          ? -260
          : !likelyFullSheet && profile.bottomBandRatio < 0.95
            ? -95
            : profile.bottomBandRatio < 0.95
              ? 18
              : 0;
      for (const qnw of qSweep) {
        for (const colShift of cSweep) {
          const profileQ: OmrGeometryProfile = { ...profile, qnumWidthRatio: qnw };
          const detail = scanCalifacilOmrCanvasDetailedWithProfile(
            c,
            columns,
            thresholds,
            profileQ,
            colShift,
            undefined,
            rowCount
          );
          const detailScore = omrSweepCandidateScore(detail) + profilePrior;
          if (detailScore > bestSweepScore) {
            best = detail;
            bestReviewCanvas = c;
            bestSweepScore = detailScore;
          }
        }
      }
    }
  }

  const needsVisionAssist = best.rows.some((r) => r.ambiguous);

  /** La vista previa usa la foto enderezada (no la variante CLAHE del barrido OMR). */
  const reviewCanvas =
    templateGridOnly || opts?.preserveInputCanvas
      ? (prepareAnswerSheetDisplayCanvas(canvas) ?? canvas)
      : (bestReviewCanvas ?? canvas);

  if (templateGridOnly) {
    let geometry = buildRegisteredAnswerSheetGeometry(
      reviewCanvas,
      rowCount,
      columns
    );
    const gridValidation = validateAnswerSheetGeometry(geometry, rowCount);
    if (!gridValidation.ok) {
      geometry = buildAnswerSheetOmrGeometry(
        rowCount,
        columns,
        reviewCanvas.width,
        reviewCanvas.height
      );
    }
    const templateRead = readAnswerSheetPicksFromTemplateGeometry(
      reviewCanvas,
      geometry,
      thresholds,
      rowCount,
      columns
    );
    best = {
      ...best,
      picks: templateRead.picks,
      rows: templateRead.rows,
      resolvedCount: templateRead.resolvedCount,
      confidenceSum: templateRead.confidenceSum,
      maxSameColumnCount: templateRead.maxSameColumnCount,
      geometry,
    };
  }

  const controlRead = readAnswerSheetControlNumberFromCanvas(reviewCanvas, rowCount, thresholds);

  return {
    picks: best.picks,
    rows: best.rows,
    needsVisionAssist,
    maxSameColumnCount: best.maxSameColumnCount,
    geometry: best.geometry,
    reviewSourceCanvas: reviewCanvas,
    warpAlignment: opts?.includeWarpAlignment
      ? measureWarpedFiducialAlignment(canvas)
      : undefined,
    controlNumberDigits: controlRead.digits,
    controlNumber: controlRead.controlNumber,
  };
}

/**
 * Auto-orienta la foto para que la banda CaliFacil quede en la posición esperada.
 * Prueba 0/90/180/270 y se queda con la orientación con mayor evidencia de marcas válidas.
 */
export function autoOrientCalifacilSheet(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number,
  opts?: AutoOrientCalifacilSheetOptions
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const base = prepareCalifacilScanInput(source, opts);
  if (!base) return null;

  const candidates: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  let bestCanvas: HTMLCanvasElement = base;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestCardinal: 0 | 90 | 180 | 270 = 0;

  for (const angle of candidates) {
    const rotated = rotateCanvas(base, angle);
    const detail = scanCalifacilOmrCanvasDetailed(rotated, columns, {
      minMarkDarkness: 0.04,
      minBestVsSecondGap: 0.02,
    });
    const bandInk = estimateBottomBandInk(rotated);
    const score =
      bandInk * 2000 +
      detail.resolvedCount * 100 +
      detail.confidenceSum * 10 +
      detail.clarityStripGapSum * 40;
    if (score > bestScore) {
      bestScore = score;
      bestCanvas = rotated;
      bestCardinal = angle;
    }
  }

  /** Base ya en 0/90/180/270; todo giro fino se aplica sobre esta copia (no encadenado). */
  const cardinalBest = bestCanvas;

  const scoreTilted = (tilted: HTMLCanvasElement) => {
    const detail = scanCalifacilOmrCanvasDetailed(tilted, columns, {
      minMarkDarkness: 0.04,
      minBestVsSecondGap: 0.02,
    });
    const bandInk = estimateBottomBandInk(tilted);
    return (
      bandInk * 2000 +
      detail.resolvedCount * 100 +
      detail.confidenceSum * 10 +
      detail.clarityStripGapSum * 40
    );
  };

  if (opts?.allowTiltSweep !== false) {
    // Inclinaciones fuertes (p. ej. ~45°): el barrido anterior ±38° dejaba la hoja torcida y la rejilla desfasada.
    // Paso grueso 3° hasta ±60° y luego afinación de 1° (con paso 3° el óptimo puede quedar a ±1.5° del mejor).
    let bestDeltaDeg = 0;
    for (let delta = -60; delta <= 60; delta += 3) {
      if (delta === 0) continue;
      const tilted = rotateCanvasByDegrees(cardinalBest, delta);
      const score = scoreTilted(tilted);
      if (score > bestScore) {
        bestScore = score;
        bestCanvas = tilted;
        bestDeltaDeg = delta;
      }
    }

    for (let fine = -5; fine <= 5; fine++) {
      if (fine === 0) continue;
      const total = bestDeltaDeg + fine;
      if (total < -65 || total > 65) continue;
      const tilted = rotateCanvasByDegrees(cardinalBest, total);
      const score = scoreTilted(tilted);
      if (score > bestScore) {
        bestScore = score;
        bestCanvas = tilted;
        bestDeltaDeg = total;
      }
    }
  }

  let deskewed = applyPerspectiveCorrection(bestCanvas);

  /** Tras el warp, a veces queda 2–8° de sesgo residual; un barrido corto encaja la rejilla con la tabla. */
  let bestPostScore = scoreTilted(deskewed);
  for (let post = -10; post <= 10; post += 2) {
    if (post === 0) continue;
    const t = rotateCanvasByDegrees(deskewed, post);
    const sc = scoreTilted(t);
    if (sc > bestPostScore) {
      bestPostScore = sc;
      deskewed = t;
    }
  }

  // Evita variable no usada cuando el compilador endurece reglas.
  void bestCardinal;
  return deskewed;
}

/** JPEG en data URL para enviar a la API de visión (desde imagen o canvas). */
export function califacilImageToJpegDataUrl(
  source: HTMLImageElement | HTMLCanvasElement,
  quality = 0.88
): string {
  if (typeof document === 'undefined') return '';
  if (source instanceof HTMLCanvasElement) {
    return source.toDataURL('image/jpeg', quality);
  }
  const c = document.createElement('canvas');
  c.width = source.naturalWidth || source.width;
  c.height = source.naturalHeight || source.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  ctx.drawImage(source, 0, 0);
  return c.toDataURL('image/jpeg', quality);
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

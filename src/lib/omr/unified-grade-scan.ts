import {
  scanCalifacilDesktopGradeDocument,
  scanCalifacilDesktopGradeDocumentAsync,
  scanWarpedGradeDocument,
  scanWarpedGradeDocumentAsync,
  scanCalifacilOmrSheetWithMeta,
  syncCalifacilOmrGeometryImageSize,
  attachAnswerSheetReviewBubbleOverlay,
  sanitizeAnswerSheetOmrMeta,
  downscaleCanvasForOmrScan,
  isAnswerSheetOmrMostlyBlank,
  type CalifacilScanOptions,
  type OmrScanMetaResult,
} from '@/lib/omrScan';
import {
  isUnifiedOmrEngineEnabled,
  runUnifiedOmrPipeline,
  unifiedResultToMeta,
  runStripFallbackFast,
} from '@/lib/omr/engine';

const OMR_GRADE_SCAN_MAX_SIDE = 1100;
const OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE = 1600;

/** Presupuesto móvil: un pase rápido (~70 iters). Sin recovery 160. */
const MOBILE_FAST_OPTIMIZE_ITERS = 70;
const MOBILE_FAST_STAGNANT = 10;

function gradeScanCanvas(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  return downscaleCanvasForOmrScan(canvas, maxSide) ?? canvas;
}

function countResolvedPicks(meta: OmrScanMetaResult, rows: number): number {
  return meta.picks.slice(0, rows).filter((p) => p != null).length;
}

/** Lectura débil: pocos picks, blank falso o sesgo de columna. */
export function isWeakMobileOmrMeta(meta: OmrScanMetaResult, rows: number): boolean {
  const resolved = countResolvedPicks(meta, rows);
  if (resolved < Math.ceil(rows * 0.45)) return true;
  if (isAnswerSheetOmrMostlyBlank(meta, rows) && resolved < 3) return true;
  if (meta.maxSameColumnCount > Math.max(4, Math.round(rows * 0.35))) return true;
  return false;
}

/** Lectura suficientemente buena para confiar en readingOverride (sin re-pipeline). */
export function isStrongMobileOmrMeta(meta: OmrScanMetaResult, rows: number): boolean {
  const resolved = countResolvedPicks(meta, rows);
  if (resolved < Math.ceil(rows * 0.55)) return false;
  if (isAnswerSheetOmrMostlyBlank(meta, rows) && resolved < 3) return false;
  if (meta.maxSameColumnCount > Math.max(4, Math.round(rows * 0.4))) return false;
  return true;
}

function finalizeUnifiedDisplayMeta(
  displayCanvas: HTMLCanvasElement,
  meta: OmrScanMetaResult,
  rows: number,
  columns: number,
  opts?: { skipBubbleReattach?: boolean }
): OmrScanMetaResult {
  const geometry = meta.geometry
    ? syncCalifacilOmrGeometryImageSize(
        meta.geometry,
        displayCanvas.width,
        displayCanvas.height
      )
    : null;
  const hasSaneEngineBubbles =
    !!geometry?.bubbles &&
    geometry.bubbles.length >= rows &&
    geometry.bubbles.some((row) =>
      row?.some((b) => Number.isFinite(b.r) && b.r > 0.002 && b.r < 0.06)
    );

  // Móvil: reutilizar bubbles sanos; si r/cx basura → re-anclar en display.
  if (opts?.skipBubbleReattach && hasSaneEngineBubbles) {
    return {
      ...meta,
      geometry,
      reviewSourceCanvas: displayCanvas,
    };
  }

  const withOverlay = attachAnswerSheetReviewBubbleOverlay(
    displayCanvas,
    { ...meta, geometry },
    columns,
    rows
  );
  return {
    ...withOverlay,
    geometry: withOverlay.geometry,
    reviewSourceCanvas: displayCanvas,
  };
}

function pickBetterOmrMeta(
  a: OmrScanMetaResult,
  b: OmrScanMetaResult,
  rows: number
): OmrScanMetaResult {
  const ra = countResolvedPicks(a, rows);
  const rb = countResolvedPicks(b, rows);
  if (rb !== ra) return rb > ra ? b : a;
  // Preferir menos sesgo de columna.
  if (b.maxSameColumnCount !== a.maxSameColumnCount) {
    return b.maxSameColumnCount < a.maxSameColumnCount ? b : a;
  }
  return a;
}

export function scanDesktopGradeUnifiedOrLegacy(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): OmrScanMetaResult {
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE);
  if (isUnifiedOmrEngineEnabled()) {
    const unified = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
      fastMode: false,
      maxOptimizeIterations: 320,
      requireFullOptimize: true,
    });
    return finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(unified), rows, columns);
  }
  return scanCalifacilDesktopGradeDocument(displayCanvas, columns, rows);
}

export async function scanDesktopGradeUnifiedOrLegacyAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): Promise<OmrScanMetaResult> {
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE);
  if (isUnifiedOmrEngineEnabled()) {
    const unified = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
      fastMode: false,
      maxOptimizeIterations: 320,
      requireFullOptimize: true,
    });
    return finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(unified), rows, columns);
  }
  return scanCalifacilDesktopGradeDocumentAsync(displayCanvas, columns, rows);
}

export function scanWarpedGradeUnifiedOrLegacy(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): OmrScanMetaResult {
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_GRADE_SCAN_MAX_SIDE);
  if (isUnifiedOmrEngineEnabled()) {
    const unified = runUnifiedOmrPipeline(scanCanvas, columns, rows, { fastMode: false });
    return finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(unified), rows, columns);
  }
  return scanWarpedGradeDocument(displayCanvas, columns, rows);
}

export async function scanWarpedGradeUnifiedOrLegacyAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): Promise<OmrScanMetaResult> {
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_GRADE_SCAN_MAX_SIDE);
  if (isUnifiedOmrEngineEnabled()) {
    const unified = runUnifiedOmrPipeline(scanCanvas, columns, rows, { fastMode: false });
    return finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(unified), rows, columns);
  }
  return scanWarpedGradeDocumentAsync(displayCanvas, columns, rows);
}

/**
 * Perfil móvil: ~70 iters + strip fast solo si la lectura es débil.
 * Sin segundo pase de 160 iters (evita «Calificando…» eterno).
 * Clave del examen (expectedPicks) se aplica en el popup, no aquí.
 */
export async function scanWarpedGradeMobileAsync(
  displayCanvas: HTMLCanvasElement,
  columns: number,
  rows: number
): Promise<OmrScanMetaResult> {
  const scanCanvas = gradeScanCanvas(displayCanvas, OMR_GRADE_SCAN_MAX_SIDE);
  if (!isUnifiedOmrEngineEnabled()) {
    return scanWarpedGradeDocumentAsync(displayCanvas, columns, rows);
  }

  const unified = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
    fastMode: true,
    maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
    stagnantLimit: MOBILE_FAST_STAGNANT,
  });
  let meta = finalizeUnifiedDisplayMeta(
    displayCanvas,
    unifiedResultToMeta(unified),
    rows,
    columns,
    { skipBubbleReattach: false }
  );
  meta = sanitizeAnswerSheetOmrMeta(meta, rows);

  if (!isWeakMobileOmrMeta(meta, rows)) {
    return meta;
  }

  // Recovery barato: solo strip live sweeps (sin optimize 160).
  const stripRaw = runStripFallbackFast(displayCanvas, columns, rows);
  let stripMeta = finalizeUnifiedDisplayMeta(displayCanvas, stripRaw, rows, columns, {
    skipBubbleReattach: false,
  });
  stripMeta = sanitizeAnswerSheetOmrMeta(stripMeta, rows);
  return pickBetterOmrMeta(meta, stripMeta, rows);
}

export function scanLiveOmrUnifiedOrLegacy(
  source: HTMLImageElement | HTMLCanvasElement,
  columns: number,
  opts?: CalifacilScanOptions
): OmrScanMetaResult {
  if (isUnifiedOmrEngineEnabled() && opts?.preserveInputCanvas && source instanceof HTMLCanvasElement) {
    const rows = opts.rowCount ?? 30;
    const unified = runUnifiedOmrPipeline(source, columns, rows, { fastMode: true });
    return sanitizeAnswerSheetOmrMeta(
      { ...unifiedResultToMeta(unified), reviewSourceCanvas: source },
      rows
    );
  }
  return scanCalifacilOmrSheetWithMeta(source, columns, opts);
}

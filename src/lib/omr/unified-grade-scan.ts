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
  type CalifacilScanOptions,
  type OmrScanMetaResult,
} from '@/lib/omrScan';
import {
  isUnifiedOmrEngineEnabled,
  runUnifiedOmrPipeline,
  unifiedResultToMeta,
} from '@/lib/omr/engine';

const OMR_GRADE_SCAN_MAX_SIDE = 1100;
const OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE = 1600;

function gradeScanCanvas(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  return downscaleCanvasForOmrScan(canvas, maxSide) ?? canvas;
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

const MOBILE_FAST_OPTIMIZE_ITERS = 40;

/**
 * Perfil móvil: 40 iters, stagnant 8. Sin escalate ni strip full.
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
    stagnantLimit: 8,
  });
  let meta = finalizeUnifiedDisplayMeta(
    displayCanvas,
    unifiedResultToMeta(unified),
    rows,
    columns,
    { skipBubbleReattach: false }
  );
  meta = sanitizeAnswerSheetOmrMeta(meta, rows);
  return meta;
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

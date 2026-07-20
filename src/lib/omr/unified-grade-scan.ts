import {
  scanCalifacilDesktopGradeDocument,
  scanCalifacilDesktopGradeDocumentAsync,
  scanWarpedGradeDocument,
  scanWarpedGradeDocumentAsync,
  scanCalifacilOmrSheetWithMeta,
  syncCalifacilOmrGeometryImageSize,
  attachAnswerSheetReviewBubbleOverlay,
  sanitizeAnswerSheetOmrMeta,
  isAnswerSheetOmrMostlyBlank,
  downscaleCanvasForOmrScan,
  type CalifacilScanOptions,
  type OmrScanMetaResult,
} from '@/lib/omrScan';
import {
  isUnifiedOmrEngineEnabled,
  runUnifiedOmrPipeline,
  unifiedResultToMeta,
} from '@/lib/omr/engine';

const OMR_GRADE_SCAN_MAX_SIDE = 1280;
const OMR_DESKTOP_DOCUMENT_SCAN_MAX_SIDE = 1600;

function gradeScanCanvas(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  return downscaleCanvasForOmrScan(canvas, maxSide) ?? canvas;
}

function finalizeUnifiedDisplayMeta(
  displayCanvas: HTMLCanvasElement,
  meta: OmrScanMetaResult,
  rows: number,
  columns: number
): OmrScanMetaResult {
  const geometry = meta.geometry
    ? syncCalifacilOmrGeometryImageSize(
        meta.geometry,
        displayCanvas.width,
        displayCanvas.height
      )
    : null;
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

const MOBILE_FAST_OPTIMIZE_ITERS = 80;
/** Escalate solo en banda útil: ni casi vacío ni casi perfecto. */
const MOBILE_ESCALATE_MIN_RATIO = 0.4;
const MOBILE_ESCALATE_MAX_RATIO = 0.9;

function countResolvedPicks(meta: OmrScanMetaResult): number {
  return meta.picks.filter((p) => p != null).length;
}

/**
 * Perfil móvil: una pasada fastMode; escalate solo si hay lecturas parciales útiles.
 * Hojas en blanco / casi vacías no hacen 2ª pasada (más rápido + menos FPs).
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

  let unified = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
    fastMode: true,
    maxOptimizeIterations: MOBILE_FAST_OPTIMIZE_ITERS,
  });
  let meta = finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(unified), rows, columns);
  meta = sanitizeAnswerSheetOmrMeta(meta, rows);

  const resolved = countResolvedPicks(meta);
  const ratio = rows > 0 ? resolved / rows : 0;
  const mostlyBlank = isAnswerSheetOmrMostlyBlank(meta, rows);
  const needEscalate =
    rows > 0 &&
    !mostlyBlank &&
    ratio >= MOBILE_ESCALATE_MIN_RATIO &&
    ratio <= MOBILE_ESCALATE_MAX_RATIO;

  if (needEscalate) {
    unified = runUnifiedOmrPipeline(scanCanvas, columns, rows, {
      fastMode: false,
      maxOptimizeIterations: 320,
    });
    meta = finalizeUnifiedDisplayMeta(displayCanvas, unifiedResultToMeta(unified), rows, columns);
    meta = sanitizeAnswerSheetOmrMeta(meta, rows);
  }
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

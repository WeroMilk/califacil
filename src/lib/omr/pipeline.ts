import { preprocessForSheetDetection } from '@/lib/omr/preprocess';
import { prepareReferenceGradeCanvas } from '@/lib/omr/reference-grade';
import type { WarpAlignmentReport } from '@/lib/omrScan';
import {
  MAX_WARP_ALIGNMENT_ERROR_PX,
  autoOrientCalifacilSheet,
  captureImageFullFrame,
  countCalifacilCornerMarkers,
  detectAnswerSheetQuadViaAlignStrips,
  detectCalifacilSheetCornerQuadRobust,
  isCalifacilExamSheetLikely,
  isCalifacilWarpedLetterCanvas,
  hasCalifacilAlignStrips,
  isMobileWarpedAnswerSheetAcceptable,
  isMobileWarpedAnswerSheetReady,
  mapRoiQuadToFrame,
  measureWarpedFiducialAlignment,
  prepareMobileGradeDocumentCanvas,
  refineWarpedCalifacilSheet,
  scaleCanvasToMaxSide,
  scaleQuadToCanvas,
  warpAndValidateCalifacilSheet,
  warpCalifacilSheetFromCornerMarkers,
  type MobileGuideRoiCapture,
  type Point,
} from '@/lib/omrScan';

/** Misma resolución que el PDF rasterizado en calificar (referencia visual + OMR). */
export const CALIFACIL_GRADE_DOCUMENT_MAX_SIDE = 1600;

export type NormalizeGradeDocumentResult = {
  canvas: HTMLCanvasElement;
  alignment: WarpAlignmentReport | null;
  /** true si se enderezó o reorientó respecto al original */
  normalized: boolean;
};

export type RoiQuad = [Point, Point, Point, Point];

export type MobileWarpPipelineResult = {
  warped: HTMLCanvasElement | null;
  alignment: WarpAlignmentReport | null;
  /** Origen del cuadrilátero ganador (diagnóstico). */
  source: 'roi' | 'full_res' | 'corner_markers' | 'strips' | 'none';
};

function alignmentScore(alignment: WarpAlignmentReport | null): number {
  if (!alignment) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(alignment.maxErrorPx)) return Number.POSITIVE_INFINITY;
  return alignment.maxErrorPx;
}

function warpCandidateScore(
  warped: HTMLCanvasElement | null,
  alignment: WarpAlignmentReport | null
): number {
  if (!warped || !isCalifacilWarpedLetterCanvas(warped)) return Number.POSITIVE_INFINITY;
  const corners = countCalifacilCornerMarkers(warped);
  const align = alignmentScore(alignment);
  if (corners < 2) return align + 400;
  if (!isMobileWarpedAnswerSheetAcceptable(warped)) return align + 120;
  return align - corners * 3;
}

function finalizeWarpCandidate(
  warped: HTMLCanvasElement | null,
  alignment: WarpAlignmentReport | null,
  maxAllowedPx: number,
  fast = false
): { warped: HTMLCanvasElement | null; alignment: WarpAlignmentReport | null } {
  if (!warped) return { warped: null, alignment };
  const refined = refineWarpedCalifacilSheet(warped, { maxAllowedPx, fast });
  return { warped: refined.canvas, alignment: refined.alignment };
}

/**
 * Warp rápido para captura móvil: un solo camino, sin barrido full-res.
 * Estilo ZipGrade: foto → documento enderezado en <1 s.
 */
export function warpCalifacilMobileCaptureFast(
  fullCanvas: HTMLCanvasElement,
  opts?: {
    /** Quad ya en coordenadas del fotograma completo. */
    frameQuad?: RoiQuad | null;
    roiQuad?: RoiQuad | null;
    roiCapture?: MobileGuideRoiCapture | null;
    maxErrorPx?: number;
  }
): MobileWarpPipelineResult {
  const maxErrorPx = opts?.maxErrorPx ?? MAX_WARP_ALIGNMENT_ERROR_PX;
  const fallbackMaxErrorPx = maxErrorPx + 8;

  if (opts?.frameQuad) {
    const frameWarp = warpAndValidateCalifacilSheet(fullCanvas, opts.frameQuad, maxErrorPx, {
      fast: true,
    });
    // Un solo refine fast (ya hecho en warpAndValidate); sin deskew.
    if (frameWarp.warped && isMobileWarpedAnswerSheetAcceptable(frameWarp.warped)) {
      return { warped: frameWarp.warped, alignment: frameWarp.alignment, source: 'full_res' };
    }
    if (frameWarp.warped) {
      return { warped: frameWarp.warped, alignment: frameWarp.alignment, source: 'full_res' };
    }
  }

  const roiQuad = opts?.roiQuad;
  const roiCapture = opts?.roiCapture;
  if (roiQuad && roiCapture) {
    const roiW = roiCapture.roiCanvas.width;
    const roiH = roiCapture.roiCanvas.height;
    const frameQuad = mapRoiQuadToFrame(roiQuad, roiCapture.roiRect, roiW, roiH);
    const scaledQuad = scaleQuadToCanvas(
      frameQuad,
      roiCapture.frameW,
      roiCapture.frameH,
      fullCanvas.width,
      fullCanvas.height
    );
    const roiWarp = warpAndValidateCalifacilSheet(fullCanvas, scaledQuad, maxErrorPx, {
      fast: true,
    });
    if (roiWarp.warped && isMobileWarpedAnswerSheetAcceptable(roiWarp.warped)) {
      return { warped: roiWarp.warped, alignment: roiWarp.alignment, source: 'roi' };
    }
  }

  const preprocessed = preprocessForSheetDetection(fullCanvas);
  for (const target of [preprocessed, fullCanvas].filter(Boolean) as HTMLCanvasElement[]) {
    const stripQuad = detectAnswerSheetQuadViaAlignStrips(target);
    if (!stripQuad) continue;
    const stripWarp = warpAndValidateCalifacilSheet(fullCanvas, stripQuad, maxErrorPx, {
      fast: true,
    });
    if (stripWarp.warped && isMobileWarpedAnswerSheetAcceptable(stripWarp.warped)) {
      return { warped: stripWarp.warped, alignment: stripWarp.alignment, source: 'strips' };
    }
  }

  const cornerWarped = warpCalifacilSheetFromCornerMarkers(fullCanvas);
  if (cornerWarped) {
    const finalized = finalizeWarpCandidate(
      cornerWarped,
      measureWarpedFiducialAlignment(cornerWarped, fallbackMaxErrorPx),
      fallbackMaxErrorPx,
      true
    );
    if (finalized.warped && isMobileWarpedAnswerSheetAcceptable(finalized.warped)) {
      return { ...finalized, source: 'corner_markers' };
    }
    if (finalized.warped) {
      return { ...finalized, source: 'corner_markers' };
    }
  }

  return { warped: null, alignment: null, source: 'none' };
}

/**
 * Pipeline móvil: franjas negras + ROI + detección full-res + fiduciales.
 */
export function warpCalifacilMobileCapture(
  fullCanvas: HTMLCanvasElement,
  opts?: {
    /** Quad ya en coordenadas del fotograma completo (mismo canvas que se warpea). */
    frameQuad?: RoiQuad | null;
    roiQuad?: RoiQuad | null;
    roiCapture?: MobileGuideRoiCapture | null;
    maxErrorPx?: number;
    fallbackMaxErrorPx?: number;
  }
): MobileWarpPipelineResult {
  const maxErrorPx = opts?.maxErrorPx ?? MAX_WARP_ALIGNMENT_ERROR_PX;
  const fallbackMaxErrorPx = opts?.fallbackMaxErrorPx ?? maxErrorPx + 6;

  let best: MobileWarpPipelineResult = {
    warped: null,
    alignment: null,
    source: 'none',
  };
  let bestScore = Number.POSITIVE_INFINITY;

  const consider = (
    warped: HTMLCanvasElement | null,
    alignment: WarpAlignmentReport | null,
    source: MobileWarpPipelineResult['source'],
    allowPx: number
  ) => {
    const finalized = finalizeWarpCandidate(warped, alignment, allowPx);
    const score = warpCandidateScore(finalized.warped, finalized.alignment);
    if (finalized.warped && score < bestScore) {
      bestScore = score;
      best = { ...finalized, source };
    }
  };

  const preprocessed = preprocessForSheetDetection(fullCanvas);
  const detectTargets: HTMLCanvasElement[] = preprocessed
    ? [preprocessed, fullCanvas]
    : [fullCanvas];

  if (opts?.frameQuad) {
    const frameWarp = warpAndValidateCalifacilSheet(fullCanvas, opts.frameQuad, maxErrorPx);
    consider(frameWarp.warped, frameWarp.alignment, 'full_res', maxErrorPx);
  }

  const roiQuad = opts?.roiQuad;
  const roiCapture = opts?.roiCapture;
  if (roiQuad && roiCapture) {
    const roiW = roiCapture.roiCanvas.width;
    const roiH = roiCapture.roiCanvas.height;
    const frameQuad = mapRoiQuadToFrame(roiQuad, roiCapture.roiRect, roiW, roiH);
    const scaledQuad = scaleQuadToCanvas(
      frameQuad,
      roiCapture.frameW,
      roiCapture.frameH,
      fullCanvas.width,
      fullCanvas.height
    );
    const roiWarp = warpAndValidateCalifacilSheet(fullCanvas, scaledQuad, maxErrorPx);
    consider(roiWarp.warped, roiWarp.alignment, 'roi', maxErrorPx);
  }

  for (const target of detectTargets) {
    const stripQuad = detectAnswerSheetQuadViaAlignStrips(target);
    if (!stripQuad) continue;
    const stripWarp = warpAndValidateCalifacilSheet(fullCanvas, stripQuad, maxErrorPx);
    consider(stripWarp.warped, stripWarp.alignment, 'strips', maxErrorPx);
  }

  for (const target of detectTargets) {
    const quad = detectCalifacilSheetCornerQuadRobust(target, { skipPreprocess: true });
    if (!quad) continue;
    const fullWarp = warpAndValidateCalifacilSheet(fullCanvas, quad, maxErrorPx);
    consider(fullWarp.warped, fullWarp.alignment, 'full_res', maxErrorPx);
    if (best.warped && isMobileWarpedAnswerSheetAcceptable(best.warped) && best.alignment?.ok) {
      break;
    }
  }

  const cornerWarped = warpCalifacilSheetFromCornerMarkers(fullCanvas);
  if (cornerWarped) {
    const cornerRefined = refineWarpedCalifacilSheet(cornerWarped, {
      maxAllowedPx: fallbackMaxErrorPx,
    });
    consider(cornerRefined.canvas, cornerRefined.alignment, 'corner_markers', fallbackMaxErrorPx);
  }

  return best;
}

export type DesktopUploadClass = 'pdf' | 'flatScan' | 'photoCrop' | 'warpedPhoto';

function isLikelyFlatCalifacilDocument(
  canvas: HTMLCanvasElement,
  columns: number,
  opts?: { flatDocument?: boolean }
): boolean {
  if (opts?.flatDocument) return true;
  if (isCalifacilWarpedLetterCanvas(canvas)) return false;
  if (!isCalifacilExamSheetLikely(canvas, columns)) return false;
  if (!hasCalifacilAlignStrips(canvas)) return false;
  const aspect = canvas.width / Math.max(1, canvas.height);
  return aspect > 0.68 && aspect < 0.88;
}

/** Clasifica subidas desktop para enrutar normalización y escaneo OMR. */
export function classifyDesktopUploadCanvas(
  canvas: HTMLCanvasElement,
  columns: number,
  opts?: { isServerRenderedPdfPage?: boolean; preWarped?: boolean }
): DesktopUploadClass {
  if (opts?.isServerRenderedPdfPage) return 'pdf';
  if (opts?.preWarped || isCalifacilWarpedLetterCanvas(canvas) || isMobileWarpedAnswerSheetReady(canvas)) {
    return 'warpedPhoto';
  }
  if (isLikelyFlatCalifacilDocument(canvas, columns)) return 'flatScan';
  return 'photoCrop';
}

/**
 * Endereza y escala cualquier captura al mismo formato que un PDF de hoja CaliFacil
 * (carta, ~1600 px de lado mayor, fiduciales alineados) para lectura OMR uniforme.
 */
export function normalizeCalifacilGradeDocumentCanvas(
  source: HTMLCanvasElement,
  columns: number,
  opts?: {
    maxSide?: number;
    maxErrorPx?: number;
    flatDocument?: boolean;
    uploadClass?: DesktopUploadClass;
    rowCount?: number;
  }
): NormalizeGradeDocumentResult {
  const maxSide = opts?.maxSide ?? CALIFACIL_GRADE_DOCUMENT_MAX_SIDE;
  const maxErrorPx = opts?.maxErrorPx ?? MAX_WARP_ALIGNMENT_ERROR_PX;

  const finish = (
    canvas: HTMLCanvasElement,
    alignment: WarpAlignmentReport | null,
    normalized: boolean
  ): NormalizeGradeDocumentResult => {
    let out = scaleCanvasToMaxSide(canvas, maxSide);
    const shouldReferenceAlign = opts?.rowCount != null && opts.rowCount > 0;
    if (shouldReferenceAlign) {
      out = prepareReferenceGradeCanvas(out, columns, opts.rowCount!);
    }
    return { canvas: out, alignment, normalized };
  };

  const base = captureImageFullFrame(source, { maxSide: Math.max(maxSide, 2400) }) ?? source;
  const uploadClass =
    opts?.uploadClass ?? classifyDesktopUploadCanvas(base, columns);
  const useFlatPath =
    uploadClass === 'pdf' ||
    uploadClass === 'flatScan' ||
    isLikelyFlatCalifacilDocument(base, columns, {
      flatDocument: opts?.flatDocument,
    });

  if (useFlatPath) {
    return finish(base, null, false);
  }

  if (isMobileWarpedAnswerSheetAcceptable(base)) {
    const doc = prepareMobileGradeDocumentCanvas(base, null);
    return finish(
      doc,
      measureWarpedFiducialAlignment(doc, maxErrorPx),
      Math.max(base.width, base.height) > maxSide * 1.08
    );
  }

  for (const attempt of [
    () => warpCalifacilMobileCapture(base, { maxErrorPx, fallbackMaxErrorPx: maxErrorPx + 12 }),
    () => warpCalifacilMobileCaptureFast(base, { maxErrorPx }),
  ]) {
    const result = attempt();
    if (result.warped && isMobileWarpedAnswerSheetAcceptable(result.warped)) {
      const doc = prepareMobileGradeDocumentCanvas(result.warped, result.alignment);
      return finish(doc, result.alignment, true);
    }
  }

  if (isCalifacilExamSheetLikely(base, columns)) {
    const corner = warpCalifacilSheetFromCornerMarkers(base);
    if (corner && countCalifacilCornerMarkers(corner) >= 3) {
      const alignment = measureWarpedFiducialAlignment(corner, maxErrorPx);
      const doc = prepareMobileGradeDocumentCanvas(corner, alignment);
      return finish(doc, alignment, true);
    }
    return finish(base, null, false);
  }

  const oriented = autoOrientCalifacilSheet(base, columns, {
    useGuideCrop: false,
    allowTiltSweep: true,
  });
  if (oriented && isCalifacilExamSheetLikely(oriented, columns)) {
    return finish(oriented, null, true);
  }

  return finish(base, null, false);
}

/**
 * Prepara cualquier captura (cámara, galería, PDF, escaneo) al mismo espacio de referencia
 * antes de leer burbujas OMR.
 */
export function prepareCalifacilGradeScanCanvas(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount: number,
  opts?: {
    preWarped?: boolean;
    warpAlignment?: WarpAlignmentReport | null;
    /** Móvil ultrágil: no warp a 1230×1600 (se descarta al bajar maxSide). */
    skipReferenceAlign?: boolean;
  }
): HTMLCanvasElement {
  // Móvil: canvas ya warpeado — sin segundo refine/deskew.
  if (opts?.skipReferenceAlign) {
    return canvas;
  }
  let out = canvas;
  if (opts?.preWarped) {
    out = prepareMobileGradeDocumentCanvas(out, opts.warpAlignment);
  }
  return prepareReferenceGradeCanvas(out, columns, rowCount);
}

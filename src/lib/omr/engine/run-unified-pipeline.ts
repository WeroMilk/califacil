import {
  getOmrCanvasImageDataForEngine,
  sanitizeAnswerSheetOmrMeta,
  readAnswerSheetControlNumberFromCanvas,
  clampCalifacilOmrRowCount,
} from '@/lib/omr/engine/omr-bridge';
import {
  shouldUseStripFallback,
  runStripFallback,
  runStripFallbackFast,
  isStripGeometryMisaligned,
  hasStrongCircleGeometry,
  FALLBACK_THRESHOLDS,
  type FallbackReason,
} from '@/lib/omr/engine/fallback-strip';
import { computeGeometryQuality } from '@/lib/omr/engine/objective';
import { detectInitialGeometry } from '@/lib/omr/engine/detect-initial-geometry';
import { optimizeGeometry } from '@/lib/omr/engine/optimize-geometry';
import { readFrozenGeometry, meanCenterErrorPx } from '@/lib/omr/engine/read-frozen-geometry';
import type { FrozenOmrGeometry, UnifiedPipelineOptions, UnifiedPipelineMeta } from '@/lib/omr/engine/types';
import { frozenGeometryToLegacyCells } from '@/lib/omr/engine/types';
import type { OmrScanMetaResult } from '@/lib/omrScan';
import { scanCalifacilDesktopGradeDocument, scanCalifacilNearReferenceFlatDocument } from '@/lib/omrScan';
import { scanCalifacilOmrSheetWithMeta, CALIFACIL_DESKTOP_GRADE_SCAN_OPTS } from '@/lib/omr/engine/omr-bridge';
import {
  attachConvergenceToQuality,
  shouldKeepFrozenOverStrip,
  canRunAuthoritativeRead,
  FREEZE_GATE,
} from '@/lib/omr/engine/freeze-gate';
import type { OptimizeResult } from '@/lib/omr/engine/optimize-geometry';
import type { InitialGeometryResult } from '@/lib/omr/engine/detect-initial-geometry';
import {
  isReferenceGradeExam,
  hasReferenceGradeCalibration,
  isReferenceGradeCanvasAnchor,
  canvasMatchesReferenceGrade,
  canvasNearReferenceGrade,
} from '@/lib/omr/reference-grade-merge';

function runExactReferenceGradeScan(
  canvas: HTMLCanvasElement,
  cols: number,
  rows: number
): OmrScanMetaResult {
  return scanCalifacilNearReferenceFlatDocument(canvas, cols, rows);
}

function preferDesktopTierRecovery(rows: number, cols: number): boolean {
  return isReferenceGradeExam(rows, cols) && hasReferenceGradeCalibration();
}

function pickDesktopRecoveryScan(
  canvas: HTMLCanvasElement,
  cols: number,
  rows: number,
  initial?: InitialGeometryResult | null
): OmrScanMetaResult {
  const exactRef = canvasMatchesReferenceGrade(canvas.width, canvas.height);
  const nearRefNonExact =
    canvasNearReferenceGrade(canvas.width, canvas.height) && !exactRef;

  if (
    nearRefNonExact &&
    initial &&
    initial.validationOk &&
    initial.bubbleFit >= 0.35
  ) {
    const locked = optimizeGeometry(canvas, initial, rows, cols, { lockGridLines: true });
    const control = readAnswerSheetControlNumberFromCanvas(canvas, rows);
    const legacyGeom = frozenGeometryToLegacyCells(locked.geometry);
    return sanitizeAnswerSheetOmrMeta(
      {
        picks: locked.read.picks,
        rows: locked.read.rows,
        needsVisionAssist: locked.read.rows.some((r) => r.ambiguous),
        maxSameColumnCount: locked.read.maxSameColumnCount,
        geometry: legacyGeom,
        reviewSourceCanvas: canvas,
        controlNumberDigits: control.digits,
        controlNumber: control.controlNumber,
        usedFallback: true,
        unifiedEngine: true,
      },
      rows
    );
  }

  if (exactRef) {
    return runExactReferenceGradeScan(canvas, cols, rows);
  }

  if (nearRefNonExact) {
    return scanCalifacilNearReferenceFlatDocument(canvas, cols, rows);
  }

  return scanCalifacilDesktopGradeDocument(canvas, cols, rows);
}

function buildDesktopTierRecoveryResult(
  canvas: HTMLCanvasElement,
  cols: number,
  rows: number,
  t0: number,
  fallbackReason: FallbackReason,
  ctx?: {
    initial?: InitialGeometryResult | null;
    optimized?: OptimizeResult;
  }
): UnifiedPipelineResult {
  const desktopMeta = pickDesktopRecoveryScan(canvas, cols, rows, ctx?.initial);
  const resolvedCount = desktopMeta.picks.filter((p) => p !== null).length;
  const geometry = desktopMeta.geometry
    ? {
        ...desktopMeta.geometry,
        quality: attachConvergenceToQuality(
          desktopMeta.geometry.quality ?? {
            score: ctx?.optimized?.bestScore ?? 0,
            bubbleFit: ctx?.initial?.bubbleFit ?? 0,
            stability: 0,
            spatialConsistency: 0,
            validationOk: ctx?.initial?.validationOk ?? false,
            issues: [],
          },
          {
            converged: ctx?.optimized?.converged ?? false,
            iterations: ctx?.optimized?.iterations ?? 0,
            meanCenterErrorPx: ctx?.optimized?.meanCenterErrorPx ?? 0,
            scoreDelta: ctx?.optimized?.scoreDelta ?? 0,
            skipOptimizeUsed: false,
            stripFallbackUsed: false,
            resolvedCount,
            ambiguousCount: desktopMeta.rows.filter((r) => r.ambiguous).length,
          }
        ),
      }
    : desktopMeta.geometry;
  const processingMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return {
    meta: {
      ...desktopMeta,
      geometry,
      reviewSourceCanvas: canvas,
      usedFallback: true,
      unifiedEngine: true,
    },
    fallbackReason,
    processingMs,
    meanCenterErrorPx: ctx?.optimized?.meanCenterErrorPx ?? 0,
    geometryQuality: ctx?.optimized?.bestScore ?? 0,
  };
}

export function isUnifiedOmrEngineEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_OMR_UNIFIED_ENGINE === '0') {
    return false;
  }
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_OMR_UNIFIED_ENGINE === '1') {
    return true;
  }
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as unknown as { __OMR_UNIFIED_ENGINE__?: boolean };
    if (g.__OMR_UNIFIED_ENGINE__ === false) return false;
    if (g.__OMR_UNIFIED_ENGINE__) return true;
  }
  return true;
}

export function enableUnifiedOmrEngineForBenchmark(enable = true): void {
  (globalThis as unknown as { __OMR_UNIFIED_ENGINE__?: boolean }).__OMR_UNIFIED_ENGINE__ = enable;
}

export type UnifiedPipelineResult = {
  meta: UnifiedPipelineMeta;
  fallbackReason: FallbackReason | null;
  processingMs: number;
  meanCenterErrorPx: number;
  geometryQuality: number;
};

/**
 * Unified OMR pipeline: detect → optimize until convergence → freeze → single authoritative read.
 */
export function runUnifiedOmrPipeline(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount?: number,
  opts?: UnifiedPipelineOptions
): UnifiedPipelineResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rows = clampCalifacilOmrRowCount(rowCount ?? opts?.rowCount);
  const cols = Math.max(2, Math.min(5, Math.round(columns ?? opts?.columns ?? 4)));
  const fastMode = Boolean(opts?.fastMode) && !opts?.requireFullOptimize;

  if (
    isReferenceGradeExam(rows, cols) &&
    hasReferenceGradeCalibration() &&
    canvasMatchesReferenceGrade(canvas.width, canvas.height)
  ) {
    const tRef = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const exactMeta = runExactReferenceGradeScan(canvas, cols, rows);
    const processingMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tRef;
    return {
      meta: {
        ...exactMeta,
        unifiedEngine: true,
        usedFallback: false,
        reviewSourceCanvas: canvas,
      },
      fallbackReason: null,
      processingMs,
      meanCenterErrorPx: 0,
      geometryQuality: exactMeta.geometry?.quality?.score ?? 1,
    };
  }

  const isReferenceSizedCanvas =
    isReferenceGradeExam(rows, cols) && isReferenceGradeCanvasAnchor(canvas.width, canvas.height);

  const initial = detectInitialGeometry(canvas, cols, rows);
  const preCheck = shouldUseStripFallback({ initial, rows, columns: cols, canvas });

  if (preCheck.useFallback && !(initial && hasStrongCircleGeometry(initial, rows, cols))) {
    if (!fastMode && preferDesktopTierRecovery(rows, cols)) {
      return buildDesktopTierRecoveryResult(canvas, cols, rows, t0, preCheck.reason ?? 'validation_failed', {
        initial,
      });
    }
    const strip = fastMode
      ? runStripFallbackFast(canvas, cols, rows)
      : runStripFallback(canvas, cols, rows);
    const control = readAnswerSheetControlNumberFromCanvas(canvas, rows);
    const processingMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return {
      meta: {
        ...strip,
        controlNumberDigits: strip.controlNumberDigits.length
          ? strip.controlNumberDigits
          : control.digits,
        controlNumber: strip.controlNumber ?? control.controlNumber,
        reviewSourceCanvas: canvas,
        usedFallback: true,
        unifiedEngine: true,
      },
      fallbackReason: preCheck.reason,
      processingMs,
      meanCenterErrorPx: 0,
      geometryQuality: 0,
    };
  }

  if (!initial) {
    if (!fastMode && preferDesktopTierRecovery(rows, cols)) {
      return buildDesktopTierRecoveryResult(canvas, cols, rows, t0, 'initial_geometry_missing');
    }
    const strip = fastMode
      ? runStripFallbackFast(canvas, cols, rows)
      : runStripFallback(canvas, cols, rows);
    const control = readAnswerSheetControlNumberFromCanvas(canvas, rows);
    const processingMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return {
      meta: {
        ...strip,
        controlNumberDigits: strip.controlNumberDigits.length
          ? strip.controlNumberDigits
          : control.digits,
        controlNumber: strip.controlNumber ?? control.controlNumber,
        reviewSourceCanvas: canvas,
        usedFallback: true,
        unifiedEngine: true,
      },
      fallbackReason: 'initial_geometry_missing',
      processingMs,
      meanCenterErrorPx: 0,
      geometryQuality: 0,
    };
  }

  const optimized = optimizeGeometry(canvas, initial, rows, cols, {
    fastMode,
    maxIterations: opts?.maxOptimizeIterations ?? (fastMode ? 80 : 320),
    stagnantLimit: opts?.stagnantLimit ?? (fastMode ? 10 : 24),
    lockGridLines:
      preferDesktopTierRecovery(rows, cols) &&
      canvasNearReferenceGrade(canvas.width, canvas.height) &&
      !canvasMatchesReferenceGrade(canvas.width, canvas.height) &&
      initial.bubbleFit >= FALLBACK_THRESHOLDS.minGeometryQuality,
  });

  const resolvedAfterOptimize = optimized.read.picks.filter((p) => p != null).length;
  const authoritativeOk =
    canRunAuthoritativeRead({
      skipOptimizeUsed: false,
      converged: optimized.converged,
      meanCenterErrorPx: optimized.meanCenterErrorPx,
    }) ||
    (fastMode &&
      optimized.meanCenterErrorPx <= FREEZE_GATE.maxMeanCenterErrorPx * 3 &&
      resolvedAfterOptimize >= Math.ceil(rows * 0.5));

  if (!authoritativeOk && !(initial && hasStrongCircleGeometry(initial, rows, cols))) {
    if (
      !fastMode &&
      (preferDesktopTierRecovery(rows, cols) || isReferenceSizedCanvas || opts?.requireFullOptimize)
    ) {
      return buildDesktopTierRecoveryResult(
        canvas,
        cols,
        rows,
        t0,
        optimized.converged ? 'low_geometry_quality' : 'optimization_not_converged',
        { initial, optimized }
      );
    }
    // fastMode: no strip full — usar mejor frozen del optimize más abajo.
    if (!fastMode) {
      const strip = runStripFallback(canvas, cols, rows);
      const control = readAnswerSheetControlNumberFromCanvas(canvas, rows);
      const processingMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return {
        meta: {
          ...strip,
          controlNumberDigits: strip.controlNumberDigits.length
            ? strip.controlNumberDigits
            : control.digits,
          controlNumber: strip.controlNumber ?? control.controlNumber,
          reviewSourceCanvas: canvas,
          usedFallback: true,
          unifiedEngine: true,
        },
        fallbackReason: optimized.converged ? 'low_geometry_quality' : 'optimization_not_converged',
        processingMs,
        meanCenterErrorPx: optimized.meanCenterErrorPx,
        geometryQuality: optimized.bestScore,
      };
    }
  }

  let frozen: FrozenOmrGeometry = optimized.geometry;
  let read = optimized.read;
  const bestScore = optimized.bestScore;

  const imageData = getOmrCanvasImageDataForEngine(canvas);
  const baseQuality = computeGeometryQuality(
    frozen,
    frozen.rowLines,
    frozen.colEdges,
    frozen.bubbles,
    rows,
    imageData,
    canvas.width,
    canvas.height
  );

  const resolvedCount = read.picks.filter((p) => p !== null).length;
  frozen = {
    ...frozen,
    quality: attachConvergenceToQuality(baseQuality, {
      converged: optimized.converged,
      iterations: optimized.iterations,
      meanCenterErrorPx: optimized.meanCenterErrorPx,
      scoreDelta: optimized.scoreDelta,
      skipOptimizeUsed: false,
      stripFallbackUsed: false,
      resolvedCount,
      ambiguousCount: read.ambiguousCount,
    }),
  };
  frozen.quality.score = bestScore;

  const postCheck = shouldUseStripFallback({
    initial,
    optimize: optimized,
    read,
    rows,
    columns: cols,
    canvas,
    isReferenceSizedCanvas,
  });

  const keepFrozen = shouldKeepFrozenOverStrip({
    isReferenceSizedCanvas,
    converged: optimized.converged,
    meanCenterErrorPx: optimized.meanCenterErrorPx,
    validationOk: frozen.quality.validationOk,
  });

  if (
    postCheck.useFallback &&
    !(initial && hasStrongCircleGeometry(initial, rows, cols)) &&
    !keepFrozen
  ) {
    if (!fastMode && preferDesktopTierRecovery(rows, cols)) {
      return buildDesktopTierRecoveryResult(canvas, cols, rows, t0, postCheck.reason ?? 'low_geometry_quality', {
        initial,
        optimized,
      });
    }
    if (fastMode) {
      // Recovery barato en móvil: strip live (no full).
      const strip = runStripFallbackFast(canvas, cols, rows);
      const stripMisaligned =
        strip.geometry && isStripGeometryMisaligned(canvas, strip.geometry, rows);
      const stripResolved = strip.picks.filter((p) => p != null).length;
      const frozenResolved = read.picks.filter((p) => p != null).length;
      if (!stripMisaligned && stripResolved > frozenResolved) {
        const control = readAnswerSheetControlNumberFromCanvas(canvas, rows);
        const processingMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        return {
          meta: {
            ...strip,
            controlNumberDigits: strip.controlNumberDigits.length
              ? strip.controlNumberDigits
              : control.digits,
            controlNumber: strip.controlNumber ?? control.controlNumber,
            reviewSourceCanvas: canvas,
            usedFallback: true,
            unifiedEngine: true,
          },
          fallbackReason: postCheck.reason,
          processingMs,
          meanCenterErrorPx: optimized.meanCenterErrorPx,
          geometryQuality: frozen.quality.score,
        };
      }
      frozen = {
        ...frozen,
        quality: {
          ...frozen.quality,
          issues: [...frozen.quality.issues, 'strip_fallback_fast:kept_frozen'],
        },
      };
      read = readFrozenGeometry(canvas, frozen, rows, cols);
    } else {
      const strip = runStripFallback(canvas, cols, rows);
      const stripMisaligned =
        strip.geometry && isStripGeometryMisaligned(canvas, strip.geometry, rows);
      if (!stripMisaligned) {
        const control = readAnswerSheetControlNumberFromCanvas(canvas, rows);
        const processingMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
        return {
          meta: {
            ...strip,
            controlNumberDigits: strip.controlNumberDigits.length
              ? strip.controlNumberDigits
              : control.digits,
            controlNumber: strip.controlNumber ?? control.controlNumber,
            reviewSourceCanvas: canvas,
            usedFallback: true,
            unifiedEngine: true,
          },
          fallbackReason: postCheck.reason,
          processingMs,
          meanCenterErrorPx: optimized.meanCenterErrorPx,
          geometryQuality: frozen.quality.score,
        };
      }
      read = readFrozenGeometry(canvas, frozen, rows, cols);
    }
  } else if (postCheck.useFallback && keepFrozen) {
    frozen = {
      ...frozen,
      quality: {
        ...frozen.quality,
        issues: [...frozen.quality.issues, 'strip_fallback_skipped:frozen_converged'],
      },
    };
  }

  const control = readAnswerSheetControlNumberFromCanvas(canvas, rows);
  const legacyGeom = frozenGeometryToLegacyCells(frozen);
  const needsVisionAssist = read.rows.some((r) => r.ambiguous);

  const meta: UnifiedPipelineMeta = sanitizeAnswerSheetOmrMeta(
    {
      picks: read.picks,
      rows: read.rows,
      needsVisionAssist,
      maxSameColumnCount: read.maxSameColumnCount,
      geometry: legacyGeom,
      reviewSourceCanvas: canvas,
      controlNumberDigits: control.digits,
      controlNumber: control.controlNumber,
      usedFallback: false,
      unifiedEngine: true,
    },
    rows
  );

  const processingMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

  return {
    meta,
    fallbackReason: null,
    processingMs,
    meanCenterErrorPx: meanCenterErrorPx(frozen),
    geometryQuality: bestScore,
  };
}

/** Convert unified result to standard OmrScanMetaResult for existing callers. */
export function unifiedResultToMeta(result: UnifiedPipelineResult): OmrScanMetaResult {
  return result.meta;
}

import {
  scanCalifacilOmrSheetWithMeta,
  CALIFACIL_DESKTOP_GRADE_SCAN_OPTS,
  clampCalifacilOmrRowCount,
  type OmrScanMetaResult,
} from '@/lib/omrScan';
import {
  canvasMatchesReferenceGrade,
  canvasNearReferenceGrade,
  isReferenceGradeExam,
} from '@/lib/omr/reference-grade-merge';
import type { UnifiedReadResult } from '@/lib/omr/engine/types';
import type { InitialGeometryResult } from '@/lib/omr/engine/detect-initial-geometry';
import type { OptimizeResult } from '@/lib/omr/engine/optimize-geometry';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

export const FALLBACK_THRESHOLDS = {
  minGeometryQuality: 0.55,
  minGlobalConfidence: 0.45,
  maxAmbiguousRatio: 0.25,
} as const;

export type FallbackReason =
  | 'initial_geometry_missing'
  | 'validation_failed'
  | 'low_geometry_quality'
  | 'low_global_confidence'
  | 'low_resolved_count'
  | 'suspicious_column_bias'
  | 'too_many_ambiguous'
  | 'optimization_not_converged';

export function hasStrongCircleGeometry(
  initial: InitialGeometryResult,
  rows: number,
  cols: number
): boolean {
  const bubbles = initial.geometry.bubbles?.flat().filter((b) => b.r > 0).length ?? 0;
  return bubbles >= rows * cols * 0.75 && initial.bubbleFit >= 0.7;
}

/** Strip reader often assumes footer band; reject if 30 rows are squeezed in the page bottom. */
export function isStripGeometryMisaligned(
  _canvas: HTMLCanvasElement,
  geometry: CalifacilOmrScanGeometry,
  rows: number
): boolean {
  const row1 = geometry.cells[0]?.[0];
  const rowLast = geometry.cells[rows - 1]?.[0];
  if (!row1 || !rowLast) return false;
  const span = rowLast.y + rowLast.h - row1.y;
  return row1.y > 0.52 && span < 0.28;
}

export function shouldUseStripFallback(params: {
  initial: InitialGeometryResult | null;
  optimize?: OptimizeResult | null;
  read?: UnifiedReadResult | null;
  rows: number;
  columns?: number;
  canvas?: HTMLCanvasElement;
  isReferenceSizedCanvas?: boolean;
}): { useFallback: boolean; reason: FallbackReason | null } {
  const rows = clampCalifacilOmrRowCount(params.rows);
  const cols = params.columns ?? 4;
  const canvas = params.canvas;
  const read = params.read ?? params.optimize?.read;

  const isReferenceSizedCanvas =
    params.isReferenceSizedCanvas ??
    Boolean(
      canvas &&
        isReferenceGradeExam(rows, cols) &&
        canvasMatchesReferenceGrade(canvas.width, canvas.height)
    );

  if (!params.initial) {
    return { useFallback: true, reason: 'initial_geometry_missing' };
  }
  const strongCircles = hasStrongCircleGeometry(params.initial, rows, cols);
  if (!params.initial.validationOk && !strongCircles) {
    if (
      isReferenceSizedCanvas &&
      params.initial.bubbleFit >= FALLBACK_THRESHOLDS.minGeometryQuality
    ) {
      return { useFallback: false, reason: null };
    }
    return { useFallback: true, reason: 'validation_failed' };
  }
  const isNearReferenceFlat =
    Boolean(
      canvas &&
        isReferenceGradeExam(rows, cols) &&
        canvasNearReferenceGrade(canvas.width, canvas.height)
    );

  if (
    isNearReferenceFlat &&
    params.initial.validationOk &&
    params.initial.bubbleFit >= 0.35
  ) {
    return { useFallback: false, reason: null };
  }

  if (params.initial.bubbleFit < FALLBACK_THRESHOLDS.minGeometryQuality * 0.85 && !strongCircles) {
    return { useFallback: true, reason: 'low_geometry_quality' };
  }

  if (read) {
    if (strongCircles) {
      return { useFallback: false, reason: null };
    }

    if (
      isReferenceSizedCanvas &&
      params.optimize &&
      params.optimize.converged &&
      params.optimize.meanCenterErrorPx <= 0.25
    ) {
      return { useFallback: false, reason: null };
    }

    const resolved = read.picks.filter((p) => p !== null).length;
    if (resolved < rows * 0.45) {
      return { useFallback: true, reason: 'low_resolved_count' };
    }
    if (
      resolved > 0 &&
      read.maxSameColumnCount > Math.max(4, Math.round(rows * 0.35))
    ) {
      return { useFallback: true, reason: 'suspicious_column_bias' };
    }
    if (read.globalConfidence < FALLBACK_THRESHOLDS.minGlobalConfidence) {
      return { useFallback: true, reason: 'low_global_confidence' };
    }
    if (read.ambiguousCount > rows * FALLBACK_THRESHOLDS.maxAmbiguousRatio) {
      return { useFallback: true, reason: 'too_many_ambiguous' };
    }
  } else if (isReferenceSizedCanvas) {
    return { useFallback: false, reason: null };
  }

  if (params.optimize && !params.optimize.converged && params.optimize.bestScore < 0.2) {
    return { useFallback: true, reason: 'optimization_not_converged' };
  }

  return { useFallback: false, reason: null };
}

/**
 * Strip reader — recovery only when unified pipeline cannot trust geometry.
 */
export function runStripFallback(
  canvas: HTMLCanvasElement,
  columns: number,
  rowCount?: number
): OmrScanMetaResult {
  const rows = clampCalifacilOmrRowCount(rowCount);
  return scanCalifacilOmrSheetWithMeta(canvas, columns, {
    ...CALIFACIL_DESKTOP_GRADE_SCAN_OPTS,
    qnumSweep: 'full',
    columnShiftSweep: 'full',
    rowCount: rows,
  });
}

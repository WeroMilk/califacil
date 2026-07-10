import type { CalifacilOmrScanGeometry, OmrNormRect, OmrScanMetaResult, OmrScanRowDetail, CalifacilOmrBubbleSample } from '@/lib/omrScan';

/** Per-bubble sample — single source of truth for read + overlay. */
export type BubbleSample = CalifacilOmrBubbleSample;

export type GeometryConvergenceReport = {
  converged: boolean;
  iterations: number;
  meanCenterErrorPx: number;
  scoreDelta: number;
  skipOptimizeUsed: boolean;
  stripFallbackUsed: boolean;
  resolvedCount: number;
  ambiguousCount: number;
};

export type GeometryQualityReport = {
  score: number;
  bubbleFit: number;
  stability: number;
  spatialConsistency: number;
  validationOk: boolean;
  issues: string[];
  convergence?: GeometryConvergenceReport;
};

/** Frozen geometry — immutable after optimization. */
export type FrozenOmrGeometry = CalifacilOmrScanGeometry & {
  frame: OmrNormRect;
  rowLines: number[];
  colEdges: number[];
  bubbles: BubbleSample[][];
  quality: GeometryQualityReport;
  frozen: true;
  source: 'unified-engine';
};

export type UnifiedReadResult = {
  picks: (number | null)[];
  rows: OmrScanRowDetail[];
  geometry: FrozenOmrGeometry;
  globalConfidence: number;
  ambiguousCount: number;
  maxSameColumnCount: number;
  usedFallback: boolean;
};

export type UnifiedPipelineOptions = {
  rowCount?: number;
  columns?: number;
  /** Fewer iterations for live camera (same architecture). */
  fastMode?: boolean;
  maxOptimizeIterations?: number;
  /** When true, never skip optimizeGeometry (document / reference-grade scans). */
  requireFullOptimize?: boolean;
};

export type UnifiedPipelineMeta = OmrScanMetaResult & {
  usedFallback?: boolean;
  unifiedEngine?: boolean;
};

export const UNIFIED_ENGINE_SOURCE = 'unified-engine' as const;

export function isFrozenOmrGeometry(
  geometry: CalifacilOmrScanGeometry | null | undefined
): geometry is FrozenOmrGeometry {
  return Boolean(
    geometry &&
      'frozen' in geometry &&
      (geometry as FrozenOmrGeometry).frozen === true &&
      (geometry as FrozenOmrGeometry).source === UNIFIED_ENGINE_SOURCE
  );
}

export function frozenGeometryToLegacyCells(geometry: FrozenOmrGeometry): CalifacilOmrScanGeometry {
  return {
    imageWidth: geometry.imageWidth,
    imageHeight: geometry.imageHeight,
    cells: geometry.cells,
    bubbles: geometry.bubbles,
    frame: geometry.frame,
    rowLines: geometry.rowLines,
    colEdges: geometry.colEdges,
    quality: geometry.quality,
    frozen: true,
    source: UNIFIED_ENGINE_SOURCE,
  };
}

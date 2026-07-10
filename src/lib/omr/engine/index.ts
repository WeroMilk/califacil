export type {
  BubbleSample,
  FrozenOmrGeometry,
  GeometryQualityReport,
  UnifiedPipelineMeta,
  UnifiedPipelineOptions,
  UnifiedReadResult,
} from '@/lib/omr/engine/types';

export {
  isFrozenOmrGeometry,
  frozenGeometryToLegacyCells,
  UNIFIED_ENGINE_SOURCE,
} from '@/lib/omr/engine/types';

export { detectInitialGeometry } from '@/lib/omr/engine/detect-initial-geometry';
export type { InitialGeometryResult } from '@/lib/omr/engine/detect-initial-geometry';

export { refineAllBubbles, bubblesToGeometry } from '@/lib/omr/engine/refine-bubbles';
export {
  computeObjectiveScore,
  computeGeometryQuality,
  DEFAULT_OBJECTIVE_WEIGHTS,
} from '@/lib/omr/engine/objective';
export { optimizeGeometry } from '@/lib/omr/engine/optimize-geometry';
export { readFrozenGeometry, meanCenterErrorPx } from '@/lib/omr/engine/read-frozen-geometry';
export {
  FREEZE_GATE,
  attachConvergenceToQuality,
  shouldKeepFrozenOverStrip,
  canRunAuthoritativeRead,
} from '@/lib/omr/engine/freeze-gate';

export {
  shouldUseStripFallback,
  runStripFallback,
  FALLBACK_THRESHOLDS,
} from '@/lib/omr/engine/fallback-strip';

export {
  runUnifiedOmrPipeline,
  unifiedResultToMeta,
  isUnifiedOmrEngineEnabled,
  enableUnifiedOmrEngineForBenchmark,
} from '@/lib/omr/engine/run-unified-pipeline';

export type { UnifiedPipelineResult } from '@/lib/omr/engine/run-unified-pipeline';

export { detectCircleGridGeometry, detectPrintedBubbleHits } from '@/lib/omr/engine/detect-circles-grid';

export {
  extractLinesFromGeometry,
  buildCellsFromNormLines,
} from '@/lib/omr/engine/geometry-lines';

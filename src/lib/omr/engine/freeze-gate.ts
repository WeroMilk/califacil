import type { GeometryQualityReport } from '@/lib/omr/engine/types';

/** Gates for authoritative OMR read — geometry must converge before picks are final. */
export const FREEZE_GATE = {
  maxMeanCenterErrorPx: 0.25,
  minRelativeScoreImprovement: 0.001,
  minBubbleFitFlatDoc: 0.85,
  maxFrameDeviationNorm: 0.012,
} as const;

export type FreezeGateConvergence = {
  converged: boolean;
  iterations: number;
  meanCenterErrorPx: number;
  scoreDelta: number;
  skipOptimizeUsed: boolean;
  stripFallbackUsed: boolean;
  resolvedCount: number;
  ambiguousCount: number;
};

export function buildFreezeGateIssues(params: FreezeGateConvergence & {
  bubbleFit: number;
  validationOk: boolean;
}): string[] {
  const issues: string[] = [];
  issues.push(`converged:${params.converged}`);
  issues.push(`iterations:${params.iterations}`);
  issues.push(`mean_center_error_px:${params.meanCenterErrorPx.toFixed(3)}`);
  issues.push(`score_delta:${params.scoreDelta.toFixed(6)}`);
  issues.push(`bubble_fit_pct:${Math.round(params.bubbleFit * 100)}`);
  issues.push(`skipOptimize_used:${params.skipOptimizeUsed}`);
  issues.push(`strip_fallback_used:${params.stripFallbackUsed}`);
  issues.push(`resolved_count:${params.resolvedCount}`);
  issues.push(`ambiguous_count:${params.ambiguousCount}`);
  if (!params.validationOk) issues.push('validation_weak');
  if (!params.converged) issues.push('geometry_not_converged');
  if (params.meanCenterErrorPx > FREEZE_GATE.maxMeanCenterErrorPx) {
    issues.push(`center_error_high:${params.meanCenterErrorPx.toFixed(2)}px`);
  }
  if (params.skipOptimizeUsed) issues.push('authoritative_read_blocked:skip_optimize');
  return issues;
}

export function attachConvergenceToQuality(
  quality: GeometryQualityReport,
  convergence: FreezeGateConvergence
): GeometryQualityReport {
  return {
    ...quality,
    convergence,
    issues: [
      ...quality.issues,
      ...buildFreezeGateIssues({
        ...convergence,
        bubbleFit: quality.bubbleFit,
        validationOk: quality.validationOk,
      }),
    ],
  };
}

/** True when frozen geometry is stable enough to trust over strip recovery. */
export function shouldKeepFrozenOverStrip(params: {
  isReferenceSizedCanvas: boolean;
  converged: boolean;
  meanCenterErrorPx: number;
  validationOk: boolean;
}): boolean {
  if (!params.isReferenceSizedCanvas) return false;
  return (
    params.converged &&
    params.meanCenterErrorPx <= FREEZE_GATE.maxMeanCenterErrorPx &&
    params.validationOk
  );
}

export function canRunAuthoritativeRead(params: {
  skipOptimizeUsed: boolean;
  converged: boolean;
  meanCenterErrorPx: number;
}): boolean {
  if (params.skipOptimizeUsed) return false;
  return params.converged && params.meanCenterErrorPx <= FREEZE_GATE.maxMeanCenterErrorPx;
}

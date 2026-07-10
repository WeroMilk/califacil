import type { BubbleSample, FrozenOmrGeometry } from '@/lib/omr/engine/types';
import type { OmrNormRect } from '@/lib/omrScan';
import {
  buildCellsFromNormLines,
  scaleColEdges,
  scaleRowLines,
  shiftNormLines,
} from '@/lib/omr/engine/geometry-lines';
import { refineAllBubbles, bubblesToGeometry } from '@/lib/omr/engine/refine-bubbles';
import { computeObjectiveScore } from '@/lib/omr/engine/objective';
import { readFrozenGeometry, meanCenterErrorPx } from '@/lib/omr/engine/read-frozen-geometry';
import { getOmrCanvasImageDataForEngine } from '@/lib/omr/engine/omr-bridge';
import type { InitialGeometryResult } from '@/lib/omr/engine/detect-initial-geometry';
import { FREEZE_GATE } from '@/lib/omr/engine/freeze-gate';

export type OptimizeOptions = {
  maxIterations?: number;
  convergenceEpsilon?: number;
  stagnantLimit?: number;
  fastMode?: boolean;
  maxMeanCenterErrorPx?: number;
  minRelativeScoreImprovement?: number;
  /** When true, keep row/col lines fixed and only refine bubble centers for read. */
  lockGridLines?: boolean;
};

type OptimizeState = {
  rowLines: number[];
  colEdges: number[];
  frame: OmrNormRect;
  bubbles: BubbleSample[][];
  score: number;
};

function cloneState(s: OptimizeState): OptimizeState {
  return {
    rowLines: [...s.rowLines],
    colEdges: [...s.colEdges],
    frame: { ...s.frame },
    bubbles: s.bubbles.map((row) => row.map((b) => ({ ...b, bounds: { ...b.bounds } }))),
    score: s.score,
  };
}

type Perturbation = {
  name: string;
  apply: (s: OptimizeState) => OptimizeState | null;
};

function buildPerturbations(rows: number, cols: number, fastMode: boolean): Perturbation[] {
  const dy = 0.0012;
  const dx = 0.0015;
  const list: Perturbation[] = [
    {
      name: 'shift+',
      apply: (s) => {
        const { rowLines, colEdges } = shiftNormLines(s.rowLines, s.colEdges, dx, dy);
        return { ...s, rowLines, colEdges };
      },
    },
    {
      name: 'shift-',
      apply: (s) => {
        const { rowLines, colEdges } = shiftNormLines(s.rowLines, s.colEdges, -dx, -dy);
        return { ...s, rowLines, colEdges };
      },
    },
    {
      name: 'rowScale+',
      apply: (s) => {
        const cy = (s.rowLines[0]! + s.rowLines[s.rowLines.length - 1]!) * 0.5;
        return { ...s, rowLines: scaleRowLines(s.rowLines, cy, 1.002) };
      },
    },
    {
      name: 'rowScale-',
      apply: (s) => {
        const cy = (s.rowLines[0]! + s.rowLines[s.rowLines.length - 1]!) * 0.5;
        return { ...s, rowLines: scaleRowLines(s.rowLines, cy, 0.998) };
      },
    },
    {
      name: 'colScale+',
      apply: (s) => {
        const cx = (s.colEdges[0]! + s.colEdges[s.colEdges.length - 1]!) * 0.5;
        return { ...s, colEdges: scaleColEdges(s.colEdges, cx, 1.002) };
      },
    },
    {
      name: 'colScale-',
      apply: (s) => {
        const cx = (s.colEdges[0]! + s.colEdges[s.colEdges.length - 1]!) * 0.5;
        return { ...s, colEdges: scaleColEdges(s.colEdges, cx, 0.998) };
      },
    },
  ];

  if (!fastMode) {
    for (let i = 1; i < rows; i++) {
      const idx = i;
      list.push({
        name: `rowLine${idx}+`,
        apply: (s) => {
          const rowLines = [...s.rowLines];
          rowLines[idx] = Math.min(1, rowLines[idx]! + dy);
          return { ...s, rowLines };
        },
      });
      list.push({
        name: `rowLine${idx}-`,
        apply: (s) => {
          const rowLines = [...s.rowLines];
          rowLines[idx] = Math.max(0, rowLines[idx]! - dy);
          return { ...s, rowLines };
        },
      });
    }
    for (let j = 1; j < cols; j++) {
      const idx = j;
      list.push({
        name: `colEdge${idx}+`,
        apply: (s) => {
          const colEdges = [...s.colEdges];
          colEdges[idx] = Math.min(1, colEdges[idx]! + dx);
          return { ...s, colEdges };
        },
      });
      list.push({
        name: `colEdge${idx}-`,
        apply: (s) => {
          const colEdges = [...s.colEdges];
          colEdges[idx] = Math.max(0, colEdges[idx]! - dx);
          return { ...s, colEdges };
        },
      });
    }
  }

  return list;
}

function evaluateState(
  canvas: HTMLCanvasElement,
  state: OptimizeState,
  initial: InitialGeometryResult,
  rows: number,
  cols: number,
  initialBubbles: BubbleSample[][]
): OptimizeState {
  const cells = buildCellsFromNormLines(state.rowLines, state.colEdges, rows, cols);
  const geometry = bubblesToGeometry(
    canvas,
    state.rowLines,
    state.colEdges,
    state.bubbles,
    state.frame,
    rows,
    cols
  );
  geometry.cells = cells;

  const refinedBubbles = refineAllBubbles({
    canvas,
    geometry,
    rowLines: state.rowLines,
    colEdges: state.colEdges,
    rows,
    cols,
    mode: 'align',
  });

  const frozenPartial = {
    ...geometry,
    bubbles: refinedBubbles,
    cells,
    rowLines: state.rowLines,
    colEdges: state.colEdges,
    frame: state.frame,
    frozen: true as const,
    source: 'unified-engine' as const,
    quality: {
      score: 0,
      bubbleFit: initial.bubbleFit,
      stability: 0,
      spatialConsistency: 0,
      validationOk: initial.validationOk,
      issues: [],
    },
  } as FrozenOmrGeometry;

  const read = readFrozenGeometry(canvas, frozenPartial, rows, cols);
  const imageData = getOmrCanvasImageDataForEngine(canvas);
  const score = computeObjectiveScore({
    picks: read.picks,
    rows: read.rows,
    bubbles: refinedBubbles,
    rowLines: state.rowLines,
    colEdges: state.colEdges,
    geometry: frozenPartial,
    rowCount: rows,
    imageData,
    canvasW: canvas.width,
    canvasH: canvas.height,
    initialBubbles,
  });

  return { ...state, bubbles: refinedBubbles, score };
}

export type OptimizeResult = {
  geometry: FrozenOmrGeometry;
  read: ReturnType<typeof readFrozenGeometry>;
  iterations: number;
  converged: boolean;
  bestScore: number;
  meanCenterErrorPx: number;
  scoreDelta: number;
};

function buildFrozenFromState(
  canvas: HTMLCanvasElement,
  state: OptimizeState,
  initial: InitialGeometryResult,
  rows: number,
  cols: number,
  mode: 'align' | 'read'
): FrozenOmrGeometry {
  const cells =
    initial.geometry.cells.length === rows
      ? initial.geometry.cells
      : buildCellsFromNormLines(state.rowLines, state.colEdges, rows, cols);
  const finalBubbles = refineAllBubbles({
    canvas,
    geometry: { ...initial.geometry, cells },
    rowLines: state.rowLines,
    colEdges: state.colEdges,
    rows,
    cols,
    mode,
  });
  return {
    imageWidth: canvas.width,
    imageHeight: canvas.height,
    cells,
    bubbles: finalBubbles,
    frame: state.frame,
    rowLines: state.rowLines,
    colEdges: state.colEdges,
    frozen: true,
    source: 'unified-engine',
    quality: {
      score: state.score,
      bubbleFit: initial.bubbleFit,
      stability: 0,
      spatialConsistency: 0,
      validationOk: initial.validationOk,
      issues: [],
    },
  };
}

/**
 * Iterative geometry optimization — accept/reject per perturbation.
 */
export function optimizeGeometry(
  canvas: HTMLCanvasElement,
  initial: InitialGeometryResult,
  rows: number,
  cols: number,
  opts?: OptimizeOptions
): OptimizeResult {
  const maxIterations = opts?.maxIterations ?? (opts?.fastMode ? 80 : 320);
  const convergenceEpsilon = opts?.convergenceEpsilon ?? 0.0008;
  const stagnantLimit = opts?.stagnantLimit ?? 24;
  const maxCenterErrorPx = opts?.maxMeanCenterErrorPx ?? FREEZE_GATE.maxMeanCenterErrorPx;
  const minRelativeImprovement =
    opts?.minRelativeScoreImprovement ?? FREEZE_GATE.minRelativeScoreImprovement;

  const initialBubbles = refineAllBubbles({
    canvas,
    geometry: initial.geometry,
    rowLines: initial.rowLines,
    colEdges: initial.colEdges,
    rows,
    cols,
    mode: 'align',
  });

  if (opts?.lockGridLines) {
    const cells =
      initial.geometry.cells.length === rows
        ? initial.geometry.cells
        : buildCellsFromNormLines(initial.rowLines, initial.colEdges, rows, cols);
    const alignBubbles = refineAllBubbles({
      canvas,
      geometry: { ...initial.geometry, cells },
      rowLines: initial.rowLines,
      colEdges: initial.colEdges,
      rows,
      cols,
      mode: 'align',
    });
    const frozen: FrozenOmrGeometry = {
      imageWidth: canvas.width,
      imageHeight: canvas.height,
      cells,
      bubbles: alignBubbles,
      frame: initial.frame,
      rowLines: initial.rowLines,
      colEdges: initial.colEdges,
      frozen: true,
      source: 'unified-engine',
      quality: {
        score: 0,
        bubbleFit: initial.bubbleFit,
        stability: 0,
        spatialConsistency: 0,
        validationOk: initial.validationOk,
        issues: [],
      },
    };
    const read = readFrozenGeometry(canvas, frozen, rows, cols);
    const centerErr = meanCenterErrorPx(frozen);
    const resolved = read.picks.filter((p) => p !== null).length;
    frozen.quality = { ...frozen.quality, score: resolved / Math.max(1, rows) };
    return {
      geometry: frozen,
      read,
      iterations: 0,
      converged: centerErr <= maxCenterErrorPx && resolved >= rows * 0.85,
      bestScore: frozen.quality.score,
      meanCenterErrorPx: centerErr,
      scoreDelta: 0,
    };
  }

  let best: OptimizeState = evaluateState(
    canvas,
    {
      rowLines: [...initial.rowLines],
      colEdges: [...initial.colEdges],
      frame: initial.frame,
      bubbles: initialBubbles,
      score: Number.NEGATIVE_INFINITY,
    },
    initial,
    rows,
    cols,
    initialBubbles
  );
  best = evaluateState(canvas, best, initial, rows, cols, initialBubbles);
  const scoreAtStart = best.score;

  const perturbations = buildPerturbations(rows, cols, Boolean(opts?.fastMode));
  let stagnant = 0;
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIterations && stagnant < stagnantLimit; iter++) {
    iterations = iter + 1;
    const scoreBeforeIter = best.score;
    let improved = false;

    for (const p of perturbations) {
      const candidateBase = cloneState(best);
      const perturbed = p.apply(candidateBase);
      if (!perturbed) continue;
      const candidate = evaluateState(canvas, perturbed, initial, rows, cols, initialBubbles);
      if (candidate.score > best.score + convergenceEpsilon) {
        best = candidate;
        improved = true;
      }
    }

    if (improved) stagnant = 0;
    else stagnant++;

    const probeFrozen = buildFrozenFromState(canvas, best, initial, rows, cols, 'align');
    const centerErr = meanCenterErrorPx(probeFrozen);
    const iterScoreDelta = Math.abs(best.score - scoreBeforeIter);
    const relativeImprovement =
      Math.abs(scoreBeforeIter) > 1e-9 ? iterScoreDelta / Math.abs(scoreBeforeIter) : iterScoreDelta;

    if (
      !improved &&
      centerErr <= maxCenterErrorPx &&
      relativeImprovement < minRelativeImprovement
    ) {
      converged = true;
      break;
    }
  }

  if (!converged) {
    const finalCenterErr = meanCenterErrorPx(
      buildFrozenFromState(canvas, best, initial, rows, cols, 'align')
    );
    converged = stagnant >= stagnantLimit && finalCenterErr <= maxCenterErrorPx;
  }

  const frozen = buildFrozenFromState(canvas, best, initial, rows, cols, 'align');
  frozen.quality = {
    ...frozen.quality,
    score: best.score,
  };
  const read = readFrozenGeometry(canvas, frozen, rows, cols);
  const finalCenterErrorPx = meanCenterErrorPx(frozen);
  const scoreDelta = Math.abs(best.score - scoreAtStart);

  return {
    geometry: frozen,
    read,
    iterations,
    converged,
    bestScore: best.score,
    meanCenterErrorPx: finalCenterErrorPx,
    scoreDelta,
  };
}

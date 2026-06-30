import { CALIFACIL_FIDUCIAL_CENTERS_NORM } from '@/lib/printExam';
import {
  computeHomographySrcToDst,
  warpCanvasWithHomography,
  type HomographyPoint,
} from '@/lib/omr/homography';

export const REFINE_WARP_MAX_ITERATIONS = 3;
export const REFINE_WARP_TARGET_MAX_ERROR_PX = 3;

export type FiducialCornerId = 'tl' | 'tr' | 'br' | 'bl';

export type FiducialAlignmentReport = {
  ok: boolean;
  maxErrorPx: number;
  meanErrorPx: number;
  maxAllowedPx: number;
};

export type FiducialDetectFn = (
  canvas: HTMLCanvasElement
) => Record<FiducialCornerId, HomographyPoint | null>;

export type FiducialMeasureFn = (
  canvas: HTMLCanvasElement,
  maxAllowedPx: number
) => FiducialAlignmentReport;

export type RefineWarpedSheetResult = {
  canvas: HTMLCanvasElement;
  alignment: FiducialAlignmentReport;
  iterations: number;
};

function fiducialQuadFromReport(
  detected: Record<FiducialCornerId, HomographyPoint | null>
): [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint] | null {
  const ids: FiducialCornerId[] = ['tl', 'tr', 'br', 'bl'];
  const pts: HomographyPoint[] = [];
  for (const id of ids) {
    const p = detected[id];
    if (!p) return null;
    pts.push(p);
  }
  return pts as [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint];
}

function expectedFiducialQuad(
  width: number,
  height: number
): [HomographyPoint, HomographyPoint, HomographyPoint, HomographyPoint] {
  return [
    { x: CALIFACIL_FIDUCIAL_CENTERS_NORM.tl.x * width, y: CALIFACIL_FIDUCIAL_CENTERS_NORM.tl.y * height },
    { x: CALIFACIL_FIDUCIAL_CENTERS_NORM.tr.x * width, y: CALIFACIL_FIDUCIAL_CENTERS_NORM.tr.y * height },
    { x: CALIFACIL_FIDUCIAL_CENTERS_NORM.br.x * width, y: CALIFACIL_FIDUCIAL_CENTERS_NORM.br.y * height },
    { x: CALIFACIL_FIDUCIAL_CENTERS_NORM.bl.x * width, y: CALIFACIL_FIDUCIAL_CENTERS_NORM.bl.y * height },
  ];
}

/**
 * Refina iterativamente una hoja ya warpeada alineando fiduciales detectados con la plantilla PDF.
 */
export function refineWarpedSheetFiducials(
  warped: HTMLCanvasElement,
  detectFiducials: FiducialDetectFn,
  measureAlignment: FiducialMeasureFn,
  opts?: {
    maxIterations?: number;
    targetMaxErrorPx?: number;
    maxAllowedPx?: number;
  }
): RefineWarpedSheetResult {
  const maxIterations = opts?.maxIterations ?? REFINE_WARP_MAX_ITERATIONS;
  const targetMaxErrorPx = opts?.targetMaxErrorPx ?? REFINE_WARP_TARGET_MAX_ERROR_PX;
  const maxAllowedPx = opts?.maxAllowedPx ?? targetMaxErrorPx;

  let current = warped;
  let alignment = measureAlignment(current, maxAllowedPx);
  let iterations = 0;

  while (iterations < maxIterations && alignment.maxErrorPx > targetMaxErrorPx) {
    const detected = detectFiducials(current);
    const srcQuad = fiducialQuadFromReport(detected);
    if (!srcQuad) break;

    const dstQuad = expectedFiducialQuad(current.width, current.height);
    const h = computeHomographySrcToDst(srcQuad, dstQuad);
    if (!h) break;

    const corrected = warpCanvasWithHomography(current, h, current.width, current.height);
    if (!corrected) break;

    const nextAlignment = measureAlignment(corrected, maxAllowedPx);
    if (nextAlignment.maxErrorPx >= alignment.maxErrorPx - 0.25) break;

    current = corrected;
    alignment = nextAlignment;
    iterations++;
  }

  return { canvas: current, alignment, iterations };
}

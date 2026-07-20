import {

  buildRegisteredAnswerSheetGeometry,

  detectFullCanvasTableGeometry,

  type CalifacilOmrScanGeometry,

  clampCalifacilOmrRowCount,

  califacilOmrOrangeFrameRect,

  type OmrNormRect,

} from '@/lib/omrScan';

import { validateAnswerSheetGeometry } from '@/lib/omr/validate-geometry';

import {

  pickFooterAnswerSheetGeometryForEngine,

  scoreAnswerSheetGeometryBubbleFitForEngine,

  getOmrCanvasImageDataForEngine,

  extendAnswerSheetLastColumnCellsForEngine,

} from '@/lib/omr/engine/omr-bridge';

import { extractLinesFromGeometry } from '@/lib/omr/engine/geometry-lines';

import { detectCircleGridGeometry } from '@/lib/omr/engine/detect-circles-grid';

import {

  buildReferenceAnchoredGeometry,

  isReferenceGradeExam,

} from '@/lib/omr/reference-grade';

import {

  canvasMatchesReferenceGrade,
  canvasNearReferenceGrade,
  hasReferenceGradeCalibration,

} from '@/lib/omr/reference-grade-merge';



export type InitialGeometryResult = {

  geometry: CalifacilOmrScanGeometry;

  rowLines: number[];

  colEdges: number[];

  frame: OmrNormRect;

  bubbleFit: number;

  validationOk: boolean;

};



function buildInitialFromGeometry(

  geometry: CalifacilOmrScanGeometry,

  rows: number,

  cols: number,

  W: number,

  H: number,

  imageData: Uint8ClampedArray | null

): InitialGeometryResult {

  const validation = validateAnswerSheetGeometry(geometry, rows);

  const { rowLines, colEdges } = extractLinesFromGeometry(geometry, rows, cols);

  const frame =

    califacilOmrOrangeFrameRect(geometry, rows) ??

    ({ x: 0.03, y: 0.04, w: 0.94, h: 0.92 } as OmrNormRect);

  const bubbleFit = imageData

    ? scoreAnswerSheetGeometryBubbleFitForEngine(imageData, W, H, geometry, rows)

    : 0;

  return {

    geometry: { ...geometry, imageWidth: W, imageHeight: H },

    rowLines,

    colEdges,

    frame,

    bubbleFit,

    validationOk: validation.ok,

  };

}



/**

 * Compose initial geometry from existing detectors (sensors only — no pick reading).

 */

export function detectInitialGeometry(

  canvas: HTMLCanvasElement,

  columns: number,

  rowCount?: number

): InitialGeometryResult | null {

  const rows = clampCalifacilOmrRowCount(rowCount);

  const cols = Math.max(2, Math.min(5, Math.round(columns)));

  const W = canvas.width;

  const H = canvas.height;

  const imageData = getOmrCanvasImageDataForEngine(canvas);



  const isReferenceCanvas =

    isReferenceGradeExam(rows, cols) &&

    hasReferenceGradeCalibration() &&

    canvasNearReferenceGrade(W, H);



  if (isReferenceCanvas) {

    const registered = buildRegisteredAnswerSheetGeometry(canvas, rows, cols);

    const regInitial = buildInitialFromGeometry(registered, rows, cols, W, H, imageData);

    if (regInitial.validationOk && regInitial.bubbleFit >= 0.35) {

      return regInitial;

    }



    const anchored = buildReferenceAnchoredGeometry(canvas, rows, cols);

    if (anchored) {

      const anchoredInitial = buildInitialFromGeometry(anchored, rows, cols, W, H, imageData);

      const bubbleCount =

        anchored.bubbles?.flat().filter((b) => b.r > 0).length ?? 0;

      const hasVisualBubbles = bubbleCount >= rows * cols * 0.5;

      if (

        anchoredInitial.validationOk &&

        (anchoredInitial.bubbleFit >= 0.35 || hasVisualBubbles)

      ) {

        return anchoredInitial;

      }

    }



    if (regInitial.bubbleFit >= 0.35) {

      return regInitial;

    }

  } else if (isReferenceGradeExam(rows, cols) && hasReferenceGradeCalibration()) {

    const anchored = buildReferenceAnchoredGeometry(canvas, rows, cols);

    if (anchored) {

      const anchoredInitial = buildInitialFromGeometry(anchored, rows, cols, W, H, imageData);

      const bubbleCount =

        anchored.bubbles?.flat().filter((b) => b.r > 0).length ?? 0;

      const hasVisualBubbles = bubbleCount >= rows * cols * 0.5;

      if (

        anchoredInitial.validationOk &&

        (anchoredInitial.bubbleFit >= 0.35 || hasVisualBubbles)

      ) {

        return anchoredInitial;

      }

    }

  }



  const circleGrid = detectCircleGridGeometry(canvas, columns, rows);

  if (circleGrid && circleGrid.bubbleFit >= 0.45 && circleGrid.validationOk) {

    return circleGrid;

  }



  const candidates: CalifacilOmrScanGeometry[] = [];



  const footer = pickFooterAnswerSheetGeometryForEngine([], rows, columns, canvas);

  if (footer) candidates.push(footer);



  const registered = buildRegisteredAnswerSheetGeometry(canvas, rows, columns);

  const regVal = validateAnswerSheetGeometry(registered, rows);

  if (regVal.ok) candidates.push(registered);



  const full = detectFullCanvasTableGeometry(canvas, rows, columns);

  if (full?.geometry && validateAnswerSheetGeometry(full.geometry, rows).ok) {

    candidates.push(full.geometry);

  }



  const unique = candidates.filter((g, i, arr) => arr.findIndex((o) => o === g) === i);

  if (unique.length === 0) return null;



  unique.sort((a, b) => {

    if (imageData) {

      const fitA = scoreAnswerSheetGeometryBubbleFitForEngine(imageData, W, H, a, rows);

      const fitB = scoreAnswerSheetGeometryBubbleFitForEngine(imageData, W, H, b, rows);

      if (Math.abs(fitB - fitA) > 0.02) return fitB - fitA;

    }

    const va = validateAnswerSheetGeometry(a, rows);

    const vb = validateAnswerSheetGeometry(b, rows);

    if (va.ok !== vb.ok) return va.ok ? -1 : 1;

    return 0;

  });



  let geometry = extendAnswerSheetLastColumnCellsForEngine(unique[0]!, rows);

  return buildInitialFromGeometry(geometry, rows, cols, W, H, imageData);

}



/** Re-exports for unified OMR engine — thin bridge over omrScan internals. */
export {
  pickFooterAnswerSheetGeometry as pickFooterAnswerSheetGeometryForEngine,
  scoreAnswerSheetGeometryBubbleFit as scoreAnswerSheetGeometryBubbleFitForEngine,
  getOmrCanvasImageData as getOmrCanvasImageDataForEngine,
  extendAnswerSheetLastColumnCells as extendAnswerSheetLastColumnCellsForEngine,
  geometryCellsForBubbleSampling as geometryCellsForBubbleSamplingForEngine,
  sampleBubbleMarkAtCell as sampleBubbleMarkAtCellForEngine,
  refineAnswerSheetGeometryToBubblePeaks,
  readAnswerSheetPicksFromTemplateGeometry,
  refineBubbleCenterInCell as refineBubbleCenterInCellForEngine,
  sampleAnnulusDarkness as sampleAnnulusDarknessForEngine,
  sampleDiskDarkness as sampleDiskDarknessForEngine,
  califacilOmrOrangeFrameRect,
  clampCalifacilOmrRowCount,
  scanCalifacilOmrSheetWithMeta,
  CALIFACIL_DESKTOP_GRADE_SCAN_OPTS,
  sanitizeAnswerSheetOmrMeta,
  syncCalifacilOmrGeometryImageSize,
  readAnswerSheetControlNumberFromCanvas,
} from '@/lib/omrScan';

export const UNIFIED_FRAME_SCAN_THRESHOLDS = {
  minMarkDarkness: 0.072,
  minBestVsSecondGap: 0.038,
  minBestVsSecondRatio: 1.35,
  minCenterVsRingDelta: 0.04,
  minSolidCenterDarkness: 0.24,
  ringDarknessWeight: 0.35,
} as const;

export { preprocessForSheetDetection } from '@/lib/omr/preprocess';
export { refineWarpedSheetFiducials, REFINE_WARP_MAX_ITERATIONS, REFINE_WARP_TARGET_MAX_ERROR_PX } from '@/lib/omr/refine-warp';
export { computeHomographySrcToDst, warpCanvasWithHomography } from '@/lib/omr/homography';
export { validateAnswerSheetGeometry, type AnswerSheetGeometryValidation } from '@/lib/omr/validate-geometry';
export { warpCalifacilMobileCapture, warpCalifacilMobileCaptureFast, type MobileWarpPipelineResult, type RoiQuad } from '@/lib/omr/pipeline';

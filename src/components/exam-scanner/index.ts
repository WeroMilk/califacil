export { ExamScannerScreen } from '@/components/exam-scanner/exam-scanner-screen';
export type { ExamScannerScreenProps } from '@/components/exam-scanner/exam-scanner-screen';
export type { DocumentDetectionPhase, ViewportPoint } from '@/components/exam-scanner/types';
export {
  deriveDetectionPhase,
  deriveStatusLabel,
  guideRectToViewportQuad,
  createStaticScannerGuide,
  readScannerViewportPx,
} from '@/components/exam-scanner/document-detector';
export {
  CAPTURE_STABLE_TICKS_REQUIRED,
  shouldTriggerAutoCapture,
} from '@/components/exam-scanner/capture-controller';
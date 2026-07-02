import type { ViewfinderGuideRectPx, ViewportPoint } from '@/components/exam-scanner/types';
export {
  deriveDetectionPhase,
  deriveStatusLabel,
  phaseStrokeColor,
  type ScannerUiInput,
} from '@/components/exam-scanner/exam-stability';

/** Convierte el marco guía estático en un cuadrilátero para el overlay. */
export function guideRectToViewportQuad(guide: ViewfinderGuideRectPx): ViewportPoint[] {
  const { left, top, width, height } = guide;
  return [
    { x: left, y: top },
    { x: left + width, y: top },
    { x: left + width, y: top + height },
    { x: left, y: top + height },
  ];
}

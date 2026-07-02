import type { ViewfinderGuideRectPx, ViewportPoint } from '@/components/exam-scanner/types';
import { califacilMobileScannerGuideInViewportPx } from '@/lib/omrScan';
export {
  deriveDetectionPhase,
  deriveStatusLabel,
  phaseStrokeColor,
  type ScannerUiInput,
} from '@/components/exam-scanner/exam-stability';

/** Tamaño visible del escáner (visualViewport en iOS Safari). */
export function readScannerViewportPx(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  const vv = window.visualViewport;
  return {
    w: Math.round(vv?.width ?? window.innerWidth),
    h: Math.round(vv?.height ?? window.innerHeight),
  };
}

/** Marco guía fijo para el overlay (coords. de pantalla). */
export function createStaticScannerGuide(
  viewportW: number,
  viewportH: number
): ViewfinderGuideRectPx | null {
  if (viewportW < 40 || viewportH < 40) return null;
  return califacilMobileScannerGuideInViewportPx(viewportW, viewportH);
}

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

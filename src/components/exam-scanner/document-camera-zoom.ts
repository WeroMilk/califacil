import type { CSSProperties } from 'react';
import type { DocumentDetectionPhase, ViewportPoint } from '@/components/exam-scanner/types';
import { readScannerViewportPx } from '@/components/exam-scanner/document-detector';

export type DocumentCameraZoom = {
  scale: number;
  translateX: number;
  translateY: number;
};

/** Escala y centra el fotograma para que la hoja detectada llene la pantalla (estilo ZipGrade). */
export function computeViewportDocumentZoom(
  polygon: ViewportPoint[],
  viewportW: number,
  viewportH: number,
  fillRatio = 0.98
): DocumentCameraZoom | null {
  if (polygon.length !== 4 || viewportW < 40 || viewportH < 40) return null;

  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const bw = Math.max(56, maxX - minX);
  const bh = Math.max(56, maxY - minY);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  let scale = Math.min(viewportW / bw, viewportH / bh) * fillRatio;
  scale = Math.min(scale, 3.2);
  if (scale < 1.05) return null;

  return {
    scale,
    translateX: viewportW * 0.5 - cx * scale,
    translateY: viewportH * 0.5 - cy * scale,
  };
}

export function documentCameraZoomStyle(
  polygon: ViewportPoint[] | null | undefined,
  phase: DocumentDetectionPhase,
  stableProgress: number
): CSSProperties {
  const poly = polygon?.length === 4 ? polygon : null;
  const zoomActive =
    poly &&
    (phase === 'stable' || phase === 'capturing' || (phase === 'searching' && stableProgress > 0.08));

  if (!zoomActive || !poly) {
    return {
      transform: 'translate3d(0,0,0) scale(1)',
      transition: 'transform 260ms ease-out',
      willChange: 'transform',
    };
  }

  const { w, h } = readScannerViewportPx();
  const zoom = computeViewportDocumentZoom(poly, w, h);
  if (!zoom) {
    return {
      transform: 'translate3d(0,0,0) scale(1)',
      transition: 'transform 260ms ease-out',
      willChange: 'transform',
    };
  }

  let blend = 0.72;
  if (phase === 'capturing') blend = 1;
  else if (phase === 'stable') blend = 0.88 + stableProgress * 0.12;
  else if (phase === 'searching') blend = 0.55 + stableProgress * 0.35;

  const scale = 1 + (zoom.scale - 1) * blend;
  const translateX = zoom.translateX * blend;
  const translateY = zoom.translateY * blend;

  return {
    transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`,
    transformOrigin: '0 0',
    transition: 'transform 260ms ease-out',
    willChange: 'transform',
  };
}

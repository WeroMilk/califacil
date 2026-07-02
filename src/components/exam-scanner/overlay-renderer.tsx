'use client';

import { memo, useId, useMemo } from 'react';
import {
  califacilFiducialCornerGuidesOnViewportQuad,
  califacilStaticFiducialCornerGuidesInViewportPx,
} from '@/lib/omrScan';
import { phaseStrokeColor, guideRectToViewportQuad } from '@/components/exam-scanner/document-detector';
import { useSmoothedPolygon } from '@/components/exam-scanner/use-smoothed-polygon';
import type {
  DocumentDetectionPhase,
  ViewfinderGuideRectPx,
  ViewportPoint,
} from '@/components/exam-scanner/types';

type Props = {
  phase: DocumentDetectionPhase;
  documentPolygon?: ViewportPoint[] | null;
  guideRect?: ViewfinderGuideRectPx | null;
};

function cornerPaths(poly: ViewportPoint[], len: number, stroke: string, sw: number) {
  const [tl, tr, br, bl] = poly;
  return (
    <>
      <path d={`M ${tl.x} ${tl.y + len} L ${tl.x} ${tl.y} L ${tl.x + len} ${tl.y}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <path d={`M ${tr.x - len} ${tr.y} L ${tr.x} ${tr.y} L ${tr.x} ${tr.y + len}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <path d={`M ${br.x} ${br.y - len} L ${br.x} ${br.y} L ${br.x - len} ${br.y}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      <path d={`M ${bl.x + len} ${bl.y} L ${bl.x} ${bl.y} L ${bl.x} ${bl.y - len}`} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
    </>
  );
}

function OverlayRendererInner({ phase, documentPolygon, guideRect }: Props) {
  const maskId = useId();
  const poly =
    documentPolygon && documentPolygon.length === 4 ? documentPolygon : null;
  const smoothPoly = useSmoothedPolygon(poly);
  const stroke = phaseStrokeColor(phase);
  const points = smoothPoly?.map((p) => `${p.x},${p.y}`).join(' ') ?? '';

  const bracketLen = useMemo(() => {
    if (typeof window === 'undefined') return smoothPoly ? 38 : 30;
    const vw = window.innerWidth;
    return smoothPoly
      ? Math.round(Math.min(44, Math.max(30, vw * 0.1)))
      : Math.round(Math.min(36, Math.max(26, vw * 0.085)));
  }, [smoothPoly]);

  const bracketStroke = smoothPoly ? stroke : phaseStrokeColor(phase);
  const guideQuad =
    !smoothPoly && guideRect && guideRect.width > 40
      ? guideRectToViewportQuad(guideRect)
      : null;
  const guidePoints = guideQuad?.map((p) => `${p.x},${p.y}`).join(' ') ?? '';

  const cornerGuides = useMemo(() => {
    if (smoothPoly) {
      return califacilFiducialCornerGuidesOnViewportQuad(
        smoothPoly as [ViewportPoint, ViewportPoint, ViewportPoint, ViewportPoint]
      );
    }
    if (guideRect && guideRect.width > 40) {
      return califacilStaticFiducialCornerGuidesInViewportPx(guideRect);
    }
    return null;
  }, [smoothPoly, guideRect]);

  return (
    <div className="exam-scanner-overlay pointer-events-none absolute inset-0 z-10">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {smoothPoly ? (
          <>
            <defs>
              <mask id={maskId}>
                <rect width="100%" height="100%" fill="white" />
                <polygon points={points} fill="black" />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.52)"
              mask={`url(#${maskId})`}
              className="exam-scanner-dim"
            />
            <polygon
              points={points}
              fill="rgba(255,255,255,0.04)"
              stroke={stroke}
              strokeWidth={phase === 'stable' || phase === 'capturing' ? 3.25 : 2.75}
              className="exam-scanner-border"
              style={{ stroke }}
            />
            {cornerPaths(smoothPoly, bracketLen, bracketStroke, 3.5)}
          </>
        ) : guideQuad ? (
          <>
            <defs>
              <mask id={maskId}>
                <rect width="100%" height="100%" fill="white" />
                <polygon points={guidePoints} fill="black" />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.45)"
              mask={`url(#${maskId})`}
              className="exam-scanner-dim"
            />
            {cornerPaths(guideQuad, bracketLen, bracketStroke, 3.25)}
          </>
        ) : (
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.18)" className="exam-scanner-dim" />
        )}
      </svg>

      {cornerGuides && !smoothPoly && phase === 'searching' && !guideQuad
        ? cornerGuides.map((g, i) => (
            <div
              key={i}
              className="exam-scanner-corner-fallback absolute rounded-lg border-[2.5px] border-white/50 bg-white/10"
              style={{ left: g.left, top: g.top, width: g.size, height: g.size }}
              aria-hidden
            />
          ))
        : null}
    </div>
  );
}

export const OverlayRenderer = memo(OverlayRendererInner);

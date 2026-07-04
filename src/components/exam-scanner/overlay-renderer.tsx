'use client';

import { memo, useId, useMemo } from 'react';
import {
  califacilFiducialCornerGuidesOnViewportQuad,
  califacilStaticFiducialCornerGuidesInViewportPx,
} from '@/lib/omrScan';
import { MobileAnswerSheetAlignGuideOverlay } from '@/components/mobile-answer-sheet-bubble-guide-overlay';
import {
  createStaticScannerGuide,
  guideRectToViewportQuad,
  phaseStrokeColor,
  readScannerViewportPx,
} from '@/components/exam-scanner/document-detector';
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
  stableProgress?: number;
  fiducialCorners?: [boolean, boolean, boolean, boolean];
  stripAligned?: boolean;
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

function OverlayRendererInner({
  phase,
  documentPolygon,
  guideRect,
  stableProgress = 0,
  fiducialCorners = [false, false, false, false],
  stripAligned = false,
}: Props) {
  const maskId = useId();
  const poly =
    documentPolygon && documentPolygon.length === 4 ? documentPolygon : null;
  const smoothPoly = useSmoothedPolygon(poly);
  const stroke = phaseStrokeColor(phase);
  const points = smoothPoly?.map((p) => `${p.x},${p.y}`).join(' ') ?? '';

  const staticGuide = useMemo(() => {
    if (guideRect && guideRect.width > 40) return guideRect;
    const { w, h } = readScannerViewportPx();
    return createStaticScannerGuide(w, h);
  }, [guideRect]);

  const showDetectedMask =
    Boolean(smoothPoly) &&
    (phase === 'stable' ||
      phase === 'capturing' ||
      (phase === 'searching' && stableProgress > 0.08));

  const bracketLen = useMemo(() => {
    if (typeof window === 'undefined') return showDetectedMask ? 38 : 30;
    const vw = window.innerWidth;
    return showDetectedMask
      ? Math.round(Math.min(44, Math.max(30, vw * 0.1)))
      : Math.round(Math.min(36, Math.max(26, vw * 0.085)));
  }, [showDetectedMask]);

  const bracketStroke = showDetectedMask ? stroke : phaseStrokeColor(phase);
  const guideQuad = staticGuide ? guideRectToViewportQuad(staticGuide) : null;
  const guidePoints = guideQuad?.map((p) => `${p.x},${p.y}`).join(' ') ?? '';

  const cornerGuides = useMemo(() => {
    if (showDetectedMask && smoothPoly) {
      return califacilFiducialCornerGuidesOnViewportQuad(
        smoothPoly as [ViewportPoint, ViewportPoint, ViewportPoint, ViewportPoint]
      );
    }
    if (staticGuide) {
      return califacilStaticFiducialCornerGuidesInViewportPx(staticGuide);
    }
    return null;
  }, [showDetectedMask, smoothPoly, staticGuide]);

  const fiducialCount = fiducialCorners.filter(Boolean).length;
  const sheetAligned = fiducialCount >= 4;

  const alignGuideRect = useMemo(() => {
    if (!staticGuide || staticGuide.width <= 40) return null;
    return {
      left: staticGuide.left,
      top: staticGuide.top,
      width: staticGuide.width,
      height: staticGuide.height,
    };
  }, [staticGuide]);

  return (
    <div className="exam-scanner-overlay pointer-events-none absolute inset-0 z-10">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {showDetectedMask && smoothPoly ? (
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
              fill="rgba(0,0,0,0.68)"
              mask={`url(#${maskId})`}
              className="exam-scanner-dim"
            />
            <polygon
              points={points}
              fill="rgba(255,255,255,0.04)"
              stroke={stroke}
              strokeWidth={phase === 'capturing' ? 3.25 : 3}
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
            {smoothPoly ? (
              <>
                <polygon
                  points={points}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={2.5}
                  className="exam-scanner-border"
                  style={{ stroke }}
                />
                {cornerPaths(smoothPoly, bracketLen, stroke, 3)}
              </>
            ) : null}
          </>
        ) : (
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.18)" className="exam-scanner-dim" />
        )}
      </svg>

      {alignGuideRect ? (
        <MobileAnswerSheetAlignGuideOverlay guideRect={alignGuideRect} aligned={sheetAligned} />
      ) : null}

      {cornerGuides
        ? cornerGuides.map((g, i) => (
            <div
              key={i}
              className="absolute rounded-md border-[2.5px] transition-colors duration-200"
              style={{
                left: g.left,
                top: g.top,
                width: g.size,
                height: g.size,
                borderColor: fiducialCorners[i]
                  ? 'rgba(251,146,60,0.98)'
                  : 'rgba(255,255,255,0.45)',
                backgroundColor: fiducialCorners[i]
                  ? 'rgba(251,146,60,0.22)'
                  : 'rgba(255,255,255,0.08)',
              }}
              aria-hidden
            />
          ))
        : null}

      {stripAligned && alignGuideRect ? (
        <>
          <div
            className="pointer-events-none absolute z-[11] rounded-sm bg-black/55 ring-2 ring-orange-400/90"
            style={{
              left: alignGuideRect.left + alignGuideRect.width * 0.018,
              top: alignGuideRect.top + alignGuideRect.height * 0.12,
              width: Math.max(8, alignGuideRect.width * 0.028),
              height: alignGuideRect.height * 0.76,
            }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute z-[11] rounded-sm bg-black/55 ring-2 ring-orange-400/90"
            style={{
              left: alignGuideRect.left + alignGuideRect.width * 0.954,
              top: alignGuideRect.top + alignGuideRect.height * 0.12,
              width: Math.max(8, alignGuideRect.width * 0.028),
              height: alignGuideRect.height * 0.76,
            }}
            aria-hidden
          />
        </>
      ) : null}
    </div>
  );
}

export const OverlayRenderer = memo(OverlayRendererInner);

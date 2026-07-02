'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  califacilFiducialCornerGuidesOnViewportQuad,
  califacilStaticFiducialCornerGuidesInViewportPx,
  type CalifacilSheetCornerGuidePx,
} from '@/lib/omrScan';

export type ViewportPoint = { x: number; y: number };

export type ViewfinderGuideRectPx = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Props = {
  documentPolygon?: ViewportPoint[] | null;
  /** Marco guía carta en pantalla (cuando aún no hay detección de franjas). */
  guideRect?: ViewfinderGuideRectPx | null;
  fiducialCorners?: [boolean, boolean, boolean, boolean];
  detected?: boolean;
  hint?: string;
  examTitle?: string;
  /** 0–1 progreso hacia captura automática */
  captureProgress?: number;
};

function lerpPoint(a: ViewportPoint, b: ViewportPoint, t: number): ViewportPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function useSmoothedPolygon(target: ViewportPoint[] | null): ViewportPoint[] | null {
  const [display, setDisplay] = useState<ViewportPoint[] | null>(target);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef<ViewportPoint[] | null>(target);
  const startRef = useRef(0);

  useEffect(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (!target || target.length !== 4) {
      setDisplay(null);
      fromRef.current = null;
      return;
    }
    const from = fromRef.current ?? target;
    fromRef.current = target;
    startRef.current = performance.now();
    const duration = 140;

    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      const eased = 1 - (1 - t) ** 4;
      setDisplay(
        target.map((p, i) => lerpPoint(from[i] ?? p, p, eased)) as ViewportPoint[]
      );
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target]);

  return display;
}

function ZipgradeCornerFrame({
  guide,
  detected,
  sheetDetected,
}: {
  guide: CalifacilSheetCornerGuidePx;
  detected: boolean;
  sheetDetected: boolean;
}) {
  return (
    <div
      className={cn(
        'absolute z-20 rounded-lg border-[2.5px]',
        detected
          ? 'border-emerald-400 bg-white/55 shadow-[0_0_0_2px_rgba(52,211,153,0.4)]'
          : sheetDetected
            ? 'border-black/80 bg-white/45 shadow-[0_2px_10px_rgba(0,0,0,0.22)]'
            : 'border-white/90 bg-white/40 shadow-[0_2px_12px_rgba(0,0,0,0.25)]'
      )}
      style={{ left: guide.left, top: guide.top, width: guide.size, height: guide.size }}
      aria-hidden
    />
  );
}

export function IphoneDocumentScannerOverlay({
  documentPolygon,
  guideRect,
  fiducialCorners = [false, false, false, false],
  detected = false,
  hint = 'Encuadra la hoja dentro del visor.',
  examTitle,
  captureProgress = 0,
}: Props) {
  const poly =
    documentPolygon && documentPolygon.length === 4 ? documentPolygon : null;
  const smoothPoly = useSmoothedPolygon(poly);
  const sheetTracked = smoothPoly !== null;

  const cornerGuides = useMemo(() => {
    if (smoothPoly) {
      return califacilFiducialCornerGuidesOnViewportQuad(
        smoothPoly as [
          ViewportPoint,
          ViewportPoint,
          ViewportPoint,
          ViewportPoint,
        ]
      );
    }
    if (guideRect && guideRect.width >= 40 && guideRect.height >= 40) {
      return califacilStaticFiducialCornerGuidesInViewportPx(guideRect);
    }
    return null;
  }, [smoothPoly, guideRect]);

  const statusLine = detected
    ? captureProgress >= 1
      ? 'Calificando…'
      : captureProgress > 0
        ? 'Mantén quieto…'
        : 'Hoja detectada'
    : hint;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {cornerGuides?.map((g, index) => (
        <ZipgradeCornerFrame
          key={index}
          guide={g}
          detected={fiducialCorners[index] ?? false}
          sheetDetected={sheetTracked || detected}
        />
      ))}

      {(examTitle || statusLine) && (
        <div
          className="absolute left-1/2 z-30 max-w-[min(92%,20rem)] -translate-x-1/2 text-center"
          style={{ top: 'max(3.25rem, calc(env(safe-area-inset-top, 0px) + 2.75rem))' }}
        >
          <div
            className={cn(
              'rounded-lg border px-4 py-2.5 shadow-lg backdrop-blur-xl',
              detected
                ? 'border-emerald-400/35 bg-white/92 text-gray-900'
                : 'border-white/12 bg-black/58 text-white/95'
            )}
          >
            {examTitle ? (
              <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-600">
                {examTitle}
              </p>
            ) : null}
            <p
              className={cn(
                'text-[13px] font-medium leading-snug tracking-tight',
                examTitle && 'mt-0.5',
                detected ? 'text-gray-900' : 'text-white'
              )}
            >
              {statusLine}
            </p>
            {detected && captureProgress > 0 && captureProgress < 1 ? (
              <div className="mx-auto mt-2 h-1 w-full max-w-[10rem] overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-75"
                  style={{ width: `${Math.round(captureProgress * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export function IosCaptureFlashOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[80] animate-[iosShutterFlash_0.22s_ease-out_forwards] bg-white"
      aria-hidden
    />
  );
}

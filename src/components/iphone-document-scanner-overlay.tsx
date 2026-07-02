'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type ViewportPoint = { x: number; y: number };

type Props = {
  documentPolygon?: ViewportPoint[] | null;
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

/** Esquinas estilo ZipGrade: marcos negros en L en cada vértice del documento. */
function zipgradeCornerBrackets(
  poly: ViewportPoint[],
  len = 32,
  stroke = 'rgba(0,0,0,0.88)',
  sw = 3.25
) {
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

export function IphoneDocumentScannerOverlay({
  documentPolygon,
  detected = false,
  hint = 'Encuadra la hoja dentro del visor.',
  examTitle,
  captureProgress = 0,
}: Props) {
  const poly =
    documentPolygon && documentPolygon.length === 4 ? documentPolygon : null;
  const smoothPoly = useSmoothedPolygon(poly);

  const statusLine = detected
    ? captureProgress >= 1
      ? 'Calificando…'
      : captureProgress > 0
        ? 'Mantén quieto…'
        : 'Hoja detectada'
    : hint;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {smoothPoly ? (
        <svg className="absolute inset-0 h-full w-full" aria-hidden>
          {zipgradeCornerBrackets(
            smoothPoly,
            detected ? 34 : 28,
            detected ? 'rgba(0,0,0,0.92)' : 'rgba(255,255,255,0.82)',
            detected ? 3.5 : 3
          )}
        </svg>
      ) : (
        <>
          {[
            { left: '10%', top: '12%' },
            { right: '10%', top: '12%' },
            { right: '10%', bottom: '14%' },
            { left: '10%', bottom: '14%' },
          ].map((style, i) => (
            <div
              key={i}
              className="absolute h-14 w-14 rounded-lg border-[2.5px] border-white/55"
              style={style}
              aria-hidden
            />
          ))}
        </>
      )}

      {(examTitle || statusLine) && (
        <div
          className="absolute left-1/2 z-20 max-w-[min(92%,20rem)] -translate-x-1/2 text-center"
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

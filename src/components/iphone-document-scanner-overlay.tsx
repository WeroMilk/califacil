'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type ViewportPoint = { x: number; y: number };

type Props = {
  documentPolygon?: ViewportPoint[] | null;
  detected?: boolean;
  hint?: string;
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
    const duration = 120;

    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration);
      const eased = 1 - (1 - t) ** 3;
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

function cornerBrackets(
  poly: ViewportPoint[],
  len = 22,
  stroke = 'rgb(255, 214, 10)',
  sw = 3.5
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
  hint = 'Coloca el documento en el visor.',
}: Props) {
  const maskId = useId();
  const poly =
    documentPolygon && documentPolygon.length === 4 ? documentPolygon : null;
  const smoothPoly = useSmoothedPolygon(poly);
  const points = smoothPoly ? smoothPoly.map((p) => `${p.x},${p.y}`).join(' ') : '';

  const bannerText = detected
    ? 'Documento detectado'
    : hint;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
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
              fill="rgba(0,0,0,0.5)"
              mask={`url(#${maskId})`}
            />
            <polygon
              points={points}
              fill="rgba(255, 214, 10, 0.18)"
              stroke="rgba(255, 214, 10, 0.55)"
              strokeWidth={1.5}
            />
            {cornerBrackets(smoothPoly)}
          </>
        ) : (
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.38)" />
        )}
      </svg>

      <div
        className={cn(
          'absolute left-1/2 z-20 -translate-x-1/2 rounded-full px-5 py-2 text-center shadow-lg backdrop-blur-xl transition-all duration-300',
          detected
            ? 'bg-emerald-500/25 text-white ring-1 ring-emerald-300/40'
            : 'bg-black/55 text-white/95 ring-1 ring-white/10'
        )}
        style={{ top: 'max(3.25rem, calc(env(safe-area-inset-top, 0px) + 2.75rem))' }}
      >
        <p className="text-[13px] font-medium tracking-tight">{bannerText}</p>
      </div>
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

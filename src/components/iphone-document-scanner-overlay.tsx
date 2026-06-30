'use client';

import { useId, useMemo } from 'react';
import { cn } from '@/lib/utils';

export type ViewportPoint = { x: number; y: number };

type Props = {
  /** Polígono tl→tr→br→bl en coords. de viewport; null = sin documento detectado. */
  documentPolygon?: ViewportPoint[] | null;
  detected?: boolean;
  hint?: string;
};

export function IphoneDocumentScannerOverlay({
  documentPolygon,
  detected = false,
  hint = 'Coloca el documento en el visor.',
}: Props) {
  const maskId = useId();
  const poly = documentPolygon && documentPolygon.length === 4 ? documentPolygon : null;
  const points = useMemo(
    () => (poly ? poly.map((p) => `${p.x},${p.y}`).join(' ') : ''),
    [poly]
  );

  const bannerText = detected
    ? 'Documento detectado — pulsa el obturador o espera'
    : hint;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        {poly ? (
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
              fill="rgba(0,0,0,0.42)"
              mask={`url(#${maskId})`}
            />
            <polygon
              points={points}
              fill="rgba(255, 214, 10, 0.28)"
              stroke="rgb(255, 214, 10)"
              strokeWidth={3}
              strokeLinejoin="round"
            />
            {poly.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={7}
                fill="rgb(255, 214, 10)"
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={2}
              />
            ))}
          </>
        ) : (
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.32)" />
        )}
      </svg>

      <div
        className={cn(
          'absolute left-1/2 z-20 w-[min(88%,18rem)] -translate-x-1/2 rounded-xl px-4 py-2.5 text-center shadow-lg backdrop-blur-md',
          detected ? 'bg-black/55 text-white' : 'bg-black/60 text-white'
        )}
        style={{ top: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
      >
        <p className="text-sm font-medium leading-snug">{bannerText}</p>
      </div>
    </div>
  );
}

'use client';

import type { ViewportAnswerBubble } from '@/lib/omrScan';

type Props = {
  bubbles: ViewportAnswerBubble[] | null;
  visible?: boolean;
};

/**
 * Círculos de alineación en la cámara: burbujas detectadas en la rejilla impresa.
 * Verde = columna de la respuesta correcta (clave); ámbar = resto de opciones.
 */
export function MobileAnswerSheetCameraOverlay({ bubbles, visible = true }: Props) {
  if (!visible || !bubbles || bubbles.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[15] h-full w-full"
      aria-hidden
    >
      {bubbles.map((b) => (
        <circle
          key={`${b.row}-${b.col}`}
          cx={b.x}
          cy={b.y}
          r={b.r}
          fill={b.isKeyColumn ? 'rgba(34,197,94,0.14)' : 'rgba(255,255,255,0.06)'}
          stroke={b.isKeyColumn ? 'rgba(74,222,128,0.92)' : 'rgba(255,214,10,0.72)'}
          strokeWidth={b.isKeyColumn ? 2.25 : 1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

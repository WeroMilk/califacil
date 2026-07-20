'use client';

import { useId } from 'react';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

type Props = {
  geometry: CalifacilOmrScanGeometry;
  /** Índice de columna elegido por fila (0 = A), null si no hay lectura. */
  picks: (number | null)[];
  /** Índice de columna correcta esperada por fila (0 = A), null si no aplica. */
  expectedPicks?: (number | null)[];
  /** Opacidad visual del overlay esperado (0..1). */
  expectedOpacity?: number;
  /** Filas activas en esta hoja. */
  rowCount: number;
  /** Opcional: recorta el overlay a una región normalizada 0..1. */
  clipRect?: { x: number; y: number; w: number; h: number } | null;
};

type BubbleCircle = { cx: number; cy: number; r: number };

const RADIUS_SCALE = 0.38;

function bubbleSampleToCircle(
  bubble: { cx: number; cy: number; r: number },
  imageW: number,
  imageH: number
): BubbleCircle {
  const minDim = Math.min(imageW, imageH);
  return {
    cx: bubble.cx * imageW,
    cy: bubble.cy * imageH,
    r: Math.max(5, bubble.r * minDim),
  };
}

function cellToBubbleCircle(
  cell: { x: number; y: number; w: number; h: number },
  imageW: number,
  imageH: number,
  radiusScale = RADIUS_SCALE
): BubbleCircle {
  const pxW = cell.w * imageW;
  const pxH = cell.h * imageH;
  return {
    cx: (cell.x + cell.w * 0.5) * imageW,
    cy: (cell.y + cell.h * 0.5) * imageH,
    r: Math.max(5, Math.min(pxW, pxH) * radiusScale),
  };
}

/**
 * Superpone bolitas sólidas: naranja = clave, verde = acierto, rojo = error.
 */
export function CalifacilOmrReviewOverlay({
  geometry,
  picks,
  expectedPicks,
  expectedOpacity = 0.92,
  rowCount,
  clipRect = null,
}: Props) {
  const rows = Math.min(rowCount, geometry.cells.length);
  const clipId = useId();
  const W = Math.max(1, geometry.imageWidth);
  const H = Math.max(1, geometry.imageHeight);
  const useFrozenBubbles = geometry.frozen === true;
  const clipPx = clipRect
    ? {
        x: clipRect.x * W,
        y: clipRect.y * H,
        w: clipRect.w * W,
        h: clipRect.h * H,
      }
    : null;

  const strokeBase = Math.max(1.8, W * 0.0045);
  const whiteStroke = Math.max(1.6, strokeBase * 0.9);

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 h-full w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <defs>
        {clipPx ? (
          <clipPath id={clipId}>
            <rect x={clipPx.x} y={clipPx.y} width={clipPx.w} height={clipPx.h} />
          </clipPath>
        ) : null}
      </defs>
      <g clipPath={clipPx ? `url(#${clipId})` : undefined}>
        {Array.from({ length: rows }, (_, row) => {
          const rowCells = geometry.cells[row];
          if (!rowCells?.length) return null;

          const pick = picks[row] ?? null;
          const expectedPick = expectedPicks?.[row] ?? null;
          const hasExpected =
            typeof expectedPick === 'number' &&
            expectedPick >= 0 &&
            expectedPick < rowCells.length;

          const expectedCell = hasExpected ? rowCells[expectedPick] : null;
          const expectedBubble = hasExpected ? geometry.bubbles?.[row]?.[expectedPick!] : null;
          const expectedCircle = expectedBubble
            ? bubbleSampleToCircle(expectedBubble, W, H)
            : !useFrozenBubbles && expectedCell
              ? cellToBubbleCircle(expectedCell, W, H)
              : null;

          const pickCell =
            pick !== null && pick >= 0 && pick < rowCells.length ? rowCells[pick] : null;
          const pickBubble =
            pick !== null && pick >= 0 ? geometry.bubbles?.[row]?.[pick] : null;
          const pickCircle =
            pickBubble
              ? bubbleSampleToCircle(pickBubble, W, H)
              : !useFrozenBubbles && pickCell
                ? cellToBubbleCircle(pickCell, W, H)
                : null;

          const isCorrect = hasExpected && pick !== null && pick === expectedPick;
          const isWrong = hasExpected && pick !== null && pick !== expectedPick;
          const isUnread = hasExpected && pick === null;

          return (
            <g key={row}>
              {/* Clave: naranja; si acertó, verde sólido en su lugar. */}
              {expectedCircle && !isCorrect ? (
                <circle
                  cx={expectedCircle.cx}
                  cy={expectedCircle.cy}
                  r={expectedCircle.r}
                  fill={`rgba(234,88,12,${Math.max(0, Math.min(1, expectedOpacity))})`}
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth={whiteStroke}
                  strokeDasharray={isUnread ? `${strokeBase * 2.5} ${strokeBase * 1.6}` : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {expectedCircle && isCorrect && pickCircle ? (
                <circle
                  cx={pickCircle.cx}
                  cy={pickCircle.cy}
                  r={pickCircle.r}
                  fill="rgba(22,163,74,0.95)"
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth={whiteStroke}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {/* Error: rojo sólido en la columna leída (clave naranja ya dibujada). */}
              {isWrong && pickCircle ? (
                <circle
                  cx={pickCircle.cx}
                  cy={pickCircle.cy}
                  r={pickCircle.r}
                  fill="rgba(220,38,38,0.95)"
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth={whiteStroke}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {/* Sin clave esperada: mostrar lectura verde si hay pick. */}
              {!hasExpected && pickCircle ? (
                <circle
                  cx={pickCircle.cx}
                  cy={pickCircle.cy}
                  r={pickCircle.r}
                  fill="rgba(22,163,74,0.9)"
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth={whiteStroke}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

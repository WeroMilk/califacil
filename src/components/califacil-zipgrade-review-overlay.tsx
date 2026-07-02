'use client';

import { useMemo, useState } from 'react';
import type { CalifacilOmrScanGeometry } from '@/lib/omrScan';

type Props = {
  geometry: CalifacilOmrScanGeometry;
  picks: (number | null)[];
  expectedPicks?: (number | null)[];
  rowCount: number;
};

function cellCenter(
  cell: { x: number; y: number; w: number; h: number },
  imageW: number,
  imageH: number
) {
  return {
    cx: (cell.x + cell.w * 0.5) * imageW,
    cy: (cell.y + cell.h * 0.5) * imageH,
    r: Math.max(5, Math.min(cell.w * imageW, cell.h * imageH) * 0.4),
  };
}

/**
 * Overlay estilo ZipGrade: ✓/✗ por fila y círculos verde/rojo sobre burbujas marcadas.
 */
export function CalifacilZipGradeReviewOverlay({
  geometry,
  picks,
  expectedPicks,
  rowCount,
}: Props) {
  const rows = Math.min(rowCount, geometry.cells.length);
  const W = Math.max(1, geometry.imageWidth);
  const H = Math.max(1, geometry.imageHeight);
  const fontSize = Math.max(11, W * 0.018);
  const markXBase = W * 0.028;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      {Array.from({ length: rows }, (_, row) => {
        const rowCells = geometry.cells[row];
        if (!rowCells?.length) return null;

        const pick = picks[row] ?? null;
        const expectedPick = expectedPicks?.[row] ?? null;
        const hasExpected =
          typeof expectedPick === 'number' &&
          expectedPick >= 0 &&
          expectedPick < rowCells.length;

        const firstCell = rowCells[0];
        const rowCy = firstCell ? (firstCell.y + firstCell.h * 0.5) * H : 0;
        const isCorrect = hasExpected && pick !== null && pick === expectedPick;
        const isWrong = hasExpected && pick !== null && pick !== expectedPick;
        const isUnread = hasExpected && pick === null;

        const pickCell =
          pick !== null && pick >= 0 && pick < rowCells.length ? rowCells[pick] : null;
        const bubble = pickCell ? cellCenter(pickCell, W, H) : null;

        let mark = '';
        let markColor = '#6b7280';
        if (isCorrect) {
          mark = '✓';
          markColor = '#16a34a';
        } else if (isWrong || isUnread) {
          mark = '✗';
          markColor = '#dc2626';
        }

        return (
          <g key={row}>
            {mark ? (
              <text
                x={markXBase}
                y={rowCy + fontSize * 0.35}
                fill={markColor}
                fontSize={fontSize}
                fontWeight={700}
                fontFamily="system-ui, -apple-system, sans-serif"
              >
                {mark}
              </text>
            ) : null}
            {bubble && hasExpected ? (
              <circle
                cx={bubble.cx}
                cy={bubble.cy}
                r={bubble.r}
                fill="none"
                stroke={isCorrect ? 'rgba(22,163,74,0.95)' : 'rgba(220,38,38,0.95)'}
                strokeWidth={Math.max(2.2, W * 0.0045)}
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

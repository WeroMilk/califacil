'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { AnswerSheetTemplateGuide } from '@/lib/omrScan';
import type { MobileGuideRectPx } from '@/components/mobile-scan-viewfinder-overlay';

type ViewportPoint = { x: number; y: number };

type Props = {
  templateGuide: AnswerSheetTemplateGuide;
  guideRect?: MobileGuideRectPx | null;
  /** Índice de columna correcta por fila (0 = A). */
  expectedPicks?: (number | null)[];
  aligned?: boolean;
};

function mapPageNormToGuideViewport(
  nx: number,
  ny: number,
  guideRect: MobileGuideRectPx
): ViewportPoint {
  return {
    x: guideRect.left + nx * guideRect.width,
    y: guideRect.top + ny * guideRect.height,
  };
}

/**
 * Guía fija: margen de hoja carta + un círculo por fila en la respuesta correcta.
 */
export function MobileAnswerSheetBubbleGuideOverlay({
  templateGuide,
  guideRect,
  expectedPicks = [],
  aligned = false,
}: Props) {
  const bubbles = useMemo(() => {
    if (!guideRect) return [] as Array<{ cx: number; cy: number; r: number }>;

    const map = (nx: number, ny: number) => mapPageNormToGuideViewport(nx, ny, guideRect);

    const bubbleList: Array<{ cx: number; cy: number; r: number }> = [];
    const rows = templateGuide.geometry.cells;
    for (let row = 0; row < rows.length; row++) {
      const col = expectedPicks[row];
      if (col === null || col === undefined || col < 0) continue;
      const cell = rows[row]?.[col];
      if (!cell) continue;
      const cxNorm = cell.x + cell.w / 2;
      const cyNorm = cell.y + cell.h / 2;
      const center = map(cxNorm, cyNorm);
      const right = map(cell.x + cell.w, cyNorm);
      const bottom = map(cxNorm, cell.y + cell.h);
      const r = Math.max(
        2,
        Math.min(Math.abs(right.x - center.x), Math.abs(bottom.y - center.y)) * 0.46
      );
      bubbleList.push({ cx: center.x, cy: center.y, r });
    }

    return bubbleList;
  }, [templateGuide, guideRect, expectedPicks]);

  if (!guideRect) return null;

  const stroke = aligned ? 'rgba(52,211,153,0.9)' : 'rgba(251,146,60,0.88)';
  const tableStroke = aligned ? 'rgba(52,211,153,0.75)' : 'rgba(255,255,255,0.45)';

  return (
    <svg
      className={cn('pointer-events-none absolute inset-0 z-[12] h-full w-full')}
      aria-hidden
    >
      <rect
        x={guideRect.left}
        y={guideRect.top}
        width={guideRect.width}
        height={guideRect.height}
        fill="none"
        stroke={tableStroke}
        strokeWidth={2}
        strokeDasharray="10 6"
        vectorEffect="non-scaling-stroke"
      />
      {bubbles.map((b, i) => (
        <circle
          key={i}
          cx={b.cx}
          cy={b.cy}
          r={b.r}
          fill="none"
          stroke={stroke}
          strokeWidth={aligned ? 2 : 1.25}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

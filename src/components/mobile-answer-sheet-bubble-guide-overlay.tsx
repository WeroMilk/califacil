'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { AnswerSheetTemplateGuide } from '@/lib/omrScan';
import type { MobileGuideRectPx } from '@/components/mobile-scan-viewfinder-overlay';

type ViewportPoint = { x: number; y: number };

type Props = {
  templateGuide: AnswerSheetTemplateGuide;
  guideRect?: MobileGuideRectPx | null;
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

function normRectCorners(rect: { x: number; y: number; w: number; h: number }) {
  return [
    { u: rect.x, v: rect.y },
    { u: rect.x + rect.w, v: rect.y },
    { u: rect.x + rect.w, v: rect.y + rect.h },
    { u: rect.x, v: rect.y + rect.h },
  ];
}

/**
 * Guía fija con margen de tabla y todos los círculos OMR (marco carta estático).
 */
export function MobileAnswerSheetBubbleGuideOverlay({
  templateGuide,
  guideRect,
  aligned = false,
}: Props) {
  const { bubbles, tablePolygon } = useMemo(() => {
    if (!guideRect) return { bubbles: [], tablePolygon: [] as ViewportPoint[] };

    const map = (nx: number, ny: number) => mapPageNormToGuideViewport(nx, ny, guideRect);

    const bubbleList: Array<{ cx: number; cy: number; r: number }> = [];
    for (const row of templateGuide.geometry.cells) {
      for (const cell of row) {
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
    }

    const tablePts = normRectCorners(templateGuide.tableBoundsNorm).map((c) => map(c.u, c.v));

    return { bubbles: bubbleList, tablePolygon: tablePts };
  }, [templateGuide, guideRect]);

  if (!guideRect || bubbles.length === 0) return null;

  const stroke = aligned ? 'rgba(52,211,153,0.9)' : 'rgba(255,255,255,0.62)';
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
        stroke="rgba(255,255,255,0.28)"
        strokeWidth={1}
        strokeDasharray="8 5"
        vectorEffect="non-scaling-stroke"
      />
      {tablePolygon.length === 4 ? (
        <polygon
          points={tablePolygon.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={tableStroke}
          strokeWidth={1.5}
          strokeDasharray="6 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
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

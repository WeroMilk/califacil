'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { AnswerSheetTemplateGuide } from '@/lib/omrScan';
import { sheetCornerGuidesToViewportQuad } from '@/lib/omrScan';
import type { MobileGuideRectPx, MobileSheetCornerGuidePx } from '@/components/mobile-scan-viewfinder-overlay';

type ViewportPoint = { x: number; y: number };

type Props = {
  templateGuide: AnswerSheetTemplateGuide;
  guideRect?: MobileGuideRectPx | null;
  sheetCornerGuides?: MobileSheetCornerGuidePx[] | null;
  aligned?: boolean;
};

function mapPageNormToViewport(
  nx: number,
  ny: number,
  guideRect: MobileGuideRectPx | null,
  sheetQuad: { tl: ViewportPoint; tr: ViewportPoint; br: ViewportPoint; bl: ViewportPoint } | null
): ViewportPoint | null {
  if (sheetQuad) {
    const topX = sheetQuad.tl.x + (sheetQuad.tr.x - sheetQuad.tl.x) * nx;
    const topY = sheetQuad.tl.y + (sheetQuad.tr.y - sheetQuad.tl.y) * nx;
    const botX = sheetQuad.bl.x + (sheetQuad.br.x - sheetQuad.bl.x) * nx;
    const botY = sheetQuad.bl.y + (sheetQuad.br.y - sheetQuad.bl.y) * nx;
    return { x: topX + (botX - topX) * ny, y: topY + (botY - topY) * ny };
  }
  if (guideRect) {
    return {
      x: guideRect.left + nx * guideRect.width,
      y: guideRect.top + ny * guideRect.height,
    };
  }
  return null;
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
 * Guía visual con margen de tabla y todos los círculos OMR para alinear la hoja de respuestas.
 */
export function MobileAnswerSheetBubbleGuideOverlay({
  templateGuide,
  guideRect,
  sheetCornerGuides,
  aligned = false,
}: Props) {
  const sheetQuad = useMemo(
    () => (sheetCornerGuides ? sheetCornerGuidesToViewportQuad(sheetCornerGuides) : null),
    [sheetCornerGuides]
  );

  const { bubbles, tablePolygon } = useMemo(() => {
    const map = (nx: number, ny: number) =>
      mapPageNormToViewport(nx, ny, guideRect ?? null, sheetQuad);

    const bubbleList: Array<{ cx: number; cy: number; r: number }> = [];
    for (const row of templateGuide.geometry.cells) {
      for (const cell of row) {
        const cxNorm = cell.x + cell.w / 2;
        const cyNorm = cell.y + cell.h / 2;
        const center = map(cxNorm, cyNorm);
        if (!center) continue;
        const right = map(cell.x + cell.w, cyNorm);
        const bottom = map(cxNorm, cell.y + cell.h);
        if (!right || !bottom) continue;
        const r = Math.max(
          2,
          Math.min(Math.abs(right.x - center.x), Math.abs(bottom.y - center.y)) * 0.46
        );
        bubbleList.push({ cx: center.x, cy: center.y, r });
      }
    }

    const corners = normRectCorners(templateGuide.tableBoundsNorm);
    const tablePts = corners
      .map((c) => map(c.u, c.v))
      .filter((p): p is ViewportPoint => p !== null);

    return { bubbles: bubbleList, tablePolygon: tablePts };
  }, [templateGuide, guideRect, sheetQuad]);

  if (bubbles.length === 0) return null;

  const stroke = aligned ? 'rgba(52,211,153,0.9)' : 'rgba(255,255,255,0.62)';
  const tableStroke = aligned ? 'rgba(52,211,153,0.75)' : 'rgba(255,255,255,0.45)';

  return (
    <svg
      className={cn('pointer-events-none absolute inset-0 z-[12] h-full w-full')}
      aria-hidden
    >
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

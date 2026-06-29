'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM,
  CALIFACIL_RIGHT_ALIGN_STRIP_NORM,
} from '@/lib/printExam';
import { mapPageNormToAlignGuideViewport } from '@/lib/omrScan';
import type { MobileGuideRectPx } from '@/components/mobile-scan-viewfinder-overlay';

type Props = {
  guideRect: MobileGuideRectPx;
  aligned?: boolean;
};

/**
 * Guía fija: marco según franja negra derecha + barra negra de referencia para alinear.
 */
export function MobileAnswerSheetAlignGuideOverlay({
  guideRect,
  aligned = false,
}: Props) {
  const stripRect = useMemo(() => {
    const frame = CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM;
    const strip = CALIFACIL_RIGHT_ALIGN_STRIP_NORM;
    const tl = mapPageNormToAlignGuideViewport(strip.left, strip.top, guideRect, frame);
    const br = mapPageNormToAlignGuideViewport(
      strip.left + strip.width,
      strip.top + strip.height,
      guideRect,
      frame
    );
    return {
      x: tl.x,
      y: tl.y,
      width: Math.max(4, br.x - tl.x),
      height: Math.max(4, br.y - tl.y),
    };
  }, [guideRect]);

  const frameStroke = aligned ? 'rgba(52,211,153,0.9)' : 'rgba(255,255,255,0.55)';

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
        stroke={frameStroke}
        strokeWidth={2}
        strokeDasharray="10 6"
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={stripRect.x}
        y={stripRect.y}
        width={stripRect.width}
        height={stripRect.height}
        fill={aligned ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.38)'}
        stroke={aligned ? 'rgba(52,211,153,0.95)' : 'rgba(255,255,255,0.7)'}
        strokeWidth={aligned ? 2 : 1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

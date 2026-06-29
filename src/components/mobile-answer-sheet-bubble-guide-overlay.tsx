'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM,
  CALIFACIL_ALIGN_STRIPS_NORM,
} from '@/lib/printExam';
import { mapPageNormToAlignGuideViewport } from '@/lib/omrScan';
import type { MobileGuideRectPx } from '@/components/mobile-scan-viewfinder-overlay';

type Props = {
  guideRect: MobileGuideRectPx;
  aligned?: boolean;
};

function stripRectInViewport(
  strip: { left: number; top: number; width: number; height: number },
  guideRect: MobileGuideRectPx
) {
  const frame = CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM;
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
    width: Math.max(6, br.x - tl.x),
    height: Math.max(6, br.y - tl.y),
  };
}

/**
 * Guía fija: marco carta + dos franjas negras (izq/der) como en la hoja impresa.
 */
export function MobileAnswerSheetAlignGuideOverlay({
  guideRect,
  aligned = false,
}: Props) {
  const stripRects = useMemo(
    () => CALIFACIL_ALIGN_STRIPS_NORM.map((strip) => stripRectInViewport(strip, guideRect)),
    [guideRect]
  );

  const frameStroke = aligned ? 'rgba(52,211,153,0.92)' : 'rgba(255,255,255,0.6)';
  const stripFill = aligned ? 'rgba(0,0,0,0.62)' : 'rgba(0,0,0,0.45)';
  const stripStroke = aligned ? 'rgba(52,211,153,0.98)' : 'rgba(255,255,255,0.82)';

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
        strokeWidth={2.5}
        strokeDasharray={aligned ? '0' : '12 7'}
        vectorEffect="non-scaling-stroke"
      />
      {stripRects.map((strip, index) => (
        <rect
          key={index}
          x={strip.x}
          y={strip.y}
          width={strip.width}
          height={strip.height}
          fill={stripFill}
          stroke={stripStroke}
          strokeWidth={aligned ? 2.5 : 2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

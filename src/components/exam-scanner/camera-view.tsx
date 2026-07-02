'use client';

import { forwardRef, memo, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import type { LiveVideoLayoutPx } from '@/components/exam-scanner/types';

type Props = {
  layout: LiveVideoLayoutPx | null;
  videoRef: RefObject<HTMLVideoElement | null>;
};

const CameraViewInner = forwardRef<HTMLDivElement, Props>(function CameraViewInner(
  { layout, videoRef },
  ref
) {
  return (
    <div ref={ref} className="relative h-[100dvh] w-full overflow-hidden bg-black">
      <div
        className="absolute overflow-hidden bg-black"
        style={
          layout
            ? {
                left: layout.offsetX,
                top: layout.offsetY,
                width: layout.displayW,
                height: layout.displayH,
              }
            : { inset: 0 }
        }
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef as RefObject<HTMLVideoElement>}
          autoPlay
          playsInline
          muted
          className={cn(
            'h-full w-full bg-black object-center',
            layout ? 'object-cover' : 'object-contain'
          )}
        />
      </div>
    </div>
  );
});

export const CameraView = memo(CameraViewInner);

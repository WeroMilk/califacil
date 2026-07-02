'use client';

import { forwardRef, memo, type RefObject } from 'react';

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
};

const CameraViewInner = forwardRef<HTMLDivElement, Props>(function CameraViewInner(
  { videoRef },
  ref
) {
  return (
    <div ref={ref} className="exam-scanner-camera absolute inset-0 overflow-hidden bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef as RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover object-center"
        style={{ transform: 'translateZ(0)' }}
      />
    </div>
  );
});

export const CameraView = memo(CameraViewInner);

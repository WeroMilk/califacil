'use client';

import { forwardRef, memo, useCallback, type MutableRefObject, type RefObject } from 'react';

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  onVideoMount?: (node: HTMLVideoElement | null) => void;
};

const CameraViewInner = forwardRef<HTMLDivElement, Props>(function CameraViewInner(
  { videoRef, onVideoMount },
  ref
) {
  const setVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      (videoRef as MutableRefObject<HTMLVideoElement | null>).current = node;
      onVideoMount?.(node);
    },
    [videoRef, onVideoMount]
  );

  return (
    <div
      ref={ref}
      className="exam-scanner-camera pointer-events-none absolute inset-0 overflow-hidden bg-black"
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={setVideoRef}
        autoPlay
        playsInline
        muted
        className="pointer-events-none absolute inset-0 h-full w-full object-contain object-center"
      />
    </div>
  );
});

export const CameraView = memo(CameraViewInner);

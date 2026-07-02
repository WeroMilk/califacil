'use client';

import { memo } from 'react';

type Props = { active: boolean };

function CaptureFlashInner({ active }: Props) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[80] animate-[iosShutterFlash_0.18s_ease-out_forwards] bg-white"
      aria-hidden
    />
  );
}

export const CaptureFlash = memo(CaptureFlashInner);

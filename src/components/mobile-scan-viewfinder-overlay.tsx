'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  aligned: boolean;
  examTitle?: string;
  sheetLabel?: string;
};

function CornerViewfinder({
  aligned,
  style,
}: {
  aligned: boolean;
  style: CSSProperties;
}) {
  return (
    <div
      className={cn(
        'absolute z-10 h-[3.25rem] w-[3.25rem] rounded-2xl border-2 shadow-sm transition-colors duration-150',
        aligned
          ? 'border-emerald-500 bg-emerald-400/30'
          : 'border-black/85 bg-white/50'
      )}
      style={style}
      aria-hidden
    />
  );
}

export function MobileScanViewfinderOverlay({ aligned, examTitle, sheetLabel }: Props) {
  const topInset = 'max(0.65rem, env(safe-area-inset-top, 0px))';
  const bottomInset = 'max(0.65rem, env(safe-area-inset-bottom, 0px))';
  const sideInset = '0.65rem';

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute left-1/2 z-20 w-[min(92%,20rem)] -translate-x-1/2 rounded-lg border border-black/10 bg-white/92 px-3 py-2.5 text-center shadow-md"
        style={{ top: `calc(${topInset} + 4.25rem)` }}
      >
        {examTitle ? (
          <p className="truncate text-xs font-semibold text-gray-900">{examTitle}</p>
        ) : null}
        {sheetLabel ? <p className="mt-0.5 text-[11px] text-gray-600">{sheetLabel}</p> : null}
        <p className="mt-1 text-sm font-bold leading-snug text-gray-900">
          {aligned ? 'Esquinas listas — capturando…' : 'Alinear las 4 esquinas con los visores'}
        </p>
      </div>

      <CornerViewfinder aligned={aligned} style={{ top: topInset, left: sideInset }} />
      <CornerViewfinder aligned={aligned} style={{ top: topInset, right: sideInset }} />
      <CornerViewfinder aligned={aligned} style={{ bottom: bottomInset, left: sideInset }} />
      <CornerViewfinder aligned={aligned} style={{ bottom: bottomInset, right: sideInset }} />
    </div>
  );
}

'use client';

import { cn } from '@/lib/utils';

/** Inset del marco guía (debe coincidir con areMobileViewfinderCornersAligned). */
export const MOBILE_SCAN_VIEWFINDER_INSET = '5%';

type Props = {
  aligned: boolean;
  examTitle?: string;
  sheetLabel?: string;
};

export function MobileScanViewfinderOverlay({ aligned, examTitle, sheetLabel }: Props) {
  const cornerClass = cn(
    'absolute z-10 h-[3.25rem] w-[3.25rem] rounded-md border-[3px] shadow-sm transition-colors duration-200',
    aligned
      ? 'border-emerald-400 bg-emerald-400/15'
      : 'border-white/85 bg-white/10'
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {(examTitle || sheetLabel) && (
        <div className="absolute left-1/2 top-[max(0.5rem,env(safe-area-inset-top,0px))] z-20 w-[min(92%,20rem)] -translate-x-1/2 rounded-lg border border-white/20 bg-black/55 px-3 py-2 text-center backdrop-blur-sm">
          {examTitle ? (
            <p className="truncate text-xs font-semibold text-white">{examTitle}</p>
          ) : null}
          {sheetLabel ? (
            <p className="mt-0.5 text-[11px] text-white/80">{sheetLabel}</p>
          ) : null}
          <p className="mt-1 text-[11px] font-semibold leading-snug text-white">
            {aligned
              ? 'Esquinas detectadas — capturando…'
              : 'Alinear las 4 esquinas con los visores'}
          </p>
        </div>
      )}

      <span
        className={cornerClass}
        style={{ left: MOBILE_SCAN_VIEWFINDER_INSET, top: MOBILE_SCAN_VIEWFINDER_INSET }}
        aria-hidden
      />
      <span
        className={cornerClass}
        style={{ right: MOBILE_SCAN_VIEWFINDER_INSET, top: MOBILE_SCAN_VIEWFINDER_INSET }}
        aria-hidden
      />
      <span
        className={cornerClass}
        style={{ left: MOBILE_SCAN_VIEWFINDER_INSET, bottom: MOBILE_SCAN_VIEWFINDER_INSET }}
        aria-hidden
      />
      <span
        className={cornerClass}
        style={{ right: MOBILE_SCAN_VIEWFINDER_INSET, bottom: MOBILE_SCAN_VIEWFINDER_INSET }}
        aria-hidden
      />
    </div>
  );
}

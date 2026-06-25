'use client';

import { cn } from '@/lib/utils';

export type MobileGuideRectPx = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Props = {
  aligned: boolean;
  examTitle?: string;
  sheetLabel?: string;
  /** Marco guía hoja carta en píxeles de pantalla — coincide con el ROI de procesamiento. */
  guideRect?: MobileGuideRectPx | null;
};

function CornerBracket({
  aligned,
  className,
}: {
  aligned: boolean;
  className: string;
}) {
  return (
    <span
      className={cn(
        'absolute h-7 w-7 border-2 transition-colors duration-150',
        aligned ? 'border-emerald-400' : 'border-white',
        className
      )}
      aria-hidden
    />
  );
}

export function MobileScanViewfinderOverlay({ aligned, examTitle, sheetLabel, guideRect }: Props) {
  const bannerTop = guideRect
    ? Math.max(8, guideRect.top - 88)
    : 'max(0.65rem, env(safe-area-inset-top, 0px))';

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute left-1/2 z-20 w-[min(92%,20rem)] -translate-x-1/2 rounded-lg border border-black/10 bg-white/92 px-3 py-2.5 text-center shadow-md"
        style={{ top: typeof bannerTop === 'number' ? bannerTop : `calc(${bannerTop} + 4.25rem)` }}
      >
        {examTitle ? (
          <p className="truncate text-xs font-semibold text-gray-900">{examTitle}</p>
        ) : null}
        {sheetLabel ? <p className="mt-0.5 text-[11px] text-gray-600">{sheetLabel}</p> : null}
        <p className="mt-1 text-sm font-bold leading-snug text-gray-900">
          {aligned
            ? 'Esquinas detectadas — capturando…'
            : 'Encuadra la hoja dentro del rectángulo'}
        </p>
      </div>

      {guideRect ? (
        <div
          className={cn(
            'absolute z-10 rounded-sm border-2 border-dashed transition-colors duration-150',
            aligned ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/90 bg-white/5'
          )}
          style={{
            left: guideRect.left,
            top: guideRect.top,
            width: guideRect.width,
            height: guideRect.height,
          }}
        >
          <CornerBracket aligned={aligned} className="left-0 top-0 border-b-0 border-r-0" />
          <CornerBracket aligned={aligned} className="right-0 top-0 border-b-0 border-l-0" />
          <CornerBracket aligned={aligned} className="bottom-0 left-0 border-r-0 border-t-0" />
          <CornerBracket aligned={aligned} className="bottom-0 right-0 border-l-0 border-t-0" />
        </div>
      ) : null}
    </div>
  );
}

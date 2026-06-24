'use client';

import { califacilViewfinderGuideInViewportPx, type CalifacilVideoLetterbox } from '@/lib/omrScan';
import { CALIFACIL_VIEWFINDER_GUIDE } from '@/lib/printExam';
import { cn } from '@/lib/utils';

type Props = {
  aligned: boolean;
  examTitle?: string;
  sheetLabel?: string;
  /** Caja del video en pantalla (object-cover); alinea el marco con la hoja impresa. */
  letterbox?: CalifacilVideoLetterbox | null;
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
        'absolute z-10 h-10 w-10 border-[3px] transition-colors duration-200',
        aligned ? 'border-emerald-400' : 'border-white/90',
        className
      )}
      aria-hidden
    />
  );
}

export function MobileScanViewfinderOverlay({
  aligned,
  examTitle,
  sheetLabel,
  letterbox,
}: Props) {
  const guidePx = letterbox ? califacilViewfinderGuideInViewportPx(letterbox) : null;

  const frameStyle = guidePx
    ? {
        left: guidePx.left,
        top: guidePx.top,
        width: guidePx.width,
        height: guidePx.height,
      }
    : {
        left: '50%',
        top: '50%',
        width: `${CALIFACIL_VIEWFINDER_GUIDE.widthFrac * 100}%`,
        maxHeight: '88%',
        aspectRatio: String(CALIFACIL_VIEWFINDER_GUIDE.aspectRatio),
        transform: 'translate(-50%, -50%)',
      };

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
              : 'Encaja la hoja dentro del marco y alinea los 4 cuadros negros'}
          </p>
        </div>
      )}

      <div
        className={cn(
          'absolute rounded-md border-2 border-dashed transition-colors duration-200',
          aligned ? 'border-emerald-400/85' : 'border-white/55'
        )}
        style={{ position: 'absolute', ...frameStyle }}
      >
        <CornerBracket aligned={aligned} className="left-0 top-0 border-b-0 border-r-0 rounded-tl-md" />
        <CornerBracket aligned={aligned} className="right-0 top-0 border-b-0 border-l-0 rounded-tr-md" />
        <CornerBracket aligned={aligned} className="bottom-0 left-0 border-r-0 border-t-0 rounded-bl-md" />
        <CornerBracket aligned={aligned} className="bottom-0 right-0 border-l-0 border-t-0 rounded-br-md" />
      </div>
    </div>
  );
}

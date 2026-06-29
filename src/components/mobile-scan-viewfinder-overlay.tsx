'use client';

import { cn } from '@/lib/utils';
import { MOBILE_MIN_ROI_FILL_RATIO } from '@/lib/omrScan';

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
  /** Área de hoja detectada / área del ROI (0–1). */
  fillRatio?: number;
  /** Ticks consecutivos de estabilidad (0…stableTicksRequired). */
  stableTicks?: number;
  stableTicksRequired?: number;
  /** Sombra fuerte detectada en el ROI. */
  shadowWarning?: boolean;
  /** Cuadros negros de esquina visibles (0–4). */
  fiducialCount?: number;
};

function CornerBracket({
  tone,
  className,
}: {
  tone: 'idle' | 'warn' | 'ready';
  className: string;
}) {
  return (
    <span
      className={cn(
        'absolute h-8 w-8 border-[3px] transition-colors duration-150',
        tone === 'ready' && 'border-emerald-400',
        tone === 'warn' && 'border-amber-400',
        tone === 'idle' && 'border-white',
        className
      )}
      aria-hidden
    />
  );
}

function FiducialHint({ className }: { className: string }) {
  return (
    <span
      className={cn('absolute h-3 w-3 rounded-[1px] border border-white/50 bg-black/80', className)}
      aria-hidden
    />
  );
}

function StableDots({ ticks, required }: { ticks: number; required: number }) {
  return (
    <div className="mt-2 flex items-center justify-center gap-1.5" aria-hidden>
      {Array.from({ length: required }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-4 rounded-full transition-colors duration-150',
            i < ticks ? 'bg-emerald-400' : 'bg-white/35'
          )}
        />
      ))}
    </div>
  );
}

export function MobileScanViewfinderOverlay({
  aligned,
  examTitle,
  sheetLabel,
  guideRect,
  fillRatio = 0,
  stableTicks = 0,
  stableTicksRequired = 3,
  shadowWarning = false,
  fiducialCount = 0,
}: Props) {
  const bannerTop = guideRect
    ? Math.max(8, guideRect.top - 96)
    : 'max(0.65rem, env(safe-area-inset-top, 0px))';

  const fillLow = fillRatio > 0 && fillRatio < MOBILE_MIN_ROI_FILL_RATIO;
  const fillVeryLow = fillRatio > 0 && fillRatio < 0.3;
  const fiducialsOk = fiducialCount >= 3;

  const tone: 'idle' | 'warn' | 'ready' =
    aligned && !fillLow && fiducialsOk && !shadowWarning
      ? 'ready'
      : fillVeryLow || shadowWarning
        ? 'warn'
        : 'idle';

  const bannerLine =
    aligned && stableTicks >= stableTicksRequired
      ? 'Capturando…'
      : aligned
        ? 'Mantén la hoja quieta'
        : fillVeryLow
          ? 'Acerca el teléfono — la hoja debe llenar el marco'
          : fillLow
            ? 'Un poco más cerca — llena el rectángulo con la hoja'
            : shadowWarning
              ? 'Reduce la sombra o activa el flash'
              : fiducialCount > 0 && fiducialCount < 3
                ? 'Alinea los 4 cuadros negros de las esquinas'
                : 'Encuadra la hoja dentro del rectángulo';

  const borderColor =
    tone === 'ready'
      ? 'rgba(52, 211, 153, 0.95)'
      : tone === 'warn'
        ? 'rgba(251, 191, 36, 0.95)'
        : 'rgba(255, 255, 255, 0.92)';

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute left-1/2 z-20 w-[min(92%,20rem)] -translate-x-1/2 rounded-lg border border-black/10 bg-white/94 px-3 py-2.5 text-center shadow-md backdrop-blur-sm"
        style={{ top: typeof bannerTop === 'number' ? bannerTop : `calc(${bannerTop} + 4.25rem)` }}
      >
        {examTitle ? (
          <p className="truncate text-xs font-semibold text-gray-900">{examTitle}</p>
        ) : null}
        {sheetLabel ? <p className="mt-0.5 text-[11px] text-gray-600">{sheetLabel}</p> : null}
        <p className="mt-1 text-sm font-bold leading-snug text-gray-900">{bannerLine}</p>
        {aligned || stableTicks > 0 ? (
          <StableDots ticks={stableTicks} required={stableTicksRequired} />
        ) : null}
      </div>

      {guideRect ? (
        <div
          className="absolute z-10 rounded-sm transition-colors duration-150"
          style={{
            left: guideRect.left,
            top: guideRect.top,
            width: guideRect.width,
            height: guideRect.height,
            border: `2px dashed ${borderColor}`,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.58)',
            backgroundColor:
              tone === 'ready'
                ? 'rgba(52, 211, 153, 0.08)'
                : tone === 'warn'
                  ? 'rgba(251, 191, 36, 0.06)'
                  : 'rgba(255, 255, 255, 0.04)',
          }}
        >
          <CornerBracket tone={tone} className="left-0 top-0 border-b-0 border-r-0" />
          <CornerBracket tone={tone} className="right-0 top-0 border-b-0 border-l-0" />
          <CornerBracket tone={tone} className="bottom-0 left-0 border-r-0 border-t-0" />
          <CornerBracket tone={tone} className="bottom-0 right-0 border-l-0 border-t-0" />
          <FiducialHint className="left-1 top-1" />
          <FiducialHint className="right-1 top-1" />
          <FiducialHint className="bottom-1 left-1" />
          <FiducialHint className="bottom-1 right-1" />
        </div>
      ) : null}
    </div>
  );
}

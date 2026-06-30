'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  MOBILE_MIN_ROI_FILL_RATIO,
  califacilStaticFiducialCornerGuidesInViewportPx,
} from '@/lib/omrScan';
import { MobileAnswerSheetAlignGuideOverlay } from '@/components/mobile-answer-sheet-bubble-guide-overlay';

export type MobileGuideRectPx = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type MobileSheetCornerGuidePx = {
  left: number;
  top: number;
  size: number;
};

type Props = {
  aligned: boolean;
  examTitle?: string;
  sheetLabel?: string;
  guideRect?: MobileGuideRectPx | null;
  fillRatio?: number;
  stableTicks?: number;
  stableTicksRequired?: number;
  /** Duración total de la espera antes de captura (para barra de progreso). */
  alignHoldMs?: number;
  shadowWarning?: boolean;
  fiducialCount?: number;
  fiducialCorners?: [boolean, boolean, boolean, boolean];
};

function ZipgradeAlignCornerAt({
  left,
  top,
  size,
  detected,
}: {
  left: number;
  top: number;
  size: number;
  detected: boolean;
}) {
  return (
    <div
      className={cn(
        'absolute z-20 rounded-lg border-[2.5px]',
        detected
          ? 'border-emerald-400 bg-white/50 shadow-[0_0_0_2px_rgba(52,211,153,0.35)]'
          : 'border-white/90 bg-white/40 shadow-[0_2px_12px_rgba(0,0,0,0.25)]'
      )}
      style={{ left, top, width: size, height: size }}
      aria-hidden
    />
  );
}

function StableDots({
  ticks,
  required,
}: {
  ticks: number;
  required: number;
}) {
  const segmentCount = 5;
  const progress = required > 0 ? Math.min(1, ticks / required) : 0;
  const filled = Math.min(segmentCount, Math.ceil(progress * segmentCount));
  return (
    <div className="mt-2 flex items-center justify-center gap-1.5" aria-hidden>
      {Array.from({ length: segmentCount }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-5 rounded-full transition-colors duration-150',
            i < filled ? 'bg-emerald-400' : 'bg-white/35'
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
  stableTicksRequired = 30,
  alignHoldMs = 3000,
  shadowWarning = false,
  fiducialCount = 0,
  fiducialCorners = [false, false, false, false],
}: Props) {
  const bannerTop = guideRect
    ? Math.max(8, guideRect.top - 100)
    : 'max(0.65rem, env(safe-area-inset-top, 0px))';

  const fillLow = fillRatio > 0 && fillRatio < MOBILE_MIN_ROI_FILL_RATIO;
  const staticCornerGuides = useMemo(
    () => (guideRect ? califacilStaticFiducialCornerGuidesInViewportPx(guideRect) : null),
    [guideRect]
  );
  const useSheetCorners = staticCornerGuides && staticCornerGuides.length === 4;

  const secsUntilCapture =
    aligned && stableTicks < stableTicksRequired
      ? Math.max(1, Math.ceil(((stableTicksRequired - stableTicks) * alignHoldMs) / stableTicksRequired / 1000))
      : null;

  const bannerLine =
    aligned && stableTicks >= stableTicksRequired
      ? 'Procesando escaneo…'
      : aligned && secsUntilCapture !== null
        ? `Hoja detectada — captura en ~${secsUntilCapture} s o pulsa el botón blanco`
        : aligned
          ? 'Hoja detectada — pulsa el botón blanco para capturar'
        : fillLow
          ? 'Acerca un poco o pulsa capturar'
          : shadowWarning
            ? 'Mejor luz — puedes capturar igual con el botón blanco'
            : useSheetCorners
              ? 'Encuadra la hoja; alinea las franjas negras si puedes'
              : fiducialCount > 0 && fiducialCount < 4
                ? 'Encuadra la hoja completa y pulsa capturar'
                : 'Encuadra la hoja dentro del marco y pulsa el botón blanco';

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute inset-0 bg-black/32" aria-hidden />

      {guideRect ? (
        <MobileAnswerSheetAlignGuideOverlay guideRect={guideRect} aligned={aligned} />
      ) : null}

      <div
        className="absolute left-1/2 z-30 w-[min(92%,20rem)] -translate-x-1/2 rounded-lg border border-black/10 bg-white/94 px-3 py-2.5 text-center shadow-md backdrop-blur-sm"
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

      {useSheetCorners
        ? staticCornerGuides.map((g, index) => (
            <ZipgradeAlignCornerAt
              key={index}
              left={g.left}
              top={g.top}
              size={g.size}
              detected={fiducialCorners[index] ?? false}
            />
          ))
        : null}

      {guideRect && !useSheetCorners ? (
        <div
          className="absolute z-10 border border-dashed border-white/35"
          style={{
            left: guideRect.left,
            top: guideRect.top,
            width: guideRect.width,
            height: guideRect.height,
          }}
          aria-hidden
        />
      ) : null}
    </div>
  );
}

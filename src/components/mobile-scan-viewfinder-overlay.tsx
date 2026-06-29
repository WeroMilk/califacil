'use client';

import { cn } from '@/lib/utils';
import { MOBILE_MIN_ROI_FILL_RATIO } from '@/lib/omrScan';

export type MobileGuideRectPx = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CornerId = 'tl' | 'tr' | 'bl' | 'br';

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
  /** Fiduciales detectados por esquina [TL, TR, BL, BR]. */
  fiducialCorners?: [boolean, boolean, boolean, boolean];
};

const CORNER_ORDER: CornerId[] = ['tl', 'tr', 'bl', 'br'];

function zipgradeCornerSize(guide: MobileGuideRectPx): number {
  const base = Math.min(guide.width, guide.height) * 0.28;
  return Math.round(Math.max(84, Math.min(base, 152)));
}

function cornerPosition(
  guide: MobileGuideRectPx,
  corner: CornerId,
  size: number
): { left: number; top: number } {
  switch (corner) {
    case 'tl':
      return { left: guide.left, top: guide.top };
    case 'tr':
      return { left: guide.left + guide.width - size, top: guide.top };
    case 'bl':
      return { left: guide.left, top: guide.top + guide.height - size };
    case 'br':
      return {
        left: guide.left + guide.width - size,
        top: guide.top + guide.height - size,
      };
  }
}

function ZipgradeAlignCorner({
  corner,
  guideRect,
  size,
  detected,
}: {
  corner: CornerId;
  guideRect: MobileGuideRectPx;
  size: number;
  detected: boolean;
}) {
  const { left, top } = cornerPosition(guideRect, corner, size);

  return (
    <div
      className={cn(
        'absolute z-20 rounded-lg border-[2.5px] transition-all duration-200',
        detected
          ? 'border-emerald-400 bg-white/50 shadow-[0_0_0_2px_rgba(52,211,153,0.35)]'
          : 'border-gray-700/75 bg-white/38 shadow-[0_2px_12px_rgba(0,0,0,0.25)]'
      )}
      style={{
        left,
        top,
        width: size,
        height: size,
      }}
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
  fiducialCorners = [false, false, false, false],
}: Props) {
  const bannerTop = guideRect
    ? Math.max(8, guideRect.top - 100)
    : 'max(0.65rem, env(safe-area-inset-top, 0px))';

  const fillLow = fillRatio > 0 && fillRatio < MOBILE_MIN_ROI_FILL_RATIO;
  const fillVeryLow = fillRatio > 0 && fillRatio < 0.3;
  const cornerSize = guideRect ? zipgradeCornerSize(guideRect) : 96;

  const bannerLine =
    aligned && stableTicks >= stableTicksRequired
      ? 'Capturando…'
      : aligned
        ? 'Mantén la hoja quieta'
        : fillVeryLow
          ? 'Acerca el teléfono para que la hoja llene la pantalla'
          : fillLow
            ? 'Un poco más cerca — los visores deben cubrir la hoja'
            : shadowWarning
              ? 'Reduce la sombra o activa el flash'
              : fiducialCount > 0 && fiducialCount < 4
                ? 'Centra los cuadros negros dentro de los visores blancos'
                : 'Alinea los cuadros negros de la hoja con los visores blancos';

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute inset-0 bg-black/38" aria-hidden />

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

      {guideRect ? (
        <>
          {CORNER_ORDER.map((corner, index) => (
            <ZipgradeAlignCorner
              key={corner}
              corner={corner}
              guideRect={guideRect}
              size={cornerSize}
              detected={fiducialCorners[index] ?? false}
            />
          ))}

          <div
            className="absolute z-10 border border-white/20"
            style={{
              left: guideRect.left,
              top: guideRect.top,
              width: guideRect.width,
              height: guideRect.height,
            }}
            aria-hidden
          />
        </>
      ) : null}
    </div>
  );
}

'use client';

import { memo, type ReactNode } from 'react';
import { Camera, FileStack, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

type FlashMode = 'auto' | 'on' | 'off';

type Props = {
  flashMode: FlashMode;
  flashOn: boolean;
  flashSupported: boolean;
  captureReady: boolean;
  onChangeExam: () => void;
  onFlash: () => void;
  onCapture: () => void;
};

function HudButton({
  label,
  onClick,
  active,
  highlight,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  highlight?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'exam-scanner-hud-btn flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-[9px] font-medium text-white/90 transition-all duration-200 active:scale-95 sm:gap-1 sm:rounded-2xl sm:px-4 sm:py-2.5 sm:text-[10px]',
        highlight
          ? 'bg-emerald-500/85 text-white shadow-lg shadow-emerald-900/30'
          : active
            ? 'bg-white/20'
            : 'bg-white/10 hover:bg-white/14'
      )}
      style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
      aria-label={label}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function ScanHudInner({
  flashMode,
  flashOn,
  flashSupported,
  captureReady,
  onChangeExam,
  onFlash,
  onCapture,
}: Props) {
  return (
    <div
      className="exam-scanner-hud pointer-events-auto absolute inset-x-0 z-[60] flex justify-center"
      style={{ bottom: 'max(0.85rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-[1.35rem] border border-white/12 bg-black/50 px-1.5 py-1.5 shadow-2xl backdrop-blur-2xl sm:gap-2 sm:px-2 sm:py-2">
        <HudButton label="Cambiar examen" onClick={onChangeExam}>
          <FileStack className="h-5 w-5" strokeWidth={2} />
        </HudButton>
        <HudButton
          label="Capturar"
          onClick={onCapture}
          highlight={captureReady}
        >
          <Camera className="h-5 w-5" strokeWidth={2.25} />
        </HudButton>
        <HudButton
          label="Flash"
          onClick={onFlash}
          active={flashOn || flashMode === 'on'}
        >
          <span className="relative">
            <Zap
              className={cn(
                'h-5 w-5',
                (flashOn || flashMode === 'on') && 'fill-amber-300 text-amber-300'
              )}
            />
            {flashMode === 'auto' ? (
              <span className="absolute -bottom-1 -right-1 text-[8px] font-bold">A</span>
            ) : null}
          </span>
        </HudButton>
      </div>
      {!flashSupported ? (
        <span className="sr-only">Flash no disponible en este dispositivo</span>
      ) : null}
    </div>
  );
}

export const ScanHud = memo(ScanHudInner);

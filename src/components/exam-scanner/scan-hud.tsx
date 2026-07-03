'use client';

import { type ReactNode } from 'react';
import { Camera, FileStack, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

type FlashMode = 'auto' | 'on' | 'off';

type Props = {
  flashMode: FlashMode;
  flashOn: boolean;
  flashSupported: boolean;
  captureReady: boolean;
  disabled?: boolean;
  onChangeExam: () => void;
  onFlash: () => void;
  onCapture: () => void;
};

function HudButton({
  label,
  onPress,
  action,
  active,
  highlight,
  disabled,
  children,
  large,
}: {
  label: string;
  onPress: () => void;
  action: string;
  active?: boolean;
  highlight?: boolean;
  disabled?: boolean;
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <button
      type="button"
      data-scanner-action={action}
      disabled={disabled}
      className={cn(
        'exam-scanner-hud-btn flex min-h-[48px] min-w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2.5 text-[10px] font-semibold text-white/95 transition-transform duration-150 active:scale-95 disabled:opacity-45',
        large && 'min-h-[56px] min-w-[76px] px-4',
        highlight
          ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-950/40'
          : active
            ? 'bg-white/22'
            : 'bg-white/12'
      )}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onPress();
      }}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function ScanHud({
  flashMode,
  flashOn,
  flashSupported,
  captureReady,
  disabled = false,
  onChangeExam,
  onFlash,
  onCapture,
}: Props) {
  return (
    <footer
      className="exam-scanner-hud pointer-events-none fixed inset-x-0 bottom-0 z-[10006] flex justify-center"
      style={{
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-[1.4rem] border border-white/15 bg-black/62 px-2 py-2 shadow-2xl">
        <HudButton label="Cambiar examen" action="change-exam" onPress={onChangeExam} disabled={disabled}>
          <FileStack className="h-5 w-5" strokeWidth={2} />
        </HudButton>
        <HudButton
          label="Capturar"
          action="capture"
          onPress={onCapture}
          highlight={captureReady}
          disabled={disabled}
          large
        >
          <Camera className="h-6 w-6" strokeWidth={2.25} />
        </HudButton>
        <HudButton
          label="Flash"
          action="flash"
          onPress={onFlash}
          active={flashOn || flashMode === 'on'}
          disabled={disabled}
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
    </footer>
  );
}

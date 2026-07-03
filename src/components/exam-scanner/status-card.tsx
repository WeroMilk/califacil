'use client';

import { cn } from '@/lib/utils';
import type { DocumentDetectionPhase } from '@/components/exam-scanner/types';

type Props = {
  examTitle: string;
  statusLabel: string;
  stableProgress: number;
  phase: DocumentDetectionPhase;
  className?: string;
  onTapCapture?: () => void;
};

export function StatusCard({
  examTitle,
  statusLabel,
  stableProgress,
  phase,
  className,
  onTapCapture,
}: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, stableProgress)) * 100);
  const showBar = phase === 'searching' || phase === 'stable';

  return (
    <button
      type="button"
      className={cn(
        'exam-scanner-status w-full min-w-0 text-left transition-transform duration-150 active:scale-[0.99] disabled:opacity-100',
        onTapCapture ? 'cursor-pointer' : 'cursor-default',
        className
      )}
      disabled={!onTapCapture}
      onClick={(event) => {
        event.stopPropagation();
        onTapCapture?.();
      }}
    >
      <div
        className={cn(
          'rounded-2xl border px-3.5 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md sm:px-4 sm:py-3',
          phase === 'stable' || phase === 'capturing'
            ? 'border-emerald-400/40 bg-white/92'
            : phase === 'searching'
              ? 'border-amber-300/35 bg-black/55'
              : 'border-red-400/35 bg-black/55'
        )}
      >
        <p
          className={cn(
            'truncate text-[10px] font-semibold uppercase tracking-[0.14em] sm:text-[11px] sm:tracking-[0.16em]',
            phase === 'stable' || phase === 'capturing' ? 'text-gray-500' : 'text-white/70'
          )}
        >
          {examTitle}
        </p>
        <p
          className={cn(
            'mt-0.5 text-[14px] font-medium leading-snug sm:mt-1 sm:text-[15px]',
            phase === 'stable' || phase === 'capturing' ? 'text-gray-900' : 'text-white'
          )}
        >
          {statusLabel}
        </p>
        {showBar ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/15">
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-200 ease-out',
                phase === 'stable' ? 'bg-emerald-500' : 'bg-amber-400'
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
        {onTapCapture ? (
          <p className="mt-1.5 text-[11px] font-medium text-emerald-600/90">Toca aquí para capturar</p>
        ) : null}
      </div>
    </button>
  );
}

'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { DocumentDetectionPhase } from '@/components/exam-scanner/types';

type Props = {
  examTitle: string;
  statusLabel: string;
  stableProgress: number;
  phase: DocumentDetectionPhase;
};

function StatusCardInner({ examTitle, statusLabel, stableProgress, phase }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, stableProgress)) * 100);
  const showBar = phase === 'searching' || phase === 'stable';

  return (
    <div
      className="exam-scanner-status absolute left-1/2 z-30 w-[min(88%,19rem)] -translate-x-1/2"
      style={{ top: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
    >
      <div
        className={cn(
          'rounded-2xl border px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl transition-all duration-200',
          phase === 'stable' || phase === 'capturing'
            ? 'border-emerald-400/40 bg-white/92'
            : phase === 'searching'
              ? 'border-amber-300/35 bg-black/55'
              : 'border-red-400/35 bg-black/55'
        )}
      >
        <p
          className={cn(
            'truncate text-[11px] font-semibold uppercase tracking-[0.16em]',
            phase === 'stable' || phase === 'capturing' ? 'text-gray-500' : 'text-white/70'
          )}
        >
          {examTitle}
        </p>
        <p
          className={cn(
            'mt-1 text-[15px] font-medium leading-snug',
            phase === 'stable' || phase === 'capturing' ? 'text-gray-900' : 'text-white'
          )}
        >
          {statusLabel}
        </p>
        {showBar ? (
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/15">
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-200 ease-out',
                phase === 'stable' ? 'bg-emerald-500' : 'bg-amber-400'
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const StatusCard = memo(StatusCardInner);

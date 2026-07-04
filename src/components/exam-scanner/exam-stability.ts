import type { DocumentDetectionPhase } from '@/components/exam-scanner/types';

export type ScannerUiInput = {
  documentVisible: boolean;
  aligned: boolean;
  stableProgress: number;
  scanBusy: boolean;
  lowLight?: boolean;
};

export function deriveDetectionPhase(input: ScannerUiInput): DocumentDetectionPhase {
  if (input.scanBusy) return 'capturing';
  if (input.lowLight) return 'lost';
  if (!input.documentVisible && !input.aligned) return 'lost';
  if (input.aligned && input.stableProgress >= 0.92) return 'stable';
  return 'searching';
}

export function deriveStatusLabel(
  phase: DocumentDetectionPhase,
  stableProgress: number
): string {
  if (phase === 'capturing') return 'Escaneando documento…';
  if (phase === 'lost') return 'Coloca el examen dentro del marco';
  if (phase === 'searching' && stableProgress > 0.05) return 'Mantén quieto…';
  if (phase === 'searching') return 'Buscando documento…';
  if (stableProgress < 1) return 'Mantén quieto…';
  return 'Listo — escaneando…';
}

export function phaseStrokeColor(phase: DocumentDetectionPhase): string {
  switch (phase) {
    case 'stable':
    case 'capturing':
      return 'rgb(52, 211, 153)';
    case 'searching':
      return 'rgb(249, 115, 22)';
    default:
      return 'rgb(255, 69, 58)';
  }
}

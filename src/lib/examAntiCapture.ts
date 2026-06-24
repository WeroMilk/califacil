'use client';

const CAPTURE_KEY_PATTERNS: Array<(e: KeyboardEvent) => boolean> = [
  (e) => e.key === 'PrintScreen',
  (e) => e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key),
  (e) => e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's',
  (e) => e.altKey && e.key === 'PrintScreen',
];

export function isLikelyCaptureShortcut(event: KeyboardEvent): boolean {
  return CAPTURE_KEY_PATTERNS.some((match) => match(event));
}

export function attachExamAntiCaptureHandlers(options: {
  active: boolean;
  onCaptureAttempt: (source: string) => void;
}): () => void {
  if (!options.active || typeof window === 'undefined') return () => undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isLikelyCaptureShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    options.onCaptureAttempt('keyboard_shortcut');
  };

  const onBeforePrint = () => {
    options.onCaptureAttempt('print');
  };

  const opts = { capture: true } as AddEventListenerOptions;
  document.addEventListener('keydown', onKeyDown, opts);
  window.addEventListener('beforeprint', onBeforePrint);

  return () => {
    document.removeEventListener('keydown', onKeyDown, opts);
    window.removeEventListener('beforeprint', onBeforePrint);
  };
}

export const EXAM_SECURE_BODY_CLASS = 'exam-active-secure';

'use client';

const NOTIFY_COOLDOWN_MS = 900;
const CLIPBOARD_PROBE_DELAY_MS = 180;
const BLUR_CLIPBOARD_MAX_MS = 120_000;
const BLUR_CAPTURE_DELAY_MS = 450;
const CLIPBOARD_POLL_MS = 2_500;

let examClipboardAccessGranted = false;

function isPrintScreenKey(event: KeyboardEvent): boolean {
  return (
    event.key === 'PrintScreen' ||
    event.code === 'PrintScreen' ||
    event.keyCode === 44 ||
    event.key === 'Snapshot'
  );
}

function isSnipShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  const code = event.code;
  const snipKey = key === 's' || code === 'KeyS';
  if (!snipKey || !event.shiftKey) return false;
  return event.metaKey || event.ctrlKey || event.getModifierState?.('Meta') === true;
}

const CAPTURE_KEY_PATTERNS: Array<(e: KeyboardEvent) => boolean> = [
  isPrintScreenKey,
  isSnipShortcut,
  (e) => e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key),
  (e) => e.metaKey && e.shiftKey && ['Digit3', 'Digit4', 'Digit5'].includes(e.code),
  (e) => e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS'),
  (e) => e.altKey && isPrintScreenKey(e),
  (e) => e.ctrlKey && isPrintScreenKey(e),
  (e) => e.key === 'F13' || e.code === 'F13',
];

export function isLikelyCaptureShortcut(event: KeyboardEvent): boolean {
  return CAPTURE_KEY_PATTERNS.some((match) => match(event));
}

async function clipboardHasImage(): Promise<boolean> {
  if (!examClipboardAccessGranted || typeof navigator === 'undefined' || !navigator.clipboard?.read) {
    return false;
  }
  try {
    const items = await navigator.clipboard.read();
    return items.some((item) => item.types.some((type) => type.startsWith('image/')));
  } catch {
    return false;
  }
}

export type ExamClipboardWarmupResult = 'granted' | 'denied' | 'unsupported';

export function hasExamClipboardAccess(): boolean {
  return examClipboardAccessGranted;
}

/**
 * Pide acceso al portapapeles en el gesto del alumno (clic en Comenzar).
 * Sin esto, Win+Shift+S y PrtScn a veces no se detectan hasta mucho después.
 */
export async function warmupExamClipboardAccess(): Promise<ExamClipboardWarmupResult> {
  examClipboardAccessGranted = false;

  if (typeof navigator === 'undefined' || !navigator.clipboard?.read) {
    return 'unsupported';
  }

  try {
    const permissions = navigator.permissions;
    if (permissions?.query) {
      const status = await permissions.query({
        name: 'clipboard-read' as PermissionName,
      });
      if (status.state === 'denied') return 'denied';
    }
  } catch {
    /* clipboard-read no está en Permissions API de este navegador */
  }

  try {
    await navigator.clipboard.read();
    examClipboardAccessGranted = true;
    return 'granted';
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === 'NotAllowedError' || err.name === 'SecurityError')
    ) {
      return 'denied';
    }
    return 'unsupported';
  }
}

export function clearExamClipboardAccess(): void {
  examClipboardAccessGranted = false;
}

type DisplayMediaFn = typeof navigator.mediaDevices.getDisplayMedia;

export function attachExamAntiCaptureHandlers(options: {
  active: boolean;
  onCaptureAttempt: (source: string) => void;
}): () => void {
  if (!options.active || typeof window === 'undefined') return () => undefined;

  let lastNotifyAt = 0;
  let blurredAt = 0;
  let blurCaptureTimer: ReturnType<typeof setTimeout> | null = null;
  let clipboardPollTimer: ReturnType<typeof setInterval> | null = null;

  const notifyCapture = (source: string) => {
    const now = Date.now();
    if (now - lastNotifyAt < NOTIFY_COOLDOWN_MS) return;
    lastNotifyAt = now;
    options.onCaptureAttempt(source);
  };

  const probeClipboard = (source: string) => {
    window.setTimeout(() => {
      void clipboardHasImage().then((hasImage) => {
        if (hasImage) notifyCapture(source);
      });
    }, CLIPBOARD_PROBE_DELAY_MS);
  };

  const clearBlurCaptureTimer = () => {
    if (blurCaptureTimer) {
      clearTimeout(blurCaptureTimer);
      blurCaptureTimer = null;
    }
  };

  const onKey = (event: KeyboardEvent) => {
    if (!isLikelyCaptureShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    notifyCapture('keyboard_shortcut');
    probeClipboard('clipboard_after_key');
  };

  const onClipboardEvent = (event: Event) => {
    notifyCapture(event.type === 'paste' ? 'paste' : 'clipboard_copy');
    probeClipboard('clipboard_after_copy');
  };

  const onBeforePrint = () => {
    notifyCapture('print');
  };

  const onBlur = () => {
    if (document.visibilityState !== 'visible') return;
    blurredAt = Date.now();
    clearBlurCaptureTimer();
    blurCaptureTimer = setTimeout(() => {
      if (document.visibilityState === 'visible' && !document.hasFocus()) {
        notifyCapture('window_blur_capture_tool');
        probeClipboard('clipboard_after_blur');
      }
    }, BLUR_CAPTURE_DELAY_MS);
  };

  const onFocus = () => {
    clearBlurCaptureTimer();
    if (!blurredAt || document.visibilityState !== 'visible') return;
    const elapsed = Date.now() - blurredAt;
    blurredAt = 0;
    if (elapsed > BLUR_CLIPBOARD_MAX_MS) return;
    probeClipboard('clipboard_after_blur');
  };

  let originalGetDisplayMedia: DisplayMediaFn | null = null;
  if (navigator.mediaDevices?.getDisplayMedia) {
    originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (...args) => {
      notifyCapture('display_media');
      throw new DOMException('Grabación de pantalla no permitida durante el examen.', 'NotAllowedError');
    };
  }

  if (examClipboardAccessGranted) {
    clipboardPollTimer = setInterval(() => {
      void clipboardHasImage().then((hasImage) => {
        if (hasImage) notifyCapture('clipboard_poll');
      });
    }, CLIPBOARD_POLL_MS);
  }

  const opts = { capture: true } as AddEventListenerOptions;
  window.addEventListener('keydown', onKey, opts);
  window.addEventListener('keyup', onKey, opts);
  window.addEventListener('copy', onClipboardEvent, opts);
  window.addEventListener('cut', onClipboardEvent, opts);
  window.addEventListener('paste', onClipboardEvent, opts);
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);

  return () => {
    clearBlurCaptureTimer();
    if (clipboardPollTimer) clearInterval(clipboardPollTimer);
    window.removeEventListener('keydown', onKey, opts);
    window.removeEventListener('keyup', onKey, opts);
    window.removeEventListener('copy', onClipboardEvent, opts);
    window.removeEventListener('cut', onClipboardEvent, opts);
    window.removeEventListener('paste', onClipboardEvent, opts);
    window.removeEventListener('beforeprint', onBeforePrint);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    if (originalGetDisplayMedia && navigator.mediaDevices) {
      navigator.mediaDevices.getDisplayMedia = originalGetDisplayMedia;
    }
  };
}

export const EXAM_SECURE_BODY_CLASS = 'exam-active-secure';

/** Tiempo que se muestra el aviso antes de anular el intento. */
export const CAPTURE_FORFEIT_DELAY_MS = 2600;

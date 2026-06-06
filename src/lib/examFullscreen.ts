export type ExamFullscreenMode = 'native' | 'pseudo' | 'none';

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
  msExitFullscreen?: () => Promise<void> | void;
};

/** Dispositivos táctiles / móviles donde el fullscreen nativo suele fallar (p. ej. iOS). */
export function isMobileExamDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const narrow = window.matchMedia('(max-width: 767px)').matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  return mobileUa || (touch && narrow);
}

export function getFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as FullscreenDocument;
  return (
    doc.fullscreenElement ??
    doc.webkitFullscreenElement ??
    doc.mozFullScreenElement ??
    doc.msFullscreenElement ??
    null
  );
}

export function isNativeFullscreenActive(): boolean {
  return Boolean(getFullscreenElement());
}

export async function requestExamFullscreen(el?: HTMLElement | null): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const target = el ?? document.documentElement;
  const anyEl = target as FullscreenCapableElement;
  const req =
    anyEl.requestFullscreen?.bind(anyEl) ??
    anyEl.webkitRequestFullscreen?.bind(anyEl) ??
    anyEl.mozRequestFullScreen?.bind(anyEl) ??
    anyEl.msRequestFullscreen?.bind(anyEl);
  if (!req) return false;
  try {
    await Promise.resolve(req());
    return isNativeFullscreenActive();
  } catch {
    return false;
  }
}

export async function exitExamFullscreenSafe(): Promise<void> {
  try {
    if (typeof document === 'undefined') return;
    const doc = document as FullscreenDocument;
    if (!getFullscreenElement()) return;
    const exit =
      doc.exitFullscreen?.bind(doc) ??
      doc.webkitExitFullscreen?.bind(doc) ??
      doc.mozCancelFullScreen?.bind(doc) ??
      doc.msExitFullscreen?.bind(doc);
    if (exit) await Promise.resolve(exit());
  } catch {
    /* ignore */
  }
}

/** Entra en pantalla completa: nativa si el navegador lo permite; pseudo en móvil como respaldo. */
export async function enterExamFullscreen(
  shellEl?: HTMLElement | null
): Promise<ExamFullscreenMode> {
  if (await requestExamFullscreen(shellEl ?? document.documentElement)) {
    return 'native';
  }
  if (isMobileExamDevice()) {
    return 'pseudo';
  }
  return 'none';
}

export const EXAM_PSEUDO_FULLSCREEN_CLASS = 'exam-pseudo-fullscreen';

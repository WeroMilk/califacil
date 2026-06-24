'use client';

export type ExamScreenShareSurface = 'monitor' | 'window' | 'browser' | 'unknown';

export type ExamScreenShareResult =
  | { ok: true; stream: MediaStream; surface: ExamScreenShareSurface }
  | { ok: false; error: 'unsupported' | 'denied' | 'tab_only' | 'failed' };

function readDisplaySurface(track: MediaStreamTrack): ExamScreenShareSurface {
  const settings = track.getSettings?.() as { displaySurface?: string } | undefined;
  const raw = settings?.displaySurface;
  if (raw === 'monitor' || raw === 'window' || raw === 'browser') return raw;
  return 'unknown';
}

/**
 * Pide compartir pantalla al iniciar el examen (gesto del usuario).
 * En escritorio exige pantalla completa o ventana, no solo la pestaña del navegador.
 */
export async function requestExamScreenShare(options: {
  rejectBrowserTabOnly: boolean;
}): Promise<ExamScreenShareResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    return { ok: false, error: 'unsupported' };
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      return { ok: false, error: 'failed' };
    }

    const surface = readDisplaySurface(track);
    if (options.rejectBrowserTabOnly && surface === 'browser') {
      stream.getTracks().forEach((t) => t.stop());
      return { ok: false, error: 'tab_only' };
    }

    return { ok: true, stream, surface };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return { ok: false, error: 'denied' };
    }
    return { ok: false, error: 'failed' };
  }
}

export function isExamScreenShareSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

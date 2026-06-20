'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ExamFullscreenMode } from '@/lib/examFullscreen';
import { isNativeFullscreenActive } from '@/lib/examFullscreen';
import { rpcVoidStudentExamAttempt } from '@/lib/examAttemptRpc';

const VISIBILITY_GRACE_MS = 2800;
const FULLSCREEN_EXIT_GRACE_MS = 2800;

const FULLSCREEN_CHANGE_EVENTS = [
  'fullscreenchange',
  'webkitfullscreenchange',
  'mozfullscreenchange',
  'MSFullscreenChange',
] as const;

export const examClientSessionKey = (examId: string, studentId: string) =>
  `califacil_exam_session_${examId}_${studentId}`;

export function readExamClientSession(examId: string, studentId: string): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(examClientSessionKey(examId, studentId));
}

export function writeExamClientSession(examId: string, studentId: string, token: string) {
  sessionStorage.setItem(examClientSessionKey(examId, studentId), token);
}

export function clearExamClientSession(examId: string, studentId: string) {
  sessionStorage.removeItem(examClientSessionKey(examId, studentId));
}

/**
 * Vigila cámara y visibilidad durante el examen; llama onForfeit una sola vez.
 */
export function useStudentExamProctoring(options: {
  examId: string;
  studentId: string | null;
  clientSession: string | null;
  /** true solo mientras se responde el examen (no en pantalla previa) */
  active: boolean;
  /** Modo de pantalla completa activo; 'none' = sin exigir permanencia en FS. */
  fullscreenMode: ExamFullscreenMode;
  onForfeit: (reason: string, voidPersisted: boolean) => void;
  onVisibilityHidden?: () => void;
  onVisibilityVisible?: () => void;
  onLogEvent?: (eventType: string, metadata?: Record<string, unknown>) => void;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forfeitOnceRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const optsRef = useRef(options);
  optsRef.current = options;

  const clearHiddenTimer = useCallback(() => {
    if (hiddenTimerRef.current) {
      clearTimeout(hiddenTimerRef.current);
      hiddenTimerRef.current = null;
    }
  }, []);

  const clearFullscreenTimer = useCallback(() => {
    if (fullscreenTimerRef.current) {
      clearTimeout(fullscreenTimerRef.current);
      fullscreenTimerRef.current = null;
    }
  }, []);

  const logEvent = useCallback((eventType: string, metadata?: Record<string, unknown>) => {
    optsRef.current.onLogEvent?.(eventType, metadata);
  }, []);

  const forfeit = useCallback(
    async (reason: string) => {
      if (forfeitOnceRef.current) return;
      forfeitOnceRef.current = true;
      clearHiddenTimer();
      clearFullscreenTimer();

      const { examId, studentId, clientSession } = optsRef.current;
      const session =
        clientSession ?? (studentId ? readExamClientSession(examId, studentId) : null);
      let voidPersisted = false;
      if (studentId && session) {
        let ok = await rpcVoidStudentExamAttempt(examId, studentId, session, reason);
        if (!ok) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          ok = await rpcVoidStudentExamAttempt(examId, studentId, session, reason);
        }
        voidPersisted = ok;
        if (!ok) {
          console.error('void_student_exam_attempt: no se pudo anular el intento en Supabase', {
            examId,
            studentId,
            reason,
          });
        }
      }

      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      optsRef.current.onForfeit(reason, voidPersisted);
    },
    [clearHiddenTimer, clearFullscreenTimer]
  );

  const bindStream = useCallback(
    (stream: MediaStream) => {
      streamRef.current = stream;
      const vt = stream.getVideoTracks()[0];
      if (vt) {
        vt.addEventListener('ended', () => {
          logEvent('camera_stopped');
          void forfeit('camera_stopped');
        });
      }
    },
    [forfeit, logEvent]
  );

  const stopStream = useCallback(() => {
    clearHiddenTimer();
    clearFullscreenTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [clearHiddenTimer, clearFullscreenTimer]);

  useEffect(() => {
    if (!options.active || !options.studentId || !options.clientSession) {
      clearHiddenTimer();
      clearFullscreenTimer();
      return;
    }

    forfeitOnceRef.current = false;

    const scheduleVisibilityForfeit = (reason: string) => {
      clearHiddenTimer();
      hiddenTimerRef.current = setTimeout(() => {
        void forfeit(reason);
      }, VISIBILITY_GRACE_MS);
    };

    const scheduleFullscreenForfeit = () => {
      clearFullscreenTimer();
      fullscreenTimerRef.current = setTimeout(() => {
        logEvent('left_fullscreen');
        void forfeit('left_fullscreen');
      }, FULLSCREEN_EXIT_GRACE_MS);
    };

    const onVisibility = () => {
      if (forfeitOnceRef.current) return;
      if (document.visibilityState === 'hidden') {
        logEvent('tab_hidden');
        optsRef.current.onVisibilityHidden?.();
        scheduleVisibilityForfeit('tab_hidden');
      } else {
        logEvent('tab_visible');
        optsRef.current.onVisibilityVisible?.();
        clearHiddenTimer();
      }
    };

    const onPageHide = () => {
      logEvent('left_page');
      void forfeit('left_page');
    };

    const onFreeze = () => {
      logEvent('tab_hidden', { source: 'freeze' });
      optsRef.current.onVisibilityHidden?.();
      scheduleVisibilityForfeit('tab_hidden');
    };

    const onFullscreenChange = () => {
      if (optsRef.current.fullscreenMode !== 'native' || forfeitOnceRef.current) return;
      if (!isNativeFullscreenActive()) {
        logEvent('left_fullscreen');
        scheduleFullscreenForfeit();
      } else {
        clearFullscreenTimer();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('freeze', onFreeze as EventListener);
    for (const evt of FULLSCREEN_CHANGE_EVENTS) {
      document.addEventListener(evt, onFullscreenChange);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('freeze', onFreeze as EventListener);
      for (const evt of FULLSCREEN_CHANGE_EVENTS) {
        document.removeEventListener(evt, onFullscreenChange);
      }
      clearHiddenTimer();
      clearFullscreenTimer();
    };
  }, [
    options.active,
    options.studentId,
    options.clientSession,
    options.fullscreenMode,
    forfeit,
    clearHiddenTimer,
    clearFullscreenTimer,
    logEvent,
  ]);

  useEffect(() => {
    if (!options.active) {
      void wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
      return;
    }

    let cancelled = false;

    const acquireWakeLock = async () => {
      if (cancelled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          if (!cancelled && optsRef.current.active) {
            void acquireWakeLock();
          }
        });
      } catch {
        /* permisos o batería baja */
      }
    };

    void acquireWakeLock();

    const onVisibilityForWakeLock = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityForWakeLock);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityForWakeLock);
      void wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
    };
  }, [options.active]);

  return { bindStream, stopStream, logEvent };
}

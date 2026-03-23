'use client';

import { useCallback, useEffect, useRef } from 'react';
import { rpcVoidStudentExamAttempt } from '@/lib/examAttemptRpc';

const VISIBILITY_GRACE_MS = 2800;

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
  onForfeit: (reason: string) => void;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const hiddenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forfeitOnceRef = useRef(false);
  const optsRef = useRef(options);
  optsRef.current = options;

  const clearHiddenTimer = useCallback(() => {
    if (hiddenTimerRef.current) {
      clearTimeout(hiddenTimerRef.current);
      hiddenTimerRef.current = null;
    }
  }, []);

  const forfeit = useCallback(
    async (reason: string) => {
      if (forfeitOnceRef.current) return;
      forfeitOnceRef.current = true;
      clearHiddenTimer();

      const { examId, studentId, clientSession } = optsRef.current;
      if (studentId && clientSession) {
        await rpcVoidStudentExamAttempt(examId, studentId, clientSession, reason);
      }

      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      optsRef.current.onForfeit(reason);
    },
    [clearHiddenTimer]
  );

  const bindStream = useCallback(
    (stream: MediaStream) => {
      streamRef.current = stream;
      const vt = stream.getVideoTracks()[0];
      if (vt) {
        vt.addEventListener('ended', () => {
          void forfeit('camera_stopped');
        });
      }
    },
    [forfeit]
  );

  const stopStream = useCallback(() => {
    clearHiddenTimer();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [clearHiddenTimer]);

  useEffect(() => {
    if (!options.active || !options.studentId || !options.clientSession) {
      clearHiddenTimer();
      return;
    }

    forfeitOnceRef.current = false;

    const scheduleForfeit = (reason: string) => {
      clearHiddenTimer();
      hiddenTimerRef.current = setTimeout(() => {
        void forfeit(reason);
      }, VISIBILITY_GRACE_MS);
    };

    const onVisibility = () => {
      if (forfeitOnceRef.current) return;
      if (document.visibilityState === 'hidden') {
        scheduleForfeit('tab_hidden');
      } else {
        clearHiddenTimer();
      }
    };

    const onPageHide = () => {
      void forfeit('left_page');
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      clearHiddenTimer();
    };
  }, [options.active, options.studentId, options.clientSession, forfeit, clearHiddenTimer]);

  return { bindStream, stopStream };
}

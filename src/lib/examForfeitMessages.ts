export const examForfeitMessages: Record<string, string> = {
  tab_hidden:
    'Salió del examen (cambio de pestaña o aplicación). El intento quedó anulado y no puede volver a presentarlo.',
  left_page: 'Cerró o abandonó la página del examen. El intento quedó anulado.',
  camera_stopped: 'La cámara se desactivó durante el examen. El intento quedó anulado.',
  left_fullscreen:
    'Salió del modo pantalla completa durante el examen. El intento quedó anulado.',
  capture_attempt:
    'Se detectó un intento de captura o impresión durante el examen. El intento quedó anulado.',
  abandoned: 'El intento fue abandonado o interrumpido.',
};

export function formatAttemptDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return secs > 0 ? `${mins} min ${secs} s` : `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hours} h ${remainMins} min` : `${hours} h`;
}

export function voidReasonLabel(reason: string | null | undefined): string {
  if (!reason) return examForfeitMessages.abandoned;
  return examForfeitMessages[reason] ?? reason;
}

export const examAttemptEventLabels: Record<string, string> = {
  exam_started: 'Examen iniciado',
  tab_hidden: 'Pestaña oculta / cambio de app',
  tab_visible: 'Pestaña visible de nuevo',
  left_fullscreen: 'Salió de pantalla completa',
  capture_attempt: 'Intento de captura o impresión',
  camera_stopped: 'Cámara desactivada',
  left_page: 'Abandonó la página',
  question_viewed: 'Vio pregunta',
  answer_changed: 'Cambió respuesta',
  submit_clicked: 'Presionó enviar',
};

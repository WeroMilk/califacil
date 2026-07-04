/** Exporta resultados de calificación OMR a CSV (compatible con Excel). */
export function downloadCalificacionCsv(opts: {
  examTitle: string;
  studentName: string;
  controlNumber?: string | null;
  questionLabels: string[];
  studentAnswers: string[];
  keyAnswers: string[];
  correctFlags: boolean[];
  score: { correct: number; total: number; pct: number };
}): void {
  if (typeof document === 'undefined') return;

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines: string[] = [
    `Examen,${esc(opts.examTitle)}`,
    `Alumno,${esc(opts.studentName)}`,
    opts.controlNumber ? `Control,${esc(opts.controlNumber)}` : '',
    `Calificación,${opts.score.correct}/${opts.score.total} (${opts.score.pct}%)`,
    '',
    'Pregunta,Respuesta alumno,Clave,Correcta',
  ].filter(Boolean);

  for (let i = 0; i < opts.questionLabels.length; i++) {
    lines.push(
      [
        esc(opts.questionLabels[i] ?? `P${i + 1}`),
        esc(opts.studentAnswers[i] ?? ''),
        esc(opts.keyAnswers[i] ?? ''),
        opts.correctFlags[i] ? 'Sí' : 'No',
      ].join(',')
    );
  }

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const safeName = opts.studentName.replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'alumno';
  const a = document.createElement('a');
  a.href = url;
  a.download = `calificacion-${safeName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

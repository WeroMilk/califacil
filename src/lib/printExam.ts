import type { ExamWithQuestions, Question } from '@/types';
import { resolveOptionIndexFromValue } from '@/lib/utils';

export const CALIFACIL_PRINT_MAX_QUESTIONS = 30;

/**
 * Relación ancho:alto del recuadro CaliFacil impreso (borde exterior del aside: título + tabla).
 * Calíbralo con captura real: debe coincidir con la caja `.califacil-omr` (--califacil-footer-band 76mm + padding).
 * Valor más bajo = guía más alta para un mismo ancho.
 */
export const CALIFACIL_OMR_GUIDE_ASPECT_RATIO = 2.92;

/**
 * Marco del visor en Calificar (cámara y recorte `cropCanvasToCalifacilGuideOverlay`):
 * encuadre de la **hoja carta completa** (8.5×11 in vertical), no solo del pie CaliFacil.
 * Debe coincidir con los cuadros negros de esquina impresos en cada página.
 */
export const CALIFACIL_VIEWFINDER_GUIDE = {
  /** Fracción del ancho del fotograma para el rectángulo guía */
  widthFrac: 0.92,
  centerXFrac: 0.5,
  centerYFrac: 0.5,
  /** Relación ancho÷alto del papel (carta vertical). */
  aspectRatio: 8.5 / 11,
} as const;

export type CalifacilVirtualKeyRow = {
  questionId: string;
  questionNumber: number;
  options: string[];
  correctIndex: number;
  correctOption: string;
};

/**
 * Construye una "clave virtual" determinista del examen para comparar contra la lectura OMR.
 * Esta simulación usa exactamente el texto/opciones guardadas en BD.
 */
export function buildCalifacilVirtualKey(questions: Question[]): {
  rows: CalifacilVirtualKeyRow[];
  issues: string[];
} {
  const rows: CalifacilVirtualKeyRow[] = [];
  const issues: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (q.type !== 'multiple_choice') continue;
    const optsRaw = q.options ?? [];
    const correctIndex = resolveOptionIndexFromValue(optsRaw, q.correct_answer);
    if (correctIndex === null) {
      issues.push(`La pregunta ${i + 1} no tiene respuesta correcta válida dentro de sus opciones.`);
      continue;
    }
    const options = optsRaw.map((opt) => String(opt).trim());
    const correctOption = options[correctIndex] ?? '';
    rows.push({
      questionId: q.id,
      questionNumber: i + 1,
      options,
      correctIndex,
      correctOption,
    });
  }
  return { rows, issues };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function questionBlock(
  q: Question,
  index: number,
  includeAnswerKey: boolean
): string {
  const n = index + 1;
  const text = escapeHtml(q.text);
  let body = '';

  if (q.type === 'multiple_choice' && q.options?.length) {
    const inlineOptions = q.options
      .map((opt, i) => {
        const letter = String.fromCharCode(65 + i);
        const isCorrect = includeAnswerKey && opt === q.correct_answer;
        const mark = isCorrect ? ' <strong>(correcta)</strong>' : '';
        return `<span class="opt-inline-item"><span class="opt-letter">${letter}.</span> ${escapeHtml(opt)}${mark}</span>`;
      })
      .join('');
    body = `<p class="opt-inline">${inlineOptions}</p>`;
  } else {
    body =
      '<div class="open-lines">' +
      Array.from({ length: 2 }, () => '<div class="write-line"></div>').join('') +
      '</div>';
  }

  return `
    <div class="question">
      <p class="q-num"><strong>${n}.</strong> ${text}</p>
      ${body}
    </div>`;
}

export function chunkQuestions<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Examen apto para impresión con banda CaliFacil (OMR) y para la página Calificar. */
export function examSupportsCalifacilOmr(questions: Question[]): boolean {
  if (!questions.length) return false;
  return questions.every(
    (q) =>
      q.type === 'multiple_choice' &&
      (q.options?.length ?? 0) >= 2 &&
      (q.options?.length ?? 0) <= 5
  );
}

export function califacilOmrColumnCount(questions: Question[]): number {
  if (!examSupportsCalifacilOmr(questions)) return 0;
  return Math.min(
    5,
    Math.max(...questions.map((q) => q.options?.length ?? 0))
  );
}

function califacilOmrTableHtml(
  questions: Question[],
  omrCols: number
): string {
  const rowCount = questions.length;
  const headerCells: string[] = [
    `<th class="omr-qnum omr-th" scope="col"><span class="omr-th-num">N.º</span></th>`,
  ];
  for (let c = 0; c < omrCols; c++) {
    const letter = String.fromCharCode(65 + c);
    headerCells.push(
      `<th class="omr-bubble-cell omr-th" scope="col"><span class="omr-th-letter">${letter}</span></th>`
    );
  }
  const thead = `<thead><tr class="omr-tr omr-tr--head">${headerCells.join('')}</tr></thead>`;

  const rows: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const q = questions[i];
    const qNum = i + 1;
    if (!q || q.type !== 'multiple_choice') {
      rows.push(
        `<tr class="omr-tr omr-tr--inactive"><td class="omr-qnum">—</td><td class="omr-inactive" colspan="${omrCols}">—</td></tr>`
      );
      continue;
    }
    const nOpts = Math.min(omrCols, q.options?.length ?? omrCols);
    const cells: string[] = [];
    for (let c = 0; c < omrCols; c++) {
      const letter = String.fromCharCode(65 + c);
      if (c < nOpts) {
        cells.push(
          `<td class="omr-bubble-cell"><div class="omr-bubble-wrap"><span class="omr-square" aria-label="Opción ${letter}" title="Opción ${letter}"></span></div></td>`
        );
      } else {
        cells.push(`<td class="omr-bubble-cell omr-bubble-cell--muted"></td>`);
      }
    }
    rows.push(`<tr class="omr-tr"><td class="omr-qnum">${qNum}</td>${cells.join('')}</tr>`);
  }
  return `
    <aside class="califacil-omr" aria-label="Zona CaliFacil">
      <p class="omr-title">Marca <strong>un cuadrado</strong> por reactivo con bolígrafo <strong>azul o negro</strong> (tinta oscura).</p>
      <table class="omr-table" data-califacil-omr-cols="${omrCols}" data-califacil-omr-rows="${rowCount}" data-califacil-omr-version="3">
        ${thead}
        <tbody>${rows.join('')}</tbody>
      </table>
    </aside>`;
}

const PRINT_STYLES = `    @page { size: letter; margin: 3mm 4mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 9pt;
      line-height: 1.15;
      color: #111;
      margin: 0;
      padding: 0;
    }
    .print-page {
      max-width: 7in;
      margin: 0 auto;
      position: relative;
      display: block;
      page-break-after: auto;
      break-after: auto;
    }
    /** Referencia al fotografiar con el móvil: alinear con el marco de cámara (hoja carta completa). */
    .sheet-align-corner {
      position: absolute;
      width: 6pt;
      height: 6pt;
      background: #000;
      z-index: 6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sheet-align-corner--tl { top: 0; left: 0; }
    .sheet-align-corner--tr { top: 0; right: 0; }
    .sheet-align-corner--bl { bottom: 0; left: 0; }
    .sheet-align-corner--br { bottom: 0; right: 0; }
    /**
     * Chromium suele partir el impreso entre Hermanos flex (preguntas vs OMR) y mandar sólo CaliFacil a la hoja siguiente.
     * El aside OMR está position:absolute al fondo de .print-page-omr-bundle (misma altura física estable + break-inside: avoid).
     * .print-page-fill sigue en flex column para que el bloque de preguntas ocupe el hueco restante; padding-bottom reserva la franja del pie.
     */
    .print-page--with-omr {
      --sheet-inner-height: calc(11in - 8mm);
      --califacil-footer-band: 76mm;
      --omr-bottom-gap: 3mm;
      overflow: visible;
    }
    .print-page-omr-bundle {
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: var(--sheet-inner-height);
      min-height: var(--sheet-inner-height);
      max-height: var(--sheet-inner-height);
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    .print-page-top {
      flex: 0 0 auto;
    }
    .print-page-fill {
      flex: 1 1 0;
      min-height: 0;
      overflow: hidden;
      box-sizing: border-box;
      padding-bottom: calc(var(--califacil-footer-band) + var(--omr-bottom-gap));
    }
    .print-page--with-omr .print-page-fill .questions-block {
      overflow: hidden;
      max-height: 100%;
    }
    .print-page-omr-bundle > .califacil-omr {
      position: absolute;
      left: 0;
      right: 0;
      bottom: var(--omr-bottom-gap);
      margin: 0;
      height: var(--califacil-footer-band);
      min-height: var(--califacil-footer-band);
      width: auto;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-page--with-omr .print-page-omr-bundle .omr-title {
      flex-shrink: 0;
    }
    .print-page--with-omr .print-page-omr-bundle .omr-table {
      flex: 1 1 auto;
      min-height: 0;
    }
    .print-page--with-omr .meta-grid {
      margin-bottom: 10pt;
    }
    .print-page--with-omr .question {
      margin-bottom: 2.5pt;
    }
    .print-page--with-omr .question + .question {
      padding-top: 2pt;
    }
    .print-page--with-omr .q-num {
      font-size: 8pt;
      line-height: 1.12;
    }
    .print-page--with-omr .opt-inline {
      font-size: 7.2pt;
      line-height: 1.14;
    }
    .print-page--break {
      page-break-after: always;
      break-after: page;
    }
    /** Hoja dedicada solo a la tabla de respuestas CaliFacil (separada de las preguntas). */
    .print-page--omr-only {
      --sheet-inner-height: calc(11in - 6mm);
      --corner-size: 8pt;
      --corner-gap: 4pt;
      --omr-body-inset: calc(var(--corner-size) + var(--corner-gap));
      position: relative;
      width: 100%;
      max-width: none;
      min-height: 0;
      height: auto;
      overflow: visible;
      page-break-after: always;
      break-after: page;
    }
    .print-page--omr-first {
      page-break-before: always;
      break-before: page;
    }
    /** Cuadros negros de alineación en las esquinas del papel (fuera de la tabla). */
    .print-page--omr-only .sheet-align-corner {
      width: var(--corner-size);
      height: var(--corner-size);
      z-index: 10;
    }
    .print-page--omr-only .sheet-align-corner--tl { top: 0; left: 0; }
    .print-page--omr-only .sheet-align-corner--tr { top: 0; right: 0; }
    .print-page--omr-only .sheet-align-corner--bl { bottom: 0; left: 0; }
    .print-page--omr-only .sheet-align-corner--br { bottom: 0; right: 0; }
    .print-page--omr-only .print-page-omr-sheet-body {
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      width: auto;
      height: calc(var(--sheet-inner-height) - 2 * var(--omr-body-inset));
      max-height: calc(var(--sheet-inner-height) - 2 * var(--omr-body-inset));
      min-height: 0;
      margin: var(--omr-body-inset);
      overflow: visible;
      page-break-inside: avoid;
      break-inside: avoid-page;
    }
    .print-page--omr-answer-sheet .sheet-header--omr {
      flex: 0 0 auto;
      margin-bottom: 2pt;
      padding-bottom: 2pt;
      border-bottom: 0.75pt solid #000;
    }
    .print-page--omr-answer-sheet .sheet-header--omr .header-exam-title {
      font-size: 8.5pt;
      line-height: 1.1;
    }
    .print-page--omr-answer-sheet .sheet-header--omr .omr-sheet-label {
      font-size: 7pt;
      font-weight: bold;
      margin-top: 1pt;
      color: #333;
    }
    .omr-sheet-meta-row {
      flex: 0 0 auto;
      display: flex;
      flex-direction: row;
      align-items: flex-end;
      gap: 10pt;
      margin: 0 0 3pt;
      font-size: 6.8pt;
    }
    .omr-meta-field {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      align-items: flex-end;
      gap: 3pt;
    }
    .omr-meta-field--short {
      flex: 0 0 22%;
      max-width: 22%;
    }
    .omr-meta-field label {
      flex: 0 0 auto;
      font-weight: bold;
      white-space: nowrap;
    }
    .omr-meta-field .meta-line {
      flex: 1 1 auto;
      min-height: 7pt;
      margin-top: 0;
      border-bottom: 0.75pt solid #000;
    }
    /** Tabla OMR: ocupa el resto de la hoja carta. */
    .print-page--omr-answer-sheet .califacil-omr {
      position: relative;
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      max-height: 100%;
      width: 100%;
      margin: 0;
      padding: 1.5pt 2pt 2pt;
      border: 1.5pt solid #000;
      border-radius: 0;
      background: #fff;
      overflow: visible;
      z-index: 2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-page--omr-answer-sheet .omr-title {
      flex: 0 0 auto;
      font-size: 6.2pt;
      margin: 0 0 2pt;
      font-weight: bold;
      text-align: center;
      line-height: 1.12;
    }
    .print-page--omr-answer-sheet .omr-table {
      flex: 1 1 auto;
      width: 100%;
      min-height: 0;
      height: 100%;
      font-size: 7.2pt;
      border: 1pt solid #000;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .print-page--omr-answer-sheet tbody tr.omr-tr {
      break-inside: auto;
      page-break-inside: auto;
    }
    .print-page--omr-answer-sheet .omr-tr--head .omr-th {
      border: 0.75pt solid #000;
      background: #d8d8d8;
      color: #000;
      font-weight: 800;
      padding: 1pt 2pt;
      vertical-align: middle;
      height: calc(var(--omr-row-pt, 10pt) * 1.12);
    }
    .print-page--omr-answer-sheet tbody .omr-tr .omr-qnum {
      width: 9%;
      border: 0.75pt solid #000;
      background: #efefef;
      font-size: 7pt;
      padding: 0 2pt;
      font-weight: bold;
      text-align: right;
      vertical-align: middle;
    }
    .print-page--omr-answer-sheet tbody .omr-tr .omr-bubble-cell {
      border: 0.75pt solid #000;
      background: #fff;
      padding: 0;
      vertical-align: middle;
      text-align: center;
    }
    .print-page--omr-answer-sheet tbody .omr-tr:nth-child(2n) .omr-bubble-cell {
      background: #faf8f5;
    }
    .print-page--omr-answer-sheet tbody .omr-tr:nth-child(2n) .omr-qnum {
      background: #e8e8e8;
    }
    .print-page--omr-answer-sheet tbody .omr-tr {
      height: var(--omr-row-pt, 10pt);
    }
    .print-page--omr-answer-sheet .omr-bubble-wrap {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
      height: 100%;
    }
    .print-page--omr-answer-sheet .omr-square {
      width: var(--omr-square-pt, 10pt);
      height: var(--omr-square-pt, 10pt);
      min-width: 0;
      min-height: 0;
      border: 1pt solid #000;
      border-radius: 0;
      background: #fff;
      box-sizing: border-box;
    }
    .print-page--omr-answer-sheet .omr-th-letter {
      font-size: 8.5pt;
    }
    .print-page--omr-answer-sheet .omr-th-num {
      font-size: 6.8pt;
    }
    /** 16–30 reactivos: tipografía un poco más compacta; filas siguen --omr-row-pt calculado. */
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-title {
      font-size: 5.8pt;
      margin-bottom: 1pt;
      line-height: 1.1;
    }
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-table {
      font-size: 6.6pt;
      flex: 1 1 auto;
      height: 100%;
      min-height: 0;
    }
    .print-page--omr-answer-sheet.print-page--dense-omr tbody .omr-tr .omr-qnum {
      font-size: calc(var(--omr-row-pt, 10pt) * 0.58);
      padding: 0 1.5pt;
      line-height: 1;
    }
    .print-page--omr-answer-sheet.print-page--dense-omr .omr-th-letter {
      font-size: calc(var(--omr-row-pt, 10pt) * 0.68);
    }
    .print-page--questions-only .question {
      margin-bottom: 5pt;
    }
    .print-page--questions-only .q-num {
      font-size: 8.5pt;
      line-height: 1.16;
    }
    .print-page--questions-only .opt-inline {
      font-size: 8pt;
      line-height: 1.18;
    }
    /** Una sola hoja con todas las preguntas (hasta 30). */
    .print-page--all-questions {
      --sheet-inner-height: calc(11in - 6mm);
      page-break-after: always;
      break-after: page;
      max-width: none;
      width: 100%;
      min-height: var(--sheet-inner-height);
      height: var(--sheet-inner-height);
    }
    .print-page--all-questions .print-page-questions-body {
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      width: 100%;
      min-height: var(--sheet-inner-height);
      height: var(--sheet-inner-height);
    }
    .print-page--all-questions .sheet-header {
      flex: 0 0 auto;
      margin-bottom: 6pt;
      padding-bottom: 4pt;
      border-bottom: 0.75pt solid #222;
    }
    .print-page--all-questions .header-exam-title {
      font-size: 10pt;
      letter-spacing: 0.01em;
    }
    .print-page--all-questions .header-exam-range {
      font-size: 7.5pt;
      color: #444;
      margin-top: 1pt;
    }
    .print-page--all-questions .meta-grid {
      flex: 0 0 auto;
      margin-bottom: 10pt;
    }
    .print-page--all-questions .print-chunk {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .print-page--all-questions .questions-block {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 0;
    }
    .print-page--all-questions .question {
      margin-bottom: 0;
      flex: 0 0 auto;
    }
    .print-page--all-questions .question + .question {
      padding-top: 0;
      border-top: none;
    }
    .print-page--all-questions .q-num {
      font-size: 7.2pt;
      line-height: 1.14;
      margin-bottom: 1.5pt;
    }
    .print-page--all-questions .opt-inline {
      font-size: 6.8pt;
      line-height: 1.15;
      margin-left: 6pt;
      margin-top: 1pt;
    }
    .print-page--all-questions .opt-inline-item {
      margin-right: 7pt;
      margin-bottom: 0;
    }
    .print-page--dense-questions .q-num {
      font-size: 6.6pt;
      line-height: 1.12;
    }
    .print-page--dense-questions .opt-inline {
      font-size: 6.4pt;
      line-height: 1.13;
    }
    .omr-sheet-meta {
      display: grid;
      grid-template-columns: minmax(0, 2.35fr) minmax(0, 0.55fr) minmax(0, 1.1fr);
      gap: 2pt 6pt;
      margin: 0 0 10pt;
      font-size: 7pt;
    }
    .omr-sheet-meta label { font-weight: bold; }
    .omr-sheet-label {
      font-size: 8pt;
      font-weight: bold;
      margin: 2pt 0 0;
      color: #222;
    }
    /* Siguientes bloques de 10 reactivos: nueva hoja fiable en todos los navegadores */
    .print-page--continuation {
      page-break-before: always;
      break-before: page;
    }
    .print-chunk {
      display: block;
      break-inside: avoid-page;
      page-break-inside: avoid;
    }
    .sheet-header {
      display: flex;
      flex-direction: column;
      gap: 2pt;
      border-bottom: 1px solid #000;
      padding-bottom: 2pt;
      margin-bottom: 2pt;
    }
    .sheet-header-text {
      width: 100%;
      min-width: 0;
      text-align: right;
    }
    .header-exam-title {
      font-size: 9pt;
      font-weight: bold;
      margin: 0;
      line-height: 1.1;
    }
    .header-exam-range {
      font-size: 8pt;
      font-weight: bold;
      margin: 2pt 0 0;
      color: #333;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: minmax(0, 2.35fr) minmax(0, 0.55fr) minmax(0, 1.1fr);
      gap: 2pt 6pt;
      margin-top: 3pt;
      margin-bottom: 18pt;
      font-size: 7pt;
    }
    .meta-grid label { font-weight: bold; }
    .meta-line {
      border-bottom: 1px solid #000;
      min-height: 9pt;
      margin-top: 2pt;
    }
    .questions-block { margin-top: 0; }
    .question { margin-bottom: 4pt; page-break-inside: avoid; break-inside: avoid-page; }
    .question + .question {
      border-top: 0.6pt solid #e3e3e3;
      padding-top: 3pt;
    }
    .question--placeholder .q-num { color: #777; }
    .q-num { margin: 0 0 1pt; text-align: justify; font-size: 8.2pt; line-height: 1.14; }
    .opt-letter { font-weight: bold; }
    .opt-inline {
      margin: 0 0 0 8pt;
      font-size: 7.5pt;
      line-height: 1.16;
      text-align: left;
    }
    .opt-inline-item {
      display: inline-block;
      margin-right: 10pt;
      margin-bottom: 1pt;
      max-width: 100%;
      vertical-align: top;
    }
    .open-lines { margin-top: 1pt; margin-left: 5pt; }
    .write-line {
      border-bottom: 1px solid #333;
      min-height: 7pt;
      margin-bottom: 2pt;
    }
    .footer-note {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 1pt;
      margin-top: 0;
      font-size: 6.5pt;
      text-align: center;
      color: #666;
      border-top: 0;
      padding-top: 1pt;
    }
    .empty-note { font-size: 9pt; color: #666; font-style: italic; }
    .califacil-omr {
      position: relative;
      margin: 0;
      padding: 2.5pt 4pt 3pt;
      border: 1.7pt solid #000;
      break-inside: avoid-page;
      page-break-inside: avoid;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .omr-title {
      font-size: 6pt;
      font-weight: bold;
      text-align: center;
      margin: 0 0 2pt;
      line-height: 1.15;
    }
    .omr-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 7pt;
      border: 1pt solid #000;
      break-inside: avoid-page;
      page-break-inside: avoid;
    }
    .omr-tr--head .omr-th {
      font-weight: 800;
      text-align: center;
      vertical-align: middle;
      padding: 1.6pt 2pt;
      border: 0.8pt solid #000;
      background: #d8d8d8;
      color: #000;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .omr-tr--head .omr-qnum.omr-th {
      text-align: center;
      background: #c8c8c8;
    }
    .omr-th-letter {
      font-size: 8.4pt;
      letter-spacing: 0.02em;
    }
    .omr-th-num {
      font-size: 6.6pt;
    }
    .omr-tr--inactive .omr-inactive {
      text-align: center;
      font-style: italic;
      color: #888;
      padding: 2pt;
    }
    .omr-qnum {
      width: 9%;
      font-weight: bold;
      text-align: right;
      padding: 1.4pt 3pt 1.4pt 2pt;
      vertical-align: middle;
      border: 0.8pt solid #000;
      background: #efefef;
      font-size: 7pt;
    }
    .omr-bubble-cell {
      text-align: center;
      vertical-align: middle;
      padding: 1.2pt 2.5pt;
      border: 0.8pt solid #000;
    }
    .omr-bubble-cell--muted {
      background: #ebebeb;
    }
    .omr-bubble-wrap {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      min-height: 9pt;
    }
    .omr-square {
      width: 9pt;
      height: 9pt;
      min-width: 9pt;
      min-height: 9pt;
      border: 1pt solid #000;
      border-radius: 1.2pt;
      background: #fff;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tbody .omr-tr:nth-child(2n) .omr-bubble-cell {
      background: #faf8f5;
    }
    tbody .omr-tr:nth-child(2n) .omr-qnum {
      background: #e8e8e8;
    }
    thead {
      display: table-header-group;
    }
    tbody tr.omr-tr {
      break-inside: avoid-page;
      page-break-inside: avoid;
    }

    @media print {
      body { max-width: none; }
      .no-print { display: none; }
      .print-page--all-questions,
      .print-page--all-questions .print-page-questions-body {
        height: var(--sheet-inner-height);
        min-height: var(--sheet-inner-height);
      }
      .print-page--all-questions .questions-block {
        justify-content: space-between;
      }
      .print-page--with-omr .print-page-omr-bundle {
        height: var(--sheet-inner-height);
        min-height: var(--sheet-inner-height);
        max-height: var(--sheet-inner-height);
        overflow: hidden;
      }
      .print-page--with-omr .print-page-fill,
      .print-page--with-omr .print-page-fill .questions-block {
        overflow: hidden;
      }
      .print-page--omr-only {
        height: auto;
        max-height: none;
        overflow: visible;
      }
      .print-page--omr-only .print-page-omr-sheet-body {
        height: calc(var(--sheet-inner-height) - 2 * var(--omr-body-inset));
        max-height: calc(var(--sheet-inner-height) - 2 * var(--omr-body-inset));
        overflow: visible;
      }
      .print-page--omr-answer-sheet .califacil-omr {
        flex: 1 1 auto;
        min-height: 0;
        height: auto;
        max-height: none;
        overflow: visible;
        display: flex;
        flex-direction: column;
      }
      .print-page--omr-answer-sheet .omr-table {
        flex: 1 1 auto;
        height: 100%;
        min-height: 0;
      }
    }`;

function sheetAlignCornersHtml(): string {
  return `
    <span class="sheet-align-corner sheet-align-corner--tl" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--tr" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--bl" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--br" aria-hidden="true"></span>`;
}

function buildQuestionPageSection(
  questions: Question[],
  title: string,
  includeAnswerKey: boolean
): string {
  const questionsInPage = questions
    .map((q, i) => questionBlock(q, i, includeAnswerKey))
    .join('');

  const qb = questionsInPage || '<p class="empty-note">Sin preguntas.</p>';

  const denseClass = questions.length > 15 ? ' print-page--dense-questions' : '';

  return `
  <section class="print-page print-page--questions-only print-page--all-questions${denseClass} print-page--break">
    <div class="print-page-questions-body">
    <header class="sheet-header">
      <div class="sheet-header-text">
        <div class="header-exam-title">${title}</div>
        <div class="header-exam-range">Preguntas 1 a ${questions.length}</div>
      </div>
    </header>
  <div class="meta-grid">
    <div><label>Nombre del alumno</label><div class="meta-line"></div></div>
    <div><label>Grupo</label><div class="meta-line"></div></div>
    <div><label>Fecha</label><div class="meta-line"></div></div>
  </div>
    <div class="print-chunk">
      <div class="questions-block">
        ${qb}
      </div>
    </div>
    </div>
  </section>`;
}

/** Altura de fila OMR (pt) para que la tabla llene la hoja sin cortar filas. */
function omrFillRowHeightPt(rowCount: number): number {
  const sheetInnerPt = 775; // carta vertical menos márgenes @page (~11in − 6mm)
  const bodyInsetPt = 24; // cuadros de esquina + gap (×2)
  const chromeOutsideOmrPt = 54; // cabecera + meta del alumno
  const omrTitlePt = 10;
  const omrBorderPadPt = 9;
  const theadRowEquiv = 1.15;
  const usable =
    sheetInnerPt - bodyInsetPt - chromeOutsideOmrPt - omrTitlePt - omrBorderPadPt;
  const rowPt = usable / (rowCount + theadRowEquiv);
  return Math.round(Math.max(8.5, rowPt) * 10) / 10;
}

/** Mismas medidas que `.print-page--omr-answer-sheet` (carta vertical, márgenes @page). */
export const CALIFACIL_ANSWER_SHEET_PAGE = {
  widthPt: 612,
  innerHeightPt: 775,
  bodyInsetPt: 12,
  chromeAboveOmrPt: 54,
  omrBorderPadTopPt: 3.5,
  omrTitlePt: 10,
  qnumColFrac: 0.09,
} as const;

export type CalifacilAnswerSheetOmrTemplate = {
  tableLeftRatio: number;
  tableTopRatio: number;
  tableWidthRatio: number;
  tableHeightRatio: number;
  titleStripRatioOfTable: number;
  qnumWidthRatio: number;
};

/**
 * Plantilla OMR normalizada (0–1) alineada con la hoja de respuestas impresa.
 * Debe usarse tras enderezar la captura con los 4 fiduciales de esquina.
 */
export function buildCalifacilAnswerSheetOmrTemplate(
  rowCount: number
): CalifacilAnswerSheetOmrTemplate {
  const { widthPt, innerHeightPt, bodyInsetPt, chromeAboveOmrPt, omrBorderPadTopPt, omrTitlePt, qnumColFrac } =
    CALIFACIL_ANSWER_SHEET_PAGE;
  const rowPt = omrFillRowHeightPt(rowCount);
  const theadPt = rowPt * 1.12;

  const tableLeft = bodyInsetPt;
  const tableTop = bodyInsetPt + chromeAboveOmrPt;
  const tableW = widthPt - 2 * bodyInsetPt;
  const tableH = innerHeightPt - tableTop - bodyInsetPt;
  const titleStripPt = omrBorderPadTopPt + omrTitlePt + theadPt;

  return {
    tableLeftRatio: tableLeft / widthPt,
    tableTopRatio: tableTop / innerHeightPt,
    tableWidthRatio: tableW / widthPt,
    tableHeightRatio: tableH / innerHeightPt,
    titleStripRatioOfTable: titleStripPt / tableH,
    qnumWidthRatio: qnumColFrac,
  };
}

function omrSheetMetaRowHtml(): string {
  return `
      <div class="omr-sheet-meta-row">
        <div class="omr-meta-field"><label>Nombre del alumno</label><div class="meta-line"></div></div>
        <div class="omr-meta-field omr-meta-field--short"><label>Grupo</label><div class="meta-line"></div></div>
        <div class="omr-meta-field omr-meta-field--short"><label>Fecha</label><div class="meta-line"></div></div>
      </div>`;
}

function buildOmrAnswerSheetSection(
  questions: Question[],
  title: string,
  omrCols: number
): string {
  const omrHtml = califacilOmrTableHtml(questions, omrCols);
  const rowCount = questions.length;
  const denseOmrClass = rowCount > 15 ? ' print-page--dense-omr' : '';
  const sheetNote = `Hoja de respuestas · Reactivos 1–${rowCount}`;

  const rowPt = omrFillRowHeightPt(rowCount);
  const squarePt = Math.round(Math.min(rowPt - 2, Math.max(7, rowPt * 0.72)) * 10) / 10;

  return `
  <section class="print-page print-page--omr-only print-page--omr-answer-sheet${denseOmrClass} print-page--omr-first print-page--break" style="--omr-row-count: ${rowCount}; --omr-row-pt: ${rowPt}pt; --omr-square-pt: ${squarePt}pt;">
${sheetAlignCornersHtml()}
    <div class="print-page-omr-sheet-body">
      <header class="sheet-header sheet-header--omr">
        <div class="sheet-header-text">
          <div class="header-exam-title">${title}</div>
          <div class="omr-sheet-label">${sheetNote}</div>
        </div>
      </header>
${omrSheetMetaRowHtml()}
${omrHtml}
    </div>
  </section>`;
}

/**
 * HTML completo del examen (mismo documento que se usa para imprimir).
 */
export function buildPrintExamHtml(
  exam: ExamWithQuestions,
  options: { includeAnswerKey?: boolean; baseUrl: string }
): string {
  const includeAnswerKey = options.includeAnswerKey === true;
  const title = escapeHtml(exam.title);

  const omrCols = califacilOmrColumnCount(exam.questions);
  const questions = exam.questions;

  const questionPagesHtml = buildQuestionPageSection(questions, title, includeAnswerKey);

  const omrPagesHtml =
    omrCols > 0 ? buildOmrAnswerSheetSection(questions, title, omrCols) : '';

  const pagesHtml = questionPagesHtml + omrPagesHtml;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Examen</title>
  <base href="${options.baseUrl}/" />
  <style>
${PRINT_STYLES}
  </style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}

/**
 * Abre ventana de impresión con examen en formato carta (US Letter).
 */
export function printExamDocument(
  exam: ExamWithQuestions,
  options?: { includeAnswerKey?: boolean }
): boolean {
  if (typeof window === 'undefined') return false;
  const includeAnswerKey = options?.includeAnswerKey === true;
  const html = buildPrintExamHtml(exam, {
    includeAnswerKey,
    baseUrl: window.location.origin,
  });

  const win = window.open('', '_blank');
  if (!win) {
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = '\u00A0';
  win.focus();
  setTimeout(() => {
    win.document.title = '\u00A0';
    win.print();
    win.close();
  }, 250);
  return true;
}

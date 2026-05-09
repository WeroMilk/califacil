import type { ExamWithQuestions, Question } from '@/types';
import { resolveOptionIndexFromValue } from '@/lib/utils';

/**
 * Relación ancho:alto del recuadro CaliFacil impreso (borde exterior del aside: título + tabla).
 * Calíbralo con captura real: debe coincidir con la caja `.califacil-omr` (--califacil-footer-band 70mm + padding).
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

function questionPlaceholderBlock(index: number): string {
  const n = index + 1;
  return `
    <div class="question question--placeholder">
      <p class="q-num"><strong>${n}.</strong> ________________________________</p>
      <div class="open-lines">
        <div class="write-line"></div>
      </div>
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
  chunkQs: Question[],
  startIdx: number,
  omrCols: number
): string {
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
  for (let i = 0; i < 10; i++) {
    const q = chunkQs[i];
    const qNum = startIdx + i + 1;
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
      <p class="omr-title">CaliFacil — <strong>Una</strong> respuesta por fila: rellena <strong>toda la casilla</strong> (cuadrado) con bolígrafo <strong>azul o negro</strong> (tinta bien oscura).</p>
      <table class="omr-table" data-califacil-omr-cols="${omrCols}" data-califacil-omr-version="2">
        ${thead}
        <tbody>${rows.join('')}</tbody>
      </table>
    </aside>`;
}

const PRINT_STYLES = `    @page { size: letter; margin: 4mm 7mm; }
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
      --sheet-inner-height: calc(11in - 16mm);
      --califacil-footer-band: 70mm;
      --omr-bottom-gap: 5mm;
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
    .print-page-omr-bundle > .califacil-omr {
      position: absolute;
      left: 0;
      right: 0;
      bottom: var(--omr-bottom-gap);
      margin: 0;
      height: var(--califacil-footer-band);
      min-height: var(--califacil-footer-band);
      max-height: var(--califacil-footer-band);
      width: auto;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      z-index: 1;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .print-page--with-omr .print-page-omr-bundle .omr-title {
      flex-shrink: 0;
    }
    .print-page--break {
      page-break-after: always;
      break-after: page;
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
    .sheet-banner-wrap {
      width: 100%;
      background: #fff;
      line-height: 0;
      display: flex;
      justify-content: center;
    }
    .sheet-banner {
      width: 100%;
      height: auto;
      max-height: 0.62in;
      object-fit: contain;
      object-position: center;
      display: block;
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

      padding: 3pt 4pt 4pt;

      border: 1.7pt solid #000;
      break-inside: avoid-page;
      page-break-inside: avoid;
      -webkit-print-color-adjust: exact;

      print-color-adjust: exact;
    }
    .omr-title {
      font-size: 6.4pt;
      font-weight: bold;
      text-align: center;
      margin: 0 0 3.5pt;
      line-height: 1.2;
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
      padding: 2.3pt 2.6pt;
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
      padding: 2.2pt 4.2pt 2.2pt 2.4pt;
      vertical-align: middle;
      border: 0.8pt solid #000;
      background: #efefef;
      font-size: 7.4pt;
    }
    .omr-bubble-cell {
      text-align: center;
      vertical-align: middle;
      padding: 1.9pt 3.2pt;
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
      min-height: 11pt;
    }
    .omr-square {
      width: 11pt;
      height: 11pt;
      min-width: 11pt;
      min-height: 11pt;
      border: 1.1pt solid #000;
      border-radius: 1.5pt;
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
    }`;

/**
 * HTML completo del examen (mismo documento que se usa para imprimir).
 */
export function buildPrintExamHtml(
  exam: ExamWithQuestions,
  options: { includeAnswerKey?: boolean; baseUrl: string }
): string {
  const includeAnswerKey = options.includeAnswerKey === true;
  const title = escapeHtml(exam.title);
  const headerBannerUrl = `${options.baseUrl.replace(/\/$/, '')}/print-header-banner.png`;

  const omrCols = califacilOmrColumnCount(exam.questions);

  const chunks = chunkQuestions(exam.questions, 10);
  const pagesHtml = chunks
    .map((chunkQs, pageIdx) => {
      const isFirst = pageIdx === 0;
      const isLast = pageIdx === chunks.length - 1;
      const startIdx = pageIdx * 10;
      const rangeStart = startIdx + 1;
      const rangeEnd = startIdx + 10;
      const questionsInPage = Array.from({ length: 10 }, (_, i) => {
        const q = chunkQs[i];
        return q
          ? questionBlock(q, startIdx + i, includeAnswerKey)
          : questionPlaceholderBlock(startIdx + i);
      })
        .join('');
      const breakClass = !isLast ? ' print-page--break' : '';
      const continuationClass = !isFirst ? ' print-page--continuation' : '';
      const pageClass = `print-page${continuationClass}${breakClass}`.trim().replace(/\s+/g, ' ');

      const headerRight = isFirst
        ? `<div class="header-exam-title">${title}</div>`
        : `<div class="header-exam-title">${title}</div><div class="header-exam-range">Preguntas ${rangeStart} a ${rangeEnd}</div>`;

      const firstPageBlock = isFirst
        ? `
  <div class="meta-grid">
    <div><label>Nombre del alumno</label><div class="meta-line"></div></div>
    <div><label>Grupo</label><div class="meta-line"></div></div>
    <div><label>Fecha</label><div class="meta-line"></div></div>
  </div>`
        : '';

      const qb = questionsInPage || '<p class="empty-note">Sin preguntas en esta sección.</p>';
      const withOmr = omrCols > 0;
      const omrHtml = withOmr ? califacilOmrTableHtml(chunkQs, startIdx, omrCols) : '';

      const sectionClass = `${pageClass}${withOmr ? ' print-page--with-omr' : ''}`;

      const sheetHeaderHtml = `
    <header class="sheet-header">
      <div class="sheet-banner-wrap">
        <img class="sheet-banner" src="${headerBannerUrl}" alt="" crossorigin="anonymous" />
      </div>
      <div class="sheet-header-text">
        ${headerRight}
      </div>
    </header>`;


      const bodyInner = withOmr
        ? `
    <div class="print-page-omr-bundle">
      <div class="print-page-top">
${sheetHeaderHtml}
${firstPageBlock}
      </div>
      <div class="print-page-fill">
        <div class="questions-block">
          ${qb}
        </div>
      </div>
${omrHtml}
    </div>`
        : `
${sheetHeaderHtml}
${firstPageBlock}
    <div class="print-chunk">
      <div class="questions-block">
        ${qb}
      </div>
    </div>`;

      return `
  <section class="${sectionClass}">
    <span class="sheet-align-corner sheet-align-corner--tl" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--tr" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--bl" aria-hidden="true"></span>
    <span class="sheet-align-corner sheet-align-corner--br" aria-hidden="true"></span>
${bodyInner}
  </section>`;
    })
    .join('');

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

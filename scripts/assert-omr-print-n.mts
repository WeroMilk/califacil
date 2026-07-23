/**
 * Verifica HTML de hoja OMR para N=10 y N=30.
 * Run: npx tsx scripts/assert-omr-print-n.mts
 */
import {
  assertCompactAnswerSheetLayoutRatios,
  buildPrintExamHtml,
} from '../src/lib/printExam.ts';
import type { ExamWithQuestions, Question } from '../src/types';

function mkExam(n: number): ExamWithQuestions {
  const questions: Question[] = Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    exam_id: 'e',
    type: 'multiple_choice',
    text: `Pregunta ${i + 1}`,
    options: ['a', 'b', 'c', 'd'],
    correct_answer: 'a',
    points: 1,
    order_index: i,
  })) as Question[];
  return {
    id: 'e',
    title: 'chilo',
    questions,
  } as ExamWithQuestions;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const h10 = buildPrintExamHtml(mkExam(10), { baseUrl: 'http://localhost' });
const h30 = buildPrintExamHtml(mkExam(30), { baseUrl: 'http://localhost' });

const rowsAttr = (html: string) => html.match(/data-califacil-omr-rows="(\d+)"/)?.[1];
const labelEnd = (html: string) => html.match(/Reactivos 1–(\d+)/)?.[1];
const bodyRows = (html: string) => (html.match(/<tr class="omr-tr">/g) || []).length;

assert(rowsAttr(h10) === '10', `N=10 rows attr got ${rowsAttr(h10)}`);
assert(labelEnd(h10) === '10', `N=10 label got ${labelEnd(h10)}`);
assert(bodyRows(h10) === 10, `N=10 tbody got ${bodyRows(h10)}`);

assert(rowsAttr(h30) === '30', `N=30 rows attr got ${rowsAttr(h30)}`);
assert(labelEnd(h30) === '30', `N=30 label got ${labelEnd(h30)}`);
assert(bodyRows(h30) === 30, `N=30 tbody got ${bodyRows(h30)}`);

assert(!h10.includes('Reactivos 1–30'), 'N=10 must not say 1–30');
assert(h10.includes('--omr-row-count: 10'), 'CSS var row count 10');
assert(h30.includes('--omr-row-count: 30'), 'CSS var row count 30');

assertCompactAnswerSheetLayoutRatios();
console.log('ok: print HTML N=10 compact / N=30 full + calificador template sync');

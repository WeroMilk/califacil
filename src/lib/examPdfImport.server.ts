import OpenAI from 'openai';
import type { GeneratedQuestion } from '@/types';
import { extractPdfStructureFromBuffer, attachPdfImagesToQuestions, lineAnchorForIndex, type PdfStructure, type PositionedLine } from '@/lib/pdfStructure.server';
import { extractPdfImagesFromBuffer } from '@/lib/pdfImages.server';
import { dedupeExamQuestions, normalizeScientificNotation } from '@/lib/utils';

const HEADER_SKIP =
  /^(instituto|dr\.|apellido|nombre|grupo|unidad\s+\d+|examen|física|materia|\d+\s*$)/i;
const MC_OPTION = /^[A-Ea-e][\).:\-]\s+/;

type QuestionWithAnchor = GeneratedQuestion & {
  _anchorPage?: number;
  _anchorY?: number;
  _triangle?: '1' | '2';
};

function withAnchor(
  question: GeneratedQuestion,
  positionedLines: PositionedLine[],
  lineIndex: number,
  triangle?: '1' | '2'
): QuestionWithAnchor {
  const anchor = lineAnchorForIndex(positionedLines, lineIndex);
  return {
    ...question,
    _anchorPage: anchor?.pageNumber,
    _anchorY: anchor?.y,
    _triangle: triangle,
  };
}

function stripLeadingSectionNumber(text: string): string {
  return text.replace(/^\d+[\).:\-]\s+/, '').trim();
}

function sanitizeQuestionText(text: string): string {
  return normalizeScientificNotation(stripLeadingSectionNumber(text).trim());
}

function sectionPrefix(section: string): string {
  const label = stripLeadingSectionNumber(section.split('(')[0].trim());
  return label ? `${label}: ` : '';
}

function normalizeQuestions(raw: unknown[]): GeneratedQuestion[] {
  const questions: GeneratedQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const text = sanitizeQuestionText(String(row.text ?? '').trim());
    if (!text) continue;
    const type = row.type === 'open_answer' ? 'open_answer' : 'multiple_choice';
    if (type === 'multiple_choice') {
      const options = Array.isArray(row.options)
        ? row.options.map((o) => String(o).trim()).filter(Boolean)
        : [];
      if (options.length < 2) continue;
      const correct = String(row.correct_answer ?? options[0]).trim();
      questions.push({
        text,
        type,
        options,
        correct_answer: options.includes(correct) ? correct : options[0],
        illustration: row.illustration ? String(row.illustration) : undefined,
      });
    } else {
      questions.push({
        text,
        type,
        correct_answer: row.correct_answer ? String(row.correct_answer) : undefined,
        illustration: row.illustration ? String(row.illustration) : undefined,
      });
    }
  }
  return questions;
}

function mergeBrokenLines(lines: string[]): string[] {
  const merged: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];

    while (i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (/^\d+\.\s+[A-ZÁÉÍÓÚÑ]/.test(next)) break;

      const continues =
        next === '.' ||
        /^[+\-/]/.test(next) ||
        (/x10\s*[-+]?\d*$/i.test(line) && /^[\d.]/.test(next)) ||
        (/\d$/.test(line) && next.startsWith('.')) ||
        (line.endsWith(' redondeado a') && /^dos|cuatro/i.test(next)) ||
        (line.endsWith(' a') && /^dos|cuatro/i.test(next)) ||
        (/\($/.test(line) && next.startsWith('valor')) ||
        (line.endsWith(' dos') && next.startsWith('decimales')) ||
        (line.endsWith(' a') && next.startsWith('cuatro')) ||
        (/^\d+\.\s+/.test(line) && /^[a-záéíóú]/.test(next));

      if (!continues) break;
      line = `${line} ${next}`.replace(/\s+/g, ' ');
      i += 1;
    }

    merged.push(line);
  }

  return merged;
}

function isSectionHeader(line: string): boolean {
  return /^\d+\.\s+[A-ZÁÉÍÓÚÑ¿]/.test(line) && line.length >= 40;
}

function isSkippableLine(line: string): boolean {
  if (!line || line.length < 2) return true;
  if (HEADER_SKIP.test(line)) return true;
  if (/^(A|B|C|c|b|a)\s*$/i.test(line)) return true;
  return false;
}

function isBlankExerciseStarter(line: string): boolean {
  return /^[_\s]*_{3,}\s*\S/.test(line) || /^_{5,}\s*\S/.test(line);
}

function readBlankExerciseBlock(
  lines: string[],
  startIndex: number
): { content: string; endIndex: number } | null {
  const line = lines[startIndex];
  if (!isBlankExerciseStarter(line)) return null;

  let content = line
    .replace(/^[_\s]+/, '')
    .replace(/\s*_{3,}\s*/, ' ')
    .trim();
  let i = startIndex;

  while (i + 1 < lines.length) {
    const next = lines[i + 1].trim();
    if (!next || isSectionHeader(next) || isBlankExerciseStarter(next)) break;
    if (/Triángulo/i.test(next) || /\b[ABCabc]\s*=\s*_{3,}/.test(next)) break;
    if (/^[\d.+/-]/.test(next) || next === '.' || /x10/i.test(next)) {
      content = `${content} ${next}`.replace(/\s+/g, ' ');
      i += 1;
      continue;
    }
    break;
  }

  content = content.replace(/\s+/g, ' ').trim();
  if (/^[ABCabc]\s*=/.test(content) || !isMathOrConversionExercise(content)) return null;
  return { content, endIndex: i };
}

function isMathOrConversionExercise(text: string): boolean {
  if (/^[ABCabc]\s*=/.test(text)) return false;
  return (
    /\d/.test(text) &&
    /(?:x10\s*[-+]?\s*\d+|[+\-/]|°|\b(?:m|yd|ft|in|kg|g\/cm|mi\/h|m\/s|m\s+a\s+))/i.test(text)
  );
}

function extractMcOptionsFromLines(lines: string[]): { options: string[]; consumed: number } | null {
  const options: string[] = [];
  let consumed = 0;
  for (const line of lines) {
    if (!MC_OPTION.test(line)) break;
    options.push(line.replace(MC_OPTION, '').trim());
    consumed += 1;
  }
  if (options.length < 2) return null;
  return { options, consumed };
}

function parseTriangleBlanks(
  lines: string[],
  sectionIntro: string
): GeneratedQuestion[] {
  const shortIntro = stripLeadingSectionNumber(sectionIntro.split('(')[0].trim());
  const questions: GeneratedQuestion[] = [];
  const given: Record<'1' | '2', string[]> = { '1': [], '2': [] };
  const assigned = new Set<string>();

  const pushBlank = (tri: '1' | '2', field: string) => {
    const key = `${tri}:${field}`;
    if (assigned.has(key)) return;
    assigned.add(key);
    questions.push({
      text: `${shortIntro} — Triángulo ${tri}: calcula ${field}`,
      type: 'open_answer',
      _triangle: tri,
    } as QuestionWithAnchor);
  };

  const pushGiven = (tri: '1' | '2', field: string, value: string) => {
    given[tri].push(`${field}=${value}`);
  };

  for (const rawLine of lines) {
    if (isSkippableLine(rawLine)) continue;

    const blanks = Array.from(rawLine.matchAll(/\b([ABCabc])\s*=\s*(_{3,})/g));
    const vals = Array.from(rawLine.matchAll(/\b([ABCabc])\s*=\s*([^_\s][^_A-Zabc=]{0,40})/g))
      .map((m) => ({ field: m[1], value: m[2].trim() }))
      .filter((m) => !/_{3,}/.test(m.value));

    if (blanks.length === 2) {
      pushBlank('1', blanks[0][1]);
      pushBlank('2', blanks[1][1]);
    } else if (blanks.length === 1 && vals.length >= 1) {
      const field = blanks[0][1];
      const blankIndex = rawLine.indexOf(blanks[0][0]);
      const firstValIndex = rawLine.indexOf(`${vals[0].field}=`);
      if (blankIndex > firstValIndex) {
        pushBlank('2', field);
        for (const v of vals) {
          const idx = rawLine.indexOf(`${v.field}=`);
          if (idx < blankIndex) pushGiven('1', v.field, v.value);
          else pushGiven('2', v.field, v.value);
        }
      } else {
        pushBlank('1', field);
        for (const v of vals) pushGiven('2', v.field, v.value);
      }
    } else if (blanks.length === 1) {
      const field = blanks[0][1];
      const tri2Hint =
        vals.some((v) => /90°|265|567|yd/i.test(v.value)) ||
        /Triángulo\s*2/i.test(rawLine);
      if (assigned.has(`1:${field}`) || (tri2Hint && /[Bc]/.test(field))) {
        pushBlank('2', field);
      } else {
        pushBlank('1', field);
      }
    }

    if (blanks.length === 0) {
      for (const v of vals) {
        if (/1286|53°|\bin\b/i.test(v.value)) pushGiven('1', v.field, v.value);
        else if (/265|567|yd/i.test(v.value)) pushGiven('2', v.field, v.value);
        else if (/90°/.test(v.value)) {
          pushGiven('1', v.field, v.value);
          pushGiven('2', v.field, v.value);
        }
      }
    }
  }

  return questions.map((q) => {
    const tri = (q as QuestionWithAnchor)._triangle;
    const context = tri && given[tri]?.length ? `. Datos: ${given[tri].join(', ')}` : '';
    return { ...q, text: sanitizeQuestionText(`${q.text}${context}`) };
  });
}

export function heuristicParseExamText(structure: PdfStructure): GeneratedQuestion[] {
  const positionedLines = structure.lines;
  const rawLines = positionedLines.map((l) => l.text);
  const lines = mergeBrokenLines(rawLines);
  const questions: QuestionWithAnchor[] = [];

  let currentSection = '';
  let sectionLines: string[] = [];
  let pendingStem = '';

  const flushSection = () => {
    if (currentSection && /triángulo/i.test(currentSection)) {
      questions.push(...parseTriangleBlanks(sectionLines, currentSection));
    }
    sectionLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isSkippableLine(line)) continue;

    if (isSectionHeader(line)) {
      flushSection();
      currentSection = line.replace(/\s+/g, ' ');
      pendingStem = currentSection;
      continue;
    }

    sectionLines.push(line);

    const blankBlock = readBlankExerciseBlock(lines, i);
    if (blankBlock) {
      const sourceIndex = rawLines.findIndex((line) => line === lines[i] || lines[i].includes(line));
      questions.push(
        withAnchor(
          {
            text: sanitizeQuestionText(`${sectionPrefix(currentSection)}${blankBlock.content}`),
            type: 'open_answer',
          },
          positionedLines,
          sourceIndex >= 0 ? sourceIndex : i
        )
      );
      i = blankBlock.endIndex;
      continue;
    }

    const mcBlock = extractMcOptionsFromLines(lines.slice(i + 1));
    if (mcBlock) {
      const stem = pendingStem || line;
      if (stem.length >= 8) {
        questions.push({
          text: sanitizeQuestionText(stem),
          type: 'multiple_choice',
          options: mcBlock.options,
          correct_answer: mcBlock.options[0],
        });
        i += mcBlock.consumed;
        pendingStem = '';
      }
      continue;
    }

    if (MC_OPTION.test(line)) continue;

    const numberedStem = line.match(/^(\d+)[\).:\-]\s+(.+)/);
    if (numberedStem && numberedStem[2].length >= 12 && !/_{3,}/.test(line)) {
      pendingStem = numberedStem[2].trim();
      continue;
    }

    if (
      (line.endsWith('?') || (line.length > 20 && !/_{3,}/.test(line))) &&
      !isSectionHeader(line)
    ) {
      const next = lines[i + 1];
      if (!next || !MC_OPTION.test(next)) {
        if (!/triángulo/i.test(line)) {
          questions.push({ text: sanitizeQuestionText(line), type: 'open_answer' });
        }
      }
    }
  }

  flushSection();
  return dedupeExamQuestions(questions);
}

function mergeQuestionLists(
  primary: GeneratedQuestion[],
  secondary: GeneratedQuestion[]
): GeneratedQuestion[] {
  return dedupeExamQuestions([...primary, ...secondary]);
}

async function parseWithOpenAI(text: string, apiKey: string): Promise<GeneratedQuestion[]> {
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'Extraes preguntas de exámenes escolares desde texto plano. Responde solo JSON válido en español.',
      },
      {
        role: 'user',
        content: `Extrae TODAS las preguntas y sub-ejercicios del siguiente examen (texto de PDF).

REGLAS IMPORTANTES:
- Cada línea con espacio en blanco (____) y un ejercicio (conversión, operación, etc.) es UNA pregunta separada tipo open_answer.
- Cada valor faltante en triángulos (A= __, b= __, etc.) es UNA pregunta separada.
- Si hay opción múltiple (A, B, C, D), usa type multiple_choice con todas las opciones.
- NO omitas ningún ítem aunque el examen tenga muchas preguntas.
- NO dupliques preguntas: cada enunciado debe aparecer una sola vez.
- NO incluyas la numeración inicial del examen (1., 2., 3.) en el enunciado.
- Sí incluye el contexto de la sección seguido del ejercicio, sin el número (ej. "Realiza las siguientes conversiones de unidades...: 18.597 m a yardas").

Formato JSON:
{
  "questions": [
    {
      "text": "enunciado completo",
      "type": "multiple_choice" | "open_answer",
      "options": ["..."],
      "correct_answer": "...",
      "illustration": null
    }
  ]
}

TEXTO:
${text.slice(0, 50000)}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 8000,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(content) as { questions?: unknown[] };
  return normalizeQuestions(parsed.questions ?? []);
}

export async function parseExamQuestionsFromPdfBuffer(buffer: ArrayBuffer): Promise<GeneratedQuestion[]> {
  const structure = await extractPdfStructureFromBuffer(buffer.slice(0));
  const text = structure.text.trim();
  if (!text) {
    throw new Error('No se pudo leer texto del PDF. Prueba con un archivo con texto seleccionable.');
  }

  const images = await extractPdfImagesFromBuffer(buffer.slice(0));
  const heuristic = attachPdfImagesToQuestions(
    dedupeExamQuestions(heuristicParseExamText(structure)),
    images,
    structure.lines
  );

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  const finalize = (questions: GeneratedQuestion[]) =>
    questions.map((q) => ({ ...q, text: sanitizeQuestionText(q.text) }));

  if (!apiKey) {
    if (heuristic.length === 0) {
      throw new Error('No se detectaron preguntas. Configura OPENAI_API_KEY para mejor extracción.');
    }
    return finalize(heuristic);
  }

  try {
    const aiQuestions = attachPdfImagesToQuestions(
      dedupeExamQuestions(await parseWithOpenAI(text, apiKey)),
      images,
      structure.lines
    );
    if (aiQuestions.length === 0 && heuristic.length > 0) return finalize(heuristic);
    if (heuristic.length > aiQuestions.length) {
      return finalize(dedupeExamQuestions(mergeQuestionLists(heuristic, aiQuestions)));
    }
    return finalize(dedupeExamQuestions(aiQuestions.length > 0 ? aiQuestions : heuristic));
  } catch (error) {
    console.error('[examPdfImport] OpenAI parse failed, using heuristic', error);
    if (heuristic.length > 0) return finalize(heuristic);
    throw new Error('No se encontraron preguntas en el PDF.');
  }
}

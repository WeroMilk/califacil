import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateExamUrl(examId: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/examen/${examId}`;
  }
  return `/examen/${examId}`;
}

export function calculatePercentage(score: number, maxScore: number): number {
  if (maxScore === 0) return 0;
  return Math.round((score / maxScore) * 100);
}

export const EXAM_POINTS_CAP = 10;

export function examMaxScore(questions: { points?: number | null }[]): number {
  return questions.reduce((s, q) => s + (q.points ?? 1), 0);
}

/** Reparte 10 puntos enteros entre N preguntas. */
export function distributeExamPoints(questionCount: number): number[] {
  if (questionCount <= 0) return [];
  const base = Math.floor(EXAM_POINTS_CAP / questionCount);
  const remainder = EXAM_POINTS_CAP % questionCount;
  return Array.from({ length: questionCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function questionPoints(question: { points?: number | null }): number {
  const p = question.points ?? 1;
  return p > 0 ? p : 1;
}

export function normalizeAnswerText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function resolveOptionIndexFromValue(
  options: string[] | null | undefined,
  value: string | null | undefined
): number | null {
  if (!options || options.length === 0) return null;
  const raw = (value ?? '').trim();
  if (!raw) return null;

  const exactIdx = options.findIndex((opt) => normalizeAnswerText(opt) === normalizeAnswerText(raw));
  if (exactIdx >= 0) return exactIdx;

  const letterMatch = raw.match(/^([A-Za-z])(?:[\)\].:\s-]|$)/);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return idx;
  }

  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
  }

  return null;
}

export function isMultipleChoiceAnswerCorrect(
  options: string[] | null | undefined,
  studentAnswer: string | null | undefined,
  correctAnswer: string | null | undefined
): boolean {
  const studentIdx = resolveOptionIndexFromValue(options, studentAnswer);
  const correctIdx = resolveOptionIndexFromValue(options, correctAnswer);
  if (studentIdx !== null && correctIdx !== null) {
    return studentIdx === correctIdx;
  }
  return normalizeAnswerText(studentAnswer) === normalizeAnswerText(correctAnswer);
}

export function getGradeLabel(percentage: number): string {
  if (percentage >= 90) return 'Excelente';
  if (percentage >= 80) return 'Muy bien';
  if (percentage >= 70) return 'Bien';
  if (percentage >= 60) return 'Suficiente';
  return 'Necesita mejorar';
}

export function getGradeColor(percentage: number): string {
  if (percentage >= 90) return 'text-green-600';
  if (percentage >= 80) return 'text-orange-600';
  if (percentage >= 70) return 'text-yellow-600';
  if (percentage >= 60) return 'text-amber-700';
  return 'text-red-600';
}

import { CALIFACIL_CONTROL_NUMBER_DIGIT_COUNT } from '@/lib/printExam';
import type { Student } from '@/types';

export function normalizeControlNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  return digits
    .padStart(CALIFACIL_CONTROL_NUMBER_DIGIT_COUNT, '0')
    .slice(-CALIFACIL_CONTROL_NUMBER_DIGIT_COUNT);
}

export function controlNumberDigitsToString(digits: (number | null)[]): string | null {
  if (digits.length === 0) return null;
  if (digits.some((d) => d === null)) return null;
  return digits.map((d) => String(d)).join('');
}

export function findStudentByControlNumber(
  students: Student[],
  controlNumber: string | null | undefined
): Student | null {
  const norm = normalizeControlNumber(controlNumber);
  if (!norm) return null;
  return students.find((s) => normalizeControlNumber(s.control_number) === norm) ?? null;
}

import type { Student } from '@/types';

/** Valor interno: detectar alumno al escanear la hoja personalizada. */
export const CALIFICAR_AUTO_STUDENT_ID = '__auto__';

export function isCalificarAutoStudentMode(studentId: string): boolean {
  return studentId === CALIFICAR_AUTO_STUDENT_ID || studentId === '';
}

export function normalizeCalificarStudentSelection(studentId: string): string {
  return studentId === '' ? CALIFICAR_AUTO_STUDENT_ID : studentId;
}

export function resolveCalificarStudentId(
  selectedStudentId: string,
  override?: string,
  students: Student[] = []
): string | null {
  const candidate = override ?? selectedStudentId;
  if (isCalificarAutoStudentMode(candidate)) return null;
  return students.some((s) => s.id === candidate) ? candidate : null;
}

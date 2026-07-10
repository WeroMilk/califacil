import type { Question } from '@/types';

type QuestionOrderFields = Pick<Question, 'sort_order' | 'created_at'>;

/** Orden estable: sort_order si existe, si no created_at. */
export function sortExamQuestions<T extends QuestionOrderFields>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const ao = a.sort_order;
    const bo = b.sort_order;
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    if (ao != null && bo == null) return -1;
    if (ao == null && bo != null) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

export function isMissingSortOrderColumnError(message: string | undefined): boolean {
  if (!message) return false;
  return /sort_order/i.test(message) && /column|schema cache|does not exist/i.test(message);
}

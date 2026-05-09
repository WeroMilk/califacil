import { supabase } from '@/lib/supabase';
import { calculatePercentage } from '@/lib/utils';
import type { Exam } from '@/types';

export type ExamGroupAverage = {
  groupId: string;
  groupName: string;
  average: number;
  studentsCount: number;
};

export type ExamAverageSummaryRow = {
  examId: string;
  examTitle: string;
  createdAt: string;
  groupAverages: ExamGroupAverage[];
  overallAverage: number;
  totalStudents: number;
};

type StudentAnswerRow = {
  exam_id: string;
  student_id: string;
  score: number | null;
};

type StudentRow = {
  id: string;
  name: string;
  group_id: string;
};

type ExamGroupAssignmentRow = {
  exam_id: string;
  group_id: string;
};

/**
 * Misma lógica que la página Promedios: porcentaje por alumno = puntos / nº preguntas del examen.
 * `globalAveragePercent` agrupa todas las calificaciones (alumno–examen) del maestro en un único % 0–100.
 */
export async function fetchTeacherExamAverageSummaries(
  exams: Exam[],
  groupsById: Map<string, string>
): Promise<{ rows: ExamAverageSummaryRow[]; globalAveragePercent: number | null }> {
  if (exams.length === 0) {
    return { rows: [], globalAveragePercent: null };
  }

  const examIds = exams.map((e) => e.id);

  const { data: answersData, error: answersError } = await supabase
    .from('answers')
    .select('exam_id,student_id,score')
    .in('exam_id', examIds);
  if (answersError) throw answersError;
  const answers = (answersData || []) as StudentAnswerRow[];

  const { data: questionsData, error: questionsError } = await supabase
    .from('questions')
    .select('exam_id')
    .in('exam_id', examIds);
  if (questionsError) throw questionsError;
  const questionCountByExam = new Map<string, number>();
  for (const row of questionsData || []) {
    const examId = String((row as { exam_id: string }).exam_id);
    questionCountByExam.set(examId, (questionCountByExam.get(examId) ?? 0) + 1);
  }

  const studentIds = Array.from(new Set(answers.map((a) => a.student_id)));
  let studentsById = new Map<string, StudentRow>();
  if (studentIds.length > 0) {
    const { data: studentsData, error: studentsError } = await supabase
      .from('students')
      .select('id,name,group_id')
      .in('id', studentIds);
    if (studentsError) throw studentsError;
    studentsById = new Map((studentsData || []).map((s) => [s.id, s as StudentRow]));
  }

  const { data: assignmentData, error: assignmentError } = await supabase
    .from('exam_group_assignments')
    .select('exam_id,group_id')
    .in('exam_id', examIds);
  if (assignmentError) throw assignmentError;
  const assignments = (assignmentData || []) as ExamGroupAssignmentRow[];
  const assignedGroupIdsByExam = new Map<string, Set<string>>();
  for (const row of assignments) {
    if (!assignedGroupIdsByExam.has(row.exam_id)) {
      assignedGroupIdsByExam.set(row.exam_id, new Set<string>());
    }
    assignedGroupIdsByExam.get(row.exam_id)!.add(row.group_id);
  }

  let globalPctSum = 0;
  let globalGradedCount = 0;

  const rows: ExamAverageSummaryRow[] = exams.map((exam) => {
    const maxScore = Math.max(1, questionCountByExam.get(exam.id) ?? 0);
    const byStudent = new Map<string, number>();

    for (const answer of answers) {
      if (answer.exam_id !== exam.id) continue;
      const prev = byStudent.get(answer.student_id) ?? 0;
      byStudent.set(answer.student_id, prev + (typeof answer.score === 'number' ? answer.score : 0));
    }

    const groupCollector = new Map<string, { total: number; count: number }>();
    let overallTotal = 0;
    let overallCount = 0;

    for (const [studentId, points] of Array.from(byStudent.entries())) {
      const student = studentsById.get(studentId);
      if (!student) continue;
      const pct = calculatePercentage(points, maxScore);
      overallTotal += pct;
      overallCount += 1;
      globalPctSum += pct;
      globalGradedCount += 1;
      const prev = groupCollector.get(student.group_id) ?? { total: 0, count: 0 };
      groupCollector.set(student.group_id, {
        total: prev.total + pct,
        count: prev.count + 1,
      });
    }

    const assignedGroupIds = assignedGroupIdsByExam.get(exam.id);
    if (assignedGroupIds && assignedGroupIds.size > 0) {
      for (const groupId of Array.from(assignedGroupIds)) {
        if (!groupCollector.has(groupId)) {
          groupCollector.set(groupId, { total: 0, count: 0 });
        }
      }
    } else if (exam.group_id && !groupCollector.has(exam.group_id)) {
      groupCollector.set(exam.group_id, { total: 0, count: 0 });
    }

    const groupAverages: ExamGroupAverage[] = Array.from(groupCollector.entries())
      .map(([groupId, v]) => ({
        groupId,
        groupName: groupsById.get(groupId) || 'Grupo sin nombre',
        average: v.count > 0 ? Math.round(v.total / v.count) : 0,
        studentsCount: v.count,
      }))
      .sort((a, b) => b.average - a.average);

    return {
      examId: exam.id,
      examTitle: exam.title,
      createdAt: exam.created_at,
      groupAverages,
      overallAverage: overallCount > 0 ? Math.round(overallTotal / overallCount) : 0,
      totalStudents: overallCount,
    };
  });

  return {
    rows,
    globalAveragePercent: globalGradedCount > 0 ? Math.round(globalPctSum / globalGradedCount) : null,
  };
}

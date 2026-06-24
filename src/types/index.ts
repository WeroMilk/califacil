export interface User {
  id: string;
  email: string;
  role: 'teacher';
  created_at: string;
}

export interface Group {
  id: string;
  teacher_id: string;
  name: string;
  created_at: string;
}

export interface Student {
  id: string;
  group_id: string;
  name: string;
  control_number?: string | null;
  created_at: string;
}

export interface ExamFolder {
  id: string;
  teacher_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
}

export interface Exam {
  id: string;
  teacher_id: string;
  group_id: string | null;
  folder_id: string | null;
  title: string;
  description: string | null;
  qr_code: string | null;
  status: 'draft' | 'published' | 'closed';
  created_at: string;
}

export type QuestionType = 'multiple_choice' | 'open_answer';

export interface Question {
  id: string;
  exam_id: string;
  text: string;
  type: QuestionType;
  options: string[] | null;
  correct_answer: string | null;
  illustration: string | null;
  points: number;
  created_at: string;
}

export interface Answer {
  id: string;
  exam_id: string;
  student_id: string;
  question_id: string;
  answer_text: string;
  is_correct: boolean | null;
  score: number | null;
  created_at: string;
}

export interface ExamWithQuestions extends Exam {
  questions: Question[];
  group?: Group;
}

export interface StudentResult {
  student: Student;
  answers: Answer[];
  totalScore: number;
  maxScore: number;
  percentage: number;
}

export interface QuestionAnalysis {
  question: Question;
  totalAnswers: number;
  correctAnswers: number;
  percentageCorrect: number;
}

export interface GeneratedQuestion {
  text: string;
  type: QuestionType;
  options?: string[];
  correct_answer?: string;
  illustration?: string;
  points?: number;
  /** Solo en creación: distingue respuesta abierta en texto vs pizarrón. */
  responseMode?: 'text' | 'whiteboard';
}

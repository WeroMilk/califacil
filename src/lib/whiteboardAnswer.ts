/** Codifica respuestas de pizarrón en `correct_answer` sin migración de BD. */
const WHITEBOARD_PREFIX = '[[CALIFACIL_WHITEBOARD]]';

export function encodeWhiteboardCorrectAnswer(dataUrl: string): string {
  return `${WHITEBOARD_PREFIX}${JSON.stringify({ v: 1, reference: dataUrl })}`;
}

export function isWhiteboardCorrectAnswer(
  correctAnswer: string | null | undefined
): boolean {
  return (
    typeof correctAnswer === 'string' && correctAnswer.startsWith(WHITEBOARD_PREFIX)
  );
}

export function decodeWhiteboardReference(
  correctAnswer: string | null | undefined
): string | null {
  if (!isWhiteboardCorrectAnswer(correctAnswer)) return null;
  try {
    const parsed = JSON.parse(correctAnswer!.slice(WHITEBOARD_PREFIX.length)) as {
      reference?: string;
    };
    return typeof parsed.reference === 'string' ? parsed.reference : null;
  } catch {
    return null;
  }
}

export function isWhiteboardQuestion(question: {
  type: string;
  correct_answer: string | null;
}): boolean {
  return question.type === 'open_answer' && isWhiteboardCorrectAnswer(question.correct_answer);
}

export function isWhiteboardStudentAnswer(answer: string | null | undefined): boolean {
  return typeof answer === 'string' && answer.startsWith('data:image/');
}

export function whiteboardAnswerLabel(): string {
  return 'Respuesta en pizarrón (imagen)';
}

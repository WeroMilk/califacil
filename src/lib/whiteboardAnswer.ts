/** Codifica respuestas de pizarrón en `correct_answer` sin migración de BD. */
const WHITEBOARD_PREFIX = '[[CALIFACIL_WHITEBOARD]]';

export type WhiteboardPayload = {
  v?: number;
  reference?: string;
  /** Expresión o texto esperado confirmado por el maestro (p. ej. √5). */
  expectedText?: string;
};

function parseWhiteboardPayload(
  correctAnswer: string | null | undefined
): WhiteboardPayload | null {
  if (!isWhiteboardCorrectAnswer(correctAnswer)) return null;
  try {
    return JSON.parse(correctAnswer!.slice(WHITEBOARD_PREFIX.length)) as WhiteboardPayload;
  } catch {
    return null;
  }
}

export function encodeWhiteboardCorrectAnswer(
  dataUrl: string,
  expectedText?: string | null
): string {
  const text = (expectedText ?? '').trim();
  const payload: WhiteboardPayload = {
    v: text ? 2 : 1,
    reference: dataUrl,
    ...(text ? { expectedText: text } : {}),
  };
  return `${WHITEBOARD_PREFIX}${JSON.stringify(payload)}`;
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
  const parsed = parseWhiteboardPayload(correctAnswer);
  return typeof parsed?.reference === 'string' ? parsed.reference : null;
}

export function decodeWhiteboardExpectedText(
  correctAnswer: string | null | undefined
): string | null {
  const parsed = parseWhiteboardPayload(correctAnswer);
  const text = (parsed?.expectedText ?? '').trim();
  return text || null;
}

export function hasWhiteboardExpectedText(
  correctAnswer: string | null | undefined
): boolean {
  return decodeWhiteboardExpectedText(correctAnswer) !== null;
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

import OpenAI from 'openai';

const WHITEBOARD_MODEL = 'gpt-4o';

export type WhiteboardGradeOutcome = {
  is_correct: boolean | null;
  score: number | null;
  studentExpression: string;
  expectedExpression: string;
  reason: string;
  pending: boolean;
};

function parseJsonObject<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('invalid_json');
    return JSON.parse(m[0]) as T;
  }
}

/** Normalización ligera antes de comparar expresiones. */
export function normalizeMathExpression(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\\sqrt\{([^}]+)\}/g, '√$1')
    .replace(/sqrt\(([^)]+)\)/g, '√$1')
    .replace(/\*\*/g, '^')
    .replace(/×/g, '*')
    .replace(/÷/g, '/');
}

export async function transcribeWhiteboardImage(
  openai: OpenAI,
  imageUrl: string,
  questionText?: string
): Promise<string> {
  const context = questionText?.trim()
    ? `Contexto de la pregunta: ${questionText.slice(0, 500)}`
    : '';

  const completion = await openai.chat.completions.create({
    model: WHITEBOARD_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${context}\n\nTranscribe la expresión matemática o texto dibujado en este pizarrón. Responde SOLO con la expresión en forma concisa (ej. √5, x=3, H₂O). Si está vacío o ilegible, responde con una cadena vacía.`,
          },
          {
            type: 'image_url',
            image_url: { url: imageUrl, detail: 'high' },
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 160,
  });

  return (completion.choices[0]?.message?.content ?? '').trim();
}

export async function compareMathExpressions(
  openai: OpenAI,
  expected: string,
  student: string,
  questionText: string
): Promise<{ equivalent: boolean; confidence: 'high' | 'low'; reason: string }> {
  const exp = expected.trim();
  const stu = student.trim();

  if (!stu) {
    return { equivalent: false, confidence: 'high', reason: 'Respuesta del alumno vacía o ilegible' };
  }

  if (normalizeMathExpression(exp) === normalizeMathExpression(stu)) {
    return { equivalent: true, confidence: 'high', reason: 'Expresiones equivalentes (normalización)' };
  }

  const completion = await openai.chat.completions.create({
    model: WHITEBOARD_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'Comparas expresiones matemáticas o respuestas conceptuales. Responde solo JSON: {"equivalent":boolean,"confidence":"high"|"low","reason":"..."}. equivalent=true si significan lo mismo (√5 = sqrt(5)). confidence=low si hay duda.',
      },
      {
        role: 'user',
        content: `Pregunta: ${questionText.slice(0, 800)}\n\nRespuesta esperada: ${exp}\nRespuesta del alumno (transcrita del dibujo): ${stu}`,
      },
    ],
    temperature: 0,
    max_tokens: 120,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '{}';
  const parsed = parseJsonObject<{
    equivalent?: boolean;
    confidence?: string;
    reason?: string;
  }>(raw);

  return {
    equivalent: parsed.equivalent === true,
    confidence: parsed.confidence === 'low' ? 'low' : 'high',
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

export async function gradeWhiteboardAnswer(params: {
  openai: OpenAI;
  questionText: string;
  referenceImage: string;
  studentImage: string;
  expectedText?: string | null;
  questionPoints: number;
}): Promise<WhiteboardGradeOutcome> {
  const { openai, questionText, referenceImage, studentImage, questionPoints } = params;
  let expectedExpression = (params.expectedText ?? '').trim();

  const studentExpression = await transcribeWhiteboardImage(
    openai,
    studentImage,
    questionText
  );

  if (!expectedExpression) {
    expectedExpression = await transcribeWhiteboardImage(
      openai,
      referenceImage,
      questionText
    );
  }

  if (!studentExpression.trim()) {
    return {
      is_correct: false,
      score: 0,
      studentExpression,
      expectedExpression,
      reason: 'No se pudo leer la respuesta del alumno',
      pending: false,
    };
  }

  if (!expectedExpression.trim()) {
    return {
      is_correct: null,
      score: null,
      studentExpression,
      expectedExpression,
      reason: 'Falta texto de referencia confirmado por el maestro',
      pending: true,
    };
  }

  const comparison = await compareMathExpressions(
    openai,
    expectedExpression,
    studentExpression,
    questionText
  );

  if (comparison.confidence === 'low') {
    return {
      is_correct: null,
      score: null,
      studentExpression,
      expectedExpression,
      reason: comparison.reason || 'Confianza baja en la calificación automática',
      pending: true,
    };
  }

  const is_correct = comparison.equivalent;
  return {
    is_correct,
    score: is_correct ? questionPoints : 0,
    studentExpression,
    expectedExpression,
    reason: comparison.reason,
    pending: false,
  };
}

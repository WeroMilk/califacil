import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard', 'extreme'] as const;
type Difficulty = (typeof DIFFICULTY_LEVELS)[number];

function shuffleArrayInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Baraja las opciones de opción múltiple; `correct_answer` sigue siendo el texto de la opción correcta. */
function shuffleMultipleChoiceOptions(question: Record<string, unknown>): Record<string, unknown> {
  if (question.type !== 'multiple_choice') return question;
  const opts = question.options;
  if (!Array.isArray(opts) || opts.length < 2) return question;
  const correctRaw =
    question.correct_answer != null ? String(question.correct_answer).trim() : '';
  const options = opts.map((o) => String(o).trim()).filter((s) => s.length > 0);
  if (options.length < 2) return question;
  shuffleArrayInPlace(options);
  const next = { ...question, options, correct_answer: correctRaw || question.correct_answer };
  if (correctRaw && !options.some((o) => o === correctRaw)) {
    return question;
  }
  return next;
}

function withShuffledMcOptions(questions: Record<string, unknown>[]): Record<string, unknown>[] {
  return questions.map((q) => shuffleMultipleChoiceOptions(q));
}

function difficultyInstructions(level: string): string {
  const normalized = DIFFICULTY_LEVELS.includes(level as Difficulty)
    ? (level as Difficulty)
    : 'medium';
  const map: Record<Difficulty, string> = {
    easy:
      'NIVEL FÁCIL: reactivos con conceptos introductorios, vocabulario sencillo y pasos directos; evita trampas o razonamientos largos.',
    medium:
      'NIVEL MEDIO: dificultad típica de examen escolar; equilibrio entre comprensión y aplicación.',
    hard:
      'NIVEL DIFÍCIL: mayor profundidad, conexión entre ideas, razonamiento de varios pasos o casos menos obvios.',
    extreme:
      'NIVEL EXTREMO: máximo rigor; problemas exigentes, sutilezas, síntesis o complejidad alta (sin salirte de los temas indicados).',
  };
  return map[normalized];
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const {
      topics,
      count,
      includeMultipleChoice,
      includeOpenAnswer,
      difficulty: difficultyRaw,
    } = await request.json();

    const difficulty = DIFFICULTY_LEVELS.includes(difficultyRaw)
      ? difficultyRaw
      : 'medium';

    if (!topics || !count) {
      return NextResponse.json(
        { error: 'Topics and count are required' },
        { status: 400 }
      );
    }

    const questionTypes = [];
    if (includeMultipleChoice) questionTypes.push('multiple_choice');
    if (includeOpenAnswer) questionTypes.push('open_answer');

    if (questionTypes.length === 0) {
      return NextResponse.json(
        { error: 'At least one question type must be selected' },
        { status: 400 }
      );
    }

    const prompt = `Genera ${count} preguntas de examen sobre los siguientes temas: ${topics}

${difficultyInstructions(difficulty)}

Para cada pregunta, incluye:
- text: El texto de la pregunta
- type: Tipo de pregunta (${questionTypes.join(' o ')})
- Si es multiple_choice: incluye un array "options" con 4 opciones de respuesta y "correct_answer" con el texto exacto de la opción correcta (el orden de las opciones puede ser cualquiera)
- Si es open_answer: incluye "correct_answer" con una respuesta esperada corta (opcional)
- illustration: Una breve descripción de una ilustración que ayude a entender la pregunta (opcional)

Responde ÚNICAMENTE con un JSON válido en este formato exacto:
{
  "questions": [
    {
      "text": "¿Pregunta?",
      "type": "multiple_choice",
      "options": ["Texto de una opción", "Otra opción", "Tercera opción", "Cuarta opción"],
      "correct_answer": "Texto de una opción",
      "illustration": "Descripción de ilustración"
    }
  ]
}`;

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      const fallbackQuestions = generateFallbackQuestions(
        topics,
        count,
        includeMultipleChoice,
        includeOpenAnswer,
        difficulty
      );
      return NextResponse.json({ questions: fallbackQuestions });
    }

    const openai = new OpenAI({ apiKey });

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content:
              'Eres un asistente experto en crear reactivos de examen. Respetas estrictamente el nivel de dificultad indicado. Responde únicamente con JSON válido.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      });

      const responseContent = completion.choices[0]?.message?.content || '';
      
      // Extract JSON from response
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response');
      }

      const parsedResponse = JSON.parse(jsonMatch[0]);
      
      if (!parsedResponse.questions || !Array.isArray(parsedResponse.questions)) {
        throw new Error('Invalid response format');
      }

      return NextResponse.json({
        questions: withShuffledMcOptions(parsedResponse.questions as Record<string, unknown>[]),
      });
    } catch (openaiError: any) {
      console.error('OpenAI error:', openaiError);
      
      // Fallback: Generate sample questions
      const fallbackQuestions = generateFallbackQuestions(
        topics,
        count,
        includeMultipleChoice,
        includeOpenAnswer,
        difficulty
      );
      return NextResponse.json({ questions: fallbackQuestions });
    }
  } catch (error: any) {
    console.error('Error generating questions:', error);
    return NextResponse.json(
      { error: 'Failed to generate questions', message: error.message },
      { status: 500 }
    );
  }
}

function generateFallbackQuestions(
  topics: string,
  count: number,
  includeMultipleChoice: boolean,
  includeOpenAnswer: boolean,
  difficulty: string
): any[] {
  const questions = [];
  const topicList = topics.split(',').map((t) => t.trim());
  const levelLabel: Record<string, string> = {
    easy: '[Nivel fácil]',
    medium: '[Nivel medio]',
    hard: '[Nivel difícil]',
    extreme: '[Nivel extremo]',
  };
  const tag = levelLabel[difficulty] || levelLabel.medium;

  for (let i = 0; i < count; i++) {
    const topic = topicList[i % topicList.length] || 'el tema';
    const isMultipleChoice = includeMultipleChoice && (!includeOpenAnswer || i % 2 === 0);

    if (isMultipleChoice) {
      questions.push({
        text: `${tag} Pregunta ${i + 1} sobre ${topic}: ¿Cuál es el concepto más importante de este tema?`,
        type: 'multiple_choice',
        options: [
          `Concepto principal de ${topic}`,
          `Concepto secundario de ${topic}`,
          `Concepto relacionado con ${topic}`,
          `Ninguna de las anteriores`
        ],
        correct_answer: `Concepto principal de ${topic}`,
        illustration: `Diagrama ilustrativo sobre ${topic}`,
      });
    } else {
      questions.push({
        text: `${tag} Pregunta ${i + 1} sobre ${topic}: Explica brevemente los conceptos clave de este tema.`,
        type: 'open_answer',
        correct_answer: `Los conceptos clave de ${topic} incluyen...`,
        illustration: `Ejemplo visual de ${topic}`,
      });
    }
  }
  
  return withShuffledMcOptions(questions);
}

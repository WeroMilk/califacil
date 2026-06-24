import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import {
  PLAN_MONTHLY_EXAM_LIMIT,
  resolvePlanKey,
  isSubscriptionActive,
  isCalifacilSuperUserEmail,
} from '@/lib/billing';
import { dedupeExamQuestions, normalizeQuestionText } from '@/lib/utils';

const DIFFICULTY_LEVELS = ['easy', 'medium', 'hard', 'extreme'] as const;
type Difficulty = (typeof DIFFICULTY_LEVELS)[number];

const MAX_QUESTIONS_PER_REQUEST = 30;
const OPENAI_BATCH_SIZE = 6;

export const maxDuration = 120;

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

function clampQuestionCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_QUESTIONS_PER_REQUEST, Math.max(1, Math.round(n)));
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

function buildGenerationPrompt(params: {
  topics: string;
  count: number;
  batchIndex: number;
  batchTotal: number;
  globalStart: number;
  globalTotal: number;
  questionTypes: string[];
  difficulty: string;
  existingTexts?: string[];
}): string {
  const {
    topics,
    count,
    batchIndex,
    batchTotal,
    globalStart,
    globalTotal,
    questionTypes,
    difficulty,
    existingTexts = [],
  } = params;
  const rangeLabel =
    batchTotal > 1
      ? `Este es el lote ${batchIndex + 1} de ${batchTotal}. Genera exactamente ${count} preguntas distintas (reactivos ${globalStart + 1} a ${globalStart + count} de ${globalTotal}).`
      : `Genera exactamente ${count} preguntas.`;

  const avoidRepeatBlock =
    existingTexts.length > 0
      ? `\nEnunciados ya usados (no repitas ni parafrasees de forma similar):\n${existingTexts
          .slice(-24)
          .map((t, i) => `${i + 1}. ${t.slice(0, 200)}`)
          .join('\n')}\n`
      : '';

  return `Genera ${count} preguntas de examen sobre los siguientes temas: ${topics}

${difficultyInstructions(difficulty)}

${rangeLabel}
${avoidRepeatBlock}
Para cada pregunta, incluye:
- text: El texto de la pregunta (sin numeración tipo "1." o "Pregunta 1")
- type: Tipo de pregunta (${questionTypes.join(' o ')})
- Si es multiple_choice: incluye un array "options" con 4 opciones de respuesta y "correct_answer" con el texto exacto de la opción correcta
- Si es open_answer: incluye "correct_answer" con una respuesta esperada corta (opcional)
- illustration: Una breve descripción de una ilustración (opcional)

IMPORTANTE: Cada pregunta debe ser única y cubrir un aspecto distinto. No repitas enunciados.

Responde ÚNICAMENTE con JSON: {"questions":[...]}`;
}

function parseQuestionsJson(raw: string): Record<string, unknown>[] {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No valid JSON found in response');
  const parsedResponse = JSON.parse(jsonMatch[0]) as { questions?: unknown };
  if (!parsedResponse.questions || !Array.isArray(parsedResponse.questions)) {
    throw new Error('Invalid response format');
  }
  return parsedResponse.questions as Record<string, unknown>[];
}

async function generateOpenAIQuestionsBatch(
  openai: OpenAI,
  params: {
    topics: string;
    count: number;
    batchIndex: number;
    batchTotal: number;
    globalStart: number;
    globalTotal: number;
    questionTypes: string[];
    difficulty: string;
    existingTexts?: string[];
  }
): Promise<Record<string, unknown>[]> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'Eres un asistente experto en crear reactivos de examen escolares en español. Genera el número exacto de preguntas pedido. Responde únicamente con JSON válido.',
      },
      {
        role: 'user',
        content: buildGenerationPrompt(params),
      },
    ],
    temperature: 0.7,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  });

  const responseContent = completion.choices[0]?.message?.content || '';
  return parseQuestionsJson(responseContent);
}

async function generateAllOpenAIQuestions(
  openai: OpenAI,
  topics: string,
  totalCount: number,
  questionTypes: string[],
  difficulty: string
): Promise<Record<string, unknown>[]> {
  const collected: Record<string, unknown>[] = [];
  const batchTotal = Math.ceil(totalCount / OPENAI_BATCH_SIZE);

  for (let offset = 0; offset < totalCount; offset += OPENAI_BATCH_SIZE) {
    const batchCount = Math.min(OPENAI_BATCH_SIZE, totalCount - offset);
    const batchIndex = Math.floor(offset / OPENAI_BATCH_SIZE);
    const existingTexts = collected
      .map((q) => (q.text != null ? String(q.text).trim() : ''))
      .filter(Boolean);

    try {
      const batch = await generateOpenAIQuestionsBatch(openai, {
        topics,
        count: batchCount,
        batchIndex,
        batchTotal,
        globalStart: offset,
        globalTotal: totalCount,
        questionTypes,
        difficulty,
        existingTexts,
      });
      collected.push(...batch);
    } catch (batchError) {
      console.error(`OpenAI batch ${batchIndex + 1}/${batchTotal} failed:`, batchError);
    }
  }

  return collected;
}

function mergeToTargetCount(
  primary: { text: string }[],
  topics: string,
  targetCount: number,
  includeMultipleChoice: boolean,
  includeOpenAnswer: boolean,
  difficulty: string
): { text: string }[] {
  let merged = dedupeExamQuestions(primary);
  if (merged.length >= targetCount) return merged.slice(0, targetCount);

  const seen = new Set(merged.map((q) => normalizeQuestionText(q.text)));
  let seed = 0;
  while (merged.length < targetCount && seed < targetCount * 6) {
    const pad = generateFallbackQuestions(
      topics,
      targetCount - merged.length,
      includeMultipleChoice,
      includeOpenAnswer,
      difficulty,
      seed
    ) as { text: string }[];
    let added = 0;
    for (const q of pad) {
      const key = normalizeQuestionText(q.text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(q);
      added++;
      if (merged.length >= targetCount) break;
    }
    seed += Math.max(pad.length, 1);
    if (added === 0) seed += 1;
  }

  while (merged.length < targetCount) {
    const idx = merged.length;
    const pad = generateFallbackQuestions(
      topics,
      1,
      includeMultipleChoice,
      includeOpenAnswer,
      difficulty,
      idx + seed
    ) as { text: string }[];
    const base = pad[0];
    if (!base) break;
    const suffix = ` (reactivo ${idx + 1})`;
    const text = base.text.endsWith(suffix) ? base.text : `${base.text}${suffix}`;
    const key = normalizeQuestionText(text);
    if (seen.has(key)) {
      seed += 1;
      continue;
    }
    seen.add(key);
    merged.push({ ...base, text });
  }

  return merged.slice(0, targetCount);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const superUser = isCalifacilSuperUserEmail(auth.user.email);

    if (!superUser) {
      const { data: billingRow, error: billingError } = await auth.supabase
        .from('teacher_billing')
        .select('is_active,subscription_status,plan_key')
        .eq('user_id', auth.user.id)
        .maybeSingle();

      if (billingError) {
        return NextResponse.json(
          { error: 'No se pudo validar el plan activo', message: billingError.message },
          { status: 500 }
        );
      }

      if (!isSubscriptionActive(billingRow)) {
        return NextResponse.json(
          { error: 'Necesitas un plan activo para generar examenes con IA' },
          { status: 402 }
        );
      }

      const planKey = resolvePlanKey(billingRow?.plan_key);
      const monthlyLimit = PLAN_MONTHLY_EXAM_LIMIT[planKey];
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

      const { count: monthUsageCount, error: usageCountError } = await auth.supabase
        .from('ai_exam_generation_usage')
        .select('*', { count: 'exact', head: true })
        .eq('teacher_id', auth.user.id)
        .gte('created_at', monthStart);

      if (usageCountError) {
        return NextResponse.json(
          { error: 'No se pudo validar tu consumo mensual', message: usageCountError.message },
          { status: 500 }
        );
      }

      const used = monthUsageCount ?? 0;
      if (used >= monthlyLimit) {
        return NextResponse.json(
          {
            error: `Alcanzaste tu limite mensual (${monthlyLimit}) para el plan ${planKey}.`,
            used,
            limit: monthlyLimit,
            plan: planKey,
          },
          { status: 429 }
        );
      }
    }

    const {
      topics,
      count: countRaw,
      includeMultipleChoice,
      includeOpenAnswer,
      difficulty: difficultyRaw,
    } = await request.json();

    const difficulty = DIFFICULTY_LEVELS.includes(difficultyRaw)
      ? difficultyRaw
      : 'medium';
    const questionCount = clampQuestionCount(countRaw);

    if (!topics?.trim()) {
      return NextResponse.json(
        { error: 'Topics and count are required' },
        { status: 400 }
      );
    }

    const questionTypes: string[] = [];
    if (includeMultipleChoice) questionTypes.push('multiple_choice');
    if (includeOpenAnswer) questionTypes.push('open_answer');

    if (questionTypes.length === 0) {
      return NextResponse.json(
        { error: 'At least one question type must be selected' },
        { status: 400 }
      );
    }

    const topicsTrimmed = String(topics).trim();
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      const fallbackQuestions = generateFallbackQuestions(
        topicsTrimmed,
        questionCount,
        includeMultipleChoice,
        includeOpenAnswer,
        difficulty,
        0
      );
      return NextResponse.json({
        questions: mergeToTargetCount(
          fallbackQuestions as { text: string }[],
          topicsTrimmed,
          questionCount,
          includeMultipleChoice,
          includeOpenAnswer,
          difficulty
        ),
      });
    }

    const openai = new OpenAI({ apiKey });

    if (!superUser) {
      const { error: usageInsertError } = await auth.supabase
        .from('ai_exam_generation_usage')
        .insert({ teacher_id: auth.user.id });

      if (usageInsertError) {
        return NextResponse.json(
          { error: 'No se pudo registrar el uso mensual', message: usageInsertError.message },
          { status: 500 }
        );
      }
    }

    try {
      const rawQuestions = await generateAllOpenAIQuestions(
        openai,
        topicsTrimmed,
        questionCount,
        questionTypes,
        difficulty
      );
      const shuffled = withShuffledMcOptions(rawQuestions) as { text: string }[];
      const questions = mergeToTargetCount(
        shuffled,
        topicsTrimmed,
        questionCount,
        includeMultipleChoice,
        includeOpenAnswer,
        difficulty
      );

      return NextResponse.json({ questions });
    } catch (openaiError: unknown) {
      console.error('OpenAI error:', openaiError);

      const fallbackQuestions = generateFallbackQuestions(
        topicsTrimmed,
        questionCount,
        includeMultipleChoice,
        includeOpenAnswer,
        difficulty,
        0
      );
      return NextResponse.json({
        questions: mergeToTargetCount(
          fallbackQuestions as { text: string }[],
          topicsTrimmed,
          questionCount,
          includeMultipleChoice,
          includeOpenAnswer,
          difficulty
        ),
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating questions:', error);
    return NextResponse.json(
      { error: 'Failed to generate questions', message },
      { status: 500 }
    );
  }
}

const MC_STEMS = [
  '¿Cuál afirmación es correcta sobre {topic}?',
  '¿Qué opción describe mejor un aspecto de {topic}?',
  'En el contexto de {topic}, ¿cuál respuesta es adecuada?',
  '¿Qué concepto se relaciona directamente con {topic}?',
  '¿Cuál ejemplo ilustra correctamente {topic}?',
  '¿Qué diferencia es importante en {topic}?',
  '¿Cuál regla o idea aplica a {topic}?',
  '¿Qué elemento es esencial en {topic}?',
];

const OPEN_STEMS = [
  'Explica con tus palabras un aspecto importante de {topic}.',
  'Describe un ejemplo relacionado con {topic}.',
  '¿Cómo aplicarías {topic} en un caso sencillo?',
  'Menciona dos ideas clave sobre {topic}.',
];

function generateFallbackQuestions(
  topics: string,
  count: number,
  includeMultipleChoice: boolean,
  includeOpenAnswer: boolean,
  difficulty: string,
  seedOffset = 0
): Record<string, unknown>[] {
  const questions: Record<string, unknown>[] = [];
  const topicList = topics.split(',').map((t) => t.trim()).filter(Boolean);
  const levelLabel: Record<string, string> = {
    easy: '[Nivel fácil]',
    medium: '[Nivel medio]',
    hard: '[Nivel difícil]',
    extreme: '[Nivel extremo]',
  };
  const tag = levelLabel[difficulty] || levelLabel.medium;

  for (let i = 0; i < count; i++) {
    const globalIndex = seedOffset + i;
    const topic = topicList[globalIndex % topicList.length] || topics.trim() || 'el tema';
    const isMultipleChoice = includeMultipleChoice && (!includeOpenAnswer || globalIndex % 2 === 0);
    const stemPool = isMultipleChoice ? MC_STEMS : OPEN_STEMS;
    const stemTemplate = stemPool[globalIndex % stemPool.length] ?? stemPool[0]!;
    const stem = stemTemplate.replace(/\{topic\}/g, topic);
    const uniqueStem = `${stem} (reactivo ${globalIndex + 1})`;

    if (isMultipleChoice) {
      const correct = `Respuesta correcta (${globalIndex + 1}) sobre ${topic}`;
      questions.push({
        text: `${tag} ${uniqueStem}`,
        type: 'multiple_choice',
        options: [
          correct,
          `Opción alternativa A (${globalIndex + 1})`,
          `Opción alternativa B (${globalIndex + 1})`,
          `Ninguna de las anteriores`,
        ],
        correct_answer: correct,
        illustration: `Ilustración ${globalIndex + 1} sobre ${topic}`,
      });
    } else {
      questions.push({
        text: `${tag} ${uniqueStem}`,
        type: 'open_answer',
        correct_answer: `Respuesta modelo ${globalIndex + 1} sobre ${topic}`,
        illustration: `Ejemplo ${globalIndex + 1} sobre ${topic}`,
      });
    }
  }

  return withShuffledMcOptions(questions);
}

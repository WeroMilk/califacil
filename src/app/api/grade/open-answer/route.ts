import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = {
  examId: string;
  studentId: string;
  clientSession: string;
  questionId: string;
  questionText: string;
  referenceAnswer: string | null;
  studentAnswer: string;
};

function isUuid(s: string): boolean {
  return typeof s === 'string' && UUID_RE.test(s.trim());
}

/**
 * Califica una respuesta abierta (0/1) usando la respuesta de referencia como rúbrica.
 * Requiere intento de examen en curso (validate_open_answer_attempt en Supabase).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const examId = (body.examId ?? '').trim();
    const studentId = (body.studentId ?? '').trim();
    const clientSession = (body.clientSession ?? '').trim();
    const questionId = (body.questionId ?? '').trim();
    const questionText = (body.questionText ?? '').trim().slice(0, 8000);
    const referenceAnswer = (body.referenceAnswer ?? '').trim().slice(0, 8000);
    const studentAnswer = (body.studentAnswer ?? '').trim().slice(0, 12000);

    if (!isUuid(examId) || !isUuid(studentId) || !isUuid(clientSession) || !isUuid(questionId)) {
      return NextResponse.json(
        { error: 'Faltan identificadores válidos del intento de examen', code: 'BAD_IDS' },
        { status: 400 }
      );
    }

    if (!questionText || !studentAnswer) {
      return NextResponse.json(
        { error: 'questionText y studentAnswer son obligatorios' },
        { status: 400 }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!url || !anonKey) {
      return NextResponse.json(
        { error: 'Supabase no configurado en el servidor', code: 'NO_SUPABASE' },
        { status: 502 }
      );
    }

    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: validation, error: rpcError } = await supabase.rpc('validate_open_answer_attempt', {
      p_exam_id: examId,
      p_student_id: studentId,
      p_session: clientSession,
      p_question_id: questionId,
    });

    if (rpcError) {
      console.error('validate_open_answer_attempt:', rpcError);
      const hint =
        /function|does not exist|schema cache/i.test(rpcError.message)
          ? 'Ejecuta la migración 20250413100000_validate_open_answer_attempt.sql en Supabase.'
          : undefined;
      return NextResponse.json(
        {
          error: 'No se pudo validar el intento de examen',
          code: 'RPC_ERROR',
          hint,
        },
        { status: 502 }
      );
    }

    const v = validation as { ok?: boolean; error?: string } | null;
    if (!v?.ok) {
      return NextResponse.json(
        {
          error: 'No autorizado para calificar esta respuesta',
          code: v?.error ?? 'forbidden',
        },
        { status: 403 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY no configurada', code: 'NO_KEY' },
        { status: 503 }
      );
    }

    const refBlock =
      referenceAnswer.length > 0
        ? `Respuesta de referencia (clave / ideas esperadas; no exiges texto idéntico):\n${referenceAnswer}`
        : 'No hay respuesta de referencia: evalúa si la respuesta del alumno es razonable y responde al enunciado.';

    const prompt = `Eres un corrector de exámenes escolares en español.

PREGUNTA:
${questionText}

${refBlock}

RESPUESTA DEL ALUMNO:
${studentAnswer}

Criterio: otorga score 1 si la respuesta demuestra comprensión adecuada (puede usar otras palabras que la referencia). Score 0 si está vacía de contenido, es irrelevante o es incorrecta de forma clara.

Responde ÚNICAMENTE con JSON: {"score":0 o 1, "isCorrect": true o false}
isCorrect debe ser true solo si score es 1.`;

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Respondes solo con JSON válido: {"score":0|1,"isCorrect":boolean}. Sin markdown.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 80,
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '{}';
    let parsed: { score?: number; isCorrect?: boolean };
    try {
      parsed = JSON.parse(raw) as { score?: number; isCorrect?: boolean };
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? (JSON.parse(m[0]) as { score?: number; isCorrect?: boolean }) : {};
    }

    const scoreNum = parsed.score === 1 ? 1 : 0;
    const is_correct = scoreNum === 1;

    return NextResponse.json({
      score: scoreNum,
      is_correct,
      model: 'gpt-4o-mini',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('grade/open-answer:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

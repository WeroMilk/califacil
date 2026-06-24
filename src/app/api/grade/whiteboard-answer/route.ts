import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { decodeWhiteboardReference } from '@/lib/whiteboardAnswer';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_IMAGE_CHARS = 1_200_000;

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

function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/');
}

/**
 * Compara dibujos de pizarrón (referencia vs alumno) con visión por IA.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const examId = (body.examId ?? '').trim();
    const studentId = (body.studentId ?? '').trim();
    const clientSession = (body.clientSession ?? '').trim();
    const questionId = (body.questionId ?? '').trim();
    const questionText = (body.questionText ?? '').trim().slice(0, 8000);
    const studentAnswer = (body.studentAnswer ?? '').trim();

    if (!isUuid(examId) || !isUuid(studentId) || !isUuid(clientSession) || !isUuid(questionId)) {
      return NextResponse.json(
        { error: 'Faltan identificadores válidos del intento de examen', code: 'BAD_IDS' },
        { status: 400 }
      );
    }

    if (!questionText || !isDataImageUrl(studentAnswer)) {
      return NextResponse.json(
        { error: 'questionText y una imagen de respuesta del alumno son obligatorios' },
        { status: 400 }
      );
    }

    const referenceImage = decodeWhiteboardReference(body.referenceAnswer);
    if (!referenceImage || !isDataImageUrl(referenceImage)) {
      return NextResponse.json(
        { error: 'La pregunta no tiene una referencia de pizarrón válida' },
        { status: 400 }
      );
    }

    if (
      studentAnswer.length > MAX_IMAGE_CHARS ||
      referenceImage.length > MAX_IMAGE_CHARS
    ) {
      return NextResponse.json(
        { error: 'Las imágenes del pizarrón son demasiado grandes para calificar' },
        { status: 413 }
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
      return NextResponse.json(
        { error: 'No se pudo validar el intento de examen', code: 'RPC_ERROR' },
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

    const { data: questionRow, error: questionErr } = await supabase
      .from('questions')
      .select('points')
      .eq('id', questionId)
      .eq('exam_id', examId)
      .maybeSingle();

    if (questionErr) {
      return NextResponse.json({ error: 'No se pudo cargar la pregunta' }, { status: 502 });
    }

    const questionPoints = Number(questionRow?.points ?? 1) || 1;

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY no configurada', code: 'NO_KEY' },
        { status: 503 }
      );
    }

    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Eres corrector de exámenes. Comparas dos dibujos en pizarrón (referencia y alumno). Responde solo JSON: {"score":0|1,"isCorrect":boolean}. score=1 si expresan la misma respuesta matemática o conceptual aunque difieran posición, tamaño o trazo.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Pregunta del examen:\n${questionText}\n\nImagen 1 = respuesta de referencia (correcta).\nImagen 2 = respuesta del alumno.\n¿El alumno respondió correctamente?`,
            },
            {
              type: 'image_url',
              image_url: { url: referenceImage, detail: 'low' },
            },
            {
              type: 'image_url',
              image_url: { url: studentAnswer, detail: 'low' },
            },
          ],
        },
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

    const scoreNum = parsed.score === 1 || parsed.isCorrect === true ? 1 : 0;
    const is_correct = scoreNum === 1;
    const weightedScore = is_correct ? questionPoints : 0;

    return NextResponse.json({
      score: weightedScore,
      is_correct,
      model: 'gpt-4o-mini',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('grade/whiteboard-answer:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

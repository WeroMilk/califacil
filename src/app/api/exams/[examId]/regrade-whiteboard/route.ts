import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import {
  decodeWhiteboardExpectedText,
  decodeWhiteboardReference,
  isWhiteboardQuestion,
} from '@/lib/whiteboardAnswer';
import { gradeWhiteboardAnswer } from '@/lib/whiteboardGrading.server';

export const maxDuration = 60;

/**
 * Recalifica una respuesta de pizarrón ya guardada (maestro autenticado).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId } = params;
    const { supabase, user } = auth;

    const { data: examRow, error: examErr } = await supabase
      .from('exams')
      .select('id, teacher_id')
      .eq('id', examId)
      .maybeSingle();

    if (examErr || !examRow || examRow.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const body = (await request.json()) as { answerId?: string };
    const answerId = (body.answerId ?? '').trim();
    if (!answerId) {
      return NextResponse.json({ error: 'answerId es obligatorio' }, { status: 400 });
    }

    const { data: answerRow, error: answerErr } = await supabase
      .from('answers')
      .select('id, exam_id, student_id, question_id, answer_text')
      .eq('id', answerId)
      .eq('exam_id', examId)
      .maybeSingle();

    if (answerErr || !answerRow) {
      return NextResponse.json({ error: 'Respuesta no encontrada' }, { status: 404 });
    }

    const { data: questionRow, error: questionErr } = await supabase
      .from('questions')
      .select('id, text, type, correct_answer, points')
      .eq('id', answerRow.question_id)
      .eq('exam_id', examId)
      .maybeSingle();

    if (questionErr || !questionRow || !isWhiteboardQuestion(questionRow)) {
      return NextResponse.json({ error: 'No es una pregunta de pizarrón' }, { status: 400 });
    }

    const studentImage = (answerRow.answer_text ?? '').trim();
    const referenceImage = decodeWhiteboardReference(questionRow.correct_answer);
    if (!studentImage.startsWith('data:image/') || !referenceImage) {
      return NextResponse.json({ error: 'Imágenes de pizarrón inválidas' }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY no configurada', code: 'NO_KEY' },
        { status: 503 }
      );
    }

    const openai = new OpenAI({ apiKey });
    const result = await gradeWhiteboardAnswer({
      openai,
      questionText: questionRow.text,
      referenceImage,
      studentImage,
      expectedText: decodeWhiteboardExpectedText(questionRow.correct_answer),
      questionPoints: Number(questionRow.points ?? 1) || 1,
    });

    const { error: updateErr } = await supabase
      .from('answers')
      .update({
        is_correct: result.is_correct,
        score: result.score,
      })
      .eq('id', answerId);

    if (updateErr) {
      return NextResponse.json({ error: 'No se pudo guardar la calificación' }, { status: 502 });
    }

    return NextResponse.json({
      score: result.score,
      is_correct: result.is_correct,
      pending: result.pending,
      reason: result.reason,
      studentExpression: result.studentExpression,
      expectedExpression: result.expectedExpression,
      model: 'gpt-4o',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('regrade-whiteboard:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

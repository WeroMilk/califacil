import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

export async function GET(
  request: NextRequest,
  { params }: { params: { examId: string; studentId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId, studentId } = params;
    const { supabase, user } = auth;

    const { data: existing, error: fetchErr } = await supabase
      .from('exams')
      .select('id, teacher_id')
      .eq('id', examId)
      .single();

    if (fetchErr || !existing || existing.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const { data, error } = await supabase.rpc('teacher_get_attempt_timeline', {
      p_exam_id: examId,
      p_student_id: studentId,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    const payload = data as { ok?: boolean; error?: string };
    if (!payload?.ok) {
      return NextResponse.json({ error: payload?.error ?? 'not_found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string; studentId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId, studentId } = params;
    const { supabase, user } = auth;

    const { data: existing, error: fetchErr } = await supabase
      .from('exams')
      .select('id, teacher_id')
      .eq('id', examId)
      .single();

    if (fetchErr || !existing || existing.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const { data, error } = await supabase.rpc('teacher_grant_exam_retake', {
      p_exam_id: examId,
      p_student_id: studentId,
    });

    if (error) {
      const hint = /function|does not exist/i.test(error.message)
        ? 'Ejecuta la migración 20260606110000_exam_attempt_events_retake.sql en Supabase.'
        : undefined;
      return NextResponse.json({ error: error.message, hint }, { status: 502 });
    }

    const payload = data as { ok?: boolean; error?: string };
    if (!payload?.ok) {
      return NextResponse.json({ error: payload?.error ?? 'failed' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

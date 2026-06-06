import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

export async function GET(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId } = params;
    const { supabase, user } = auth;

    const { data: existing, error: fetchErr } = await supabase
      .from('exams')
      .select('id, teacher_id')
      .eq('id', examId)
      .single();

    if (fetchErr || !existing || existing.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const { data, error } = await supabase.rpc('teacher_list_voided_attempts', {
      p_exam_id: examId,
    });

    if (error) {
      const hint = /function|does not exist/i.test(error.message)
        ? 'Ejecuta la migración 20260606110000_exam_attempt_events_retake.sql en Supabase.'
        : undefined;
      return NextResponse.json(
        { error: 'No se pudieron cargar los intentos anulados', message: error.message, hint },
        { status: 502 }
      );
    }

    const payload = data as { ok?: boolean; attempts?: unknown[]; error?: string };
    if (!payload?.ok) {
      return NextResponse.json({ error: payload?.error ?? 'not_allowed' }, { status: 403 });
    }

    return NextResponse.json({ attempts: payload.attempts ?? [] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId } = params;
    const { questions } = await request.json();

    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json({ error: 'Questions array is required' }, { status: 400 });
    }

    const { supabase, user } = auth;

    const { data: existing, error: fetchErr } = await supabase
      .from('exams')
      .select('id, teacher_id')
      .eq('id', examId)
      .single();

    if (fetchErr || !existing || existing.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });
    }

    const rows = (questions as Record<string, unknown>[]).map((q) => {
      const type = q.type === 'open_answer' ? 'open_answer' : 'multiple_choice';
      const opts = q.options;
      return {
        exam_id: examId,
        text: String(q.text ?? '').trim() || '(sin texto)',
        type,
        options:
          type === 'multiple_choice' && Array.isArray(opts)
            ? opts
            : type === 'multiple_choice' && opts != null
              ? [String(opts)]
              : null,
        correct_answer:
          q.correct_answer != null && String(q.correct_answer).trim() !== ''
            ? String(q.correct_answer)
            : null,
        illustration:
          q.illustration != null && String(q.illustration).trim() !== ''
            ? String(q.illustration)
            : null,
      };
    });

    const { data, error } = await supabase.from('questions').insert(rows).select();

    if (error) {
      console.error('[questions POST]', error);
      const hint =
        /relation|does not exist|schema cache/i.test(error.message)
          ? 'Ejecuta las migraciones SQL del repo en Supabase (supabase/migrations), empezando por 20250323100000_core_schema.sql.'
          : undefined;
      return NextResponse.json(
        { error: 'Failed to add questions', message: error.message, code: error.code, hint },
        { status: 500 }
      );
    }

    return NextResponse.json({ questions: data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Internal server error', message }, { status: 500 });
  }
}

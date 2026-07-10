import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { dedupeExamQuestions } from '@/lib/utils';
import { isMissingSortOrderColumnError } from '@/lib/examQuestions';

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

    const uniqueQuestions = dedupeExamQuestions(
      (questions as Record<string, unknown>[]).map((q) => ({
        ...q,
        text: String(q.text ?? '').trim(),
      })) as { text: string }[]
    );

    if (uniqueQuestions.length === 0) {
      return NextResponse.json({ error: 'Questions array is required' }, { status: 400 });
    }

    const { count: existingCount } = await supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', examId);

    const baseOrder = existingCount ?? 0;

    const buildRow = (q: { text: string }, index: number, includeSortOrder: boolean) => {
      const row = q as Record<string, unknown>;
      const type = row.type === 'open_answer' ? 'open_answer' : 'multiple_choice';
      const opts = row.options;
      const base = {
        exam_id: examId,
        text: String(row.text ?? '').trim() || '(sin texto)',
        type,
        options:
          type === 'multiple_choice' && Array.isArray(opts)
            ? opts
            : type === 'multiple_choice' && opts != null
              ? [String(opts)]
              : null,
        correct_answer:
          row.correct_answer != null && String(row.correct_answer).trim() !== ''
            ? String(row.correct_answer)
            : null,
        illustration:
          row.illustration != null && String(row.illustration).trim() !== ''
            ? String(row.illustration)
            : null,
        points:
          typeof row.points === 'number' && row.points > 0
            ? row.points
            : row.points != null && Number(row.points) > 0
              ? Number(row.points)
              : 1,
      };
      return includeSortOrder ? { ...base, sort_order: baseOrder + index } : base;
    };

    let rows = uniqueQuestions.map((q, index) => buildRow(q, index, true));
    let { data, error } = await supabase.from('questions').insert(rows).select();

    if (error && isMissingSortOrderColumnError(error.message)) {
      rows = uniqueQuestions.map((q, index) => buildRow(q, index, false));
      ({ data, error } = await supabase.from('questions').insert(rows).select());
    }

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

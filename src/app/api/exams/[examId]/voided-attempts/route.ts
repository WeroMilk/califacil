import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { listVoidedExamAttempts } from '@/lib/examRetake';

export async function GET(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const { examId } = params;
    const { supabase, user } = auth;

    const result = await listVoidedExamAttempts(supabase, examId, user.id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, hint: result.hint },
        { status: result.error === 'Examen no encontrado' ? 404 : 502 }
      );
    }

    return NextResponse.json({ attempts: result.attempts });
  } catch (error: unknown) {
    console.error('[voided-attempts]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Error interno al cargar exámenes anulados', message },
      { status: 500 }
    );
  }
}

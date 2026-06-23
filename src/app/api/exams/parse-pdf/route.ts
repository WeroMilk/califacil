import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { parseExamQuestionsFromPdfBuffer } from '@/lib/examPdfImport.server';
import { distributeExamPoints, dedupeExamQuestions } from '@/lib/utils';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo PDF' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Solo se aceptan archivos PDF' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: 'El PDF supera el límite de 20 MB' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const questions = dedupeExamQuestions(await parseExamQuestionsFromPdfBuffer(buffer));
    const pointValues = distributeExamPoints(questions.length);
    const withPoints = questions.map((q, index) => ({
      ...q,
      points: pointValues[index],
    }));

    return NextResponse.json({ questions: withPoints });
  } catch (error: unknown) {
    console.error('[parse-pdf]', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Error al procesar el PDF', message }, { status: 500 });
  }
}

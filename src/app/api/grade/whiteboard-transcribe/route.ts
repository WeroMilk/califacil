import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';
import { transcribeWhiteboardImage } from '@/lib/whiteboardGrading.server';

export const maxDuration = 60;

const MAX_IMAGE_CHARS = 1_200_000;

function isDataImageUrl(value: string): boolean {
  return value.startsWith('data:image/');
}

/** Sugiere el texto de la respuesta de referencia a partir de un dibujo. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const body = (await request.json()) as { image?: string; questionText?: string };
    const image = (body.image ?? '').trim();
    const questionText = (body.questionText ?? '').trim();

    if (!isDataImageUrl(image)) {
      return NextResponse.json({ error: 'Se requiere una imagen válida' }, { status: 400 });
    }
    if (image.length > MAX_IMAGE_CHARS) {
      return NextResponse.json({ error: 'Imagen demasiado grande' }, { status: 413 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY no configurada', code: 'NO_KEY' },
        { status: 503 }
      );
    }

    const openai = new OpenAI({ apiKey });
    const expression = await transcribeWhiteboardImage(openai, image, questionText);

    return NextResponse.json({ expression });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    console.error('grade/whiteboard-transcribe:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

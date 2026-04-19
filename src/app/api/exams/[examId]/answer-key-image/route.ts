import { NextRequest, NextResponse } from 'next/server';
import { requireSessionUser } from '@/lib/supabaseRouteAuth';

type Params = { params: { examId: string } };

function parseDataUrlImage(dataUrl: string): { bytes: Buffer; contentType: string } {
  const m = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i);
  if (!m) throw new Error('Formato de imagen inválido');
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) throw new Error('Imagen vacía');
  return { bytes, contentType: mime };
}

async function ensureExamOwner(
  supabase: any,
  examId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('exams')
    .select('id, teacher_id')
    .eq('id', examId)
    .single();
  return Boolean(!error && data && data.teacher_id === userId);
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const examId = params.examId;
    if (!examId) return NextResponse.json({ error: 'Falta examId' }, { status: 400 });

    const allowed = await ensureExamOwner(auth.supabase, examId, auth.user.id);
    if (!allowed) return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as {
      sheetIndex?: number;
      originalImageBase64?: string;
      blurImageBase64?: string;
      width?: number;
      height?: number;
    };

    const sheetIndex = Number(body.sheetIndex);
    if (!Number.isInteger(sheetIndex) || sheetIndex < 0 || sheetIndex > 2) {
      return NextResponse.json({ error: 'sheetIndex inválido (0-2)' }, { status: 400 });
    }
    if (!body.originalImageBase64 || !body.blurImageBase64) {
      return NextResponse.json({ error: 'Faltan imágenes original/blur' }, { status: 400 });
    }

    const original = parseDataUrlImage(body.originalImageBase64);
    const blur = parseDataUrlImage(body.blurImageBase64);
    const width = Number.isFinite(Number(body.width)) ? Math.max(1, Math.round(Number(body.width))) : null;
    const height = Number.isFinite(Number(body.height)) ? Math.max(1, Math.round(Number(body.height))) : null;

    const base = `${auth.user.id}/${examId}/sheet-${sheetIndex + 1}`;
    const originalPath = `${base}/original.jpg`;
    const blurPath = `${base}/blur.jpg`;

    const originalBuffer = original.bytes.buffer.slice(
      original.bytes.byteOffset,
      original.bytes.byteOffset + original.bytes.byteLength
    ) as ArrayBuffer;
    const blurBuffer = blur.bytes.buffer.slice(
      blur.bytes.byteOffset,
      blur.bytes.byteOffset + blur.bytes.byteLength
    ) as ArrayBuffer;

    const up1 = await auth.supabase.storage
      .from('exam-key-photos')
      .upload(originalPath, originalBuffer, {
        contentType: original.contentType,
        upsert: true,
      });
    if (up1.error) throw up1.error;

    const up2 = await auth.supabase.storage
      .from('exam-key-photos')
      .upload(blurPath, blurBuffer, {
        contentType: blur.contentType,
        upsert: true,
      });
    if (up2.error) throw up2.error;

    const { error: metaErr } = await auth.supabase
      .from('exam_key_images')
      .upsert(
        {
          exam_id: examId,
          teacher_id: auth.user.id,
          sheet_index: sheetIndex,
          original_path: originalPath,
          blur_path: blurPath,
          width,
          height,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'exam_id,sheet_index' }
      );
    if (metaErr) throw metaErr;

    return NextResponse.json({ ok: true, sheetIndex, blurPath, originalPath });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireSessionUser(request);
    if ('response' in auth) return auth.response;

    const examId = params.examId;
    if (!examId) return NextResponse.json({ error: 'Falta examId' }, { status: 400 });
    const allowed = await ensureExamOwner(auth.supabase, examId, auth.user.id);
    if (!allowed) return NextResponse.json({ error: 'Examen no encontrado' }, { status: 404 });

    const sheetIndex = Number(request.nextUrl.searchParams.get('sheetIndex') ?? '');
    if (!Number.isInteger(sheetIndex) || sheetIndex < 0 || sheetIndex > 2) {
      return NextResponse.json({ error: 'sheetIndex inválido (0-2)' }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from('exam_key_images')
      .select('blur_path, original_path, width, height, updated_at')
      .eq('exam_id', examId)
      .eq('sheet_index', sheetIndex)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ hasImage: false, sheetIndex });

    const signed = await auth.supabase.storage
      .from('exam-key-photos')
      .createSignedUrl(data.blur_path, 60 * 5);
    if (signed.error) throw signed.error;

    return NextResponse.json({
      hasImage: true,
      sheetIndex,
      blurSignedUrl: signed.data.signedUrl,
      originalPath: data.original_path,
      width: data.width,
      height: data.height,
      updatedAt: data.updated_at,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error desconocido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

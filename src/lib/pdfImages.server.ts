import path from 'node:path';
import sharp from 'sharp';
import { pdfBufferBytes } from '@/lib/pdfBuffer.server';
import { loadPdfJsServer } from '@/lib/pdfjsServer.server';

/** pdfjs-dist exige URLs con slash final y barras normales (incluso en Windows). */
function pdfjsAssetUrl(...segments: string[]): string {
  const absolute = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', ...segments);
  return `${absolute.replace(/\\/g, '/')}/`;
}

export type PdfImageAsset = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
};

type PdfPage = {
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: {
    get: (name: string, callback?: (data: PdfRawImage | null) => void) => PdfRawImage | null;
  };
};

type PdfRawImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  kind: number;
};

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
};

function multiplyMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

async function resolvePdfObject<T>(page: PdfPage, name: string): Promise<T | null> {
  return new Promise((resolve) => {
    page.objs.get(name, (data) => resolve((data as T) ?? null));
  });
}

async function rawImageToDataUrl(imgData: PdfRawImage): Promise<string | null> {
  if (!imgData?.data || !imgData.width || !imgData.height) return null;
  const channels = imgData.kind === 2 ? 3 : imgData.kind === 1 ? 1 : 4;
  const pixelCopy = Buffer.from(new Uint8Array(imgData.data));
  let pipeline = sharp(pixelCopy, {
    raw: { width: imgData.width, height: imgData.height, channels },
  });
  if (channels === 1) pipeline = pipeline.toColourspace('srgb');
  if (channels === 4) pipeline = pipeline.flatten({ background: '#ffffff' });

  const meta = await pipeline.metadata();
  const maxSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (maxSide > 640) {
    pipeline = pipeline.resize({
      width: meta.width && meta.width >= (meta.height ?? 0) ? 640 : undefined,
      height: meta.height && meta.height > (meta.width ?? 0) ? 640 : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const jpeg = await pipeline.jpeg({ quality: 82 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

async function loadPdfDocument(buffer: ArrayBuffer): Promise<PdfDocument> {
  const { getDocument } = await loadPdfJsServer();
  const loadingTask = getDocument({
    data: pdfBufferBytes(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
  });
  return loadingTask.promise as Promise<PdfDocument>;
}

export async function extractPdfImagesFromBuffer(buffer: ArrayBuffer): Promise<PdfImageAsset[]> {
  const pdfjs = await loadPdfJsServer();
  const OPS = pdfjs.OPS as Record<string, number>;
  const pdf = await loadPdfDocument(buffer);
  const images: PdfImageAsset[] = [];
  const seenKeys = new Set<string>();

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const opList = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const pending: Array<{ name: string; x: number; y: number; width: number; height: number }> = [];

    for (let i = 0; i < opList.fnArray.length; i += 1) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i] as unknown[];

      if (fn === OPS.save) {
        stack.push([...ctm]);
      } else if (fn === OPS.restore) {
        ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform) {
        ctm = multiplyMatrix(ctm, args as number[]);
      } else if (fn === OPS.paintImageXObject) {
        const name = String(args[0] ?? '');
        const width = Number(args[1] ?? 0);
        const height = Number(args[2] ?? 0);
        if (!name) continue;
        pending.push({ name, x: ctm[4], y: ctm[5], width, height });
      }
    }

    for (const paint of pending) {
      if (paint.width < 40 || paint.height < 40) continue;
      const imgData = await resolvePdfObject<PdfRawImage>(page, paint.name);
      if (!imgData) continue;
      const dataUrl = await rawImageToDataUrl(imgData);
      if (!dataUrl) continue;
      const key = `${pageNumber}:${paint.name}:${paint.x.toFixed(0)}:${paint.y.toFixed(0)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      images.push({
        pageNumber,
        x: paint.x,
        y: paint.y,
        width: paint.width,
        height: paint.height,
        dataUrl,
      });
    }
  }

  return images;
}

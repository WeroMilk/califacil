import path from 'node:path';
import type { GeneratedQuestion } from '@/types';
import type { PdfImageAsset } from '@/lib/pdfImages.server';
import { pdfBufferBytes } from '@/lib/pdfBuffer.server';
import { loadPdfJsServer } from '@/lib/pdfjsServer.server';
import { isQuestionIllustrationImage } from '@/lib/utils';

/** pdfjs-dist exige URLs con slash final y barras normales (incluso en Windows). */
function pdfjsAssetUrl(...segments: string[]): string {
  const absolute = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', ...segments);
  return `${absolute.replace(/\\/g, '/')}/`;
}

export type PositionedLine = {
  pageNumber: number;
  x: number;
  y: number;
  text: string;
};

export type PdfStructure = {
  lines: PositionedLine[];
  text: string;
};

type PositionedItem = { str: string; x: number; y: number };

function groupItemsIntoLines(
  items: PositionedItem[],
  pageNumber: number,
  yTolerance = 4
): PositionedLine[] {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(b.y - a.y) > yTolerance) return b.y - a.y;
    return a.x - b.x;
  });

  const grouped: Array<{ y: number; x: number; parts: string[] }> = [];
  for (const item of sorted) {
    const last = grouped[grouped.length - 1];
    if (!last || Math.abs(item.y - last.y) > yTolerance) {
      grouped.push({ y: item.y, x: item.x, parts: [item.str] });
    } else {
      last.parts.push(item.str);
    }
  }

  return grouped
    .map((line) => ({
      pageNumber,
      x: line.x,
      y: line.y,
      text: line.parts.join(' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((line) => line.text);
}

export async function extractPdfStructureFromBuffer(buffer: ArrayBuffer): Promise<PdfStructure> {
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
  const pdf = await loadingTask.promise;
  const lines: PositionedLine[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const items: PositionedItem[] = [];

    for (const item of textContent.items as Array<{ str?: string; transform?: number[] }>) {
      const str = item?.str?.trim();
      const transform = item?.transform;
      if (!str || !transform || transform.length < 6) continue;
      items.push({ str, x: transform[4], y: transform[5] });
    }

    lines.push(...groupItemsIntoLines(items, pageNumber));
  }

  return { lines, text: lines.map((l) => l.text).join('\n') };
}

export async function extractPdfTextFromBuffer(buffer: ArrayBuffer): Promise<string> {
  const structure = await extractPdfStructureFromBuffer(buffer);
  return structure.text;
}

type QuestionWithAnchor = GeneratedQuestion & {
  _anchorPage?: number;
  _anchorY?: number;
  _triangle?: string;
};

function isSupportImage(img: PdfImageAsset): boolean {
  return img.height >= 55 && img.width >= 55;
}

function pickTriangleImages(images: PdfImageAsset[]): Map<string, string> {
  const large = images.filter(isSupportImage).sort((a, b) => a.x - b.x);
  const map = new Map<string, string>();
  if (large.length >= 2) {
    map.set('1', large[0].dataUrl);
    map.set('2', large[1].dataUrl);
  } else if (large.length === 1) {
    map.set('1', large[0].dataUrl);
    map.set('2', large[0].dataUrl);
  }
  return map;
}

function nearestImageForAnchor(
  images: PdfImageAsset[],
  pageNumber: number,
  anchorY: number
): string | undefined {
  const candidates = images
    .filter(isSupportImage)
    .filter((img) => img.pageNumber === pageNumber)
    .map((img) => ({
      img,
      dist: Math.abs(img.y - anchorY) + Math.abs(img.y + img.height - anchorY) * 0.25,
    }))
    .filter(({ dist }) => dist < 180)
    .sort((a, b) => a.dist - b.dist);

  return candidates[0]?.img.dataUrl;
}

export function attachPdfImagesToQuestions(
  questions: GeneratedQuestion[],
  images: PdfImageAsset[],
  lines: PositionedLine[]
): GeneratedQuestion[] {
  if (images.length === 0) return questions;

  const triangleImages = pickTriangleImages(images);
  const usedImageUrls = new Set<string>();

  return (questions as QuestionWithAnchor[]).map((question) => {
    if (question.illustration && isQuestionIllustrationImage(question.illustration)) {
      usedImageUrls.add(question.illustration);
      return question;
    }

    const tri = question._triangle ?? question.text.match(/Triángulo\s*(\d+)/i)?.[1];
    if (tri && triangleImages.has(tri)) {
      const dataUrl = triangleImages.get(tri)!;
      return { ...question, illustration: dataUrl };
    }

    if (question._anchorPage != null && question._anchorY != null) {
      const dataUrl = nearestImageForAnchor(images, question._anchorPage, question._anchorY);
      if (dataUrl && !usedImageUrls.has(dataUrl)) {
        usedImageUrls.add(dataUrl);
        return { ...question, illustration: dataUrl };
      }
    }

    return question;
  }).map(({ _anchorPage, _anchorY, _triangle, ...question }) => question);
}

export function lineAnchorForIndex(lines: PositionedLine[], index: number): Pick<PositionedLine, 'pageNumber' | 'y'> | null {
  const line = lines[index];
  if (!line) return null;
  return { pageNumber: line.pageNumber, y: line.y };
}

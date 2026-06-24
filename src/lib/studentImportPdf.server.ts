import path from 'node:path';
import {
  parseGenericPdfTextFromLines,
  parseItsonAttendanceListText,
  type StudentImportResult,
} from '@/lib/studentImportCore';
import { pdfBufferBytes } from '@/lib/pdfBuffer.server';
import { loadPdfJsServer } from '@/lib/pdfjsServer.server';

/** pdfjs-dist exige URLs con slash final y barras normales (incluso en Windows). */
function pdfjsAssetUrl(...segments: string[]): string {
  const absolute = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', ...segments);
  return `${absolute.replace(/\\/g, '/')}/`;
}

async function extractPdfTextFromBuffer(buffer: ArrayBuffer): Promise<string> {
  const { getDocument } = await loadPdfJsServer();
  const bytes = pdfBufferBytes(buffer);
  const loadingTask = getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: pdfjsAssetUrl('standard_fonts'),
    cMapUrl: pdfjsAssetUrl('cmaps'),
    cMapPacked: true,
  });
  const pdf = await loadingTask.promise;
  const chunks: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    let currentLine = '';

    for (const item of textContent.items as Array<{ str?: string; hasEOL?: boolean }>) {
      const part = item?.str?.trim();
      if (part) {
        currentLine = `${currentLine} ${part}`.trim();
      }
      if (item?.hasEOL && currentLine) {
        chunks.push(currentLine);
        currentLine = '';
      }
    }
    if (currentLine) chunks.push(currentLine);
  }

  return chunks.join('\n');
}

export async function parseStudentImportFromPdfBuffer(buffer: ArrayBuffer): Promise<StudentImportResult> {
  const text = await extractPdfTextFromBuffer(buffer);
  const itson = parseItsonAttendanceListText(text);
  if (itson) return itson;

  const lines = text.split(/\r?\n/);
  return parseGenericPdfTextFromLines(lines);
}

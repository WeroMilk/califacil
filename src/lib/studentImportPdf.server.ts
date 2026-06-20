import {
  parseGenericPdfTextFromLines,
  parseItsonAttendanceListText,
  type StudentImportResult,
} from '@/lib/studentImportCore';

async function extractPdfTextFromBuffer(buffer: ArrayBuffer): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = new Uint8Array(buffer);
  const loadingTask = getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
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

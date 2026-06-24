import { ensurePdfJsNodePolyfills } from '@/lib/pdfjsPolyfills.server';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjsModule: PdfJsModule | null = null;

export async function loadPdfJsServer(): Promise<PdfJsModule> {
  await ensurePdfJsNodePolyfills();
  if (!pdfjsModule) {
    pdfjsModule = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsModule;
}

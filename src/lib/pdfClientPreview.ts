export type ExamCroppedImage = {
  id: string;
  label: string;
  dataUrl: string;
  pageNumber: number;
};

export type PdfPreviewPage = {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
};

type PdfJsModule = {
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> };
  GlobalWorkerOptions: { workerSrc: string };
};

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
};

type PdfPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
    canvas: HTMLCanvasElement;
  }) => { promise: Promise<void> };
};

type PdfJsWindow = Window & {
  __califacilPdfJs?: PdfJsModule;
  __califacilPdfJsPromise?: Promise<PdfJsModule>;
};

const PDFJS_READY_EVENT = 'califacil-pdfjs-ready';

async function getPdfJs(): Promise<PdfJsModule> {
  if (typeof window === 'undefined') {
    throw new Error('La vista previa del PDF solo está disponible en el navegador');
  }

  const w = window as PdfJsWindow;
  if (w.__califacilPdfJs) return w.__califacilPdfJs;
  if (w.__califacilPdfJsPromise) return w.__califacilPdfJsPromise;

  w.__califacilPdfJsPromise = new Promise<PdfJsModule>((resolve, reject) => {
    const origin = window.location.origin;
    const script = document.createElement('script');
    script.type = 'module';
    script.textContent = `
      import * as pdfjs from '${origin}/pdfjs/pdf.min.mjs';
      pdfjs.GlobalWorkerOptions.workerSrc = '${origin}/pdfjs/pdf.worker.min.mjs';
      window.__califacilPdfJs = pdfjs;
      window.dispatchEvent(new Event('${PDFJS_READY_EVENT}'));
    `;

    const cleanup = () => {
      window.removeEventListener(PDFJS_READY_EVENT, onReady);
      script.remove();
    };

    const onReady = () => {
      cleanup();
      if (w.__califacilPdfJs) resolve(w.__califacilPdfJs);
      else reject(new Error('No se pudo cargar el visor de PDF'));
    };

    script.onerror = () => {
      cleanup();
      w.__califacilPdfJsPromise = undefined;
      reject(new Error('No se pudo cargar el visor de PDF. Recarga la página e inténtalo de nuevo.'));
    };

    window.addEventListener(PDFJS_READY_EVENT, onReady);
    document.head.appendChild(script);
  });

  return w.__califacilPdfJsPromise;
}

export async function renderPdfPreviewPages(file: File, scale = 1.4): Promise<PdfPreviewPage[]> {
  const pdfjs = await getPdfJs();
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const pages: PdfPreviewPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    pages.push({
      pageNumber,
      dataUrl: canvas.toDataURL('image/jpeg', 0.92),
      width: canvas.width,
      height: canvas.height,
    });
  }

  return pages;
}

export type CropRect = { x: number; y: number; width: number; height: number };

export async function cropPreviewPageAsync(
  page: PdfPreviewPage,
  rect: CropRect,
  displayWidth: number
): Promise<string | null> {
  if (rect.width < 8 || rect.height < 8) return null;
  const scale = page.width / displayWidth;
  const sx = Math.max(0, Math.round(rect.x * scale));
  const sy = Math.max(0, Math.round(rect.y * scale));
  const sw = Math.min(page.width - sx, Math.round(rect.width * scale));
  const sh = Math.min(page.height - sy, Math.round(rect.height * scale));
  if (sw < 8 || sh < 8) return null;

  const img = await loadImage(page.dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function findCroppedImageId(
  images: ExamCroppedImage[],
  dataUrl: string | undefined
): string | null {
  if (!dataUrl) return null;
  return images.find((img) => img.dataUrl === dataUrl)?.id ?? null;
}

type PdfJsGlobals = typeof globalThis & {
  DOMMatrix?: unknown;
  ImageData?: unknown;
  Path2D?: unknown;
};

let polyfillsReady = false;

function installStubPolyfills() {
  const g = globalThis as PdfJsGlobals;
  if (!g.DOMMatrix) {
    g.DOMMatrix = class DOMMatrix {
      is2D = true;
      isIdentity = true;
      transformPoint<T extends { x: number; y: number }>(point: T): T {
        return point;
      }
    } as unknown as typeof DOMMatrix;
  }
  if (!g.Path2D) {
    g.Path2D = class Path2D {} as unknown as typeof Path2D;
  }
  if (!g.ImageData) {
    g.ImageData = class ImageData {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
    } as unknown as typeof ImageData;
  }
}

/** pdfjs-dist references DOMMatrix at module load time; Node.js needs this first. */
export async function ensurePdfJsNodePolyfills(): Promise<void> {
  if (polyfillsReady) return;

  const g = globalThis as PdfJsGlobals;
  if (!g.DOMMatrix) {
    try {
      const canvas = await import('@napi-rs/canvas');
      g.DOMMatrix = canvas.DOMMatrix as unknown as typeof DOMMatrix;
      g.ImageData = canvas.ImageData as unknown as typeof ImageData;
      g.Path2D = canvas.Path2D as unknown as typeof Path2D;
    } catch {
      installStubPolyfills();
    }
  }

  polyfillsReady = true;
}

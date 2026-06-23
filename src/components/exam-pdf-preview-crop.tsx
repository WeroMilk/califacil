'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Scissors, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  cropPreviewPageAsync,
  renderPdfPreviewPages,
  type CropRect,
  type ExamCroppedImage,
  type PdfPreviewPage,
} from '@/lib/pdfClientPreview';

type Props = {
  file: File | null;
  croppedImages: ExamCroppedImage[];
  onCroppedImagesChange: (images: ExamCroppedImage[]) => void;
};

const MIN_SELECTION = 12;

function isValidSelection(rect: CropRect | null): rect is CropRect {
  return Boolean(rect && rect.width >= MIN_SELECTION && rect.height >= MIN_SELECTION);
}

export function ExamPdfPreviewCrop({ file, croppedImages, onCroppedImagesChange }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  const [pages, setPages] = useState<PdfPreviewPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<CropRect | null>(null);

  const loadPreview = useCallback(
    (targetFile: File) => {
      setLoading(true);
      setLoadError(null);
      setPages([]);
      setPageIndex(0);
      setSelection(null);
      onCroppedImagesChange([]);

      return renderPdfPreviewPages(targetFile)
        .then((result) => {
          if (result.length === 0) {
            setLoadError('El PDF no tiene páginas para previsualizar.');
            return;
          }
          setPages(result);
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : 'No se pudo previsualizar el PDF';
          setLoadError(message);
          toast.error('No se pudo previsualizar el PDF');
        })
        .finally(() => {
          setLoading(false);
        });
    },
    [onCroppedImagesChange]
  );

  useEffect(() => {
    if (!file) {
      setPages([]);
      setPageIndex(0);
      setLoadError(null);
      setSelection(null);
      return;
    }

    void loadPreview(file);
  }, [file, loadPreview]);

  const currentPage = pages[pageIndex] ?? null;

  useEffect(() => {
    setSelection(null);
  }, [pageIndex]);

  const pointerPos = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const box = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(clientX - box.left, box.width)),
      y: Math.max(0, Math.min(clientY - box.top, box.height)),
    };
  }, []);

  const updateSelection = useCallback((startX: number, startY: number, endX: number, endY: number) => {
    setSelection({
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      width: Math.abs(endX - startX),
      height: Math.abs(endY - startY),
    });
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = pointerPos(e.clientX, e.clientY);
    dragStartRef.current = p;
    draggingRef.current = true;
    updateSelection(p.x, p.y, p.x, p.y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !dragStartRef.current) return;
    const p = pointerPos(e.clientX, e.clientY);
    const start = dragStartRef.current;
    updateSelection(start.x, start.y, p.x, p.y);
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    dragStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleCrop = async () => {
    if (!currentPage || !isValidSelection(selection)) {
      toast.error('Arrastra para seleccionar un área más grande');
      return;
    }

    const displayWidth = imgRef.current?.clientWidth ?? 0;
    if (displayWidth <= 0) {
      toast.error('Espera a que cargue la imagen');
      return;
    }

    const dataUrl = await cropPreviewPageAsync(currentPage, selection, displayWidth);
    if (!dataUrl) {
      toast.error('Selecciona un área más grande para recortar');
      return;
    }

    const next: ExamCroppedImage = {
      id: crypto.randomUUID(),
      label: `Imagen ${croppedImages.length + 1} (pág. ${currentPage.pageNumber})`,
      dataUrl,
      pageNumber: currentPage.pageNumber,
    };
    onCroppedImagesChange([...croppedImages, next]);
    setSelection(null);
    toast.success('Imagen recortada agregada');
  };

  if (!file) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-gray-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Generando vista previa del PDF…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p>No se pudo generar la vista previa: {loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadPreview(file)}>
          Reintentar
        </Button>
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-gray-600">
        No hay páginas para mostrar en este PDF.
      </div>
    );
  }

  const hasSelection = isValidSelection(selection);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Vista previa — recorta imágenes ilustrativas</Label>
        {pages.length > 1 && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={pageIndex === 0}
              onClick={() => setPageIndex((i) => i - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-gray-600">
              Página {pageIndex + 1} / {pages.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={pageIndex >= pages.length - 1}
              onClick={() => setPageIndex((i) => i + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500">
        Arrastra sobre el PDF para marcar el área con línea punteada, luego pulsa &quot;Recortar
        selección&quot;.
      </p>

      <div className="max-h-[min(60vh,520px)] overflow-auto rounded-lg border bg-white">
        <div
          className="relative w-full touch-none cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={currentPage?.dataUrl}
            alt={`Página ${currentPage?.pageNumber ?? 1}`}
            className="block h-auto w-full select-none"
            draggable={false}
          />

          {selection && selection.width > 1 && selection.height > 1 && (
            <>
              <div
                className="pointer-events-none absolute border-2 border-dashed border-orange-500 bg-orange-500/15"
                style={{
                  left: selection.x,
                  top: selection.y,
                  width: selection.width,
                  height: selection.height,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                }}
              />
              <div
                className="pointer-events-none absolute rounded bg-orange-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
                style={{
                  left: selection.x,
                  top: Math.max(0, selection.y - 18),
                }}
              >
                {Math.round(selection.width)} × {Math.round(selection.height)} px
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!selection} onClick={() => setSelection(null)}>
          Limpiar selección
        </Button>
        <Button type="button" disabled={!hasSelection} onClick={() => void handleCrop()}>
          <Scissors className="mr-2 h-4 w-4" />
          Recortar selección
        </Button>
      </div>

      {croppedImages.length > 0 && (
        <div className="space-y-2">
          <Label>Imágenes recortadas ({croppedImages.length})</Label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {croppedImages.map((img) => (
              <div key={img.id} className="rounded-lg border bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.dataUrl} alt={img.label} className="mb-2 h-24 w-full object-contain" />
                <p className="truncate text-xs text-gray-600">{img.label}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 w-full text-red-600"
                  onClick={() =>
                    onCroppedImagesChange(croppedImages.filter((c) => c.id !== img.id))
                  }
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Eliminar
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

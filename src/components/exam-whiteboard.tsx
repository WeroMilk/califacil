'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Eraser, Pencil, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  value?: string | null;
  onChange?: (dataUrl: string) => void;
  readOnly?: boolean;
  className?: string;
  minHeight?: number;
};

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export function ExamWhiteboard({
  value,
  onChange,
  readOnly = false,
  className,
  minHeight = 260,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [ready, setReady] = useState(false);

  const resizeCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const width = Math.max(container.clientWidth, 280);
    const height = minHeight;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    if (value) {
      try {
        const img = await loadImage(value);
        ctx.drawImage(img, 0, 0, width, height);
      } catch {
        /* imagen inválida */
      }
    }
    setReady(true);
  }, [minHeight, value]);

  useEffect(() => {
    void resizeCanvas();
    const onResize = () => void resizeCanvas();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [resizeCanvas]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = 18;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2.5;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };

  const exportDrawing = () => {
    const canvas = canvasRef.current;
    if (!canvas || !onChange) return;
    onChange(canvas.toDataURL('image/png'));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getPoint(event);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || readOnly) return;
    const point = getPoint(event);
    const last = lastPointRef.current;
    if (last) stroke(last, point);
    lastPointRef.current = point;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    exportDrawing();
  };

  const handleClear = () => {
    void resizeCanvas().then(() => exportDrawing());
  };

  if (readOnly && value) {
    return (
      <div className={cn('overflow-hidden rounded-lg border border-gray-200 bg-white', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt="Respuesta en pizarrón" className="h-auto w-full object-contain" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={tool === 'pen' ? 'default' : 'outline'}
            className={tool === 'pen' ? 'bg-orange-600 hover:bg-orange-700' : ''}
            onClick={() => setTool('pen')}
          >
            <Pencil className="mr-1.5 h-4 w-4" />
            Lápiz
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tool === 'eraser' ? 'default' : 'outline'}
            onClick={() => setTool('eraser')}
          >
            <Eraser className="mr-1.5 h-4 w-4" />
            Borrador
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={handleClear}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Limpiar
          </Button>
        </div>
      )}
      <div
        ref={containerRef}
        className="overflow-hidden rounded-lg border-2 border-dashed border-orange-200 bg-white"
      >
        <canvas
          ref={canvasRef}
          className={cn(
            'block w-full touch-none',
            readOnly ? 'cursor-default' : 'cursor-crosshair',
            !ready && 'opacity-0'
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          aria-label={readOnly ? 'Respuesta de referencia en pizarrón' : 'Pizarrón para dibujar la respuesta'}
        />
      </div>
    </div>
  );
}

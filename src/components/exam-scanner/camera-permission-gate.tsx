'use client';

import { Camera, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  examTitle: string;
  denied: boolean;
  requesting: boolean;
  onRequest: () => void;
  onClose: () => void;
};

export function CameraPermissionGate({
  examTitle,
  denied,
  requesting,
  onRequest,
  onClose,
}: Props) {
  return (
    <div className="flex h-[100dvh] w-full flex-col bg-gradient-to-b from-orange-50 via-white to-orange-50/80 text-gray-900">
      <header
        className="flex shrink-0 items-center justify-between border-b border-orange-100 bg-white/90 px-4 py-3 backdrop-blur-sm"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0px))' }}
      >
        <Button type="button" variant="ghost" size="sm" className="text-gray-600" onClick={onClose}>
          Cancelar
        </Button>
        <p className="truncate px-2 text-sm font-medium text-gray-800">{examTitle}</p>
        <span className="w-16" aria-hidden />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-8">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-2xl shadow-sm ${
            denied ? 'bg-red-50 text-red-600' : 'bg-orange-100 text-orange-600'
          }`}
        >
          {denied ? (
            <ShieldAlert className="h-10 w-10" strokeWidth={1.75} />
          ) : (
            <Camera className="h-10 w-10" strokeWidth={1.75} />
          )}
        </div>

        <div className="max-w-sm space-y-2 text-center">
          <h2 className="text-xl font-bold text-gray-900">
            {denied ? 'Permiso de cámara denegado' : 'Permitir acceso a la cámara'}
          </h2>
          <p className="text-sm leading-relaxed text-gray-600">
            {denied
              ? 'Para calificar exámenes escaneados, activa la cámara en los ajustes del navegador y vuelve a intentarlo.'
              : 'Necesitamos la cámara trasera para detectar las esquinas negras del examen y capturar la hoja con precisión.'}
          </p>
        </div>

        <div className="flex w-full max-w-xs flex-col gap-2">
          <Button
            type="button"
            className="w-full bg-orange-600 hover:bg-orange-700"
            disabled={requesting}
            onClick={onRequest}
          >
            {requesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Abriendo cámara…
              </>
            ) : denied ? (
              'Reintentar'
            ) : (
              'Permitir cámara'
            )}
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            Volver
          </Button>
        </div>
      </div>
    </div>
  );
}

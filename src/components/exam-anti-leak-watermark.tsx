'use client';

import { useEffect, useMemo, useState } from 'react';

type Props = {
  studentName: string;
  examTitle: string;
  /** Fragmento de sesión para rastrear filtraciones en capturas. */
  sessionTag?: string | null;
};

function formatStamp() {
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());
}

/**
 * Marca el examen de forma densa y dinámica. No bloquea capturas del SO,
 * pero cualquier screenshot hereda nombre, hora y aviso de uso exclusivo.
 */
export function ExamAntiLeakWatermark({ studentName, examTitle, sessionTag }: Props) {
  const [stamp, setStamp] = useState(formatStamp);

  useEffect(() => {
    const id = window.setInterval(() => setStamp(formatStamp()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const line = useMemo(() => {
    const parts = [studentName, examTitle, stamp];
    if (sessionTag) parts.push(`ID ${sessionTag}`);
    parts.push('NO COMPARTIR');
    return parts.join(' · ');
  }, [studentName, examTitle, stamp, sessionTag]);

  const tiles = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[2] overflow-hidden select-none"
    >
      <div className="absolute inset-0 bg-[repeating-linear-gradient(-42deg,transparent,transparent_40px,rgba(234,88,12,0.055)_40px,rgba(234,88,12,0.055)_80px)]" />
      {tiles.map((i) => (
        <span
          key={i}
          className="absolute whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-orange-950/30 sm:text-[11px]"
          style={{
            top: `${(i * 9.5) % 94}%`,
            left: `${(i * 14.5) % 68}%`,
            transform: `rotate(-26deg) translateX(${(i % 4) * 10}px)`,
          }}
        >
          {line}
        </span>
      ))}
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <p className="max-w-3xl text-center text-3xl font-black uppercase leading-none text-orange-600/[0.09] sm:text-5xl">
          CaliFácil · examen personal · captura no autorizada
        </p>
      </div>
    </div>
  );
}

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateExamUrl(examId: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/examen/${examId}`;
  }
  return `/examen/${examId}`;
}

export function calculatePercentage(score: number, maxScore: number): number {
  if (maxScore === 0) return 0;
  return Math.round((score / maxScore) * 100);
}

export function getGradeLabel(percentage: number): string {
  if (percentage >= 90) return 'Excelente';
  if (percentage >= 80) return 'Muy bien';
  if (percentage >= 70) return 'Bien';
  if (percentage >= 60) return 'Suficiente';
  return 'Necesita mejorar';
}

export function getGradeColor(percentage: number): string {
  if (percentage >= 90) return 'text-green-600';
  if (percentage >= 80) return 'text-orange-600';
  if (percentage >= 70) return 'text-yellow-600';
  if (percentage >= 60) return 'text-amber-700';
  return 'text-red-600';
}

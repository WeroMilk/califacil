'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useExams } from '@/hooks/useExams';
import { useGroups } from '@/hooks/useGroups';
import { ExamMiniPreview } from '@/components/exam-mini-preview';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  FileText,
  Users,
  TrendingUp,
  Plus,
  ArrowRight,
  Loader2,
  Calendar,
  CheckCircle,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

const RECENTS_MAX = 40;

export default function DashboardPage() {
  const { user } = useAuth();
  const { exams, loading: examsLoading } = useExams(user?.id);
  const { groups, loading: groupsLoading } = useGroups(user?.id);
  const recentsScrollRef = useRef<HTMLDivElement>(null);
  const didInitialRecentsAlignRef = useRef(false);
  const [stats, setStats] = useState({
    totalExams: 0,
    publishedExams: 0,
    totalGroups: 0,
    totalStudents: 0,
  });

  useEffect(() => {
    if (exams && groups) {
      setStats({
        totalExams: exams.length,
        publishedExams: exams.filter((e) => e.status === 'published').length,
        totalGroups: groups.length,
        totalStudents: 0,
      });
    }
  }, [exams, groups]);

  /** Más recientes a la derecha: API trae descendente; invertimos el tramo mostrado. */
  const recentExams = [...exams].slice(0, RECENTS_MAX).reverse();

  useEffect(() => {
    const el = recentsScrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [recentExams.length, examsLoading]);

  useEffect(() => {
    if (examsLoading || recentExams.length === 0 || didInitialRecentsAlignRef.current) return;
    const el = recentsScrollRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth - el.clientWidth;
      didInitialRecentsAlignRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [examsLoading, recentExams.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden sm:gap-3">
      <div className="shrink-0">
        <h1 className="text-xl font-bold text-gray-900 sm:text-3xl">Dashboard</h1>
        <p className="mt-0.5 text-xs text-gray-600 sm:text-base">
          Bienvenido de vuelta, {user?.email?.split('@')[0]}
        </p>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:gap-2 lg:grid-cols-4 lg:gap-3">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3">
            <CardTitle className="text-xs font-medium text-gray-600 sm:text-sm">
              Total Exámenes
            </CardTitle>
            <FileText className="h-3.5 w-3.5 shrink-0 text-orange-600 sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <div className="text-xl font-bold sm:text-2xl">
              {examsLoading ? <Loader2 className="h-5 w-5 animate-spin sm:h-6 sm:w-6" /> : stats.totalExams}
            </div>
            <p className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">Creados hasta la fecha</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3">
            <CardTitle className="text-xs font-medium text-gray-600 sm:text-sm">
              Activos
            </CardTitle>
            <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600 sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <div className="text-xl font-bold sm:text-2xl">
              {examsLoading ? <Loader2 className="h-5 w-5 animate-spin sm:h-6 sm:w-6" /> : stats.publishedExams}
            </div>
            <p className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">Publicados</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3">
            <CardTitle className="text-xs font-medium text-gray-600 sm:text-sm">
              Grupos
            </CardTitle>
            <Users className="h-3.5 w-3.5 shrink-0 text-purple-600 sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <div className="text-xl font-bold sm:text-2xl">
              {groupsLoading ? <Loader2 className="h-5 w-5 animate-spin sm:h-6 sm:w-6" /> : stats.totalGroups}
            </div>
            <p className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">Registrados</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3">
            <CardTitle className="text-xs font-medium text-gray-600 sm:text-sm">
              Promedio
            </CardTitle>
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-orange-600 sm:h-4 sm:w-4" />
          </CardHeader>
          <CardContent className="pb-3 pt-0">
            <div className="text-xl font-bold sm:text-2xl">--</div>
            <p className="mt-0.5 text-[10px] text-gray-500 sm:text-xs">General</p>
          </CardContent>
        </Card>
      </div>

      <div className="shrink-0">
        <h2 className="mb-1.5 text-xs font-semibold text-gray-900 sm:mb-2 sm:text-base">
          Acciones rápidas
        </h2>
        <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
          <Link href="/exams/create" className="min-w-0">
            <Button
              variant="outline"
              className="h-14 w-full flex-col gap-0.5 px-1 py-1.5 text-[10px] hover:bg-orange-50 hover:border-orange-300 sm:h-20 sm:gap-1 sm:py-2 sm:text-sm"
            >
              <Plus className="h-4 w-4 text-orange-600 sm:h-6 sm:w-6" />
              <span className="font-medium leading-tight">Nuevo examen</span>
            </Button>
          </Link>
          <Link href="/groups" className="min-w-0">
            <Button
              variant="outline"
              className="h-16 w-full flex-col gap-1 px-1 py-2 text-xs hover:bg-purple-50 hover:border-purple-300 sm:h-20 sm:text-sm"
            >
              <Users className="h-4 w-4 text-purple-600 sm:h-6 sm:w-6" />
              <span className="font-medium leading-tight">Grupos</span>
            </Button>
          </Link>
          <Link href="/exams" className="min-w-0">
            <Button
              variant="outline"
              className="h-16 w-full flex-col gap-1 px-1 py-2 text-xs hover:bg-green-50 hover:border-green-300 sm:h-20 sm:text-sm"
            >
              <TrendingUp className="h-4 w-4 text-green-600 sm:h-6 sm:w-6" />
              <span className="font-medium leading-tight">Resultados</span>
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 sm:text-base">Recientes</h2>
          <Link href="/exams">
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs text-orange-600 sm:text-sm">
              Ver todos
              <ArrowRight className="ml-1 h-3 w-3 sm:h-4 sm:w-4" />
            </Button>
          </Link>
        </div>

        {examsLoading ? (
          <div className="flex flex-1 items-center justify-center py-4">
            <Loader2 className="h-7 w-7 animate-spin text-orange-600 sm:h-8 sm:w-8" />
          </div>
        ) : recentExams.length === 0 ? (
          <Card className="flex min-h-0 flex-1 flex-col justify-center p-4 text-center shadow-sm sm:p-6">
            <FileText className="mx-auto mb-2 h-10 w-10 text-gray-300 sm:mb-3 sm:h-12 sm:w-12" />
            <h3 className="mb-1 text-base font-medium text-gray-900 sm:text-lg">No hay exámenes aún</h3>
            <p className="mb-3 text-xs text-gray-500 sm:text-sm">Crea tu primer examen para comenzar</p>
            <Link href="/exams/create">
              <Button size="sm" className="bg-orange-600 hover:bg-orange-700">
                <Plus className="mr-2 h-4 w-4" />
                Crear examen
              </Button>
            </Link>
          </Card>
        ) : (
          <div
            ref={recentsScrollRef}
            className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-300"
          >
            {recentExams.map((exam) => (
              <Card
                key={exam.id}
                className="flex w-[min(100%,280px)] shrink-0 flex-col shadow-sm sm:w-72"
              >
                <CardHeader className="space-y-1 pb-2 pt-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-2 text-sm font-semibold leading-tight sm:text-base">
                      {exam.title}
                    </CardTitle>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium sm:text-xs ${
                        exam.status === 'published'
                          ? 'bg-green-100 text-green-700'
                          : exam.status === 'draft'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {exam.status === 'published'
                        ? 'Publicado'
                        : exam.status === 'draft'
                          ? 'Borrador'
                          : 'Cerrado'}
                    </span>
                  </div>
                  <CardDescription className="line-clamp-2 text-xs">
                    {exam.description || 'Sin descripción'}
                  </CardDescription>
                </CardHeader>
                <div className="flex flex-1 flex-col justify-center px-4 pb-2 pt-0">
                  <ExamMiniPreview title={exam.title} />
                </div>
                <CardContent className="mt-auto flex flex-col pb-3 pt-0">
                  <div className="flex items-center gap-1 text-[10px] text-gray-500 sm:text-xs">
                    <Calendar className="h-3 w-3 shrink-0 sm:h-4 sm:w-4" />
                    <span className="truncate">{formatDate(exam.created_at)}</span>
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <Link href={`/exams/${exam.id}`} className="min-w-0 flex-1">
                      <Button variant="outline" size="sm" className="h-8 w-full text-xs sm:text-sm">
                        Detalles
                      </Button>
                    </Link>
                    {exam.status === 'published' && (
                      <Link href={`/exams/results/${exam.id}`} className="min-w-0 flex-1">
                        <Button size="sm" className="h-8 w-full bg-orange-600 text-xs hover:bg-orange-700 sm:text-sm">
                          Resultados
                        </Button>
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

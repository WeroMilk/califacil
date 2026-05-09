'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useExams } from '@/hooks/useExams';
import { useGroups } from '@/hooks/useGroups';
import { fetchTeacherExamAverageSummaries, type ExamAverageSummaryRow } from '@/lib/teacherExamAverages';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, TrendingUp, Users } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export default function PromediosPage() {
  const { user } = useAuth();
  const { exams, loading: examsLoading } = useExams(user?.id);
  const { groups } = useGroups(user?.id);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExamAverageSummaryRow[]>([]);

  const groupsById = useMemo(() => {
    return new Map(groups.map((g) => [g.id, g.name]));
  }, [groups]);

  useEffect(() => {
    if (!user?.id || examsLoading) return;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const { rows: next } = await fetchTeacherExamAverageSummaries(exams, groupsById);
        if (!cancelled) {
          setRows(next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        }
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [user?.id, examsLoading, exams, groupsById]);

  if (loading || examsLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-full w-full max-w-7xl space-y-4 pb-2 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Promedios</h1>
        <p className="mt-1 text-sm text-gray-600 sm:text-base">
          Promedio por grupo y promedio general de cada examen.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-gray-500">
            Aún no hay datos para calcular promedios.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((row) => (
            <Card key={row.examId}>
              <CardHeader className="space-y-1">
                <CardTitle className="line-clamp-2">{row.examTitle}</CardTitle>
                <CardDescription>Creado el {formatDate(row.createdAt)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-gray-500">Promedio general</p>
                    <p className="mt-1 flex items-center gap-1 text-xl font-bold text-orange-600">
                      <TrendingUp className="h-4 w-4" />
                      {row.overallAverage}%
                    </p>
                  </div>
                  <div className="rounded-lg border bg-white p-3">
                    <p className="text-xs text-gray-500">Alumnos calificados</p>
                    <p className="mt-1 flex items-center gap-1 text-xl font-bold text-gray-900">
                      <Users className="h-4 w-4" />
                      {row.totalStudents}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border">
                  <div className="grid grid-cols-12 border-b bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600">
                    <span className="col-span-6">Grupo</span>
                    <span className="col-span-3 text-center">Alumnos</span>
                    <span className="col-span-3 text-right">Promedio</span>
                  </div>
                  {row.groupAverages.map((g) => (
                    <div key={`${row.examId}-${g.groupId}`} className="grid grid-cols-12 px-3 py-2 text-sm">
                      <span className="col-span-6 truncate">{g.groupName}</span>
                      <span className="col-span-3 text-center text-gray-600">{g.studentsCount}</span>
                      <span className="col-span-3 text-right font-semibold text-orange-700">{g.average}%</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

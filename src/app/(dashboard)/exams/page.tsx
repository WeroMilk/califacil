'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useExams } from '@/hooks/useExams';
import { supabase } from '@/lib/supabase';
import { printExamDocument } from '@/lib/printExam';
import { downloadExamWord } from '@/lib/wordExam';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Plus,
  Search,
  Loader2,
  Calendar,
  BarChart3,
  MoreVertical,
  Trash2,
  Eye,
  Download,
  Printer,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { Exam, ExamWithQuestions } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

export default function ExamsPage() {
  const { user } = useAuth();
  const { exams, loading, deleteExam } = useExams(user?.id);
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'draft' | 'published' | 'closed'>('all');

  useEffect(() => {
    const status = searchParams.get('status');
    if (status === 'all' || status === 'draft' || status === 'published' || status === 'closed') {
      setFilterStatus(status);
    }
  }, [searchParams]);

  const filteredExams = exams.filter(exam => {
    const matchesSearch = exam.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         exam.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || exam.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleDelete = async (examId: string) => {
    const success = await deleteExam(examId);
    if (success) {
      toast.success('Examen eliminado');
    }
  };

  return (
    <div className="mx-auto min-h-full w-full max-w-7xl space-y-4 pb-2 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Exámenes</h1>
          <p className="mt-0.5 text-sm text-gray-600 sm:mt-1 sm:text-base">
            Gestiona tus exámenes y visualiza los resultados
          </p>
        </div>
        <Link href="/exams/create" className="shrink-0">
          <Button className="h-9 w-full bg-orange-600 text-sm hover:bg-orange-700 sm:h-10 sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Nuevo Examen
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar exámenes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1 pt-0.5 sm:mx-0 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-0">
          {(['all', 'draft', 'published', 'closed'] as const).map((status) => (
            <Button
              key={status}
              variant={filterStatus === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterStatus(status)}
              className={`shrink-0 text-xs sm:text-sm ${filterStatus === status ? 'bg-orange-600 hover:bg-orange-700' : ''}`}
            >
              {status === 'all' ? 'Todos' : 
               status === 'draft' ? 'Borradores' : 
               status === 'published' ? 'Publicados' : 'Cerrados'}
            </Button>
          ))}
        </div>
      </div>

      {/* Exams Grid */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-orange-600" />
        </div>
      ) : filteredExams.length === 0 ? (
        <Card className="p-8 text-center sm:p-12">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 mb-2">
            {searchTerm ? 'No se encontraron exámenes' : 'No hay exámenes aún'}
          </h3>
          <p className="text-gray-500 mb-6">
            {searchTerm ? 'Intenta con otra búsqueda' : 'Crea tu primer examen para comenzar'}
          </p>
          {!searchTerm && (
            <Link href="/exams/create">
              <Button className="bg-orange-600 hover:bg-orange-700">
                <Plus className="w-4 h-4 mr-2" />
                Crear Examen
              </Button>
            </Link>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-2 2xl:grid-cols-3">
          {filteredExams.map((exam) => (
            <ExamCard key={exam.id} exam={exam} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

async function fetchExamWithQuestions(examId: string): Promise<ExamWithQuestions | null> {
  const { data: examData, error: examError } = await supabase
    .from('exams')
    .select('*')
    .eq('id', examId)
    .single();
  if (examError || !examData) return null;
  const { data: questions, error: qError } = await supabase
    .from('questions')
    .select('*')
    .eq('exam_id', examId)
    .order('created_at', { ascending: true });
  if (qError) return null;
  return { ...examData, questions: questions ?? [] };
}

function ExamCard({
  exam,
  onDelete,
}: {
  exam: Exam;
  onDelete: (id: string) => void;
}) {
  const [menuBusy, setMenuBusy] = useState(false);
  const statusConfig = {
    draft: { label: 'Borrador', color: 'bg-yellow-100 text-yellow-700' },
    published: { label: 'Publicado', color: 'bg-green-100 text-green-700' },
    closed: { label: 'Cerrado', color: 'bg-gray-100 text-gray-700' },
  };

  const handleDeleteClick = () => {
    if (!window.confirm('¿Eliminar este examen? Esta acción no se puede deshacer.')) return;
    onDelete(exam.id);
  };

  const handleDownload = async () => {
    setMenuBusy(true);
    try {
      const full = await fetchExamWithQuestions(exam.id);
      if (!full) {
        toast.error('No se pudo cargar el examen');
        return;
      }
      if (full.questions.length === 0) {
        toast.error('El examen no tiene preguntas para descargar');
        return;
      }
      const base =
        exam.title.replace(/[^\w\s-áéíóúñÁÉÍÓÚÑ]/gi, '').slice(0, 60) || 'examen';
      const ok = await downloadExamWord(full, base, window.location.origin);
      if (ok) {
        toast.success('Word descargado');
      } else {
        toast.error('No se pudo generar el documento Word');
      }
    } finally {
      setMenuBusy(false);
    }
  };

  const handlePrint = async () => {
    setMenuBusy(true);
    try {
      const full = await fetchExamWithQuestions(exam.id);
      if (!full) {
        toast.error('No se pudo cargar el examen');
        return;
      }
      if (full.questions.length === 0) {
        toast.error('Agrega al menos una pregunta para imprimir');
        return;
      }
      const ok = printExamDocument(full);
      if (!ok) toast.error('Permite ventanas emergentes para imprimir');
    } finally {
      setMenuBusy(false);
    }
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-1 text-lg font-semibold">{exam.title}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {exam.description || 'Sin descripción'}
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 shrink-0 p-0" disabled={menuBusy}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDownload}>
                <Download className="mr-2 h-4 w-4" />
                Descargar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-4">
          <Badge className={statusConfig[exam.status].color}>{statusConfig[exam.status].label}</Badge>
        </div>

        <div className="mb-4 flex items-center gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {formatDate(exam.created_at)}
          </div>
        </div>

        <div className="flex gap-2 items-end">
          <Link href={`/exams/${exam.id}`} className="min-w-0 flex-1">
            <Button variant="outline" size="sm" className="h-9 w-full">
              <Eye className="mr-2 h-4 w-4" />
              Ver
            </Button>
          </Link>
          {exam.status === 'published' ? (
            <div className="flex min-w-0 flex-1 flex-col items-stretch">
              <div className="mb-1 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={handleDeleteClick}
                  aria-label="Eliminar examen"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Link href={`/exams/results/${exam.id}`} className="w-full">
                <Button size="sm" className="h-9 w-full bg-orange-600 hover:bg-orange-700">
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Resultados
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={handleDeleteClick}
                aria-label="Eliminar examen"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

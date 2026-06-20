import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type VoidedAttemptRow = {
  student_id: string;
  student_name: string;
  group_id: string | null;
  void_reason: string | null;
  started_at: string;
  closed_at: string;
  duration_seconds: number;
};

export type GrantExamRetakeResult =
  | { ok: true }
  | { ok: false; error: string; hint?: string };

export function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mapRpcGrantError(code: string | undefined): GrantExamRetakeResult {
  switch (code) {
    case 'not_voided':
      return { ok: false, error: 'Este intento ya no está anulado.' };
    case 'not_found':
      return { ok: false, error: 'No se encontró el intento del alumno.' };
    case 'not_allowed':
      return {
        ok: false,
        error: 'No tienes permiso para otorgar otra oportunidad en este examen.',
      };
    default:
      return { ok: false, error: code || 'No se pudo otorgar la segunda oportunidad.' };
  }
}

async function grantExamRetakeWithAdmin(
  admin: SupabaseClient,
  examId: string,
  studentId: string
): Promise<GrantExamRetakeResult> {
  const { data: attempt, error: attemptErr } = await admin
    .from('exam_attempts')
    .select('id, state')
    .eq('exam_id', examId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (attemptErr) return { ok: false, error: attemptErr.message };
  if (!attempt) return { ok: false, error: 'No se encontró el intento del alumno.' };
  if (attempt.state !== 'voided') {
    return { ok: false, error: 'Este intento ya no está anulado.' };
  }

  const { error: answersErr } = await admin
    .from('answers')
    .delete()
    .eq('exam_id', examId)
    .eq('student_id', studentId);
  if (answersErr) return { ok: false, error: answersErr.message };

  const { error: deleteErr } = await admin.from('exam_attempts').delete().eq('id', attempt.id);
  if (deleteErr) return { ok: false, error: deleteErr.message };

  return { ok: true };
}

export type ListVoidedAttemptsResult =
  | { ok: true; attempts: VoidedAttemptRow[] }
  | { ok: false; error: string; hint?: string };

async function listVoidedAttemptsWithAdmin(
  admin: SupabaseClient,
  examId: string,
  teacherId: string
): Promise<ListVoidedAttemptsResult> {
  const { data: exam, error: examErr } = await admin
    .from('exams')
    .select('teacher_id')
    .eq('id', examId)
    .maybeSingle();

  if (examErr) return { ok: false, error: examErr.message };
  if (!exam || exam.teacher_id !== teacherId) {
    return { ok: false, error: 'Examen no encontrado' };
  }

  const { data: rows, error: listErr } = await admin
    .from('exam_attempts')
    .select('student_id, void_reason, created_at, updated_at, students!inner(name, group_id)')
    .eq('exam_id', examId)
    .eq('state', 'voided')
    .order('updated_at', { ascending: false });

  if (listErr) return { ok: false, error: listErr.message };

  const attempts: VoidedAttemptRow[] = (rows ?? []).map((row) => {
    const rawStudent = row.students as
      | { name: string; group_id: string | null }
      | Array<{ name: string; group_id: string | null }>
      | null;
    const student = Array.isArray(rawStudent) ? rawStudent[0] : rawStudent;
    const started = String(row.created_at ?? '');
    const closed = String(row.updated_at ?? '');
    const durationSeconds = Math.max(
      0,
      Math.floor((new Date(closed).getTime() - new Date(started).getTime()) / 1000)
    );
    return {
      student_id: String(row.student_id),
      student_name: student?.name ?? 'Alumno',
      group_id: student?.group_id ?? null,
      void_reason: (row.void_reason as string | null) ?? null,
      started_at: started,
      closed_at: closed,
      duration_seconds: durationSeconds,
    };
  });

  return { ok: true, attempts };
}

export async function listVoidedExamAttempts(
  userScopedSupabase: SupabaseClient,
  examId: string,
  teacherId: string
): Promise<ListVoidedAttemptsResult> {
  const { data: ownedExam, error: ownedErr } = await userScopedSupabase
    .from('exams')
    .select('id')
    .eq('id', examId)
    .eq('teacher_id', teacherId)
    .maybeSingle();

  if (ownedErr) return { ok: false, error: ownedErr.message };
  if (!ownedExam) return { ok: false, error: 'Examen no encontrado' };

  const admin = createServiceRoleClient();
  if (admin) {
    return listVoidedAttemptsWithAdmin(admin, examId, teacherId);
  }

  const { data, error } = await userScopedSupabase.rpc('teacher_list_voided_attempts', {
    p_exam_id: examId,
  });

  if (error) {
    if (/function|does not exist/i.test(error.message)) {
      return {
        ok: false,
        error: 'Falta configurar la lista de exámenes anulados en Supabase.',
        hint: 'Ejecuta la migración 20260606110000_exam_attempt_events_retake.sql en el SQL Editor.',
      };
    }
    return {
      ok: false,
      error: error.message,
      hint: 'Agrega SUPABASE_SERVICE_ROLE_KEY en .env.local (Settings → API → service_role) y reinicia el servidor.',
    };
  }

  const payload = data as { ok?: boolean; attempts?: VoidedAttemptRow[]; error?: string } | null;
  if (payload?.ok) {
    return { ok: true, attempts: payload.attempts ?? [] };
  }

  if (payload?.error === 'not_allowed' || payload?.error === 'not_authenticated') {
    return {
      ok: false,
      error: 'No se pudo verificar tu sesión para listar exámenes anulados.',
      hint: 'Agrega SUPABASE_SERVICE_ROLE_KEY en .env.local y reinicia el servidor de desarrollo.',
    };
  }

  return {
    ok: false,
    error: payload?.error || 'No se pudieron cargar los exámenes anulados.',
    hint: 'Agrega SUPABASE_SERVICE_ROLE_KEY en .env.local y reinicia el servidor.',
  };
}

export async function grantExamRetake(
  userScopedSupabase: SupabaseClient,
  examId: string,
  studentId: string
): Promise<GrantExamRetakeResult> {
  const { data, error } = await userScopedSupabase.rpc('teacher_grant_exam_retake', {
    p_exam_id: examId,
    p_student_id: studentId,
  });

  if (!error) {
    const payload = data as { ok?: boolean; error?: string } | null;
    if (payload?.ok) return { ok: true };
    if (payload?.error && payload.error !== 'not_allowed') {
      return mapRpcGrantError(payload.error);
    }
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    if (error?.message && /function|does not exist/i.test(error.message)) {
      return {
        ok: false,
        error: 'Falta configurar la segunda oportunidad en Supabase.',
        hint: 'Ejecuta la migración 20260606110000_exam_attempt_events_retake.sql en el SQL Editor.',
      };
    }
    return {
      ok: false,
      error: error?.message || mapRpcGrantError((data as { error?: string } | null)?.error).error,
      hint: 'Configura SUPABASE_SERVICE_ROLE_KEY en el servidor para habilitar el respaldo de segunda oportunidad.',
    };
  }

  return grantExamRetakeWithAdmin(admin, examId, studentId);
}

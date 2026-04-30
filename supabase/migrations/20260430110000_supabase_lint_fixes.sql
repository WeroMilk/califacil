-- Fixes para warnings de Supabase lints:
-- 1) Function search_path mutable
-- 2) SECURITY DEFINER con permisos demasiado amplios
-- 3) RLS habilitado sin políticas en exam_attempts

-- ---------------------------------------------------------------------------
-- 1) Endurecer search_path en funciones
-- ---------------------------------------------------------------------------

alter function public.touch_teacher_billing_updated_at()
  set search_path = public, pg_temp;

alter function public.create_teacher_billing_row()
  set search_path = public, pg_temp;

alter function public.exam_allows_student(uuid, uuid, boolean)
  set search_path = public, pg_temp;

alter function public.student_answer_count(uuid, uuid)
  set search_path = public, pg_temp;

alter function public.get_student_exam_attempt(uuid, uuid, uuid)
  set search_path = public, pg_temp;

alter function public.start_student_exam_attempt(uuid, uuid, uuid)
  set search_path = public, pg_temp;

alter function public.void_student_exam_attempt(uuid, uuid, uuid, text)
  set search_path = public, pg_temp;

alter function public.complete_student_exam_attempt(uuid, uuid, uuid)
  set search_path = public, pg_temp;

alter function public.validate_open_answer_attempt(uuid, uuid, uuid, uuid)
  set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 2) Reducir EXECUTE en funciones SECURITY DEFINER
-- ---------------------------------------------------------------------------

-- Siempre quitar acceso por defecto de PUBLIC.
revoke all on function public.create_teacher_billing_row() from public;
revoke all on function public.exam_allows_student(uuid, uuid, boolean) from public;
revoke all on function public.student_answer_count(uuid, uuid) from public;
revoke all on function public.get_student_exam_attempt(uuid, uuid, uuid) from public;
revoke all on function public.start_student_exam_attempt(uuid, uuid, uuid) from public;
revoke all on function public.void_student_exam_attempt(uuid, uuid, uuid, text) from public;
revoke all on function public.complete_student_exam_attempt(uuid, uuid, uuid) from public;
revoke all on function public.validate_open_answer_attempt(uuid, uuid, uuid, uuid) from public;

-- Quitar acceso "signed-in users" donde no es necesario para flujo de alumnos QR.
revoke all on function public.exam_allows_student(uuid, uuid, boolean) from authenticated;
revoke all on function public.student_answer_count(uuid, uuid) from authenticated;
revoke all on function public.get_student_exam_attempt(uuid, uuid, uuid) from authenticated;
revoke all on function public.start_student_exam_attempt(uuid, uuid, uuid) from authenticated;
revoke all on function public.void_student_exam_attempt(uuid, uuid, uuid, text) from authenticated;
revoke all on function public.complete_student_exam_attempt(uuid, uuid, uuid) from authenticated;
revoke all on function public.validate_open_answer_attempt(uuid, uuid, uuid, uuid) from authenticated;

-- Trigger interno, no debe ser invocable por roles cliente.
revoke all on function public.create_teacher_billing_row() from anon, authenticated;

-- Flujos de examen público por QR (anon).
grant execute on function public.exam_allows_student(uuid, uuid, boolean) to anon;
grant execute on function public.student_answer_count(uuid, uuid) to anon;
grant execute on function public.get_student_exam_attempt(uuid, uuid, uuid) to anon;
grant execute on function public.start_student_exam_attempt(uuid, uuid, uuid) to anon;
grant execute on function public.void_student_exam_attempt(uuid, uuid, uuid, text) to anon;
grant execute on function public.complete_student_exam_attempt(uuid, uuid, uuid) to anon;
grant execute on function public.validate_open_answer_attempt(uuid, uuid, uuid, uuid) to anon;

-- ---------------------------------------------------------------------------
-- 3) RLS: exam_attempts tenía RLS ON sin políticas (lint)
-- ---------------------------------------------------------------------------

drop policy if exists exam_attempts_no_access_anon on public.exam_attempts;
create policy exam_attempts_no_access_anon
  on public.exam_attempts
  for all
  to anon
  using (false)
  with check (false);

drop policy if exists exam_attempts_no_access_authenticated on public.exam_attempts;
create policy exam_attempts_no_access_authenticated
  on public.exam_attempts
  for all
  to authenticated
  using (false)
  with check (false);

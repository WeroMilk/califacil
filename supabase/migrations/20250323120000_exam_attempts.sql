-- Intentos de examen (alumnos por QR): un intento por (examen, alumno).
-- Ejecuta este SQL en el editor SQL de Supabase si no usas CLI de migraciones.

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  state text not null check (state in ('in_progress', 'submitted', 'voided')),
  void_reason text,
  client_session uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, student_id)
);

create index if not exists exam_attempts_exam_student_idx
  on public.exam_attempts (exam_id, student_id);

alter table public.exam_attempts enable row level security;

-- Solo funciones SECURITY DEFINER (postgres) modifican la tabla.
revoke all on public.exam_attempts from anon, authenticated;

create or replace function public.get_student_exam_attempt(
  p_exam_id uuid,
  p_student_id uuid,
  p_session uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.exam_attempts%rowtype;
begin
  if not exists (
    select 1
    from public.exams ex
    join public.students st on st.group_id = ex.group_id
    where ex.id = p_exam_id
      and st.id = p_student_id
      and ex.status = 'published'
      and ex.group_id is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into r
  from public.exam_attempts
  where exam_id = p_exam_id and student_id = p_student_id;

  if not found then
    return jsonb_build_object('ok', true, 'state', 'none');
  end if;

  if r.state = 'voided' then
    return jsonb_build_object(
      'ok', true,
      'state', 'voided',
      'void_reason', r.void_reason
    );
  end if;

  if r.state = 'submitted' then
    return jsonb_build_object('ok', true, 'state', 'submitted');
  end if;

  if r.state = 'in_progress' then
    if p_session is not null and r.client_session = p_session then
      return jsonb_build_object('ok', true, 'state', 'in_progress', 'resume', true);
    else
      return jsonb_build_object('ok', true, 'state', 'in_progress', 'other_device', true);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'state', 'unknown');
end;
$$;

create or replace function public.start_student_exam_attempt(
  p_exam_id uuid,
  p_student_id uuid,
  p_session uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.exam_attempts%rowtype;
begin
  if not exists (
    select 1
    from public.exams ex
    join public.students st on st.group_id = ex.group_id
    where ex.id = p_exam_id
      and st.id = p_student_id
      and ex.status = 'published'
      and ex.group_id is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into r
  from public.exam_attempts
  where exam_id = p_exam_id and student_id = p_student_id;

  if not found then
    insert into public.exam_attempts (exam_id, student_id, state, client_session)
    values (p_exam_id, p_student_id, 'in_progress', p_session);
    return jsonb_build_object('ok', true, 'fresh', true);
  end if;

  if r.state = 'voided' then
    return jsonb_build_object(
      'ok', false,
      'error', 'voided',
      'void_reason', r.void_reason
    );
  end if;

  if r.state = 'submitted' then
    return jsonb_build_object('ok', false, 'error', 'already_submitted');
  end if;

  if r.state = 'in_progress' then
    if r.client_session = p_session then
      return jsonb_build_object('ok', true, 'resume', true);
    else
      return jsonb_build_object('ok', false, 'error', 'in_progress_other');
    end if;
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown');
end;
$$;

create or replace function public.void_student_exam_attempt(
  p_exam_id uuid,
  p_student_id uuid,
  p_session uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.exam_attempts
  set
    state = 'voided',
    void_reason = coalesce(nullif(trim(p_reason), ''), 'abandoned'),
    updated_at = now()
  where exam_id = p_exam_id
    and student_id = p_student_id
    and client_session = p_session
    and state = 'in_progress';

  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

create or replace function public.complete_student_exam_attempt(
  p_exam_id uuid,
  p_student_id uuid,
  p_session uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.exam_attempts
  set state = 'submitted', updated_at = now()
  where exam_id = p_exam_id
    and student_id = p_student_id
    and client_session = p_session
    and state = 'in_progress';

  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end;
$$;

grant execute on function public.get_student_exam_attempt(uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.start_student_exam_attempt(uuid, uuid, uuid) to anon, authenticated;
grant execute on function public.void_student_exam_attempt(uuid, uuid, uuid, text) to anon, authenticated;
grant execute on function public.complete_student_exam_attempt(uuid, uuid, uuid) to anon, authenticated;

-- Para permitir un nuevo intento (solo maestro / soporte), borrar la fila del alumno:
-- delete from public.exam_attempts where exam_id = '...' and student_id = '...';

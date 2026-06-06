-- Eventos de intento de examen + RPCs para registro (alumno) y retake (maestro).

create table if not exists public.exam_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts (id) on delete cascade,
  event_type text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists exam_attempt_events_attempt_id_created_idx
  on public.exam_attempt_events (attempt_id, created_at);

alter table public.exam_attempt_events enable row level security;

drop policy if exists exam_attempt_events_no_access_anon on public.exam_attempt_events;
create policy exam_attempt_events_no_access_anon
  on public.exam_attempt_events
  for all to anon
  using (false)
  with check (false);

drop policy if exists exam_attempt_events_no_access_authenticated on public.exam_attempt_events;
create policy exam_attempt_events_no_access_authenticated
  on public.exam_attempt_events
  for all to authenticated
  using (false)
  with check (false);

revoke all on public.exam_attempt_events from anon, authenticated;

-- Helper: verifica que auth.uid() es maestro del examen
create or replace function public.teacher_owns_exam(p_exam_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.exams e
    where e.id = p_exam_id
      and e.teacher_id = auth.uid()
  );
$$;

grant execute on function public.teacher_owns_exam(uuid) to authenticated;

-- Alumno: registrar evento durante intento activo
create or replace function public.log_exam_attempt_event(
  p_exam_id uuid,
  p_student_id uuid,
  p_session uuid,
  p_event_type text,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.exam_attempts%rowtype;
  v_attempt_id uuid;
begin
  if not public.exam_allows_student(p_exam_id, p_student_id, true) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into r
  from public.exam_attempts
  where exam_id = p_exam_id
    and student_id = p_student_id
    and client_session = p_session
    and state = 'in_progress';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_active_attempt');
  end if;

  insert into public.exam_attempt_events (attempt_id, event_type, metadata)
  values (r.id, trim(p_event_type), p_metadata);

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.log_exam_attempt_event(uuid, uuid, uuid, text, jsonb) to anon, authenticated;

-- Maestro: listar intentos anulados de un examen
create or replace function public.teacher_list_voided_attempts(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.teacher_owns_exam(p_exam_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'student_id', ea.student_id,
        'student_name', st.name,
        'group_id', st.group_id,
        'void_reason', ea.void_reason,
        'started_at', ea.created_at,
        'closed_at', ea.updated_at,
        'duration_seconds', extract(epoch from (ea.updated_at - ea.created_at))::int
      )
      order by ea.updated_at desc
    ),
    '[]'::jsonb
  ) into result
  from public.exam_attempts ea
  join public.students st on st.id = ea.student_id
  where ea.exam_id = p_exam_id
    and ea.state = 'voided';

  return jsonb_build_object('ok', true, 'attempts', result);
end;
$$;

grant execute on function public.teacher_list_voided_attempts(uuid) to authenticated;

-- Maestro: timeline del intento (últimos 10 s antes del cierre)
create or replace function public.teacher_get_attempt_timeline(
  p_exam_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.exam_attempts%rowtype;
  v_events jsonb;
  v_last10 jsonb;
begin
  if not public.teacher_owns_exam(p_exam_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into r
  from public.exam_attempts
  where exam_id = p_exam_id
    and student_id = p_student_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_type', e.event_type,
        'metadata', e.metadata,
        'created_at', e.created_at
      )
      order by e.created_at asc
    ),
    '[]'::jsonb
  ) into v_events
  from public.exam_attempt_events e
  where e.attempt_id = r.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_type', e.event_type,
        'metadata', e.metadata,
        'created_at', e.created_at
      )
      order by e.created_at asc
    ),
    '[]'::jsonb
  ) into v_last10
  from public.exam_attempt_events e
  where e.attempt_id = r.id
    and e.created_at >= r.updated_at - interval '10 seconds'
    and e.created_at <= r.updated_at;

  return jsonb_build_object(
    'ok', true,
    'state', r.state,
    'void_reason', r.void_reason,
    'started_at', r.created_at,
    'closed_at', r.updated_at,
    'duration_seconds', extract(epoch from (r.updated_at - r.created_at))::int,
    'events', v_events,
    'last_10_seconds', v_last10
  );
end;
$$;

grant execute on function public.teacher_get_attempt_timeline(uuid, uuid) to authenticated;

-- Maestro: otorgar segunda oportunidad (borra respuestas e intento)
create or replace function public.teacher_grant_exam_retake(
  p_exam_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.exam_attempts%rowtype;
begin
  if not public.teacher_owns_exam(p_exam_id) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;

  select * into r
  from public.exam_attempts
  where exam_id = p_exam_id
    and student_id = p_student_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if r.state <> 'voided' then
    return jsonb_build_object('ok', false, 'error', 'not_voided');
  end if;

  delete from public.answers
  where exam_id = p_exam_id
    and student_id = p_student_id;

  delete from public.exam_attempts
  where id = r.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.teacher_grant_exam_retake(uuid, uuid) to authenticated;

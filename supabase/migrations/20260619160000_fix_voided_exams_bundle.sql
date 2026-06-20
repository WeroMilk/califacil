-- Pegar en Supabase → SQL Editor → Run (fix exámenes anulados).
-- Requiere haber ejecutado antes 20250323120000_exam_attempts.sql y 20260606110000_exam_attempt_events_retake.sql.

-- 1) Anular intento aunque cambie la sesión o el examen ya no esté "published"
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
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'abandoned');
begin
  update public.exam_attempts
  set state = 'voided', void_reason = v_reason, updated_at = now()
  where exam_id = p_exam_id and student_id = p_student_id
    and client_session = p_session and state = 'in_progress';
  get diagnostics n = row_count;

  if n = 0 then
    update public.exam_attempts
    set state = 'voided', void_reason = v_reason, updated_at = now()
    where exam_id = p_exam_id and student_id = p_student_id and state = 'in_progress';
    get diagnostics n = row_count;
  end if;

  return jsonb_build_object('ok', n > 0);
end;
$$;

grant execute on function public.void_student_exam_attempt(uuid, uuid, uuid, text) to anon;

-- 2) Listar anulados (maestro autenticado)
create or replace function public.teacher_list_voided_attempts(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  v_teacher_id uuid := auth.uid();
begin
  if v_teacher_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not exists (
    select 1 from public.exams e
    where e.id = p_exam_id and e.teacher_id = v_teacher_id
  ) then
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
        'duration_seconds', greatest(0, extract(epoch from (ea.updated_at - ea.created_at))::int)
      )
      order by ea.updated_at desc
    ),
    '[]'::jsonb
  ) into result
  from public.exam_attempts ea
  join public.students st on st.id = ea.student_id
  where ea.exam_id = p_exam_id and ea.state = 'voided';

  return jsonb_build_object('ok', true, 'attempts', result);
end;
$$;

grant execute on function public.teacher_list_voided_attempts(uuid) to authenticated;

-- 3) Verificar intentos anulados (opcional)
-- select ea.exam_id, ea.student_id, ea.state, ea.void_reason, ea.updated_at
-- from public.exam_attempts ea where ea.state = 'voided' order by ea.updated_at desc limit 20;

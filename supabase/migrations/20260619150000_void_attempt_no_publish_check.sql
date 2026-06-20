-- Anular intento activo sin exigir examen publicado ni coincidencia exacta de client_session.

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
  set
    state = 'voided',
    void_reason = v_reason,
    updated_at = now()
  where exam_id = p_exam_id
    and student_id = p_student_id
    and client_session = p_session
    and state = 'in_progress';

  get diagnostics n = row_count;

  if n = 0 then
    update public.exam_attempts
    set
      state = 'voided',
      void_reason = v_reason,
      updated_at = now()
    where exam_id = p_exam_id
      and student_id = p_student_id
      and state = 'in_progress';

    get diagnostics n = row_count;
  end if;

  return jsonb_build_object('ok', n > 0);
end;
$$;

grant execute on function public.void_student_exam_attempt(uuid, uuid, uuid, text) to anon;

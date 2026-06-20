-- Asegura que el maestro pueda borrar intentos anulados aunque RLS bloquee DELETE directo.
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

  perform set_config('row_security', 'off', true);

  delete from public.answers
  where exam_id = p_exam_id
    and student_id = p_student_id;

  delete from public.exam_attempts
  where id = r.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.teacher_grant_exam_retake(uuid, uuid) to authenticated;

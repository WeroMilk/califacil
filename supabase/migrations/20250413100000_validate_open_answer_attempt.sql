-- Valida que solo alumnos con intento en curso (mismo client_session) puedan usar la API de calificación de respuesta abierta.

create or replace function public.validate_open_answer_attempt(
  p_exam_id uuid,
  p_student_id uuid,
  p_session uuid,
  p_question_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  if not exists (
    select 1
    from public.exam_attempts ea
    where ea.exam_id = p_exam_id
      and ea.student_id = p_student_id
      and ea.state = 'in_progress'
      and ea.client_session = p_session
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_attempt');
  end if;

  if not exists (
    select 1
    from public.questions q
    where q.id = p_question_id
      and q.exam_id = p_exam_id
      and q.type = 'open_answer'
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_question');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.validate_open_answer_attempt(uuid, uuid, uuid, uuid) to anon, authenticated;

-- Lista de anulados vía RPC (no requiere leer exam_attempts con service_role desde la API).

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

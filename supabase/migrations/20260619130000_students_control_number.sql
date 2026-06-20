alter table public.students
  add column if not exists control_number text;

create index if not exists students_group_control_idx
  on public.students (group_id, control_number)
  where control_number is not null;

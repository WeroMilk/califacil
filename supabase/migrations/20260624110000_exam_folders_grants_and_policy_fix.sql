-- Corrige creación de carpetas: permisos para authenticated y política RLS sin recursión.
-- Ejecutar en Supabase SQL Editor si falla crear carpetas con error 500.

create table if not exists public.exam_folders (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.exam_folders (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint exam_folders_name_not_blank check (char_length(trim(name)) > 0)
);

create index if not exists exam_folders_teacher_parent_idx
  on public.exam_folders (teacher_id, parent_id);

alter table public.exams
  add column if not exists folder_id uuid references public.exam_folders (id) on delete set null;

create index if not exists exams_folder_id_idx on public.exams (folder_id);

alter table public.exam_folders enable row level security;

grant select, insert, update, delete on table public.exam_folders to authenticated;
grant select, insert, update, delete on table public.exam_folders to service_role;

create or replace function public.teacher_owns_exam_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.exam_folders f
    where f.id = p_folder_id
      and f.teacher_id = auth.uid()
  );
$$;

revoke all on function public.teacher_owns_exam_folder(uuid) from public;
grant execute on function public.teacher_owns_exam_folder(uuid) to authenticated;

drop policy if exists exam_folders_teacher_all on public.exam_folders;
drop policy if exists exam_folders_teacher_select on public.exam_folders;
drop policy if exists exam_folders_teacher_insert on public.exam_folders;
drop policy if exists exam_folders_teacher_update on public.exam_folders;
drop policy if exists exam_folders_teacher_delete on public.exam_folders;

create policy exam_folders_teacher_select on public.exam_folders
  for select
  using (teacher_id = auth.uid());

create policy exam_folders_teacher_insert on public.exam_folders
  for insert
  with check (
    teacher_id = auth.uid()
    and (
      parent_id is null
      or public.teacher_owns_exam_folder(parent_id)
    )
  );

create policy exam_folders_teacher_update on public.exam_folders
  for update
  using (teacher_id = auth.uid())
  with check (
    teacher_id = auth.uid()
    and (
      parent_id is null
      or public.teacher_owns_exam_folder(parent_id)
    )
  );

create policy exam_folders_teacher_delete on public.exam_folders
  for delete
  using (teacher_id = auth.uid());

notify pgrst, 'reload schema';

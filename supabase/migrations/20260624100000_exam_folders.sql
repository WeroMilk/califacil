-- Carpetas anidadas para organizar exámenes por maestro.

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

drop policy if exists exam_folders_teacher_all on public.exam_folders;

create policy exam_folders_teacher_all on public.exam_folders
  for all
  using (teacher_id = auth.uid())
  with check (
    teacher_id = auth.uid()
    and (
      parent_id is null
      or exists (
        select 1
        from public.exam_folders p
        where p.id = parent_id
          and p.teacher_id = auth.uid()
      )
    )
  );

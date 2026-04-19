-- Fotos de hoja clave del maestro (original + blur) por examen y hoja.

create table if not exists public.exam_key_images (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  sheet_index smallint not null check (sheet_index between 0 and 2),
  teacher_id uuid not null references auth.users (id) on delete cascade,
  original_path text not null,
  blur_path text not null,
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exam_id, sheet_index)
);

create index if not exists exam_key_images_exam_id_idx
  on public.exam_key_images (exam_id);

create index if not exists exam_key_images_teacher_id_idx
  on public.exam_key_images (teacher_id);

alter table public.exam_key_images enable row level security;

drop policy if exists exam_key_images_teacher_all on public.exam_key_images;

create policy exam_key_images_teacher_all on public.exam_key_images
  for all to authenticated
  using (
    teacher_id = auth.uid()
    and exists (
      select 1
      from public.exams e
      where e.id = exam_key_images.exam_id
        and e.teacher_id = auth.uid()
    )
  )
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1
      from public.exams e
      where e.id = exam_key_images.exam_id
        and e.teacher_id = auth.uid()
    )
  );

-- Bucket privado para fotos de hoja clave.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exam-key-photos',
  'exam-key-photos',
  false,
  7340032,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 7340032,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists exam_key_photos_insert on storage.objects;
drop policy if exists exam_key_photos_select on storage.objects;
drop policy if exists exam_key_photos_update on storage.objects;
drop policy if exists exam_key_photos_delete on storage.objects;

create policy exam_key_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'exam-key-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and exists (
      select 1
      from public.exams e
      where e.id::text = split_part(name, '/', 2)
        and e.teacher_id = auth.uid()
    )
  );

create policy exam_key_photos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exam-key-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and exists (
      select 1
      from public.exams e
      where e.id::text = split_part(name, '/', 2)
        and e.teacher_id = auth.uid()
    )
  );

create policy exam_key_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'exam-key-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and exists (
      select 1
      from public.exams e
      where e.id::text = split_part(name, '/', 2)
        and e.teacher_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'exam-key-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and exists (
      select 1
      from public.exams e
      where e.id::text = split_part(name, '/', 2)
        and e.teacher_id = auth.uid()
    )
  );

create policy exam_key_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'exam-key-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and exists (
      select 1
      from public.exams e
      where e.id::text = split_part(name, '/', 2)
        and e.teacher_id = auth.uid()
    )
  );

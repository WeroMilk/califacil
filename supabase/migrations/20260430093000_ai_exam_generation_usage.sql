create table if not exists public.ai_exam_generation_usage (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists ai_exam_generation_usage_teacher_created_idx
  on public.ai_exam_generation_usage (teacher_id, created_at desc);

alter table public.ai_exam_generation_usage enable row level security;

drop policy if exists ai_exam_generation_usage_select_own on public.ai_exam_generation_usage;
create policy ai_exam_generation_usage_select_own on public.ai_exam_generation_usage
for select to authenticated
using (teacher_id = auth.uid());

drop policy if exists ai_exam_generation_usage_insert_own on public.ai_exam_generation_usage;
create policy ai_exam_generation_usage_insert_own on public.ai_exam_generation_usage
for insert to authenticated
with check (teacher_id = auth.uid());

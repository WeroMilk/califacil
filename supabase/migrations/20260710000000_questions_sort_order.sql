-- Orden estable de preguntas por examen (independiente de created_at en inserciones por lote).

alter table public.questions
  add column if not exists sort_order integer;

with ranked as (
  select
    id,
    row_number() over (
      partition by exam_id
      order by created_at asc, id asc
    ) - 1 as rn
  from public.questions
)
update public.questions q
set sort_order = ranked.rn
from ranked
where q.id = ranked.id
  and q.sort_order is null;

update public.questions
set sort_order = 0
where sort_order is null;

alter table public.questions
  alter column sort_order set not null;

create index if not exists questions_exam_sort_order_idx
  on public.questions (exam_id, sort_order);

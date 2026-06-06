-- Valor ponderado por pregunta (default 1) y score decimal en respuestas.

alter table public.questions
  add column if not exists points numeric(6, 2) not null default 1
  check (points > 0);

alter table public.answers
  alter column score type numeric(6, 2) using score::numeric(6, 2);

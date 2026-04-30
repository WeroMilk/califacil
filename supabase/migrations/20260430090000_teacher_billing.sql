create table if not exists public.teacher_billing (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text not null default 'unpaid',
  plan_key text,
  current_period_end timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.touch_teacher_billing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_teacher_billing_updated_at on public.teacher_billing;
create trigger trg_teacher_billing_updated_at
before update on public.teacher_billing
for each row
execute function public.touch_teacher_billing_updated_at();

create or replace function public.create_teacher_billing_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.teacher_billing (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_teacher_billing on auth.users;
create trigger on_auth_user_created_teacher_billing
after insert on auth.users
for each row
execute function public.create_teacher_billing_row();

insert into public.teacher_billing (user_id)
select id from auth.users
on conflict (user_id) do nothing;

alter table public.teacher_billing enable row level security;

drop policy if exists teacher_billing_select_own on public.teacher_billing;
create policy teacher_billing_select_own on public.teacher_billing
for select to authenticated
using (user_id = auth.uid());

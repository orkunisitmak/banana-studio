-- Atomic per-user daily generation quota. The reservation is taken before the
-- provider request, so concurrent browser requests cannot spend the final slot
-- more than once. Failed provider calls may leave the slot reserved; that is a
-- deliberate conservative trade-off for a spending guardrail.
create table if not exists public.generation_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  used integer not null default 0 check (used >= 0),
  primary key (user_id, day)
);

alter table public.generation_quota enable row level security;

drop policy if exists "generation_quota_select_own" on public.generation_quota;
create policy "generation_quota_select_own"
  on public.generation_quota for select
  using (auth.uid() = user_id);

create or replace function public.reserve_generation_quota(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
begin
  if v_user is null or p_limit is null or p_limit < 1 then
    return false;
  end if;

  insert into public.generation_quota as quota (user_id, day, used)
  values (v_user, v_day, 1)
  on conflict (user_id, day) do update
    set used = quota.used + 1
    where quota.used < p_limit
  returning quota.used into v_used;

  return v_used is not null;
end;
$$;

revoke all on function public.reserve_generation_quota(integer) from public;
revoke all on function public.reserve_generation_quota(integer) from anon;
grant execute on function public.reserve_generation_quota(integer) to authenticated;

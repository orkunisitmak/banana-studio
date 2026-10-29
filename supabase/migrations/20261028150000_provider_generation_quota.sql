-- Per-provider daily guardrail, independent from the global daily quota.
create table if not exists public.generation_provider_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  provider text not null check (provider ~ '^[a-z0-9_-]{1,40}$'),
  used integer not null default 0 check (used >= 0),
  primary key (user_id, day, provider)
);

alter table public.generation_provider_quota enable row level security;

revoke all on public.generation_provider_quota from public, anon, authenticated;
grant select on public.generation_provider_quota to authenticated;

drop policy if exists "generation_provider_quota_select_own" on public.generation_provider_quota;
create policy "generation_provider_quota_select_own"
  on public.generation_provider_quota for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.reserve_generation_provider_quota(p_provider text, p_limit integer)
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
  if v_user is null or p_limit is null or p_limit < 1 or p_provider !~ '^[a-z0-9_-]{1,40}$' then
    return false;
  end if;

  insert into public.generation_provider_quota as quota (user_id, day, provider, used)
  values (v_user, v_day, p_provider, 1)
  on conflict (user_id, day, provider) do update
    set used = quota.used + 1
    where quota.used < p_limit
  returning quota.used into v_used;

  return v_used is not null;
end;
$$;

revoke all on function public.reserve_generation_provider_quota(text, integer) from public;
revoke all on function public.reserve_generation_provider_quota(text, integer) from anon;
grant execute on function public.reserve_generation_provider_quota(text, integer) to authenticated;

create or replace function public.release_generation_provider_quota(p_user_id uuid, p_provider text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_user_id is null or p_provider !~ '^[a-z0-9_-]{1,40}$' then
    return;
  end if;
  update public.generation_provider_quota
    set used = greatest(used - 1, 0)
    where user_id = p_user_id and day = v_day and provider = p_provider;
end;
$$;

revoke all on function public.release_generation_provider_quota(uuid, text) from public;
revoke all on function public.release_generation_provider_quota(uuid, text) from anon;
revoke all on function public.release_generation_provider_quota(uuid, text) from authenticated;
grant execute on function public.release_generation_provider_quota(uuid, text) to service_role;

-- Returns a reserved slot when the job was not actually admitted (queue full,
-- duplicate, session mismatch or an enqueue RPC failure). The caller is the
-- server-side service role, so the verified user id is passed explicitly.
drop function if exists public.release_generation_quota();

create or replace function public.release_generation_quota(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_user_id is null then
    return;
  end if;
  update public.generation_quota
    set used = greatest(used - 1, 0)
    where user_id = p_user_id and day = v_day;
end;
$$;

revoke all on function public.release_generation_quota(uuid) from public;
revoke all on function public.release_generation_quota(uuid) from anon;
revoke all on function public.release_generation_quota(uuid) from authenticated;
grant execute on function public.release_generation_quota(uuid) to service_role;

-- Server-side audit for media deletions. Client-declared audit events are not
-- accepted by the API, so the database records the authoritative event.
create or replace function public.audit_generation_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_events (user_id, action, target_type, target_id, metadata)
  values (old.user_id, 'media.deleted', 'generation', old.id, jsonb_build_object('source', 'database'));
  return old;
end;
$$;

drop trigger if exists generations_audit_delete on public.generations;
create trigger generations_audit_delete
  after delete on public.generations
  for each row execute function public.audit_generation_delete();

-- Service uploads during admin recovery have owner_id NULL. Grant access
-- using the private, server-written task registry, never a path prefix alone.
CREATE OR REPLACE FUNCTION private.can_access_media(object_name text, object_owner text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_authorized() AND (
    public.is_admin()
    OR coalesce(object_owner = (SELECT auth.uid())::text, false)
    OR EXISTS (SELECT 1 FROM private.legacy_media_owners l
      WHERE l.name = object_name AND l.user_id = (SELECT auth.uid()))
    OR (object_owner IS NULL AND EXISTS (
      SELECT 1 FROM private.openai_requests r
      WHERE r.user_id = (SELECT auth.uid()) AND r.kind = 'image' AND r.outcome = 'completed'
        AND r.generation_id = split_part(split_part(object_name, '/', 3), '.', 1)
        AND object_name IN (
          'openai/' || r.user_id::text || '/' || r.generation_id || '.png',
          'openai/' || r.user_id::text || '/' || r.generation_id || '.jpg',
          'openai/' || r.user_id::text || '/' || r.generation_id || '.webp')
    ))
    OR (object_owner IS NULL AND EXISTS (
      SELECT 1 FROM public.provider_tasks t
      WHERE t.user_id=(SELECT auth.uid()) AND t.provider='openrouter'
        AND object_name=t.user_id::text||'/openrouter-video/'||
          substring(t.task_id FROM '^bs_openrouter_seedance-2\.[05]_([a-zA-Z0-9_-]{1,128})$')||'.mp4'
    ))
  );
$$;
REVOKE ALL ON FUNCTION private.can_access_media(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_access_media(text,text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

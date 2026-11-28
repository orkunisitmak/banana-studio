-- Workers upload without a storage owner. Only the authenticated owner of the
-- server-registered image request can read the corresponding deterministic files.
CREATE OR REPLACE FUNCTION private.can_access_media(object_name text, object_owner text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_authorized() AND (
    public.is_admin() OR coalesce(object_owner = (SELECT auth.uid())::text, false)
    OR EXISTS (SELECT 1 FROM private.legacy_media_owners l WHERE l.name = object_name AND l.user_id = (SELECT auth.uid()))
    OR (object_owner IS NULL AND (
      EXISTS (SELECT 1 FROM private.openai_requests r WHERE r.user_id = (SELECT auth.uid()) AND r.kind = 'image' AND r.outcome = 'completed'
        AND r.generation_id = split_part(split_part(object_name, '/', 3), '.', 1)
        AND object_name = ANY (ARRAY(SELECT 'openai/' || r.user_id::text || '/' || r.generation_id || ext FROM unnest(ARRAY['.png','.jpg','.webp','.gif','.svg']) ext)))
      OR (split_part(object_name,'/',1) = (SELECT auth.uid())::text AND object_name ~ '^[0-9a-f-]+/seedream/[0-9a-f]{64}/[0-9]{1,2}\.(png|jpg)$'
        AND EXISTS (SELECT 1 FROM public.provider_tasks p WHERE p.provider = 'fal' AND p.user_id = (SELECT auth.uid()) AND
          encode(sha256(convert_to(p.task_id,'UTF8')),'hex') = split_part(object_name,'/',3)))
    ))
  );
$$;
REVOKE ALL ON FUNCTION private.can_access_media(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_access_media(text,text) TO anon, authenticated;

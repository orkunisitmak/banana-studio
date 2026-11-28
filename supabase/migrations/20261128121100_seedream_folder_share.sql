-- A share is a capability for the primary raster, not for a task's whole archive.
CREATE OR REPLACE FUNCTION public.resolve_folder_share(p_token_hash text, p_offset integer DEFAULT 0, p_media_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH shared AS (
    SELECT f.id, f.name, f.user_id, s.expires_at
    FROM public.folder_shares s
    JOIN public.folders f ON f.id = s.folder_id AND f.user_id = s.user_id
    JOIN auth.users u ON u.id = s.user_id
    WHERE (s.token_hash = p_token_hash OR s.legacy_token_hash = p_token_hash) AND s.expires_at > now()
      AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous, false)
      AND EXISTS (SELECT 1 FROM public.authorized_emails a
        WHERE lower(btrim(a.email)) = lower(btrim(u.email)) AND a.is_active)
      AND p_offset BETWEEN 0 AND 1000000
  ), media AS (
    SELECT g.id, g.created_at, original.name AS storage_path, thumbnail.name AS thumbnail_path
    FROM shared s
    JOIN public.generations g ON g.folder_id = s.id AND g.user_id = s.user_id
    JOIN storage.objects original ON original.bucket_id = 'media'
      AND original.name = coalesce(nullif(g.storage_path, ''), g.id || '.png')
      AND CASE WHEN g.image_model = 'seedream-5.5' AND g.task_id IS NOT NULL THEN
        g.status = 'completed' AND original.owner_id IS NULL
        AND EXISTS (SELECT 1 FROM public.provider_tasks p
          WHERE p.provider = 'fal' AND p.user_id = s.user_id AND p.task_id = g.task_id
            AND original.name = s.user_id::text || '/seedream/' || encode(sha256(convert_to(p.task_id, 'UTF8')), 'hex')
              || CASE original.metadata->>'mimetype' WHEN 'image/png' THEN '/0.png' WHEN 'image/jpeg' THEN '/0.jpg' END)
      ELSE
        original.owner_id = s.user_id::text OR EXISTS (
          SELECT 1 FROM private.legacy_media_owners l WHERE l.name = original.name AND l.user_id = s.user_id)
        OR (original.owner_id IS NULL AND original.name IN (
          'openai/' || s.user_id::text || '/' || g.id || '.png',
          'openai/' || s.user_id::text || '/' || g.id || '.jpg',
          'openai/' || s.user_id::text || '/' || g.id || '.webp')
          AND EXISTS (SELECT 1 FROM private.openai_requests r
            WHERE r.user_id = s.user_id AND r.generation_id = g.id
              AND r.kind = 'image' AND r.outcome = 'completed'))
      END
      AND original.metadata->>'mimetype' IN ('image/png', 'image/jpeg', 'image/webp', 'image/avif')
    LEFT JOIN storage.objects thumbnail ON thumbnail.bucket_id = 'media'
      -- The worker archives no thumbnail. Use the verified primary for previews as well.
      AND (g.image_model IS DISTINCT FROM 'seedream-5.5' OR g.task_id IS NULL)
      AND thumbnail.name = coalesce(nullif(g.thumbnail_path, ''), g.id || '_thumb.png')
      AND (thumbnail.owner_id = s.user_id::text OR EXISTS (
        SELECT 1 FROM private.legacy_media_owners l WHERE l.name = thumbnail.name AND l.user_id = s.user_id))
      AND thumbnail.metadata->>'mimetype' IN ('image/png', 'image/jpeg', 'image/webp', 'image/avif')
    WHERE g.type = 'image' AND (g.status IS NULL OR g.status = 'completed')
      AND (p_media_id IS NULL OR g.id = p_media_id)
    ORDER BY g.created_at DESC, g.id DESC
    LIMIT 49 OFFSET p_offset
  )
  SELECT jsonb_build_object('name', s.name, 'expiresAt', s.expires_at, 'images', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', m.id, 'storagePath', m.storage_path,
      'thumbnailPath', m.thumbnail_path) ORDER BY m.created_at DESC, m.id DESC) FROM media m
  ), '[]'::jsonb)) FROM shared s;
$$;
REVOKE ALL ON FUNCTION public.resolve_folder_share(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_folder_share(text, integer, text) TO service_role;

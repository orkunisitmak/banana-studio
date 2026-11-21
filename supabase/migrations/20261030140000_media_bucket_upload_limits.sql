-- Storage enforces these limits for direct and resumable uploads, independently
-- of browser checks. Keep the shared bucket compatible with images, video and
-- audio, including the 500 MiB reference-video workflow.
-- Preserve an operator's smaller size cap or explicit MIME allowlist. Supabase
-- treats both NULL and an empty MIME array as unrestricted.
UPDATE storage.buckets
SET file_size_limit = least(coalesce(file_size_limit, 524288000), 524288000),
    allowed_mime_types = CASE
      WHEN coalesce(cardinality(allowed_mime_types), 0) = 0
        THEN ARRAY['image/*', 'video/*', 'audio/*']::text[]
      ELSE allowed_mime_types
    END
WHERE id = 'media';

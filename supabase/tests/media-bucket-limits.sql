-- This checks bucket metadata, not the Supabase Storage HTTP implementation.
DO $$
DECLARE bucket storage.buckets;
BEGIN
 SELECT * INTO STRICT bucket FROM storage.buckets WHERE id='media';
 IF bucket.public IS DISTINCT FROM false THEN
  RAISE EXCEPTION 'Media bucket must stay private';
 END IF;
 IF bucket.file_size_limit IS DISTINCT FROM 524288000::bigint THEN
  RAISE EXCEPTION 'Media bucket must cap each object at 500 MiB';
 END IF;
 IF bucket.allowed_mime_types IS DISTINCT FROM ARRAY['image/*','video/*','audio/*']::text[] THEN
  RAISE EXCEPTION 'Media bucket must restrict uploads to images, video and audio';
 END IF;
END $$;

-- Keep the accepted attempt recoverable independently of a browser gallery
-- update. Deliberately no delete FK: deleting a gallery card must not erase
-- the server-owned record of the already submitted/billable provider task.
ALTER TABLE public.provider_tasks ADD COLUMN generation_id text;
ALTER TABLE public.provider_tasks ADD COLUMN task_metadata jsonb NOT NULL DEFAULT '{}'
 CHECK(jsonb_typeof(task_metadata)='object');
CREATE UNIQUE INDEX provider_tasks_generation_id_key ON public.provider_tasks(generation_id) WHERE generation_id IS NOT NULL;
-- Backfill only unambiguous, previously saved video associations.
UPDATE public.provider_tasks t SET generation_id=g.id,
 task_metadata=jsonb_strip_nulls(jsonb_build_object('generationProvider',t.provider,
  'falEndpoint',g.metadata->'falEndpoint','falQueueEndpoint',g.metadata->'falQueueEndpoint','h3MaxMode',g.metadata->'h3MaxMode'))
FROM public.generations g WHERE g.type='video' AND g.user_id=t.user_id AND g.task_id=t.task_id
 AND (SELECT count(*) FROM public.generations x WHERE x.type='video' AND x.user_id=t.user_id AND x.task_id=t.task_id)=1
 AND (SELECT count(*) FROM public.provider_tasks x WHERE x.user_id=t.user_id AND x.task_id=t.task_id)=1;

CREATE FUNCTION public.recover_video_tasks(p_generation_ids text[])
RETURNS TABLE(id text,task_id text,status text,metadata jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE caller uuid:=auth.uid(); admin boolean;
BEGIN
 IF caller IS NULL OR NOT public.is_authorized() THEN RAISE EXCEPTION 'Application access required' USING ERRCODE='42501';END IF;
 IF p_generation_ids IS NULL OR cardinality(p_generation_ids)>100 THEN RAISE EXCEPTION 'At most 100 generation IDs are required' USING ERRCODE='22023';END IF;
 admin:=public.is_admin();
 RETURN QUERY
 UPDATE public.generations g SET task_id=t.task_id,status='processing',metadata=coalesce(g.metadata,'{}'::jsonb)||t.task_metadata
 FROM public.provider_tasks t WHERE g.id=ANY(p_generation_ids) AND g.type='video' AND g.status IN('pending','processing')
  AND g.task_id IS NULL AND t.generation_id=g.id AND t.user_id=g.user_id AND (g.user_id=caller OR admin)
 RETURNING g.id,g.task_id,g.status,g.metadata;
END;
$$;
REVOKE ALL ON FUNCTION public.recover_video_tasks(text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.recover_video_tasks(text[]) TO authenticated;
NOTIFY pgrst, 'reload schema';

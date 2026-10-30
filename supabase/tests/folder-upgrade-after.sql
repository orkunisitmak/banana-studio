DO $$ BEGIN
 IF (SELECT count(*) FROM public.folders)<>5 OR (SELECT count(*) FROM public.generations)<>3 THEN
  RAISE EXCEPTION 'Upgrade deleted user records'; END IF;
 IF EXISTS(SELECT FROM public.generations WHERE id='foreign-image' AND folder_id IS NOT NULL)
  OR EXISTS(SELECT FROM public.folders WHERE id IN('foreign-child','cycle-a','cycle-b','self') AND parent_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Upgrade left invalid legacy associations'; END IF;
 IF NOT EXISTS(SELECT FROM public.provider_tasks WHERE task_id='legacy-video-task' AND generation_id='legacy-video'
  AND task_metadata->>'falEndpoint'='minimax/h3-max/text-to-video') THEN RAISE EXCEPTION 'Legacy video association was not backfilled';END IF;
 IF NOT EXISTS(SELECT FROM public.generations WHERE id='valid-image' AND folder_id='owner') THEN
  RAISE EXCEPTION 'Upgrade detached a valid association'; END IF;
END $$;

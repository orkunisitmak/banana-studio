DO $$ BEGIN
 IF EXISTS(SELECT FROM public.profiles) OR EXISTS(SELECT FROM public.authorized_emails) OR EXISTS(SELECT FROM public.generations) THEN RAISE EXCEPTION 'Fresh install contains account or media data';END IF;
 IF EXISTS(SELECT FROM storage.buckets WHERE id='media' AND public) THEN RAISE EXCEPTION 'Media bucket is public';END IF;
 IF EXISTS(SELECT FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity) THEN RAISE EXCEPTION 'An application table is missing row security';END IF;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('00000000-0000-4000-8000-000000000001','owner@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000002','member@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000003','outsider@example.invalid',now());
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.profiles WHERE role<>'user') THEN RAISE EXCEPTION 'OAuth registration granted admin';END IF;
 IF EXISTS(SELECT FROM public.authorized_emails) THEN RAISE EXCEPTION 'OAuth registration granted membership';END IF;
END $$;
INSERT INTO public.authorized_emails(email) VALUES('owner@example.invalid'),('member@example.invalid');
UPDATE public.profiles SET role='admin' WHERE email='owner@example.invalid';
INSERT INTO public.generations(id,user_id,prompt,created_at) VALUES ('owner-image','00000000-0000-4000-8000-000000000001','Synthetic owner image',1),('member-image','00000000-0000-4000-8000-000000000002','Synthetic member image',2);
INSERT INTO public.folders(id,user_id,name,created_at) VALUES
 ('owner-folder','00000000-0000-4000-8000-000000000001','Owner',1),
 ('member-folder','00000000-0000-4000-8000-000000000002','Member',1);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
SELECT set_config('request.jwt.claims','{"email":"member@example.invalid"}',false);
DO $$ DECLARE prefs jsonb; BEGIN
 IF NOT public.is_authorized() THEN RAISE EXCEPTION 'Invited user denied';END IF;
 IF public.is_admin() THEN RAISE EXCEPTION 'Member has admin rights';END IF;
 IF (SELECT count(*) FROM public.generations)<>1 THEN RAISE EXCEPTION 'Cross-owner gallery access';END IF;
 BEGIN
  UPDATE public.generations SET folder_id='owner-folder' WHERE id='member-image';
  RAISE EXCEPTION 'Cross-owner generation folder accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 BEGIN
  INSERT INTO public.folders(id,user_id,name,parent_id,created_at) VALUES('foreign-child',auth.uid(),'Child','owner-folder',1);
  RAISE EXCEPTION 'Cross-owner parent accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 INSERT INTO public.folders(id,user_id,name,parent_id,created_at) VALUES('member-child',auth.uid(),'Child','member-folder',1);
 BEGIN
  UPDATE public.folders SET parent_id='member-child' WHERE id='member-folder';
  RAISE EXCEPTION 'Folder cycle accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN
  UPDATE public.folders SET parent_id=id WHERE id='member-folder';
  RAISE EXCEPTION 'Self parent accepted';
 EXCEPTION WHEN check_violation THEN NULL;END;
 UPDATE public.generations SET folder_id='member-child' WHERE id='member-image';
 DELETE FROM public.folders WHERE id='member-folder';
 IF EXISTS(SELECT FROM public.folders WHERE id='member-child') OR
   EXISTS(SELECT FROM public.generations WHERE id='member-image' AND (folder_id IS NOT NULL OR user_id<>auth.uid()))
   THEN RAISE EXCEPTION 'Folder deletion damaged ownership or left descendants'; END IF;
 prefs:=public.get_text_model_preferences();IF prefs->>'model'<>'anthropic/claude-opus-5.5' OR prefs->>'reasoningEffort'<>'medium' THEN RAISE EXCEPTION 'Default preferences are incorrect';END IF;
 BEGIN
  UPDATE public.profiles SET role='admin' WHERE id=auth.uid();RAISE EXCEPTION 'Member could alter roles';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  INSERT INTO public.generations(id,user_id,created_at) VALUES('foreign','00000000-0000-4000-8000-000000000001',3);RAISE EXCEPTION 'Cross-owner write allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT set_config('request.jwt.claims','{"email":"outsider@example.invalid"}',false);
DO $$ BEGIN
 IF public.is_authorized() OR public.is_admin() THEN RAISE EXCEPTION 'Uninvited user authorized';END IF;
 IF EXISTS(SELECT FROM public.generations) THEN RAISE EXCEPTION 'Uninvited gallery access';END IF;
END $$;
RESET ROLE;
-- Unbilled image jobs: a lost lease is retried with a bound, and a 429 whose
-- deferral was lost is requeued. Any other dispatched job is only observed.
INSERT INTO auth.sessions(id,user_id) VALUES('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-000000000002');
DO $$ DECLARE member uuid:='00000000-0000-4000-8000-000000000002'; session uuid:='00000000-0000-4000-8000-0000000000a2';
 payload jsonb:='{"displayPrompt":"Synthetic","aspectRatio":"1:1","resolution":"1K","model":"gpt-image-2.5-sunburst"}'; c jsonb; token uuid; attempt integer; j private.image_jobs;
BEGIN
 BEGIN
  PERFORM public.enqueue_image_job(member,session,'foreign-folder-job',payload||'{"folderId":"owner-folder"}'::jsonb,'{}');
  RAISE EXCEPTION 'Server enqueue accepted a foreign folder';
 EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 IF EXISTS(SELECT FROM private.image_jobs WHERE id='foreign-folder-job') OR EXISTS(SELECT FROM public.generations WHERE id='foreign-folder-job')
  THEN RAISE EXCEPTION 'Foreign-folder enqueue left partial state'; END IF;
 PERFORM public.enqueue_image_job(member,session,'slow-job',payload,'{}');
 FOR attempt IN 1..5 LOOP
  token:=gen_random_uuid();c:=public.claim_image_job('slow-job',member,token);
  IF c->>'action'<>'prepare' THEN RAISE EXCEPTION 'Lost lease was not reclaimed: %',c;END IF;
  UPDATE private.image_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id='slow-job';
  IF public.dispatch_image_job('slow-job',token,'{}') THEN RAISE EXCEPTION 'Expired lease dispatched';END IF;
 END LOOP;
 IF (SELECT prepare_attempts FROM private.image_jobs WHERE id='slow-job')<>5 THEN RAISE EXCEPTION 'Preparation attempts were not counted';END IF;
 IF public.claim_image_job('slow-job',member,gen_random_uuid())->>'action'<>'stop' THEN RAISE EXCEPTION 'Preparation retries are unbounded';END IF;
 IF (SELECT state FROM private.image_jobs WHERE id='slow-job')<>'failed' OR (SELECT status FROM public.generations WHERE id='slow-job')<>'failed'
  THEN RAISE EXCEPTION 'Bounded preparation did not fail the job';END IF;
 IF EXISTS(SELECT FROM private.openai_requests WHERE generation_id='slow-job' AND outcome<>'rejected') THEN RAISE EXCEPTION 'Unsent preparation kept an open audit';END IF;

 PERFORM public.enqueue_image_job(member,session,'refused-job',payload,'{}');
 token:=gen_random_uuid();c:=public.claim_image_job('refused-job',member,token);
 UPDATE private.image_jobs SET prepare_attempts=4 WHERE id='refused-job';
 IF NOT public.dispatch_image_job('refused-job',token,'{}') THEN RAISE EXCEPTION 'Valid lease was refused';END IF;
 IF (SELECT prepare_attempts FROM private.image_jobs WHERE id='refused-job')<>0 THEN RAISE EXCEPTION 'Dispatch did not reset preparation attempts';END IF;
 PERFORM public.finish_openai_request((c->>'audit')::uuid,'rejected',NULL,429);
 c:=public.claim_image_job('refused-job',member,gen_random_uuid());
 SELECT * INTO j FROM private.image_jobs WHERE id='refused-job';
 IF c->>'action'<>'wait' OR j.state<>'queued' OR j.dispatched_at IS NOT NULL OR j.claim_token IS NOT NULL OR j.audit_id IS NOT NULL
  OR (SELECT status FROM public.generations WHERE id='refused-job')<>'pending' THEN RAISE EXCEPTION 'Refused dispatch was not requeued: %',c;END IF;
 UPDATE private.image_jobs SET not_before=clock_timestamp() WHERE id='refused-job';
 UPDATE private.image_provider_cooldown SET not_before=clock_timestamp() WHERE singleton;
 IF public.claim_image_job('refused-job',member,gen_random_uuid())->>'action'<>'prepare' THEN RAISE EXCEPTION 'Requeued job could not be prepared';END IF;

 PERFORM public.enqueue_image_job(member,session,'billed-job',payload,'{}');
 token:=gen_random_uuid();c:=public.claim_image_job('billed-job',member,token);
 PERFORM public.dispatch_image_job('billed-job',token,'{}');
 PERFORM public.finish_openai_request((c->>'audit')::uuid,'failed',NULL,429);
 IF public.claim_image_job('billed-job',member,gen_random_uuid())->>'action'<>'observe' THEN RAISE EXCEPTION 'A possibly billed dispatch was requeued';END IF;
 PERFORM public.enqueue_image_job(member,session,'sent-job',payload,'{}');
 token:=gen_random_uuid();PERFORM public.claim_image_job('sent-job',member,token);
 PERFORM public.dispatch_image_job('sent-job',token,'{}');
 IF public.claim_image_job('sent-job',member,gen_random_uuid())->>'action'<>'observe' THEN RAISE EXCEPTION 'An accepted dispatch was requeued';END IF;
END $$;

-- Durable refusal metadata must survive the deferral RPC being unavailable.
DO $$ DECLARE member uuid:='00000000-0000-4000-8000-000000000002'; session uuid:='00000000-0000-4000-8000-0000000000a2';
 payload jsonb:='{"displayPrompt":"Synthetic","aspectRatio":"1:1","resolution":"1K","model":"gpt-image-2.5-sunburst"}'; c jsonb; token uuid; before_retry timestamptz;
BEGIN
 -- Remove only synthetic jobs' global cooldown between independent scenarios.
 UPDATE private.image_provider_cooldown SET not_before='-infinity',reason='rate';
 PERFORM public.enqueue_image_job(member,session,'quota-refusal',payload,'{}');
 token:=gen_random_uuid();c:=public.claim_image_job('quota-refusal',member,token);
 PERFORM public.dispatch_image_job('quota-refusal',token,'{}');
 PERFORM public.finish_openai_request((c->>'audit')::uuid,'rejected',NULL,429,7200,'quota');
 c:=public.claim_image_job('quota-refusal',member,gen_random_uuid());
 IF c->>'action'<>'wait' OR (c->>'retryAfter')::integer<7199 THEN RAISE EXCEPTION 'Lost deferral forgot quota/Retry-After: %',c;END IF;
 IF (SELECT metadata->>'imageQueueWaitReason' FROM public.generations WHERE id='quota-refusal')<>'quota'
  THEN RAISE EXCEPTION 'Lost deferral forgot quota reason';END IF;
 IF (SELECT count(*) FROM private.openai_requests WHERE generation_id='quota-refusal' AND outcome='rejected')<>1
  THEN RAISE EXCEPTION 'Rejected attempts lost their anti-abuse ledger';END IF;
 -- Global cooldown can be longer than the refusing request's own delay.
 before_retry:=clock_timestamp()+interval '3 hours';
 UPDATE private.image_provider_cooldown SET not_before=before_retry,reason='quota';
 UPDATE private.image_jobs SET state='dispatched',dispatched_at=clock_timestamp(),audit_id=(SELECT id FROM private.openai_requests WHERE generation_id='quota-refusal') WHERE id='quota-refusal';
 c:=public.claim_image_job('quota-refusal',member,gen_random_uuid());
 IF (c->>'retryAfter')::integer<10799 OR (SELECT not_before FROM private.image_jobs WHERE id='quota-refusal')<before_retry
  THEN RAISE EXCEPTION 'Lost deferral ignored global cooldown: %',c;END IF;
 -- A shorter rate refusal must keep a longer quota cooldown and its reason.
 UPDATE private.image_provider_cooldown SET not_before='-infinity',reason='rate';
 PERFORM public.enqueue_image_job(member,session,'normal-rate-refusal',payload,'{}');
 token:=gen_random_uuid();c:=public.claim_image_job('normal-rate-refusal',member,token);
 PERFORM public.dispatch_image_job('normal-rate-refusal',token,'{}');
 UPDATE private.image_provider_cooldown SET not_before=before_retry,reason='quota';
 IF NOT public.defer_refused_image_job('normal-rate-refusal',token,90,'req_synthetic','rate') THEN RAISE EXCEPTION 'Valid rate refusal not deferred';END IF;
 IF (SELECT reason FROM private.image_provider_cooldown WHERE singleton)<>'quota'
  OR (SELECT not_before FROM private.image_jobs WHERE id='normal-rate-refusal')<before_retry THEN
   RAISE EXCEPTION 'Shorter deferral overwrote a longer quota cooldown';END IF;
 IF (SELECT retry_not_before FROM private.openai_requests WHERE id=(c->>'audit')::uuid)<clock_timestamp()+interval '89 seconds'
  THEN RAISE EXCEPTION 'Successful deferral lost durable provider deadline';END IF;
 UPDATE private.image_provider_cooldown SET not_before='-infinity',reason='rate';
 PERFORM public.enqueue_image_job(member,session,'normal-quota-refusal',payload,'{}');
 token:=gen_random_uuid();c:=public.claim_image_job('normal-quota-refusal',member,token);
 PERFORM public.dispatch_image_job('normal-quota-refusal',token,'{}');
 IF NOT public.defer_refused_image_job('normal-quota-refusal',token,3600,'req_synthetic','quota') THEN RAISE EXCEPTION 'Valid quota refusal not deferred';END IF;
 IF (SELECT reason FROM private.image_provider_cooldown WHERE singleton)<>'quota'
  OR (SELECT wait_reason FROM private.openai_requests WHERE id=(c->>'audit')::uuid)<>'quota'
  OR (SELECT metadata->>'imageQueueWaitReason' FROM public.generations WHERE id='normal-quota-refusal')<>'quota' THEN
   RAISE EXCEPTION 'Quota deferral forgot wait reason';END IF;
 -- All rejected attempts still count toward the existing per-user daily limit.
 INSERT INTO private.openai_requests(id,user_id,session_id,kind,generation_id,started_at,outcome,finished_at)
 SELECT gen_random_uuid(),member,session,'text',NULL,clock_timestamp()-interval '2 minutes','rejected',clock_timestamp()
 FROM generate_series(1,400);
 c:=public.start_openai_request(gen_random_uuid(),member,session,'text',NULL);
 IF c->>'reason'<>'daily' OR (c->>'allowed')::boolean THEN RAISE EXCEPTION 'Rejected requests bypassed anti-abuse limits';END IF;
END $$;
INSERT INTO public.authorized_emails(email) VALUES('outsider@example.invalid');
-- An admin recovery upload has no authenticated storage owner. The original
-- task owner must still be able to re-sign it after the first URL expires.
INSERT INTO public.provider_tasks(provider,task_id,user_id) VALUES
 ('openrouter','bs_openrouter_seedance-2.5_ownerless','00000000-0000-4000-8000-000000000002');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
 ('media','00000000-0000-4000-8000-000000000002/openrouter-video/ownerless.mp4',NULL),
 ('media','00000000-0000-4000-8000-000000000002/openrouter-video/unregistered.mp4',NULL);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM storage.objects WHERE name='00000000-0000-4000-8000-000000000002/openrouter-video/ownerless.mp4')
  THEN RAISE EXCEPTION 'Task owner cannot read admin-recovered video';END IF;
 IF EXISTS(SELECT FROM storage.objects WHERE name LIKE '%/unregistered.mp4') THEN
  RAISE EXCEPTION 'Task ownership check trusts path alone';END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 IF EXISTS(SELECT FROM storage.objects WHERE name LIKE '%/ownerless.mp4') THEN RAISE EXCEPTION 'Foreign video accessible';END IF;
END $$;
RESET ROLE;
-- Recovery attaches only a server-registered task to its exact existing owner
-- row, merges endpoints, and never revives deleted or terminal generations.
INSERT INTO public.generations(id,user_id,type,status,created_at,metadata) VALUES
 ('accepted-video','00000000-0000-4000-8000-000000000002','video','processing',1,'{"originalPrompt":"Keep me"}'),
 ('terminal-video','00000000-0000-4000-8000-000000000002','video','completed',1,'{}'),
 ('foreign-video','00000000-0000-4000-8000-000000000001','video','pending',1,'{}');
INSERT INTO public.provider_tasks(provider,task_id,user_id,generation_id,task_metadata) VALUES
 ('fal','recovered-video-task','00000000-0000-4000-8000-000000000002','accepted-video','{"falEndpoint":"minimax/h3-max/text-to-video","falQueueEndpoint":"minimax/h3-max"}'),
 ('fal','terminal-video-task','00000000-0000-4000-8000-000000000002','terminal-video','{}'),
 ('fal','deleted-video-task','00000000-0000-4000-8000-000000000002','deleted-video','{}'),
 ('fal','foreign-video-task','00000000-0000-4000-8000-000000000001','foreign-video','{}');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
DO $$ DECLARE recovered integer; BEGIN
 SELECT count(*) INTO recovered FROM public.recover_video_tasks(ARRAY['accepted-video','terminal-video','deleted-video','foreign-video']);
 IF recovered<>1 THEN RAISE EXCEPTION 'Recovery touched a deleted, foreign or terminal row';END IF;
 IF NOT EXISTS(SELECT FROM public.generations WHERE id='accepted-video' AND task_id='recovered-video-task' AND status='processing'
  AND metadata->>'originalPrompt'='Keep me' AND metadata->>'falQueueEndpoint'='minimax/h3-max') THEN RAISE EXCEPTION 'Accepted video task was not recovered with metadata';END IF;
 IF EXISTS(SELECT FROM public.recover_video_tasks(ARRAY['accepted-video'])) THEN RAISE EXCEPTION 'Recovery rewrote an existing association';END IF;
 BEGIN
  PERFORM public.recover_video_tasks(array_fill('x'::text,ARRAY[101]));RAISE EXCEPTION 'Recovery batch was unbounded';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.generations WHERE id='deleted-video') OR
  NOT EXISTS(SELECT FROM public.generations WHERE id='terminal-video' AND status='completed' AND task_id IS NULL)
  OR NOT EXISTS(SELECT FROM public.generations WHERE id='foreign-video' AND task_id IS NULL) THEN RAISE EXCEPTION 'Recovery changed protected rows';END IF;
END $$;
UPDATE public.generations SET task_id=NULL WHERE id='accepted-video';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.recover_video_tasks(ARRAY['accepted-video']))<>1 THEN RAISE EXCEPTION 'Active admin could not recover a requested member task';END IF;
END $$;
RESET ROLE;
UPDATE public.authorized_emails SET is_active=false WHERE email='outsider@example.invalid';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
DO $$ BEGIN
 BEGIN
  PERFORM public.recover_video_tasks(ARRAY['foreign-video']);RAISE EXCEPTION 'Uninvited caller could execute task recovery';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;

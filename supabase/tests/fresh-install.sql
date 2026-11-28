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
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
SELECT set_config('request.jwt.claims','{"email":"member@example.invalid"}',false);
DO $$ DECLARE prefs jsonb; BEGIN
 IF NOT public.is_authorized() THEN RAISE EXCEPTION 'Invited user denied';END IF;
 IF public.is_admin() THEN RAISE EXCEPTION 'Member has admin rights';END IF;
 IF (SELECT count(*) FROM public.generations)<>1 THEN RAISE EXCEPTION 'Cross-owner gallery access';END IF;
 prefs:=public.get_text_model_preferences();IF prefs->>'model'<>'claude-opus-5.5' OR prefs->>'reasoningEffort'<>'medium' OR prefs->'featureModels'<>'{}'::jsonb THEN RAISE EXCEPTION 'Default preferences are incorrect';END IF;
 prefs:=public.save_text_model_preferences('me','gemini-4-hydrogen','HIGH','high',auth.uid(),'{"variation":"gpt-6.2-sol"}'::jsonb);
 IF prefs->'featureModels'->>'variation' IS DISTINCT FROM 'gpt-6.2-sol' OR prefs->>'source' IS DISTINCT FROM 'personal' THEN RAISE EXCEPTION 'Feature override not saved';END IF;
 BEGIN
  PERFORM public.save_text_model_preferences('me','gemini-4-hydrogen','HIGH','high',auth.uid(),'{"bad":"gpt-6.2-sol"}'::jsonb); RAISE EXCEPTION 'Invalid feature saved';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF public.get_provider_preferences(auth.uid()) <> '{}'::jsonb THEN RAISE EXCEPTION 'Fresh model routing must use catalog defaults'; END IF;
 PERFORM public.save_provider_preference(auth.uid(),'seedance-2.5','off');
 PERFORM public.save_provider_preference(auth.uid(),'seedance-2.5','fal',true);
 PERFORM public.save_provider_preference(auth.uid(),'minimax-h3','evolink');
 IF public.get_provider_preferences() <> '{"seedance-2.5":"off","minimax-h3":"evolink"}'::jsonb THEN RAISE EXCEPTION 'Route migration overwrote a newer preference'; END IF;
 IF (public.get_provider_preferences(auth.uid(),true)->>'canManage')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Member offered admin policy controls'; END IF;
 BEGIN
  PERFORM public.save_workspace_provider_policy(auth.uid(),'minimax-h3','off'); RAISE EXCEPTION 'Member edited workspace routing';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE private.model_provider_preferences SET provider = 'off' WHERE user_id IS NULL; RAISE EXCEPTION 'Member had direct workspace policy write access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.save_provider_preference(auth.uid(),'magi-2','fal'); RAISE EXCEPTION 'Foreign provider saved';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.save_provider_preference(auth.uid(),'gpt-image-2.5-sunburst','codex'); RAISE EXCEPTION 'Desktop-only route saved in hosted account';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.save_provider_preference('00000000-0000-4000-8000-000000000001','seedance-2.5','fal'); RAISE EXCEPTION 'Cross-account route changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.profiles SET role='admin' WHERE id=auth.uid();RAISE EXCEPTION 'Member could alter roles';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  INSERT INTO public.generations(id,user_id,created_at) VALUES('foreign','00000000-0000-4000-8000-000000000001',3);RAISE EXCEPTION 'Cross-owner write allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$ BEGIN
 IF public.get_provider_preferences() <> '{}'::jsonb THEN RAISE EXCEPTION 'Model settings leaked across accounts'; END IF;
 IF (public.get_provider_preferences(auth.uid(),true)->>'canManage')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Missing admin policy controls'; END IF;
 PERFORM public.save_workspace_provider_policy(auth.uid(),'minimax-h3','fal');
 PERFORM public.save_workspace_provider_policy(auth.uid(),'seedance-2.5','fal');
 PERFORM public.save_workspace_provider_policy(auth.uid(),'magi-2','off');
 BEGIN
  PERFORM public.save_workspace_provider_policy(auth.uid(),'magi-2','fal'); RAISE EXCEPTION 'Workspace pinned an unsupported provider';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.save_workspace_provider_policy(auth.uid(),'minimax-h3','auto'); RAISE EXCEPTION 'Auto accepted as a pinned workspace policy';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  PERFORM public.save_workspace_provider_policy('00000000-0000-4000-8000-000000000002','minimax-h3',NULL); RAISE EXCEPTION 'Stale admin session cleared policy';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
DO $$ DECLARE snapshot jsonb; BEGIN
 PERFORM public.save_provider_preference(auth.uid(),'magi-2','evolink');
 snapshot := public.get_provider_preferences(auth.uid(),true);
 IF snapshot->'preferences' IS DISTINCT FROM '{"minimax-h3":"fal","seedance-2.5":"off","magi-2":"off"}'::jsonb
    OR snapshot->'personal'->>'minimax-h3' IS DISTINCT FROM 'evolink'
    OR snapshot->'policy'->>'seedance-2.5' IS DISTINCT FROM 'fal'
    OR public.get_provider_preferences() IS DISTINCT FROM snapshot->'preferences' THEN RAISE EXCEPTION 'Effective workspace policy is inconsistent'; END IF;
 BEGIN
  PERFORM public.save_workspace_provider_policy(auth.uid(),'magi-2',NULL); RAISE EXCEPTION 'Member cleared workspace policy';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
SELECT public.save_workspace_provider_policy(auth.uid(),'minimax-h3',NULL);
SELECT public.save_workspace_provider_policy(auth.uid(),'magi-2',NULL);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 IF public.get_provider_preferences() IS DISTINCT FROM '{"minimax-h3":"evolink","magi-2":"evolink","seedance-2.5":"off"}'::jsonb THEN RAISE EXCEPTION 'Clearing workspace policy did not restore personal choices'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT set_config('request.jwt.claims','{"email":"outsider@example.invalid"}',false);
DO $$ BEGIN
 IF public.is_authorized() OR public.is_admin() THEN RAISE EXCEPTION 'Uninvited user authorized';END IF;
 IF EXISTS(SELECT FROM public.generations) THEN RAISE EXCEPTION 'Uninvited gallery access';END IF;
 BEGIN
  PERFORM public.get_provider_preferences(); RAISE EXCEPTION 'Uninvited preference access';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Unbilled image jobs: a lost lease is retried with a bound, and a 429 whose
-- deferral was lost is requeued. Any other dispatched job is only observed.
INSERT INTO auth.sessions(id,user_id) VALUES('00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-000000000002');
DO $$ DECLARE member uuid:='00000000-0000-4000-8000-000000000002'; session uuid:='00000000-0000-4000-8000-0000000000a2';
 payload jsonb:='{"displayPrompt":"Synthetic","aspectRatio":"1:1","resolution":"1K","model":"gpt-image-2.5-sunburst"}'; c jsonb; token uuid; attempt integer; j private.image_jobs;
BEGIN
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

-- Public share capabilities may sign the primary Seedream raster and nothing else in its archive.
DO $$
DECLARE
  member uuid := '00000000-0000-4000-8000-000000000002';
  other_user uuid := '00000000-0000-4000-8000-000000000001';
  token_hash text := repeat('a', 64);
  legacy_hash text := repeat('b', 64);
  task text;
  prefix text;
  primary_path text;
  ext text;
  result jsonb;
BEGIN
  IF has_function_privilege('anon','public.resolve_folder_share(text,integer,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.resolve_folder_share(text,integer,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.resolve_folder_share(text,integer,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Only the service route may resolve share capabilities';
  END IF;
  INSERT INTO public.folders(id,user_id,name,created_at) VALUES('test-share',member,'Shared outputs',1);
  INSERT INTO public.folder_shares(folder_id,user_id,token_hash,legacy_token_hash,expires_at)
    VALUES('test-share',member,token_hash,legacy_hash,now()+interval '1 day');
  INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES
    ('media','test-reference.png',member::text,'{"mimetype":"image/png"}'),
    ('media','old-output.png',member::text,'{"mimetype":"image/png"}');
  INSERT INTO public.generations(id,user_id,folder_id,storage_path,created_at)
    VALUES('legacy-share-output',member,'test-share','old-output.png',1);
  FOREACH ext IN ARRAY ARRAY['png','jpg'] LOOP
    task := 'synthetic-fal-task/' || ext;
    prefix := member::text || '/seedream/' || encode(sha256(convert_to(task,'UTF8')),'hex') || '/';
    primary_path := prefix || '0.' || ext;
    INSERT INTO public.provider_tasks(provider,task_id,user_id) VALUES('fal',task,member);
    INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
      ('media',primary_path,jsonb_build_object('mimetype',CASE ext WHEN 'png' THEN 'image/png' ELSE 'image/jpeg' END)),
      ('media',prefix || '1.png','{"mimetype":"image/png"}');
    INSERT INTO public.generations(id,user_id,task_id,image_model,folder_id,created_at,storage_path,thumbnail_path,metadata,reference_images)
      VALUES('share-' || ext,member,task,'seedream-5.5','test-share',2,primary_path,'test-reference.png',
        '{"seedreamResult":{"layers":[{"description":"private-layer"}]}}','[{"url":"test-reference.png"}]');
    result := public.resolve_folder_share(legacy_hash,0,'share-' || ext);
    IF result->'images' IS DISTINCT FROM jsonb_build_array(jsonb_build_object(
      'id','share-' || ext,'storagePath',primary_path,'thumbnailPath',NULL)) THEN
      RAISE EXCEPTION 'Share must project only the archived primary (including for legacy tokens): %', result;
    END IF;
    UPDATE public.generations SET storage_path = prefix || '1.png' WHERE id = 'share-' || ext;
    IF public.resolve_folder_share(token_hash,0,'share-' || ext)->'images' IS DISTINCT FROM '[]'::jsonb THEN
      RAISE EXCEPTION 'Non-primary archive output was shareable';
    END IF;
    UPDATE public.generations SET storage_path = primary_path WHERE id = 'share-' || ext;
  END LOOP;
  result := public.resolve_folder_share(token_hash);
  IF jsonb_array_length(result->'images') IS DISTINCT FROM 3 OR result::text LIKE '%test-reference%' OR result::text LIKE '%private-layer%' THEN
    RAISE EXCEPTION 'Folder listing lost a legacy output or exposed private details';
  END IF;
  -- Using another registered task, even one owned by the same member, cannot authorize this path.
  UPDATE public.generations SET task_id = 'synthetic-fal-task/png' WHERE id = 'share-jpg';
  IF public.resolve_folder_share(token_hash,0,'share-jpg')->'images' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'Folder share did not bind the exact task';
  END IF;
  UPDATE public.provider_tasks SET user_id = other_user WHERE provider = 'fal' AND task_id = 'synthetic-fal-task/png';
  IF public.resolve_folder_share(token_hash,0,'share-png')->'images' IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION 'Folder share did not bind the task owner';
  END IF;
  UPDATE public.folder_shares SET expires_at = now() - interval '1 second' WHERE folder_id = 'test-share';
  IF public.resolve_folder_share(token_hash) IS NOT NULL OR public.resolve_folder_share(legacy_hash) IS NOT NULL THEN
    RAISE EXCEPTION 'Expired share resolved';
  END IF;
END $$;

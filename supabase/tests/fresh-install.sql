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

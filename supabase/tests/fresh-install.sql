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
 BEGIN
  INSERT INTO public.usage_logs(user_id,action,model,estimated_cost) VALUES('00000000-0000-4000-8000-000000000002','enhance','gemini-3.8-flash',0);RAISE EXCEPTION 'Member could write usage costs';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
SELECT set_config('request.jwt.claims','{"email":"outsider@example.invalid"}',false);
DO $$ BEGIN
 IF public.is_authorized() OR public.is_admin() THEN RAISE EXCEPTION 'Uninvited user authorized';END IF;
 IF EXISTS(SELECT FROM public.generations) THEN RAISE EXCEPTION 'Uninvited gallery access';END IF;
END $$;
RESET ROLE;

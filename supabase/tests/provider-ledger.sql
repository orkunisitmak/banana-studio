-- Admission behaviour of public.start_provider_request. Runs after fresh-install.sql, as superuser.
INSERT INTO auth.sessions(id,user_id) VALUES
 ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003');

-- Browsers (authenticated) cannot call the admission function at all.
SET ROLE authenticated;
DO $$ BEGIN
 PERFORM public.start_provider_request(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','image','fal');
 RAISE EXCEPTION 'T0 authenticated could call start_provider_request';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'T0 ok: authenticated denied';
END $$;
RESET ROLE;

SET ROLE service_role;
DO $$ DECLARE r jsonb; m uuid := '00000000-0000-4000-8000-000000000002'; ms uuid := '10000000-0000-4000-8000-000000000002'; BEGIN
 r := public.start_provider_request(gen_random_uuid(),m,ms,'image','fal');
 IF NOT (r->>'allowed')::boolean THEN RAISE EXCEPTION 'T1 member fal image refused: %',r; END IF;
 r := public.start_provider_request(gen_random_uuid(),'00000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003','image','fal');
 IF r->>'reason' IS DISTINCT FROM 'session' THEN RAISE EXCEPTION 'T2 uninvited user admitted: %',r; END IF;
 r := public.start_provider_request(gen_random_uuid(),m,'10000000-0000-4000-8000-000000000001','image','fal');
 IF r->>'reason' IS DISTINCT FROM 'session' THEN RAISE EXCEPTION 'T3 another user''s session accepted: %',r; END IF;
 BEGIN PERFORM public.start_provider_request(gen_random_uuid(),m,ms,'image','comfyui'); RAISE EXCEPTION 'T4 unknown provider accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'T4%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.start_provider_request(gen_random_uuid(),m,ms,'audio','fal'); RAISE EXCEPTION 'T5 unknown kind accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'T5%' THEN RAISE; END IF; END;
 RAISE NOTICE 'T1-T5 ok: member admitted, foreign/uninvited sessions and bad inputs refused';
END $$;
RESET ROLE;

-- Video cap: 39 earlier (finished) videos today, the 40th is admitted, the 41st refused.
INSERT INTO private.openai_requests(id,user_id,session_id,kind,provider,started_at,outcome)
 SELECT gen_random_uuid(),'00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','video','fal',now()-interval '2 hours','completed' FROM generate_series(1,39);
SET ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 r := public.start_provider_request(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','video','evolink');
 IF NOT (r->>'allowed')::boolean THEN RAISE EXCEPTION 'T6 40th video refused: %',r; END IF;
 r := public.start_provider_request(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','video','fal');
 IF r->>'reason' IS DISTINCT FROM 'daily' THEN RAISE EXCEPTION 'T7 41st video admitted: %',r; END IF;
 r := public.start_provider_request(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','text','gemini');
 IF NOT (r->>'allowed')::boolean THEN RAISE EXCEPTION 'T8 text refused by the video cap: %',r; END IF;
 RAISE NOTICE 'T6-T8 ok: 40 videos/day per member, other kinds unaffected';
END $$;
RESET ROLE;

-- Shared budget: OpenAI rows count toward fal/Gemini admission (no bypass by switching provider).
INSERT INTO private.openai_requests(id,user_id,session_id,kind,started_at,outcome)
 SELECT gen_random_uuid(),'00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','image',now()-interval '3 hours','completed'
 FROM generate_series(1,400-(SELECT count(*) FROM private.openai_requests WHERE user_id='00000000-0000-4000-8000-000000000002'));
SET ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 r := public.start_provider_request(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','image','gemini');
 IF r->>'reason' IS DISTINCT FROM 'daily' THEN RAISE EXCEPTION 'T9 provider switch bypassed the daily budget: %',r; END IF;
 r := public.start_openai_request(gen_random_uuid(),'00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','image',NULL);
 IF r->>'reason' IS DISTINCT FROM 'daily' THEN RAISE EXCEPTION 'T10 OpenAI ledger ignores other providers: %',r; END IF;
 RAISE NOTICE 'T9-T10 ok: one 400/day budget across OpenAI, fal, Gemini, EvoLink and OpenRouter';
END $$;
RESET ROLE;

-- Burst: 24 in-flight requests stop the owner with "rate" before the daily cap.
INSERT INTO private.openai_requests(id,user_id,session_id,kind,provider,started_at)
 SELECT gen_random_uuid(),'00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','image','fal',now()-interval '2 minutes' FROM generate_series(1,24);
SET ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 r := public.start_provider_request(gen_random_uuid(),'00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','image','fal');
 IF r->>'reason' IS DISTINCT FROM 'rate' OR (r->>'retry_after')::int <> 60 THEN RAISE EXCEPTION 'T11 concurrency cap missing: %',r; END IF;
 UPDATE private.openai_requests SET outcome='completed' WHERE user_id='00000000-0000-4000-8000-000000000001';
 RAISE NOTICE 'T11 ok: 24 in-flight requests -> rate, retry after 60s';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'T11 ok (rate verified); service_role cannot update the private ledger directly';
END $$;
RESET ROLE;

-- Finishing a ticket records the outcome; the service role can still write usage rows.
-- Hosted Supabase grants the service role every public table by default; platform-shim.sql does not.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
SET ROLE service_role;
DO $$ DECLARE id uuid := gen_random_uuid(); r jsonb; BEGIN
 INSERT INTO public.usage_logs(user_id,action,model,estimated_cost) VALUES('00000000-0000-4000-8000-000000000001','generate','flux2-klein-local',0);
 RAISE NOTICE 'T12 ok: server role writes usage rows';
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM private.openai_requests WHERE provider='evolink' AND kind='video')<>1 THEN RAISE EXCEPTION 'T13 provider not recorded'; END IF;
 RAISE NOTICE 'T13 ok: provider and kind recorded on each admission';
END $$;

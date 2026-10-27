-- Every paid provider route is admitted by the server-owned request ledger.
-- Before this, fal.ai, Gemini, EvoLink and OpenRouter video submissions only
-- required a signed-in member and bypassed the OpenAI/OpenRouter limits.
ALTER TABLE private.openai_requests
  ADD COLUMN provider text NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai', 'openrouter', 'gemini', 'fal', 'evolink')),
  DROP CONSTRAINT openai_requests_kind_check,
  ADD CONSTRAINT openai_requests_kind_check CHECK (kind IN ('image', 'text', 'video'));

-- Shares start_openai_request's lock and counters, so switching provider never
-- resets a budget. A single video request can cost dollars: it also has its
-- own daily cap per member and per workspace.
CREATE FUNCTION public.start_provider_request(p_id uuid, p_user_id uuid, p_session_id uuid, p_kind text, p_provider text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_now timestamptz; v_user_minute integer; v_user_day integer; v_user_active integer; v_user_video integer;
  v_global_minute integer; v_global_day integer; v_global_active integer; v_global_video integer;
BEGIN
  IF NOT private.image_job_authorized(p_user_id,p_session_id) THEN RETURN jsonb_build_object('allowed',false,'reason','session'); END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('image','text','video') OR p_provider IS NULL OR p_provider NOT IN ('openrouter','gemini','fal','evolink')
    THEN RAISE EXCEPTION 'Invalid provider request'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(711902,1);
  v_now := clock_timestamp();
  SELECT count(*) FILTER(WHERE started_at>v_now-interval '1 minute'),count(*),
    count(*) FILTER(WHERE outcome='accepted' AND started_at>v_now-interval '5 minutes'),count(*) FILTER(WHERE kind='video')
    INTO v_global_minute,v_global_day,v_global_active,v_global_video FROM private.openai_requests WHERE started_at>v_now-interval '24 hours';
  SELECT count(*) FILTER(WHERE started_at>v_now-interval '1 minute'),count(*),
    count(*) FILTER(WHERE outcome='accepted' AND started_at>v_now-interval '5 minutes'),count(*) FILTER(WHERE kind='video')
    INTO v_user_minute,v_user_day,v_user_active,v_user_video FROM private.openai_requests WHERE user_id=p_user_id AND started_at>v_now-interval '24 hours';
  IF v_user_day>=400 OR v_global_day>=1200 OR (p_kind='video' AND (v_user_video>=40 OR v_global_video>=120))
    THEN RETURN jsonb_build_object('allowed',false,'reason','daily','retry_after',3600); END IF;
  IF v_user_minute>=60 OR v_global_minute>=150 OR v_user_active>=24 OR v_global_active>=48
    THEN RETURN jsonb_build_object('allowed',false,'reason','rate','retry_after',60); END IF;
  INSERT INTO private.openai_requests(id,user_id,session_id,kind,provider,started_at)
    VALUES(p_id,p_user_id,p_session_id,p_kind,p_provider,v_now);
  RETURN jsonb_build_object('allowed',true);
END;
$$;
REVOKE ALL ON FUNCTION public.start_provider_request(uuid,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_provider_request(uuid,uuid,uuid,text,text) TO service_role;

-- Image usage rows are written by the server pipeline. Browsers still report
-- text tasks and Seedance submissions, but only as bounded, non-negative costs.
DROP POLICY usage_insert ON public.usage_logs;
CREATE POLICY usage_insert ON public.usage_logs FOR INSERT TO authenticated WITH CHECK (
  user_id = (SELECT auth.uid())
  AND action IN ('enhance', 'brainstorm', 'variation', 'video_enhance', 'video_generate')
  AND (estimated_cost IS NULL OR estimated_cost BETWEEN 0 AND CASE WHEN action = 'video_generate' THEN 60 ELSE 5 END)
);

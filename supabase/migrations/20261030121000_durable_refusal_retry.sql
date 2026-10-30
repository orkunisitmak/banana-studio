-- Keep refusal deadlines in the private request ledger, atomically with its
-- terminal outcome. The original four-argument RPC remains compatible.
ALTER TABLE private.openai_requests ADD COLUMN retry_not_before timestamptz;
ALTER TABLE private.openai_requests ADD COLUMN wait_reason text CHECK(wait_reason IN ('rate','quota'));
CREATE FUNCTION public.finish_openai_request(p_id uuid,p_outcome text,p_provider_request_id text,p_provider_status integer,p_retry_after integer,p_wait_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE retry_at timestamptz;
BEGIN
 IF p_outcome IS DISTINCT FROM 'rejected' OR p_provider_status IS DISTINCT FROM 429
   OR p_retry_after IS NULL OR p_retry_after<1 OR p_retry_after>86400
   OR p_wait_reason IS NULL OR p_wait_reason NOT IN ('rate','quota')
   OR (p_wait_reason='quota' AND p_retry_after<3600) THEN
   RAISE EXCEPTION 'Invalid refusal retry context' USING ERRCODE='22023';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(711902,1);
 PERFORM public.finish_openai_request(p_id,p_outcome,p_provider_request_id,p_provider_status);
 UPDATE private.openai_requests SET retry_not_before=greatest(retry_not_before,clock_timestamp()+make_interval(secs=>p_retry_after)),
   wait_reason=p_wait_reason
 WHERE id=p_id AND outcome='rejected' AND provider_status=429 RETURNING retry_not_before INTO retry_at;
 IF FOUND THEN
   UPDATE private.image_provider_cooldown SET
    reason=CASE WHEN retry_at>not_before THEN p_wait_reason ELSE reason END,
    not_before=greatest(not_before,retry_at) WHERE singleton;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_openai_request(uuid,text,text,integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_openai_request(uuid,text,text,integer,integer,text) TO service_role;

-- Also retain deadlines in successful deferrals, including callers using the
-- existing four-argument API. Never shorten a longer global quota cooldown.
CREATE OR REPLACE FUNCTION public.defer_rate_limited_image_job(p_id text,p_claim uuid,p_retry_after integer,p_request_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.image_jobs; retry_at timestamptz; reason text;
BEGIN
 IF p_retry_after IS NULL OR p_retry_after<1 OR p_retry_after>86400 THEN RETURN false; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(711902,1);
 SELECT * INTO j FROM private.image_jobs WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'dispatched' OR j.claim_token IS DISTINCT FROM p_claim OR j.audit_id IS NULL
  OR NOT EXISTS(SELECT 1 FROM private.openai_requests WHERE id=j.audit_id AND user_id=j.user_id AND generation_id=j.id AND outcome='accepted')
  THEN RETURN false; END IF;
 PERFORM public.finish_openai_request(j.audit_id,'rejected',p_request_id,429,p_retry_after,'rate');
 SELECT not_before,c.reason INTO retry_at,reason FROM private.image_provider_cooldown c WHERE singleton;
 UPDATE private.image_jobs SET state='queued',not_before=retry_at,dispatched_at=NULL,lease_until=NULL,claim_token=NULL,audit_id=NULL WHERE id=p_id;
 UPDATE public.generations SET status='pending',metadata=(coalesce(metadata,'{}'::jsonb)-'error')||
  jsonb_build_object('imageStage','queued','imageQueueWaitReason',reason,'imageRateLimitRetryAt',floor(extract(epoch FROM retry_at)*1000)::bigint)
  WHERE id=p_id AND user_id=j.user_id AND status<>'completed';
 RETURN true;
END;
$$;
CREATE OR REPLACE FUNCTION public.defer_refused_image_job(p_id text,p_claim uuid,p_retry_after integer,p_request_id text,p_wait_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE deferred boolean; audit uuid;
BEGIN
 IF p_wait_reason IS NULL OR p_wait_reason NOT IN ('rate','quota') OR (p_wait_reason='quota' AND p_retry_after<3600) THEN RETURN false; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(711902,1);
 SELECT audit_id INTO audit FROM private.image_jobs WHERE id=p_id AND state='dispatched' AND claim_token=p_claim FOR UPDATE;
 deferred:=public.defer_rate_limited_image_job(p_id,p_claim,p_retry_after,p_request_id);
 IF deferred THEN
  UPDATE private.openai_requests SET wait_reason=p_wait_reason WHERE id=audit;
  UPDATE private.image_provider_cooldown c SET reason=p_wait_reason FROM private.openai_requests a
   WHERE c.singleton AND a.id=audit AND a.retry_not_before>=c.not_before;
  UPDATE public.generations g SET metadata=coalesce(g.metadata,'{}'::jsonb)||jsonb_build_object('imageQueueWaitReason',c.reason)
   FROM private.image_jobs j,private.image_provider_cooldown c WHERE c.singleton AND g.id=j.id AND g.user_id=j.user_id AND j.state='queued';
 END IF;
 RETURN deferred;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_image_job(p_id text, p_user_id uuid, p_claim uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j private.image_jobs; admission jsonb; audit uuid; busy integer; ahead integer; cooldown timestamptz; wait_reason text; retry_at timestamptz; refusal private.openai_requests;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(711902,1);
  SELECT * INTO j FROM private.image_jobs WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('action','stop'); END IF;
  IF j.state IN ('completed','failed') THEN RETURN jsonb_build_object('action','stop'); END IF;
  IF j.state='dispatched' THEN
    -- The provider refused this exact dispatch with 429 (no image, no usage),
    -- but the deferral was not saved. Requeue it as the deferral would have.
    SELECT * INTO refusal FROM private.openai_requests WHERE id=j.audit_id AND user_id=j.user_id
      AND generation_id=j.id AND kind='image' AND outcome='rejected' AND provider_status=429;
    IF FOUND AND NOT EXISTS(SELECT 1 FROM public.generations WHERE id=p_id AND user_id=j.user_id AND status='completed') THEN
      SELECT not_before,reason INTO cooldown,wait_reason FROM private.image_provider_cooldown WHERE singleton;
      -- Legacy refusals lack retry context. Wait conservatively for an hour;
      -- newly recorded refusals retain the exact provider deadline and reason.
      retry_at := coalesce(refusal.retry_not_before,coalesce(refusal.finished_at,clock_timestamp())+interval '1 hour');
      IF cooldown>retry_at THEN retry_at:=cooldown;
      ELSE wait_reason:=coalesce(refusal.wait_reason,'quota'); END IF;
      retry_at:=greatest(clock_timestamp(),retry_at);
      UPDATE private.image_provider_cooldown SET not_before=retry_at,reason=wait_reason WHERE singleton;
      UPDATE private.image_jobs SET state='queued',not_before=retry_at,dispatched_at=NULL,lease_until=NULL,claim_token=NULL,audit_id=NULL WHERE id=p_id;
      UPDATE public.generations SET status='pending',metadata=(coalesce(metadata,'{}'::jsonb)-'error')||
        jsonb_build_object('imageStage','queued','imageQueueWaitReason',wait_reason,'imageRateLimitRetryAt',floor(extract(epoch FROM retry_at)*1000)::bigint)
        WHERE id=p_id AND user_id=j.user_id AND status<>'completed';
      RETURN jsonb_build_object('action','wait','retryAfter',greatest(1,ceil(extract(epoch FROM retry_at-clock_timestamp()))));
    END IF;
    RETURN jsonb_build_object('action','observe','claim',j.claim_token,'audit',j.audit_id,'dispatchedAt',j.dispatched_at);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.generations WHERE id=p_id AND user_id=j.user_id) THEN
    UPDATE private.image_jobs SET state='failed',finished_at=clock_timestamp() WHERE id=p_id;
    RETURN jsonb_build_object('action','stop');
  END IF;
  IF NOT private.image_job_authorized(j.user_id,j.session_id) THEN
    UPDATE private.image_jobs SET state='failed',finished_at=clock_timestamp() WHERE id=p_id;
    UPDATE public.generations SET status='failed',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('error','Queued generation cancelled because access was revoked.') WHERE id=p_id AND user_id=j.user_id;
    RETURN jsonb_build_object('action','stop');
  END IF;
  SELECT not_before,reason INTO cooldown,wait_reason FROM private.image_provider_cooldown WHERE singleton;
  IF cooldown>clock_timestamp() THEN
    UPDATE public.generations SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('imageQueueWaitReason',wait_reason) WHERE id=p_id AND user_id=j.user_id AND status='pending';
    RETURN jsonb_build_object('action','wait','retryAfter',greatest(1,ceil(extract(epoch FROM cooldown-clock_timestamp()))));
  END IF;
  IF j.not_before>clock_timestamp() THEN RETURN jsonb_build_object('action','wait','retryAfter',greatest(1,ceil(extract(epoch FROM j.not_before-clock_timestamp())))); END IF;
  IF j.state='preparing' AND j.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('action','wait','retryAfter',30); END IF;
  IF j.state='preparing' AND j.audit_id IS NOT NULL THEN PERFORM public.finish_openai_request(j.audit_id,'rejected'); END IF;
  -- Preparation never reached dispatch this many times in a row; stop
  -- retrying. No provider request was sent for any of these attempts.
  IF j.prepare_attempts>=5 THEN
    UPDATE private.image_jobs SET state='failed',lease_until=NULL,finished_at=clock_timestamp() WHERE id=p_id;
    UPDATE public.generations SET status='failed',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('error',
      'Preparing this image did not finish after several attempts. No generation was submitted. Try again, or use fewer or smaller references.')
      WHERE id=p_id AND user_id=j.user_id AND status<>'completed';
    RETURN jsonb_build_object('action','stop');
  END IF;
  SELECT count(*) INTO busy FROM private.image_jobs WHERE user_id=j.user_id AND id<>p_id
    AND ((state='preparing' AND lease_until>clock_timestamp()) OR (state='dispatched' AND dispatched_at>clock_timestamp()-interval '330 seconds'));
  SELECT count(*) INTO ahead FROM private.image_jobs WHERE user_id=j.user_id AND state='queued'
    AND not_before<=clock_timestamp() AND sequence<j.sequence;
  IF busy>=24 OR ahead>=24-busy THEN RETURN jsonb_build_object('action','wait','retryAfter',30); END IF;
  audit := gen_random_uuid();
  admission := public.start_openai_request(audit,j.user_id,j.session_id,'image',p_id);
  IF NOT (admission->>'allowed')::boolean THEN
    IF admission->>'reason'='duplicate' THEN
      UPDATE private.image_jobs SET state='dispatched',dispatched_at=clock_timestamp(),claim_token=p_claim WHERE id=p_id;
      RETURN jsonb_build_object('action','observe','claim',p_claim,'dispatchedAt',clock_timestamp());
    END IF;
    UPDATE private.image_jobs SET state='queued',not_before=clock_timestamp()+make_interval(secs=>coalesce((admission->>'retry_after')::integer,60)),lease_until=NULL WHERE id=p_id;
    RETURN jsonb_build_object('action','wait','retryAfter',coalesce((admission->>'retry_after')::integer,60));
  END IF;
  UPDATE private.image_jobs SET state='preparing',claim_token=p_claim,audit_id=audit,lease_until=clock_timestamp()+interval '120 seconds',
    prepare_attempts=j.prepare_attempts+1 WHERE id=p_id;
  RETURN jsonb_build_object('action','prepare','claim',p_claim,'audit',audit,'payload',j.payload);
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Retry queued images that never reached the provider instead of failing them.
-- 1. A lease that expires during slow preparation leaves the job 'preparing';
--    the runner no longer fails it, so claim_image_job reclaims it. Consecutive
--    preparations that never reach dispatch are bounded by prepare_attempts.
-- 2. A provider 429 whose deferral could not be saved leaves the job
--    'dispatched' with its audit 'rejected' at status 429. Only that refused,
--    unbilled state is requeued; every other dispatched job is still observed
--    and never submitted again.
ALTER TABLE private.image_jobs ADD COLUMN prepare_attempts integer NOT NULL DEFAULT 0
  CHECK (prepare_attempts >= 0);

CREATE OR REPLACE FUNCTION public.dispatch_image_job(p_id text,p_claim uuid,p_metadata jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j private.image_jobs;
BEGIN
  SELECT * INTO j FROM private.image_jobs WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR j.state<>'preparing' OR j.claim_token IS DISTINCT FROM p_claim OR j.lease_until<=clock_timestamp()
    OR NOT private.image_job_authorized(j.user_id,j.session_id)
    OR NOT EXISTS(SELECT 1 FROM public.generations WHERE id=p_id AND user_id=j.user_id) THEN RETURN false; END IF;
  UPDATE private.image_jobs SET state='dispatched',dispatched_at=clock_timestamp(),lease_until=NULL,prepare_attempts=0 WHERE id=p_id;
  UPDATE public.generations SET status='processing',metadata=coalesce(metadata,'{}'::jsonb)||p_metadata||jsonb_build_object('imageStage','generating')
    WHERE id=p_id AND user_id=j.user_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_image_job(p_id text, p_user_id uuid, p_claim uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j private.image_jobs; admission jsonb; audit uuid; busy integer; ahead integer; cooldown timestamptz; wait_reason text; retry_at timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(711902,1);
  SELECT * INTO j FROM private.image_jobs WHERE id=p_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('action','stop'); END IF;
  IF j.state IN ('completed','failed') THEN RETURN jsonb_build_object('action','stop'); END IF;
  IF j.state='dispatched' THEN
    -- The provider refused this exact dispatch with 429 (no image, no usage),
    -- but the deferral was not saved. Requeue it as the deferral would have.
    IF j.audit_id IS NOT NULL AND EXISTS(SELECT 1 FROM private.openai_requests WHERE id=j.audit_id AND user_id=j.user_id
        AND generation_id=j.id AND kind='image' AND outcome='rejected' AND provider_status=429)
      AND NOT EXISTS(SELECT 1 FROM public.generations WHERE id=p_id AND user_id=j.user_id AND status='completed') THEN
      retry_at := clock_timestamp()+interval '60 seconds';
      UPDATE private.image_jobs SET state='queued',not_before=retry_at,dispatched_at=NULL,lease_until=NULL,claim_token=NULL,audit_id=NULL WHERE id=p_id;
      UPDATE public.generations SET status='pending',metadata=(coalesce(metadata,'{}'::jsonb)-'error')||
        jsonb_build_object('imageStage','queued','imageQueueWaitReason','rate','imageRateLimitRetryAt',floor(extract(epoch FROM retry_at)*1000)::bigint)
        WHERE id=p_id AND user_id=j.user_id AND status<>'completed';
      RETURN jsonb_build_object('action','wait','retryAfter',60);
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

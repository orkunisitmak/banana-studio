-- Keep the existing personal/global revision relationship when upgrading IDs.
ALTER TABLE public.text_model_defaults DROP CONSTRAINT text_model_defaults_model_check,
  ADD COLUMN feature_models jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.user_text_model_preferences DROP CONSTRAINT user_text_model_preferences_model_check,
  ADD COLUMN feature_models jsonb NOT NULL DEFAULT '{}';
UPDATE public.text_model_defaults SET model = CASE model WHEN 'gemini-3.8-flash' THEN 'gemini-4-hydrogen' WHEN 'gpt-6.1-sol' THEN 'gpt-6.2-sol' WHEN 'anthropic/claude-opus-5.5' THEN 'claude-opus-5.5' ELSE model END;
UPDATE public.user_text_model_preferences SET model = CASE model WHEN 'gemini-3.8-flash' THEN 'gemini-4-hydrogen' WHEN 'gpt-6.1-sol' THEN 'gpt-6.2-sol' WHEN 'anthropic/claude-opus-5.5' THEN 'claude-opus-5.5' ELSE model END;
ALTER TABLE public.text_model_defaults ADD CONSTRAINT text_model_defaults_model_check CHECK (model IN ('gemini-4-hydrogen','gpt-6.2-sol','claude-opus-5.5'));
ALTER TABLE public.user_text_model_preferences ADD CONSTRAINT user_text_model_preferences_model_check CHECK (model IN ('gemini-4-hydrogen','gpt-6.2-sol','claude-opus-5.5'));

CREATE OR REPLACE FUNCTION public.get_text_model_preferences()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized() THEN RAISE EXCEPTION 'Application access required' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('model',coalesce(p.model,d.model), 'featureModels',coalesce(p.feature_models,d.feature_models),
    'thinkingLevel',coalesce(p.gemini_thinking,d.gemini_thinking), 'reasoningEffort',coalesce(p.openai_reasoning,d.openai_reasoning),
    'source',CASE WHEN p.user_id IS NULL THEN 'all' ELSE 'personal' END, 'revision',d.revision, 'canSaveAll',public.is_admin()) INTO result
  FROM public.text_model_defaults d LEFT JOIN public.user_text_model_preferences p ON p.user_id=auth.uid() AND p.global_revision=d.revision WHERE d.singleton;
  RETURN result;
END;
$$;

DROP FUNCTION public.save_text_model_preferences(text,text,text,text,uuid);
CREATE FUNCTION public.save_text_model_preferences(p_scope text,p_model text,p_gemini_thinking text,p_openai_reasoning text,p_expected_user_id uuid,p_feature_models jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_revision bigint; current_features jsonb;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_expected_user_id OR NOT public.is_authorized() THEN
    RAISE EXCEPTION 'Application access required' USING ERRCODE='42501';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('me','all') OR p_model IS NULL OR p_model NOT IN ('gemini-4-hydrogen','gpt-6.2-sol','claude-opus-5.5')
    OR p_gemini_thinking IS NULL OR p_gemini_thinking NOT IN ('LOW','MEDIUM','HIGH')
    OR p_openai_reasoning IS NULL OR p_openai_reasoning NOT IN ('low','medium','high','xhigh','max') THEN
    RAISE EXCEPTION 'Invalid model settings' USING ERRCODE='22023';
  END IF;
  IF p_feature_models IS NOT NULL THEN
    IF jsonb_typeof(p_feature_models) <> 'object' THEN RAISE EXCEPTION 'Invalid feature settings' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT FROM jsonb_each_text(p_feature_models) WHERE key NOT IN ('enhance','video_enhance','brainstorm','variation') OR value IS NULL OR value NOT IN ('gemini-4-hydrogen','gpt-6.2-sol','claude-opus-5.5')) THEN
      RAISE EXCEPTION 'Invalid feature settings' USING ERRCODE='22023';
    END IF;
  END IF;
  IF p_scope='all' THEN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
    UPDATE public.text_model_defaults SET model=p_model, gemini_thinking=p_gemini_thinking, openai_reasoning=p_openai_reasoning,
      feature_models=coalesce(p_feature_models,feature_models), revision=revision+1, updated_by=auth.uid(), updated_at=now() WHERE singleton;
  ELSE
    SELECT revision,feature_models INTO STRICT current_revision,current_features FROM public.text_model_defaults WHERE singleton FOR SHARE;
    INSERT INTO public.user_text_model_preferences AS p(user_id,model,gemini_thinking,openai_reasoning,global_revision,feature_models)
    VALUES(auth.uid(),p_model,p_gemini_thinking,p_openai_reasoning,current_revision,coalesce(p_feature_models,current_features))
    ON CONFLICT(user_id) DO UPDATE SET model=EXCLUDED.model,gemini_thinking=EXCLUDED.gemini_thinking,openai_reasoning=EXCLUDED.openai_reasoning,
      feature_models=CASE WHEN p_feature_models IS NULL AND p.global_revision=current_revision THEN p.feature_models ELSE EXCLUDED.feature_models END,
      global_revision=current_revision,updated_at=now();
  END IF;
  RETURN public.get_text_model_preferences();
END;
$$;
REVOKE ALL ON FUNCTION public.save_text_model_preferences(text,text,text,text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_text_model_preferences(text,text,text,text,uuid,jsonb) TO authenticated;

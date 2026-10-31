-- Allow saving openrouter/free in workspace text model preferences.
ALTER TABLE public.text_model_defaults DROP CONSTRAINT text_model_defaults_model_check;
ALTER TABLE public.user_text_model_preferences DROP CONSTRAINT user_text_model_preferences_model_check;
ALTER TABLE public.text_model_defaults ADD CONSTRAINT text_model_defaults_model_check
  CHECK (model IN ('gemini-3.8-flash','gpt-6.1-sol','anthropic/claude-opus-5.5','openrouter/free'));
ALTER TABLE public.user_text_model_preferences ADD CONSTRAINT user_text_model_preferences_model_check
  CHECK (model IN ('gemini-3.8-flash','gpt-6.1-sol','anthropic/claude-opus-5.5','openrouter/free'));

CREATE OR REPLACE FUNCTION public.save_text_model_preferences(p_scope text, p_model text, p_gemini_thinking text, p_openai_reasoning text, p_expected_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_revision bigint;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_expected_user_id OR NOT public.is_authorized() THEN
    RAISE EXCEPTION 'Application access required' USING ERRCODE = '42501';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('me','all')
    OR p_model IS NULL OR p_model NOT IN ('gemini-3.8-flash','gpt-6.1-sol','anthropic/claude-opus-5.5','openrouter/free')
    OR p_gemini_thinking IS NULL OR p_gemini_thinking NOT IN ('LOW','MEDIUM','HIGH')
    OR p_openai_reasoning IS NULL OR p_openai_reasoning NOT IN ('low','medium','high','xhigh','max') THEN
    RAISE EXCEPTION 'Invalid model settings' USING ERRCODE = '22023';
  END IF;
  IF p_scope = 'all' THEN
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
    UPDATE public.text_model_defaults SET model = p_model, gemini_thinking = p_gemini_thinking,
      openai_reasoning = p_openai_reasoning, revision = revision + 1, updated_by = auth.uid(), updated_at = now()
    WHERE singleton;
  ELSE
    SELECT revision INTO STRICT current_revision FROM public.text_model_defaults WHERE singleton FOR SHARE;
    INSERT INTO public.user_text_model_preferences(user_id,model,gemini_thinking,openai_reasoning,global_revision)
    VALUES (auth.uid(),p_model,p_gemini_thinking,p_openai_reasoning,current_revision)
    ON CONFLICT (user_id) DO UPDATE SET model = EXCLUDED.model, gemini_thinking = EXCLUDED.gemini_thinking,
      openai_reasoning = EXCLUDED.openai_reasoning, global_revision = EXCLUDED.global_revision, updated_at = now();
  END IF;
  RETURN public.get_text_model_preferences();
END;
$$;
REVOKE ALL ON FUNCTION public.save_text_model_preferences(text,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_text_model_preferences(text,text,text,text,uuid) TO authenticated;

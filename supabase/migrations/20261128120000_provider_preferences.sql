BEGIN;

-- Only route names are stored here. Credentials belong to the deployment.
CREATE TABLE private.model_provider_preferences (
  -- NULL is the workspace policy. Only the admin RPC can write those rows.
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  model text NOT NULL,
  provider text NOT NULL,
  UNIQUE NULLS NOT DISTINCT (user_id, model),
  CHECK (user_id IS NOT NULL OR provider <> 'auto'),
  CHECK (CASE
    WHEN model IN ('gemini-3-pro-image-preview','gemini-nano-banana-2.1') THEN provider IN ('auto','off','fal','gemini','openrouter')
    WHEN model = 'gpt-image-2.5-sunburst' THEN provider IN ('auto','off','fal','openai','openrouter')
    WHEN model = 'gpt-image-2.6-sunburst' THEN provider IN ('auto','off','fal','openai')
    WHEN model IN ('seedream-5.5','gemini-omni-1.2-flash') THEN provider IN ('auto','off','fal')
    WHEN model IN ('seedance-2.0','seedance-2.5') THEN provider IN ('auto','off','fal','evolink','openrouter')
    WHEN model = 'minimax-h3' THEN provider IN ('auto','off','fal','evolink')
    WHEN model = 'magi-2' THEN provider IN ('auto','off','evolink')
    WHEN model = 'claude-opus-5.5' THEN provider IN ('auto','off','fal','evolink','anthropic','openrouter')
    WHEN model = 'gemini-4-hydrogen' THEN provider IN ('auto','off','fal','evolink','gemini','openrouter')
    WHEN model = 'gpt-6.2-sol' THEN provider IN ('auto','off','fal','evolink','openai','openrouter')
    ELSE false END)
);
ALTER TABLE private.model_provider_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.model_provider_preferences FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_provider_preferences(p_expected_user_id uuid DEFAULT NULL, p_include_policy boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE personal jsonb; policy jsonb; opted_out jsonb; effective jsonb;
BEGIN
  IF auth.uid() IS NULL OR (p_expected_user_id IS NOT NULL AND auth.uid() <> p_expected_user_id) OR NOT public.is_authorized() THEN
    RAISE EXCEPTION 'Application access required' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_object_agg(model,provider) FILTER (WHERE user_id IS NOT NULL), '{}'::jsonb),
         coalesce(jsonb_object_agg(model,provider) FILTER (WHERE user_id IS NULL), '{}'::jsonb),
         coalesce(jsonb_object_agg(model,provider) FILTER (WHERE user_id IS NOT NULL AND provider = 'off'), '{}'::jsonb)
    INTO personal, policy, opted_out FROM private.model_provider_preferences WHERE user_id = auth.uid() OR user_id IS NULL;
  effective := personal || policy || opted_out;
  IF p_include_policy THEN
    RETURN jsonb_build_object('personal',personal,'policy',policy,'preferences',effective,'canManage',public.is_admin());
  END IF;
  RETURN effective;
END;
$$;

CREATE FUNCTION public.save_provider_preference(p_expected_user_id uuid, p_model text, p_provider text, p_if_missing boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_expected_user_id OR NOT public.is_authorized() THEN
    RAISE EXCEPTION 'Application access required' USING ERRCODE = '42501';
  END IF;
  -- One row per model: concurrent changes to other models are never replaced.
  -- Browser migration must not overwrite a newer selection on another device.
  INSERT INTO private.model_provider_preferences(user_id, model, provider) VALUES (auth.uid(), p_model, p_provider)
  ON CONFLICT (user_id, model) DO UPDATE SET provider = EXCLUDED.provider WHERE NOT p_if_missing;
  RETURN true;
END;
$$;
-- NULL clears an override without altering anyone's saved personal route.
CREATE FUNCTION public.save_workspace_provider_policy(p_expected_user_id uuid, p_model text, p_provider text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_expected_user_id OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE = '42501';
  END IF;
  IF p_provider IS NULL THEN
    DELETE FROM private.model_provider_preferences WHERE user_id IS NULL AND model = p_model;
  ELSE
    INSERT INTO private.model_provider_preferences(user_id,model,provider) VALUES (NULL,p_model,p_provider)
    ON CONFLICT (user_id,model) DO UPDATE SET provider = EXCLUDED.provider;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.get_provider_preferences(uuid,boolean), public.save_provider_preference(uuid,text,text,boolean), public.save_workspace_provider_policy(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_provider_preferences(uuid,boolean), public.save_provider_preference(uuid,text,text,boolean), public.save_workspace_provider_policy(uuid,text,text) TO authenticated;

COMMIT;

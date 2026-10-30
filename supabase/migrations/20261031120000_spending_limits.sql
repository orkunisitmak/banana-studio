-- Monthly spending limits. A workspace default applies to members; an admin
-- can give one account its own limit or exempt it. Spend is the sum of this
-- calendar month's (UTC) usage records, so a request that starts below the
-- limit can finish slightly above it.
CREATE TABLE public.spending_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  default_monthly_limit_usd numeric CHECK (default_monthly_limit_usd IS NULL OR (default_monthly_limit_usd >= 0 AND default_monthly_limit_usd <= 1000000)),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.spending_policy(default_monthly_limit_usd) VALUES (NULL);

-- No row: the account follows the workspace default. A row with a NULL limit
-- exempts the account.
CREATE TABLE public.user_spending_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_limit_usd numeric CHECK (monthly_limit_usd IS NULL OR (monthly_limit_usd >= 0 AND monthly_limit_usd <= 1000000)),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spending_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_spending_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spending_policy, public.user_spending_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.spending_policy, public.user_spending_limits TO service_role;

CREATE FUNCTION public.get_spending_status(p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  target uuid := COALESCE(p_user_id, auth.uid());
  period_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  override public.user_spending_limits%ROWTYPE;
  workspace_limit numeric;
  effective numeric;
  source text;
  spent numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_authorized() THEN
    RAISE EXCEPTION 'Application access required' USING ERRCODE = '42501';
  END IF;
  IF target IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  SELECT default_monthly_limit_usd INTO workspace_limit FROM public.spending_policy WHERE singleton;
  SELECT * INTO override FROM public.user_spending_limits WHERE user_id = target;
  IF FOUND THEN
    effective := override.monthly_limit_usd;
    source := CASE WHEN override.monthly_limit_usd IS NULL THEN 'exempt' ELSE 'account' END;
  ELSIF EXISTS (SELECT FROM public.profiles WHERE id = target AND role = 'admin') THEN
    -- The workspace default limits members. Admins stay unlimited unless an
    -- account limit is set for them.
    effective := NULL; source := 'admin';
  ELSE
    effective := workspace_limit;
    source := CASE WHEN workspace_limit IS NULL THEN 'none' ELSE 'workspace' END;
  END IF;
  -- Usage records are inserted by members; a negative estimate never lowers spend.
  SELECT COALESCE(sum(GREATEST(estimated_cost, 0)), 0) INTO spent
  FROM public.usage_logs WHERE user_id = target AND created_at >= period_start;
  RETURN jsonb_build_object(
    'userId', target, 'limitUsd', effective, 'spentUsd', spent, 'source', source,
    'workspaceLimitUsd', workspace_limit, 'periodStart', period_start,
    'blocked', effective IS NOT NULL AND spent >= effective
  );
END;
$$;

CREATE FUNCTION public.set_spending_limit(p_scope text, p_user_id uuid, p_mode text, p_limit_usd numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_limit_usd IS NOT NULL AND (p_limit_usd < 0 OR p_limit_usd > 1000000) THEN
    RAISE EXCEPTION 'Invalid spending limit' USING ERRCODE = '22023';
  END IF;
  IF p_scope = 'workspace' THEN
    IF p_mode IS NULL OR p_mode NOT IN ('limit', 'none') OR (p_mode = 'limit' AND p_limit_usd IS NULL) THEN
      RAISE EXCEPTION 'Invalid spending limit' USING ERRCODE = '22023';
    END IF;
    UPDATE public.spending_policy SET default_monthly_limit_usd = CASE WHEN p_mode = 'limit' THEN p_limit_usd END,
      updated_by = auth.uid(), updated_at = now() WHERE singleton;
    RETURN public.get_spending_status(auth.uid());
  END IF;
  IF p_scope IS DISTINCT FROM 'account' OR p_user_id IS NULL OR NOT EXISTS (SELECT FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Invalid spending limit' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'inherit' THEN
    DELETE FROM public.user_spending_limits WHERE user_id = p_user_id;
  ELSIF p_mode = 'exempt' OR (p_mode = 'limit' AND p_limit_usd IS NOT NULL) THEN
    INSERT INTO public.user_spending_limits(user_id, monthly_limit_usd, updated_by)
    VALUES (p_user_id, CASE WHEN p_mode = 'limit' THEN p_limit_usd END, auth.uid())
    ON CONFLICT (user_id) DO UPDATE SET monthly_limit_usd = EXCLUDED.monthly_limit_usd, updated_by = auth.uid(), updated_at = now();
  ELSE
    RAISE EXCEPTION 'Invalid spending limit' USING ERRCODE = '22023';
  END IF;
  RETURN public.get_spending_status(p_user_id);
END;
$$;

-- One call for the admin list instead of one status request per account.
CREATE FUNCTION public.get_workspace_spending()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.get_spending_status(p.id) || jsonb_build_object('email', p.email, 'displayName', p.display_name, 'role', p.role)
      ORDER BY lower(COALESCE(p.display_name, p.email, '')))
    FROM public.profiles p
    WHERE EXISTS (SELECT FROM public.authorized_emails a WHERE lower(a.email) = lower(p.email) AND a.is_active)
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_spending_status(uuid), public.set_spending_limit(text,uuid,text,numeric), public.get_workspace_spending() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_spending_status(uuid), public.set_spending_limit(text,uuid,text,numeric), public.get_workspace_spending() TO authenticated;

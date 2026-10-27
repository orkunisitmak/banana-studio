-- Every usage_logs row is now written by the server route that called the
-- provider, with the service role and a server-computed cost. Members keep
-- reading their own rows and admins keep reading and resetting all rows, but
-- no browser can insert a cost record, even a bounded one.
DROP POLICY IF EXISTS usage_insert ON public.usage_logs;
REVOKE INSERT ON public.usage_logs FROM authenticated;

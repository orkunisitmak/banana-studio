-- Liquid Inference video tasks use the same owner-only RLS and server-only INSERT boundary.
ALTER TABLE public.provider_tasks DROP CONSTRAINT provider_tasks_provider_check;
ALTER TABLE public.provider_tasks ADD CONSTRAINT provider_tasks_provider_check
  CHECK (provider IN ('fal', 'evolink', 'openrouter', 'liquid'));

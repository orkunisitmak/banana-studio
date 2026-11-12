import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

/** A single-connection client for one-off administration work. */
const connect = url => postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });

/**
 * Apply supabase/migrations in order, once each, recording them in the same
 * history table the Supabase CLI uses. Waits for the auth and storage services
 * to create their schemas, which the baseline references.
 */
export async function applyMigrations(url, directory) {
  const sql = connect(url);
  try {
    const deadline = Date.now() + 180_000;
    for (;;) {
      try {
        const [row] = await sql`SELECT to_regclass('auth.users') IS NOT NULL AS auth, to_regclass('storage.buckets') IS NOT NULL AS storage,
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='storage' AND table_name='objects' AND column_name='owner_id') AS storage_ready`;
        if (row.auth && row.storage && row.storage_ready) break;
      } catch { /* The database is still starting. */ }
      if (Date.now() > deadline) throw new Error('The auth and storage schemas did not appear. Check the auth and storage containers.');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await sql`CREATE SCHEMA IF NOT EXISTS supabase_migrations`;
    await sql`CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text)`;
    const applied = new Set((await sql`SELECT version FROM supabase_migrations.schema_migrations`).map(row => row.version));
    for (const file of fs.readdirSync(directory).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
      const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
      if (applied.has(version)) continue;
      const text = fs.readFileSync(path.join(directory, file), 'utf8');
      await sql.begin(async tx => {
        await tx.unsafe(text);
        await tx`INSERT INTO supabase_migrations.schema_migrations (version, statements, name) VALUES (${version}, ${[text]}, ${rest.join('_')})`;
      });
      console.log(`Applied migration ${file}`);
    }
  } finally { await sql.end(); }
}

/**
 * The Docker form of scripts/bootstrap-owner.sql. The owner's address is allowed
 * in at once; the account becomes administrator after its first verified
 * Google sign-in. It runs once per address, so later changes made in Workspace
 * admin are kept.
 */
export async function promoteOwner(sql, email) {
  const [state] = await sql`SELECT promoted_at FROM banana_docker.owner_bootstrap WHERE email=${email}`;
  if (state?.promoted_at) return;
  await sql.begin(async tx => {
    if (!state) {
      await tx`INSERT INTO public.authorized_emails (email, is_active) VALUES (${email}, true) ON CONFLICT (email) DO UPDATE SET is_active=true`;
      await tx`INSERT INTO banana_docker.owner_bootstrap (email) VALUES (${email})`;
    }
    const promoted = await tx`UPDATE public.profiles p SET role='admin' FROM auth.users u
      WHERE p.id=u.id AND lower(btrim(u.email))=${email} AND u.email_confirmed_at IS NOT NULL AND NOT coalesce(u.is_anonymous,false) RETURNING p.id`;
    if (promoted.length) {
      await tx`UPDATE banana_docker.owner_bootstrap SET promoted_at=now() WHERE email=${email}`;
      console.log('The owner account is now an administrator.');
    }
  });
}

/**
 * State that only the Docker server keeps, outside the hosted schema: the owner
 * bootstrap marker and the Seedance tasks MCP clients started. No API role can
 * read this schema; only this process (as `postgres`) does.
 */
export async function ensureDockerSchema(sql) {
  await sql`CREATE SCHEMA IF NOT EXISTS banana_docker`;
  await sql`REVOKE ALL ON SCHEMA banana_docker FROM PUBLIC, anon, authenticated, service_role`;
  await sql`CREATE TABLE IF NOT EXISTS banana_docker.owner_bootstrap (email text PRIMARY KEY, authorized_at timestamptz NOT NULL DEFAULT now(), promoted_at timestamptz)`;
  // A row is written before the provider is called (`starting`, no task yet).
  await sql`CREATE TABLE IF NOT EXISTS banana_docker.mcp_videos (
    generation_id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id text UNIQUE, provider text NOT NULL, request jsonb NOT NULL,
    usage_id uuid NOT NULL, usage_model text NOT NULL, usage_cost numeric,
    state text NOT NULL DEFAULT 'starting' CHECK (state IN ('starting','processing','completed','failed')), error text,
    created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz)`;
  await sql`CREATE INDEX IF NOT EXISTS mcp_videos_user_state ON banana_docker.mcp_videos (user_id, state, created_at DESC)`;
  // The provider task is registered through PostgREST with the MCP video's ID in
  // the X-Banana-Mcp-Video header (only the app's own server-side calls carry
  // it). In that same transaction the video gets its task and one usage row; if
  // either write fails, the registration rolls back and is retried as a whole.
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION banana_docker.link_mcp_video() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    DECLARE video banana_docker.mcp_videos;
    BEGIN
      UPDATE banana_docker.mcp_videos SET task_id = NEW.task_id, provider = NEW.provider, state = 'processing'
      WHERE generation_id = nullif(current_setting('request.headers', true), '')::json->>'x-banana-mcp-video'
        AND user_id = NEW.user_id AND state = 'starting'
      RETURNING * INTO video;
      IF FOUND THEN
        INSERT INTO public.usage_logs (id, user_id, action, model, prompt, image_count, estimated_cost)
        VALUES (video.usage_id, video.user_id, 'video_generate', video.usage_model, left(video.request->>'prompt', 500), 1, video.usage_cost)
        ON CONFLICT (id) DO NOTHING;
      END IF;
      RETURN NEW;
    END $$;
    REVOKE ALL ON FUNCTION banana_docker.link_mcp_video() FROM PUBLIC;
    DROP TRIGGER IF EXISTS link_mcp_video ON public.provider_tasks;
    CREATE TRIGGER link_mcp_video AFTER INSERT ON public.provider_tasks FOR EACH ROW EXECUTE FUNCTION banana_docker.link_mcp_video();`);
}

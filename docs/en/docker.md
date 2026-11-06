# Run the web workspace with Docker

[Home](../../README.md) · [Türkçe](../tr/docker.md) · [Keys](models.md) · [Vercel + Supabase deployment](deploy.md)

`compose.yaml` runs the **same web workspace as the hosted deployment** on your own server: the same frontend, the same `api/` functions, the same Supabase schema and row-level security. Google sign-in, invitations, Workspace admin, usage reports, the durable image queue, resumable video uploads and public folder links all work. Nothing is hosted at Vercel or Supabase.

| Container | Image | Replaces |
| --- | --- | --- |
| `app` | built from this repository | Vercel: frontend, functions, Queues, Cron; the Supabase API gateway |
| `db` | `supabase/postgres` | Supabase Postgres |
| `auth` | `supabase/gotrue` | Supabase Auth (Google sign-in) |
| `rest` | `postgrest/postgrest` | Supabase Data API |
| `storage` | `supabase/storage-api` | Supabase Storage (private `media` bucket, files on a volume) |

Only `app` is published, on `127.0.0.1:8080` by default. It serves the site and forwards `/auth/v1`, `/rest/v1` and `/storage/v1` to the internal services, so the browser uses one address. Image and video generation run at the providers; the server's CPU load stays low. The idle stack uses about 350 MB of RAM; the images need about 4 GB of disk, and media storage grows with the gallery.

## Before you start

- A Linux server with Docker and the Compose plugin.
- A domain with HTTPS in front of the server (Caddy, Traefik, nginx, Cloudflare Tunnel). The app requires `https://` except on `localhost`.
- A Google Cloud project for the OAuth client (step 3).
- The provider keys you plan to use — see the [key guide](models.md).

## 1. Create the configuration

```sh
git clone https://github.com/orkunisitmak/banana-studio.git
cd banana-studio
node scripts/docker-env.mjs
```

Without Node on the server, run the same script in a container:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w node:24-slim node scripts/docker-env.mjs
```

`--user` makes `.env` belong to you, not root. The script copies `.env.example` to `.env` and fills the internal secrets (`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `JWT_KEYS`, `JWT_JWKS`, `CRON_SECRET`). It never overwrites a value that is already set. Keep `.env` private and back it up: the database and keys depend on it.

## 2. Fill in `.env`

| Variable | Value |
| --- | --- |
| `BANANA_PUBLIC_URL` | The address people open, for example `https://studio.example.com`. No path or trailing slash. |
| `BANANA_OWNER_EMAIL` | Your Google account's address. It is allowed in at the first start and becomes administrator after your first sign-in. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From step 3. |
| Provider keys | `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `FAL_KEY`, `EVOLINK_API_KEY`, `YOUTUBE_API_KEY` — only the ones you use. |
| `FAL_ADMIN_KEY`, `OPENAI_ADMIN_KEY`, `OPENAI_PROJECT_ID` | Optional admin billing reports. |
| `BANANA_BIND`, `BANANA_PUBLISH_PORT` | Host address and port of `app` (default `127.0.0.1` and `8080`). Keep the loopback default behind a reverse proxy on the same host. With another address, `app` ignores `X-Forwarded-For` and rate-limits sign-in by the connecting address; set `BANANA_TRUST_PROXY=true` only when a firewall lets nothing but your proxy reach the port. |

Leave `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` empty: they belong to the Vercel deployment. The Docker server derives them.

## 3. Create the Google OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com), configure the OAuth consent screen.
2. Create an OAuth client of type **Web application**.
3. **Authorized JavaScript origins:** your `BANANA_PUBLIC_URL`.
4. **Authorized redirect URIs:** `BANANA_PUBLIC_URL` + `/auth/v1/callback`, for example `https://studio.example.com/auth/v1/callback`.
5. Copy the client ID and secret into `.env`. If the consent screen is in testing mode, add your account as a test user.

## 4. Start

```sh
docker compose up -d --build
docker compose ps
```

The first start builds the app image and creates the database. The `app` container applies `supabase/migrations` automatically when `auth` and `storage` have created their schemas, then reports `healthy`. Point your reverse proxy at `127.0.0.1:8080` (or the `BANANA_PUBLISH_PORT` you set). It must pass the original `Host` header, append the client address to `X-Forwarded-For` (Auth rate-limits sign-in per client by its last entry) and allow request bodies up to your upload limit (nginx: `proxy_set_header Host $host;`, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, `client_max_body_size 512m;`). Cloudflare Tunnel sets `X-Forwarded-For` itself.

**Checkpoint:** open `BANANA_PUBLIC_URL`, sign in with Google using `BANANA_OWNER_EMAIL`, and you see the gallery and **Workspace admin**. Invite other people from Workspace admin; an uninvited Google account is refused.

## Connect Claude, ChatGPT or another assistant (MCP)

The server is also a remote [MCP](https://modelcontextprotocol.io) server at **`BANANA_PUBLIC_URL/mcp`**. Add it as a custom connector (Claude: **Settings → Connectors → Add custom connector**; ChatGPT: **Settings → Connectors**; Claude Code: `claude mcp add --transport http banana-studio https://studio.example.com/mcp`). No key is copied anywhere:

1. The assistant registers itself with the workspace's sign-in service.
2. A browser window opens `/oauth/consent`. Sign in with your invited Google account and select **Allow**.
3. The assistant now acts as you. Invitation checks, provider routing and usage reports apply as in the web app.

| Tool | What it does |
| --- | --- |
| `list_models` | Image and video models, and whether the server has a key for each |
| `generate_image` | Queues an image (GPT Image 2.5, Nano Banana Pro/2.1) with optional HTTPS reference images and folder |
| `generate_video` | Starts a Seedance 2.0/2.5 video from text or first/last frames (fal.ai or OpenRouter key) |
| `get_generation` | Waits for a result and returns a download URL valid for one hour; saves finished MCP videos to the gallery |
| `list_generations`, `list_folders` | Browse the gallery |

Results appear in the gallery like any other generation. See and disconnect assistants at **`/oauth/connections`**; disconnecting ends their access at once. Assistants register without approval from an administrator, but only invited accounts can approve them. Set `BANANA_MCP_DYNAMIC_REGISTRATION=false` to turn registration off.

## Data, backups and updates

| Volume | Contents |
| --- | --- |
| `banana-studio_db-data` | Postgres: accounts, gallery records, folders, People, templates, jobs, usage |
| `banana-studio_storage-data` | Uploaded references and generated images/videos |
| `banana-studio_db-config` | Database encryption key material created by the Postgres image |

- **Backup:** stop `app` so the database and the media files match, write both into a private directory, then start it again. Each backup gets a new timestamped name, so older backups are never overwritten. If a step fails, the partial files are removed and `app` is started again:

  ```sh
  (
    set -eu
    umask 077 && mkdir -p backups
    stamp=$(date +%Y%m%d-%H%M%S)
    trap 'rm -f backups/.partial-*; docker compose start app' EXIT
    docker compose stop app
    docker compose exec -T db pg_dump -U postgres -Fc postgres > backups/.partial-db
    docker run --rm --volumes-from "$(docker compose ps -q storage)" busybox tar czf - -C /var/lib/storage . > backups/.partial-media
    mv backups/.partial-db "backups/banana-db-$stamp.dump"
    mv backups/.partial-media "backups/banana-media-$stamp.tgz"
  )
  ```

  The media command reads the volume the running `storage` container uses, so it also works with another Compose project name; it fails when `storage` is not running.
- **Update:** `git pull && docker compose up -d --build`. New migrations are applied at start.
- **Stop / remove:** `docker compose down` keeps the volumes; `docker compose down -v` deletes all data permanently.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `BANANA_MAX_UPLOAD_BYTES` | `524288000` (500 MB) | Largest single media file Storage accepts. |
| `BANANA_IMAGE_WORKERS` | `4` | Image jobs processed at the same time by `app`. |
| `BANANA_MCP_DYNAMIC_REGISTRATION` | `true` | Lets MCP clients register themselves. |

Set them in `.env`, then run `docker compose up -d`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `app` stays `starting`, logs mention auth and storage schemas | Check `docker compose logs auth storage`; usually a wrong `POSTGRES_PASSWORD` after the database was first created with another one. |
| Google shows `redirect_uri_mismatch` | The redirect URI must be exactly `BANANA_PUBLIC_URL/auth/v1/callback`. |
| Sign-in succeeds, then access is denied | That account is not invited. The owner is the address in `BANANA_OWNER_EMAIL`. |
| “Use the HTTPS URL of your own Supabase project” | `BANANA_PUBLIC_URL` is plain `http://` on a host other than `localhost`. Put HTTPS in front. |
| `… is not configured. The workspace owner must add …` | Add that key to `.env` and run `docker compose up -d`. |
| Large uploads fail | Raise the proxy's body limit and, if needed, `BANANA_MAX_UPLOAD_BYTES`. |

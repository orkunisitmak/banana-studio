# Run Banana Studio with Docker

[Home](../../README.md) · [Türkçe](../tr/docker.md) · [Keys](models.md) · [Web deployment](deploy.md)

The Docker image runs the same standalone workspace as the Mac and Windows apps — one Node.js server, SQLite and media files on disk — and serves it to a browser. You do not need Supabase, Vercel or Google sign-in. Image and video generation still happen at the providers; the server only sends requests, follows jobs and stores the results.

| | Docker server | Hosted web ([deploy.md](deploy.md)) |
| --- | --- | --- |
| Infrastructure | One container on any Linux host | Vercel + Supabase |
| Sign-in | One shared access token | Google accounts, admin approval |
| Data | SQLite + files in a Docker volume | Supabase Postgres + Storage |
| Provider keys | Server environment | Server environment |
| Public folder links | Not available | Available |

The Docker server is a **single workspace**: everyone who has the access token sees and edits the same gallery. Use the hosted web deployment if each person needs their own account.

## Start

1. Install Docker with the Compose plugin.
2. Clone the repository and create the configuration file:

   ```sh
   git clone https://github.com/orkunisitmak/banana-studio.git
   cd banana-studio
   cp .env.example .env
   ```

3. In `.env`, set `BANANA_ACCESS_TOKEN` to a long random secret, for example the output of `openssl rand -hex 24`. It must have at least 16 characters.
4. Add the provider keys you plan to use (`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `FAL_KEY`, `EVOLINK_API_KEY`, `YOUTUBE_API_KEY`). The [key guide](models.md) explains which features each key covers. Leave the Supabase and Vercel variables empty.
5. Start it:

   ```sh
   docker compose up -d --build
   ```

6. Open <http://localhost:8080>, enter the access token and select **Open workspace**.

**Checkpoint:** the top bar shows **Self-hosted workspace**, an empty gallery and the generation controls. `docker compose ps` reports the container as `healthy`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `BANANA_ACCESS_TOKEN` | — (required) | Sign-in secret. The server keeps only its SHA-256 digest; changing it signs everyone out. |
| `BANANA_PUBLIC_URL` | `http://localhost:8080` | The exact address people type in the browser. Requests for any other host are rejected. |
| `BANANA_PUBLISH_PORT` | `8080` | Host port that Compose publishes. If you change it, change `BANANA_PUBLIC_URL` too. |
| Provider keys | empty | Read when the container starts. Run `docker compose up -d` after editing them. |

The image also reads `BANANA_PORT` (container port, `8080`) and `BANANA_DATA_DIR` (`/data`).

## Put it on a domain

Run it behind a reverse proxy that terminates HTTPS (Caddy, Traefik, nginx, Cloudflare Tunnel) and set the public address:

```sh
BANANA_PUBLIC_URL=https://studio.example.com
```

The proxy must forward the original `Host` header (the default for Caddy, Traefik and Cloudflare Tunnel; `proxy_set_header Host $host;` in nginx) and allow uploads of up to 512 MB (`client_max_body_size 512m;` in nginx). With an `https://` address the session cookie is marked `Secure`. Do not publish the plain HTTP port to the internet; bind it to the proxy only, for example `127.0.0.1:8080:8080`.

A wrong access token waits one second before answering, but the token is the only protection: use a long random value, and put extra access control in the proxy if the address is public.

## Data, backups and updates

Everything lives in the `banana-data` volume: `workspace.sqlite` (gallery, folders, templates, People, jobs) and `media/` (uploaded references and generated results). Generation needs no local CPU or GPU; disk use grows with your gallery.

- **Back up:** stop the container so SQLite is consistent, then copy the volume:

  ```sh
  docker compose stop
  docker run --rm -v banana-studio_banana-data:/data -v "$PWD":/backup busybox tar czf /backup/banana-data.tgz -C /data .
  docker compose start
  ```

- **Update:** `git pull && docker compose up -d --build`. The volume is kept.
- **Remove:** `docker compose down` keeps the data; `docker compose down -v` deletes it permanently.

The volume name is prefixed with the Compose project name (the folder name by default); `docker volume ls` shows it.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| The container exits at once | `docker compose logs` names the missing or invalid variable: usually `BANANA_ACCESS_TOKEN` is empty or too short. |
| `Invalid local host.` | The browser address does not match `BANANA_PUBLIC_URL`, or the proxy rewrites `Host`. |
| `Cross-origin requests are not allowed.` when signing in | Open the exact `BANANA_PUBLIC_URL`, including `https://`; the proxy must not change the browser's `Origin`. |
| `… is not configured. The workspace owner must add …` | Add that key to `.env` and run `docker compose up -d`. |
| Large uploads fail behind a proxy | Raise the proxy's request-body limit. |

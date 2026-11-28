# Deploy your own web workspace

[Home](../../README.md#self-hosting) · [Türkçe](../tr/deploy.md) · [Keys](models.md) · [Developer guide](development.md)

This installs a **new, empty Banana Studio** at your own web address. People can use it from Windows, Mac, phones or tablets. It does not connect to the maintainer's gallery or copy anyone's accounts, media or provider keys.

You can follow the main path entirely in a browser. “Deploy” means publishing the application on a hosting service. “Fork” means making a copy of this repository in your own GitHub account. The SQL below creates your application's database structure; you do not need to write it yourself.

## Before you start

| Account / service | Why it is needed |
| --- | --- |
| [GitHub](https://github.com) | Your copy of the source code |
| [Supabase](https://supabase.com/dashboard) | Database, Google sign-in and private media storage |
| [Vercel](https://vercel.com) | Website, backend functions, queue and scheduled job recovery |
| [Google Cloud](https://console.cloud.google.com) | OAuth credentials for signing in with Google |
| Your chosen AI providers | Generation and text assistance; [key table](models.md) |

**Hosting requirement:** the checked-in [Vercel configuration](../../vercel.json) runs a recovery Cron every minute. Use a plan that supports one-minute Cron jobs, currently Pro or Enterprise. Hobby rejects this schedule. Queues also need to be available for your project. See [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [Queues](https://vercel.com/docs/queues). AI API usage, hosting and storage have their own service charges. For personal Mac use without hosting, choose the [standalone app](desktop.md).

Do not delete the Cron or queue configuration just to get a green frontend deployment. They are part of the supported OpenAI image-job recovery flow.

## 1. Copy the repository

Open [banana-studio](https://github.com/orkunisitmak/banana-studio), click **Fork**, select your GitHub account and create the fork. Keep the source files, `api/`, `supabase/` and `vercel.json` together.

**Checkpoint:** the browser now shows **your account / banana-studio**. You will import this copy into Vercel.

## 2. Create a fresh Supabase project

In the [Supabase dashboard](https://supabase.com/dashboard), create a new project. Choose your organization and region, set a strong database password, save it privately and wait for the project to be ready.

Use an empty project reserved for this application. The baseline creates tables and policies with fixed names; it is not an upgrade script for an unrelated database.

## 3. Create the tables and private media bucket

1. Open [the baseline SQL file](../../supabase/migrations/20261019123903_banana_studio_baseline.sql). On GitHub, use **Raw** or the copy button to copy the **entire file**.
2. In your new Supabase project, open **SQL Editor → New query**.
3. Paste the SQL and select **Run**. Run the baseline once on the new project, then apply **each subsequent file** in [migrations](../../supabase/migrations/) in filename order. The later migrations include the server-side model and routing preferences. For an existing installation, apply only the migrations not already installed.
4. In **Table Editor**, check for tables such as `profiles`, `generations`, `folders` and `authorized_emails`.
5. In **Storage**, confirm the `media` bucket is **private**. The [image output access migration](../../supabase/migrations/20261128121000_image_output_access.sql) grants access to server-saved results, including GIF/SVG and Seedream outputs; do not make the bucket public to work around a missing migration. Serve user media from a separate storage origin that does not receive application cookies.

**Checkpoint:** SQL Editor reports success, the tables exist, and `media` is private. A CLI-based migration path is also possible for developers; do not apply both methods to the same schema without reconciling migration history.

## 4. Import your fork into Vercel

In Vercel, choose **Add New → Project**, connect GitHub if needed, and import **your fork**. Use these settings:

| Setting | Value |
| --- | --- |
| Root directory | Repository root |
| Framework | Vite |
| Install command | `npm ci --ignore-scripts` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 24.x |

Keep the repository's Functions, Queue trigger and Cron configuration. A static-only host or uploading `dist/` alone does not provide this application's backend.

## 5. Add server environment variables

An environment variable is a named setting supplied to the application by Vercel. Add the following in the project setup or **Project Settings → Environment Variables**, targeting your Production deployment. Use your own service dashboards to copy values; do not put them into a source file on GitHub.

| Variable | What to enter | Required? |
| --- | --- | --- |
| `SUPABASE_URL` | Your project's URL from its Connect dialog | Yes |
| `SUPABASE_PUBLISHABLE_KEY` | Your project's publishable key; a legacy `anon` key is also accepted | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase backend credential: a server secret key or legacy `service_role` key; this is the app's existing variable name | Yes, for server-owned jobs and tasks |
| `CRON_SECRET` | A fresh random secret, preferably at least 32 characters, generated with your password manager | Yes |
| `FAL_KEY` | fal.ai key | Default image, creative text and video routes except MAGI-2; some video preprocessing |
| `EVOLINK_API_KEY` | EvoLink key | Required for MAGI-2; alternative for Seedance, H3 Max and creative text |
| `OPENAI_API_KEY` | OpenAI key | Direct route for Sunburst images and GPT-6.2 Sol |
| `OPENROUTER_API_KEY` | OpenRouter key | Alternative for supported images, creative text and Seedance modes |
| `ANTHROPIC_API_KEY` | Anthropic key | Direct route for Claude Opus 5.5 |
| `GEMINI_API_KEY` | Google Gemini key | Required for YouTube footage; direct route for Nano images and Gemini 4 Hydrogen |
| `YOUTUBE_API_KEY` | Key from a Google Cloud project with YouTube Data API v3 enabled | For YouTube lookup |

The Supabase Connect dialog and **Settings → API Keys** provide the project credentials. Keep the backend secret/service-role credential server-only. The app deliberately returns only the project origin and publishable key to its frontend. See [Supabase key types](https://supabase.com/docs/guides/getting-started/api-keys).

Store provider keys and `CRON_SECRET` as **Secret** environment variables where the dashboard offers that type. Never rename them with a `VITE_` prefix: that prefix exposes values to frontend builds. Leave unneeded providers unset. Optional admin billing variables in [.env.example](../../.env.example) are not required to start. See [Vercel environment variables](https://vercel.com/docs/environment-variables).

Select **Deploy**. Note your final address, for example `https://your-workspace.vercel.app`. Later changes to environment variables require a new deployment; saving a value alone does not change an existing deployment. If you also use Preview or Development, configure separate test credentials for those environments.

**Checkpoint:** the application opens at your Vercel URL. If it shows **Workspace setup is required**, check the Supabase URL/public key and redeploy before continuing.

## 6. Connect Google sign-in

1. In Supabase **Authentication**, open the Google provider and copy the project's callback URL.
2. In Google Cloud, configure the OAuth consent screen and create an OAuth client of type **Web application**.
3. Set the Vercel application origin as an authorized JavaScript origin. Set the Supabase callback as an authorized redirect URI.
4. Copy the client ID and client secret into the Supabase Google provider and enable it.
5. In Supabase Auth URL settings, set your Vercel origin as Site URL and allow its application redirect URL. The app returns to that origin after sign-in.
6. If the Google consent app is in testing mode, add your sign-in account as a test user.

Here, **origin** means the beginning of your site address, such as `https://your-workspace.vercel.app`, without a page path. Use your actual address, not this example:

| Field | Value to use |
| --- | --- |
| Google: authorized JavaScript origins | Your Vercel site address |
| Google: authorized redirect URIs | The callback copied from Supabase's Google provider, not your Vercel address |
| Supabase: Site URL | Your Vercel site address |
| Supabase: Redirect URLs | Your exact Vercel origin, which the app uses as its return URL; also add its trailing-`/` form |

Use [Supabase's Google setup instructions](https://supabase.com/docs/guides/auth/social-login/auth-google) for current dashboard labels. These OAuth credentials are separate from Gemini and YouTube API keys. Do not add them to public frontend code.

**Checkpoint:** you can sign in with Google at your deployed app. Application access may still be denied at this stage: the next step authorizes the first owner.

## 7. Activate your owner account

1. Sign in to the deployed app with your own Google account **once**, so Supabase creates your user and profile.
2. In Supabase **Authentication → Users**, confirm that this account exists.
3. Open [bootstrap-owner.sql](../../scripts/bootstrap-owner.sql), copy it to a **new SQL Editor query**, and change only `replace-me@example.invalid` to your own verified, lowercase email address.
4. Run it in **your** Supabase project's SQL Editor. Do not commit the edited script or your email to the repository.
5. Refresh/sign in again. You should now have administrator access. Invite other users from the app's administration controls as needed.

The script deliberately refuses its placeholder and unverified/nonexistent accounts. Registration alone never creates an administrator.

**Checkpoint:** you can open the gallery and admin controls. An uninvited account still has no application access.

## 8. Check the complete workspace

1. Open **AI settings**. Choose an enabled text model and provider. With `FAL_KEY` configured, Claude Opus 5.5 can use its default fal.ai route.
2. Choose an image model and match its route to a configured key. For example, use Sunburst on fal.ai or explicitly select OpenAI if using `OPENAI_API_KEY`.
3. Submit one test image with your own prompt. This is a real provider request and uses your provider's balance.
4. Verify that the result finishes, stays in the gallery after refresh and can be downloaded.
5. Check that Vercel lists the `banana-image-jobs` queue trigger and the `/api/image-job-sweep` Cron from `vercel.json`.
6. If using YouTube, configure the [lookup and footage credentials](models.md#creative-text-and-youtube-footage), then test lookup and analysis separately.

Your web workspace is now usable from its URL on Windows, Mac and mobile browsers. It is independent of the standalone desktop database. As its owner, monitor provider usage, storage, backups and hosting limits.

## Troubleshooting

| What you see | Check / next action |
| --- | --- |
| Deployment rejects the Cron schedule | Use a Vercel plan with one-minute Cron support. The checked-in schedule is not compatible with Hobby. |
| “Workspace setup is required” | Check exact Supabase variable names, the URL and publishable key; redeploy. |
| Google redirect mismatch | Compare your Google redirect URI with the callback shown in Supabase; compare the app origin with Supabase URL settings. |
| Google login succeeds, then access is denied | Sign in once, then run the owner bootstrap with that verified email. Later users need invitations. |
| “Set your verified, lowercase owner email” | Replace the placeholder in the SQL Editor copy, using lowercase and no extra spaces. |
| Missing provider / rejected model | Match the selected model to the [provider table](models.md); check account credits and model access. |
| Job remains queued or cannot save | Check the queue, Cron, service-role/server secret setting and Vercel function errors. Keep `media` private and preserve the migration's policies. |
| Nothing changed after saving a key | Redeploy the web app. On Mac, use Provider keys → Save instead. |

For code-level work, logs and schema changes, continue with the [developer guide](development.md). See [SECURITY.md](../../SECURITY.md) before sharing logs or screenshots. The app's server configuration and [baseline](../../supabase/migrations/20261019123903_banana_studio_baseline.sql) are the source of truth for its required settings.

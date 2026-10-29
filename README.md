<p align="center">
  <img src="docs/assets/brand.svg" width="680" alt="Banana Studio — images, edits, thumbnails and video" />
</p>

<p align="center"><strong>From a rough idea to images, YouTube thumbnails and video.</strong><br />An open source creative workspace, powered by your own API keys.</p>

<p align="center">
  <strong>English</strong> · <a href="docs/tr/README.md">Türkçe</a> ·
  <a href="https://github.com/orkunisitmak/banana-studio/releases/latest">Download for Mac / Windows</a> ·
  <a href="#features">Features</a> · <a href="#self-hosting">Web setup</a>
</p>

<p align="center"><img src="docs/assets/gallery-real.jpg" width="1200" alt="Real iPhone episode thumbnail generations in the project owner's hosted gallery, with identity references, prompt and generation controls" /></p>

<p align="center"><sub>Real creations and interface captures from the project owner's account, shared with permission. <a href="docs/assets/README.md">About the demos</a></sub></p>

<a id="english"></a>

**Banana Studio brings image generation, selected-area editing, thumbnail planning and video into one gallery.** Start with a sentence, reference images or a YouTube episode. Explore concepts with Brainstorm, refine instructions with Enhance, then generate and compare the results. You do not need to write code to use the Mac or Windows app.

The app is free under the [MIT license](LICENSE). AI providers bill their API usage separately; model credits are not included. Generation needs internet access.

<a id="features"></a>

## Explore ideas with Brainstorm

Turn one brief into **multiple distinct concepts**, then generate multiple images per concept. Choose **Simple** for general ideas or **YouTube** for cover concepts. Idea count and images per idea are separate controls: five ideas × four images produces twenty results.

Brainstorm uses your brief, selected People and the roles of your references. For YouTube covers it directs the model to use readable composition, camera-facing people and different wardrobe plans across ideas, unless your brief specifies a fixed outfit. Your own creative instructions remain part of the request.

<p align="center"><img src="docs/assets/brainstorm-real.jpg" width="1000" alt="Brainstorm panel over real generated thumbnails: YouTube mode, five ideas, grouped identity photos and images-per-idea total" /></p>

## Refine a prompt with Enhance

Write a short draft in your own words. **Enhance** prepares more specific instructions for the chosen image or video model: subject, composition, lighting, reference roles and, for video, motion and timing. It also works inside the area editor. Review the result, adjust it yourself or use **Revert** to restore the original draft.

Production descriptions are prepared in English even from a Turkish draft; requested visible text, names and quoted dialogue keep their intended language. Select **Opus 5.5, GPT-6.1 Sol or Gemini 3.8 Flash** and the thinking level in **AI settings**. The initial creative setting is **Opus 5.5 / Medium**. Details retain the preparation model and reasoning level when recorded.

## Edit an area, keep the rest

Open **Edit image**, draw a filled freehand **Mask** or **Rectangle**, then describe the change. Each selection is a layer: **Shift + draw** adds another, and the layer strip lets you select, redraw or remove areas. Add extra image references and use `@` mentions in the edit prompt. Choose the model, quality and image count; Enhance is optional.

**Pixels outside the final selection are preserved from the source.** References alone stay in normal generation mode; protected editing begins only when you explicitly select an edit area. For a change that needs a new silhouette, include enough context in your selection—for example, the hand and wrist when removing a held object.

<p align="center"><img src="docs/assets/area-edit-real.jpg" width="1000" alt="A real generated cover in Edit image: headline and price selected in a rectangle layer, while the person's face stays outside the selected region" /></p>

Edits run as jobs, with progress and new gallery results. Submit another attempt without waiting for the previous output. Inspect the **source/result comparison slider**, return to the source or choose **Edit this result** to continue.

<details>
<summary>See the edit controls and before/after comparison</summary>

<p><img src="docs/assets/edit-controls-real.jpg" width="1000" alt="Actual edit composer with reference upload, prompt, model, quality, plus/minus image count and Enhance" /></p>
<p><img src="docs/assets/comparison-real.jpg" width="1000" alt="Source and edited cover compared with the gallery's movable divider; the headline changes while the portrait is retained" /></p>

The rectangle and draft above demonstrate the editor controls; no new generation was submitted for these captures. The comparison shows a previously completed edit from the same account.

</details>

## Bring a YouTube episode into the workflow

Search for a channel or video with **YT**, analyze the footage, review the episode's main promise and choose the people to feature. Use that brief for Brainstorm or edit it before generating. Add previous channel covers as style references, identity photos for People and product images for specific objects. **YouTube Preview** lets you inspect a finished cover in a simulated YouTube layout.

The video reader and creative brief use different provider routes. The [key guide](docs/en/models.md) explains the combination. [Follow the thumbnail workflow →](docs/en/guide.md#plan-a-youtube-thumbnail)

## Make video from text, images and references

Use model-specific controls for duration, aspect ratio, quality and inputs. **Seedance 2.0 / 2.5 Relaxed** and **MiniMax H3 Max** provide different workflows; the interface shows the selected mode's controls. Seedance 2.5 first/last-frame mode uses two still images to direct the opening and ending.

MiniMax H3 Max modes: **Text to Video Max · Image to Video Max · Reference to Video Max · Extend Video Max · Lip Sync Max · Recast**. Add image, video or audio references where supported, prepare motion instructions with Enhance, follow the job, then play or download the result.

<p align="center"><a href="https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4"><img src="docs/assets/video-preview.gif" width="640" alt="Animated preview of a real generated video: two costumed characters emerge from plush toys inside an arcade claw machine" /></a></p>

<p align="center"><strong><a href="https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4">Download the real 15-second clip (MP4) →</a></strong><br /><sub>A previously generated MiniMax H3 clip from the owner's account. Compressed, silent documentation preview; not a new benchmark of the current Max model.</sub></p>

<details>
<summary>See the real video player and saved generation details</summary>

<p><img src="docs/assets/video-real.jpg" width="1000" alt="Actual gallery video player with the selected clip, prompt, saved model, duration and quality" /></p>

</details>

## Keep the whole project together

| Feature | What it does |
| --- | --- |
| **Image generation** | GPT Image 2.5, Nano Banana Pro and Nano Banana 2.1; aspect ratio, size/custom dimensions, quality and image count where supported. |
| **References and `@` mentions** | Upload or reuse images; assign identity, object, style or scene roles. Attaching a reference does not force an area edit. |
| **People** | Save grouped identity photos; several photos of one person still represent one person. |
| **Reference library and templates** | Reuse source material and saved prompt/settings combinations across projects. |
| **Re-create and Variation** | Restore a result's prompt and settings, or explore a new variation. |
| **Gallery organization** | Nested folders, favorites, search, image/video filters, grid density, multi-select and moving work between folders. |
| **Viewer and comparison** | Natural image proportions, zoom/pan, side-by-side image comparison and source/edit slider. Arrow-key navigation, Details toggle with **Shift+B**, and mobile swipe navigation/dismissal. |
| **Jobs and history** | Progress, notifications, completed results and recoverable task information; hosted OpenAI image jobs use a durable queue. |
| **Generation details** | Available prompts, references, dimensions, model, quality, cost, generation time, preparation model/reasoning and saved edit layers/source. Older records may have fewer fields. |
| **Export and sharing** | Download images/videos. Hosted web workspaces also support expiring public folder links for viewing and downloading completed images. |
| **Workspace administration** | Hosted account access and owner/admin controls; standalone desktop keeps its own local workspace. |

[Read the illustrated user guide →](docs/en/guide.md)

## Get started

| Your device | Available today | Start here |
| --- | --- | --- |
| Mac with Apple Silicon | Standalone app, macOS 13.5+ | [Download](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-macos-arm64.zip) · [Installation guide](docs/en/desktop.md) |
| Mac with Intel | Standalone app, macOS 13.5+ | [Download](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-macos-x64.zip) · [Installation guide](docs/en/desktop.md) |
| Windows 10/11, 64-bit Intel/AMD | Standalone portable app | [Download](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-windows-x64.zip) · [Installation guide](docs/en/desktop.md#windows-download-and-open) |
| Other computers, phones and tablets | Web version in a browser | Open a deployed workspace; its owner manages access and provider keys. |

**Desktop quick start:** download → unzip → open (Mac: move to Applications first) → **Provider keys** → add the key for your model → generate. Both standalone apps need **no Supabase, Vercel, Google sign-in or separate Node installation**. The gallery stays on your computer. API keys stay in macOS Keychain or Windows Credential Manager. Keep the app open while jobs run; minimizing is fine. [First-open permissions, updates and backups →](docs/en/desktop.md)

## Models and API keys

An API key is a private credential that lets the app use your account with an AI provider. Add only the providers you plan to use. These are the routes implemented **in this app**, not a list of every service offering each model.

| Model or feature | Available providers (Auto priority) | Add any matching key |
| --- | --- | --- |
| GPT Image 2.5 — new images and protected area edits | OpenAI → OpenRouter → fal.ai → ChatGPT plan (Codex, desktop only) | `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `FAL_KEY`, or no key: `codex login` with ChatGPT |
| Nano Banana Pro / Nano Banana 2.1 | fal.ai → Google Gemini → OpenRouter | `FAL_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` |
| Claude Opus 5.5 — Enhance, Brainstorm, variations and creative briefs | OpenRouter | `OPENROUTER_API_KEY` |
| GPT-6.1 Sol — text features | OpenAI → OpenRouter | `OPENAI_API_KEY` / `OPENROUTER_API_KEY` |
| Gemini 3.8 Flash — text and YouTube footage analysis | Google Gemini → OpenRouter | `GEMINI_API_KEY` / `OPENROUTER_API_KEY` |
| Seedance 2.0 / 2.5 | EvoLink → fal.ai → OpenRouter (supported modes) | `EVOLINK_API_KEY` / `FAL_KEY` / `OPENROUTER_API_KEY` |
| MiniMax H3 Max — text/image/reference to video, extend, lip sync and recast | fal.ai | `FAL_KEY` |
| YouTube channel/video lookup | Google YouTube Data API v3 | `YOUTUBE_API_KEY` |

**Start with one provider:** an **OpenRouter key** can cover GPT/Nano images, Opus/GPT/Gemini text, footage analysis and supported Seedance video. A **fal.ai key** can cover GPT/Nano images, Seedance and H3 Max video; add a text provider if you want Enhance or Brainstorm. A **Gemini key** can cover Nano images and Gemini text/analysis. You do not need every key. YouTube search/metadata still needs its separate YouTube Data API key.

The default creative model remains **Opus 5.5 / Medium**. Choose models, thinking and **Auto / a specific provider** in **AI settings**. Routes are selected before submission and kept with saved jobs; an uncertain paid request is never resubmitted at another service. Results show their actual provider. Outside an approved edit area, source pixels remain protected on every image route.

OpenRouter Seedance currently supports text, first/last frames and image references in this app; it requires a fixed duration and aspect ratio, and Seedance 2.5 supports 480p/720p there. Use fal.ai or EvoLink for video/audio references, Edit/Extend, Auto duration or 2.5 at 1080p. **Relaxed** is specific to EvoLink. Some reference-video preprocessing also uses fal.ai. [Provider limits, key creation links and examples →](docs/en/models.md)

## How it is built

The shared interface is **React + TypeScript + Vite**. The native Mac shell uses **AppKit + WKWebView**, bundles a **Node.js** server, saves to **SQLite + local files**, keeps credentials in **Keychain** and updates through **Sparkle**. Windows uses **WinForms + WebView2**, the same Node/SQLite workspace and **Windows Credential Manager**. The hosted web version uses **Vercel Functions / Queues / Cron** and **Supabase Postgres / Auth / private Storage**, with Google sign-in.

Selected prompts and references go to the provider handling the task. Desktop and web galleries are separate; the desktop apps have no automatic cloud sync. [Data boundaries](SECURITY.md) · [Architecture and developer setup](docs/en/development.md) · [Release procedure](docs/RELEASING.md)

<a id="self-hosting"></a>

## Deploy your own web workspace

Want a browser workspace for Windows, Mac, mobile and your team? Fork the repository, create your own Supabase project and deploy the fork to Vercel. Add your Supabase configuration and provider keys as **server environment variables**, configure Google sign-in and activate the first administrator. The one-minute Cron schedule requires a Vercel plan that supports it; the frontend alone is insufficient.

The tutorial includes a browser-only SQL Editor route, the required variable table, verification checkpoints and troubleshooting. No existing Banana Studio database or personal account is included.

**[Open the step-by-step web deployment tutorial →](docs/en/deploy.md)**

<p align="center"><sub><a href="LICENSE">MIT</a> · <a href="SECURITY.md">Security</a> · <a href="docs/en/development.md">Contribute</a> · <a href="docs/THIRD_PARTY_NOTICES.md">Third-party notices</a> · <a href="docs/tr/README.md">Türkçe</a></sub></p>

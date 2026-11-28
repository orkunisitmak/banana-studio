# Models, providers and API keys

[Home](../../README.md) · [Türkçe](../tr/models.md) · [Mac setup](desktop.md) · [Web setup](deploy.md)

The **model** makes the content. The **provider** accepts the request and bills your account. The **API key** lets Banana Studio use that provider. A familiar model name does not mean every key can access it.

These tables describe the app's configured routes. Provider availability, account permissions, pricing and quotas can change independently. There are no bundled API credits or preconfigured private accounts.

## Choose accounts, not mandatory bundles

Add the keys you use in **Provider keys** on desktop. In **AI settings → Provider routing**, each model has one entry, even if several providers offer it. For new work the default is **fal.ai**, except **MAGI-2**, which uses **EvoLink**.

- **Named provider:** use that provider only. If its key is missing, add the key or change the setting; the app does not try another account.
- **Auto:** before submission, choose the first configured route in the table, from left to right. Auto must be selected explicitly.
- **Off:** remove the model from new submissions without deleting its history or cancelling accepted jobs.

An accepted job keeps its provider and task identity. Changing the route, switching the model off or restarting the app does not move the job to another provider. To recover it, keep the original provider credential available. An ambiguous timeout never triggers automatic paid resubmission. Preferences are saved in the local desktop workspace or, on hosted web, for the signed-in account.

**Hosted workspace policy:** In **AI settings → Provider routing → Workspace policy**, an owner or administrator can pin a provider or turn a model **Off** for everyone. A workspace pin overrides personal provider choices, but a member can still opt out with personal **Off**. **Let people choose** removes the override and restores each member's saved choice. Policy changes affect new submissions only. Desktop workspaces use their own local settings; they do not inherit hosted policy.

## Models and routes

| Kind | Model | Routes in Auto order (first is also the default) |
| --- | --- | --- |
| Image | Nano Banana Pro | fal.ai → Google Gemini → OpenRouter |
| Image | Nano Banana 2.1 | fal.ai → Google Gemini → OpenRouter |
| Image | GPT Image 2.5 Sunburst | fal.ai → OpenAI → OpenRouter → [ChatGPT plan (Codex)](#use-gpt-image-with-a-chatgpt-plan) |
| Image | GPT Image 2.6 Sunburst | fal.ai → OpenAI |
| Image | Seedream 5.5 | fal.ai |
| Video | Seedance 2.0 | fal.ai → EvoLink → OpenRouter |
| Video | Seedance 2.5 | fal.ai → EvoLink → OpenRouter |
| Video | MiniMax H3 Max | fal.ai → EvoLink |
| Video | Gemini Omni 1.2 Flash | fal.ai |
| Video | MAGI-2 | EvoLink |
| Text | [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview) | fal.ai → EvoLink → Anthropic → OpenRouter |
| Text | Gemini 4 Hydrogen | fal.ai → EvoLink → Google Gemini → OpenRouter |
| Text | GPT-6.2 Sol | fal.ai → EvoLink → OpenAI → OpenRouter |

### Use GPT Image with a ChatGPT plan

On Mac and Windows, GPT Image **2.5** can use the official [Codex CLI](https://developers.openai.com/codex/cli) with no API key. Install Codex, run `codex login`, choose **Sign in with ChatGPT**, then select **ChatGPT plan (Codex)** for this model. Banana Studio runs your `codex` binary in a read-only sandbox with a minimal environment, sends the prompt over stdin and reads the saved image. It checks the sign-in mode, never reads or forwards Codex tokens, and does not pass provider keys to the process. Set `CODEX_BIN` if Codex isn't on `PATH`; on Windows the app looks for `codex.exe`.

Images count toward your ChatGPT plan's Codex usage limits instead of API billing. Each image takes about a minute, Codex chooses the nearest supported canvas for the requested ratio, and quality/moderation settings are not forwarded. Protected edits still composite only the selected area and are rejected if Codex returns a different aspect ratio. Hosted web workspaces cannot use this route. Codex also keeps its own copy of each generated image under `CODEX_HOME` (by default `~/.codex`); Banana Studio does not delete it.

### Image generation, edits and layers

Attaching a reference guides a new image; it does not automatically enable **Edit area**. Select an area explicitly to protect the rest of the source. The app composites only that area onto the original and rejects a mismatched aspect ratio. A provider's reference API may call the operation “edit” even when no area was selected.

**Seedream 5.5** can generate images, edit with up to ten ordered reference images, or extract layers from one source with **Layerize**. The layer count includes the base image. Transparent output requires PNG. Layer extraction returns assets; it is not a protected edit of the original.

## Video differences

| Model | What changes with the route or operation |
| --- | --- |
| **Seedance 2.0** | Text, first/last frames and image references work across routes. fal.ai and EvoLink also accept video/audio references. Fixed duration: 4–15 seconds. |
| **Seedance 2.5** | fal.ai uses **US**; EvoLink uses **Relaxed**. Both support Edit and Extend as well as generation. fal's 480p draft is not a 4K final render. OpenRouter supports text, first/last frames and up to nine image references; use a fixed 4–30 seconds at 480p/720p. No video/audio references, Edit or Extend on OpenRouter. |
| **MiniMax H3 Max** | EvoLink supports text, first/last frames and reference generation at 480p/768p, 5–15 seconds. Choose fal.ai for Extend, Lip Sync or Recast. |
| **Gemini Omni 1.2 Flash** | fal.ai only. Generate from text, frames or references; Edit, Extend and Upscale act on a source video. Upscale changes resolution without a prompt. |
| **MAGI-2** | EvoLink only. Generate at 1080p, 4–30 seconds. Image mode takes a first frame and optionally a last frame. Reference mode accepts up to ten images, five videos and five audio clips; audio alone is allowed. |

Some reference-video preparation uses a separate fal.ai request and needs `FAL_KEY` even when generation uses another provider. Providers set their own prices, permissions and limits. Unsupported options do not trigger a different paid model or provider.

## Creative text and YouTube footage

Enhance, Brainstorm and variations use the selected creative text model and its provider. On fal.ai, creative text uses the [OpenRouter gateway](https://fal.ai/models/openrouter/router/openai/v1/chat/completions/api) with `FAL_KEY`; you do not also need an OpenRouter key. Thinking/reasoning is configured in AI settings.

Reading **actual YouTube footage** is separate: enable Gemini 4 Hydrogen and configure a **direct `GEMINI_API_KEY`**. A creative fal.ai, EvoLink or OpenRouter key does not replace it. The chosen creative model can write from Gemini's observations; it is not credited with watching the footage itself. Search and metadata require **`YOUTUBE_API_KEY`** (YouTube Data API v3); Google OAuth credentials are for hosted sign-in, not footage or search.

## Create a key

Create a key in the provider's dashboard and save it in the matching desktop field. For hosted web, the installation owner sets the corresponding **server** environment variable and redeploys. Configure only the providers and features you plan to use.

| Provider | Server variable | Start here |
| --- | --- | --- |
| fal.ai | `FAL_KEY` | [Key dashboard](https://fal.ai/dashboard/keys) |
| EvoLink | `EVOLINK_API_KEY` | [EvoLink account](https://evolink.ai) |
| OpenAI | `OPENAI_API_KEY` | [API keys](https://platform.openai.com/api-keys) |
| OpenRouter | `OPENROUTER_API_KEY` | [API keys](https://openrouter.ai/settings/keys) |
| Anthropic | `ANTHROPIC_API_KEY` | [Claude Console API keys](https://console.anthropic.com/settings/keys) |
| Google Gemini | `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) |
| YouTube Data API | `YOUTUBE_API_KEY` | [Enable the API and create credentials](https://developers.google.com/youtube/data/getting-started) |

For YouTube, create/select your own Google Cloud project, enable **YouTube Data API v3**, then create an API key for that project. A Gemini key is not a replacement for this enabled API and its quota. API billing and consumer chat subscriptions are separate products; check the provider's API account rather than assuming a chat subscription covers requests.

## Example setups

| You want… | Add and select… |
| --- | --- |
| One billing account for images, creative text and supported video | Add `FAL_KEY`; leave the models on fal.ai. MAGI-2 and footage analysis need other providers. |
| MAGI-2 only | Add `EVOLINK_API_KEY`; leave MAGI-2 on EvoLink. |
| Nano images + Gemini Enhance / Brainstorm with a direct key | Add `GEMINI_API_KEY`; select Google Gemini for Nano and Gemini 4 Hydrogen. |
| Direct GPT images + GPT text | Add `OPENAI_API_KEY`; select OpenAI for Sunburst and GPT-6.2 Sol. |
| YouTube analysis + new thumbnail concepts | Configure YouTube Data API for search and direct Gemini for footage, then select your creative text and image routes. |
| Continue using a supported alternative such as OpenRouter | Keep your key and pin that provider, or explicitly choose Auto to use the first available route. |

## Costs and key safety

The app's estimates are not a provider balance or invoice. Charges can include text reasoning, references, output quality, video duration and preprocessing. Set spending limits with your providers and review their usage dashboards.

Provider keys belong in **macOS Keychain / Windows Credential Manager** on desktop or **server environment variables** for web. Do not put them in a prompt, screenshot, GitHub issue, public repo or `VITE_*` variable. You do not need administrator-level billing keys to generate content. `FAL_ADMIN_KEY`, `OPENAI_ADMIN_KEY` and `OPENAI_PROJECT_ID` are optional hosted billing-report settings, not starter requirements.

Developer source of truth: [route registry](../../src/lib/providers.ts), [model choices](../../src/types.ts), [image routing](../../src/services/geminiService.ts), [video routing](../../src/services/runwayService.ts), [YouTube extraction](../../src/services/youtubeBriefService.ts), [native key fields](../../desktop/macos/Sources/BananaStudio/KeyVault.swift).

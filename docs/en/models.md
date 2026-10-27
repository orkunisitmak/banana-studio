# Models, providers and API keys

[Home](../../README.md) · [Türkçe](../tr/models.md) · [Mac setup](desktop.md) · [Web setup](deploy.md)

The **model** makes the content. The **provider** accepts the request and bills your account. The **API key** lets Banana Studio use that provider. A familiar model name does not mean every key can access it.

These tables describe the app's configured routes. Provider availability, account permissions, pricing and quotas can change independently. There are no bundled API credits or preconfigured private accounts.

## Choose accounts, not mandatory bundles

Add **one or more** provider keys in **Provider keys** on Mac or Windows. In **AI settings → Provider routing**, choose **Auto** or pin a provider for each model. The generation bar and edit composer show that choice too. Auto tries the configured routes in the table's order **before** sending a request. Missing keys are skipped; they are not required setup steps.

Once accepted, an image job keeps its provider across reloads and app restarts. Changing settings affects new work. Removing a key does not switch a saved job to another account/provider. Restore its original key to recover it. Ambiguous timeouts are never automatically submitted elsewhere. Routing preferences are saved in the desktop workspace database, or per account in this browser for hosted web installations.

## Models and routes

| Model / feature | Auto priority | Any matching key |
| --- | --- | --- |
| GPT Image 2.5 | OpenAI → OpenRouter → fal.ai | `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `FAL_KEY` |
| Nano Banana Pro / 2.1 | fal.ai → Google Gemini → OpenRouter | `FAL_KEY` / `GEMINI_API_KEY` / `OPENROUTER_API_KEY` |
| FLUX.2 klein · Local / FLUX 3 Klein · Local — free, runs on your GPU | Your own ComfyUI | `COMFYUI_URL` (for example `http://127.0.0.1:8188`) |
| Opus 5.5 — default creative model, Medium | OpenRouter | `OPENROUTER_API_KEY` |
| GPT-6.1 Sol — Enhance, Brainstorm, variations | OpenAI → OpenRouter | `OPENAI_API_KEY` / `OPENROUTER_API_KEY` |
| Gemini 3.8 Flash — text and footage analysis | Google Gemini → OpenRouter | `GEMINI_API_KEY` / `OPENROUTER_API_KEY` |
| Seedance 2.0 / 2.5 | EvoLink → fal.ai → OpenRouter | `EVOLINK_API_KEY` / `FAL_KEY` / `OPENROUTER_API_KEY` |
| H3 Max — Text/Image/Reference to Video, Extend, Lip Sync, Recast | fal.ai | `FAL_KEY` |
| Reference-video preprocessing, when required | fal.ai | `FAL_KEY` |
| YouTube search / channel and video metadata | YouTube Data API v3 | `YOUTUBE_API_KEY` |

All three image providers support reference-based generation. Uploading references does not enable protected editing automatically: explicitly select **Edit area** for that. The final selected area is composited onto the source; outside pixels stay original regardless of provider. Tier-based Nano outputs may be resized to the source canvas before compositing, only when their proportions match. A different canvas ratio is rejected. A provider's reference-image API may be named “edit”; the app's reference-generation prompt does not carry an area edit's source-preservation instructions.

**FLUX.2 klein · Local** needs no account. Run [ComfyUI](https://github.com/Comfy-Org/ComfyUI) on the same computer (or a machine the server can reach) with `flux-2-klein-4b-fp8.safetensors` in `models/diffusion_models`, `qwen_3_4b.safetensors` in `models/text_encoders` and `flux2-vae.safetensors` in `models/vae`, then set `COMFYUI_URL`. An 8 GB NVIDIA card is enough at 1K.

**FLUX 3 Klein · Local** uses the same ComfyUI and `COMFYUI_URL`, with `flux3-image-klein-int8-convrot.safetensors` in `models/diffusion_models` and `qwen3vl_4b_int8_convrot.safetensors` in `models/text_encoders` (the VAE is shared). Its Hugging Face repository is gated: sign in and accept the FLUX Kommunity License at `black-forest-labs/flux-3-image-klein-comfy`, which is free for commercial use under USD 5 million annual revenue. It renders text, keeps a person's identity and combines several references far better than FLUX.2 klein; on an RTX 3060 Ti a 1K image takes about 15–25 s and each reference adds roughly 25 s.

Both local models accept up to six references and support protected area edits. `COMFYUI_URL` is an address, not a secret; never point it at a ComfyUI instance you do not control.

Thinking/reasoning remains in AI settings. Choosing fal.ai alone does not enable Enhance or Brainstorm: fal's deprecated Any LLM endpoint is not used. An Anthropic key is not an OpenRouter key. A saved key still needs model access and sufficient API credit.

## Video differences

| Operation | EvoLink | fal.ai | OpenRouter in this app |
| --- | --- | --- | --- |
| Text to video | Yes | Yes | Yes |
| First frame / first + last frame | Yes | Yes | Yes |
| Image references | Yes | Yes | Yes, up to 9 |
| Video / audio references | Yes | Yes | Not enabled |
| Seedance 2.5 Edit / Extend | Yes | Yes | Not enabled |
| Seedance 2.5 Auto duration | Yes | Yes | Fixed 4–30 seconds |
| Seedance 2.5 resolution | 480p / 720p / 1080p | 480p / 720p / 1080p | 480p / 720p |
| Seedance 2.0 fixed duration | 4–15 seconds | 4–15 seconds | 4–15 seconds |

**Seedance 2.5 Relaxed** refers specifically to the existing EvoLink route. fal.ai and OpenRouter use standard Seedance 2.5. They have their own prices, permissions and restrictions. H3 Max remains fal.ai-only; another MiniMax model with a similar name is not substituted. Unsupported options are checked before generating; the app never silently changes to a different model.

Video analysis reads the actual YouTube footage with Gemini, directly or through OpenRouter's Google AI Studio endpoint. Opus/GPT can then write the creative brief from those observations; they are not presented as watching the footage. YouTube search/metadata still needs a separate **YouTube Data API v3** key. Google OAuth credentials are separate and needed only for hosted sign-in.

Official contracts: [OpenRouter images](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [video generation](https://openrouter.ai/docs/guides/overview/multimodal/video-generation), [video understanding](https://openrouter.ai/docs/guides/overview/multimodal/videos), [fal Seedance 2.5](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api), [fal GPT Image 2.5](https://fal.ai/models/openai/gpt-image-2.5/sunburst/text-to-image/api).

## Create a key

Create an account with the provider, open its key dashboard, create a key and copy it into the matching **Provider keys** field on Mac or Windows. For the web version, the installation owner saves the same value under the environment variable above in Vercel, then redeploys.

| Provider | Start here | Official instructions |
| --- | --- | --- |
| OpenAI | [API keys](https://platform.openai.com/api-keys) | [OpenAI API quickstart](https://developers.openai.com/api/docs/quickstart) |
| OpenRouter | [API keys](https://openrouter.ai/settings/keys) | [Quickstart](https://openrouter.ai/docs/quickstart) |
| Google Gemini | [Google AI Studio](https://aistudio.google.com/apikey) | [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key) |
| fal.ai | [Key dashboard](https://fal.ai/dashboard/keys) | [fal quickstart](https://fal.ai/docs/documentation/quickstart) |
| EvoLink | [EvoLink account](https://evolink.ai) | [API documentation](https://docs.evolink.ai) |
| YouTube Data API | [Google Cloud credentials](https://console.cloud.google.com/apis/credentials) | [Enable YouTube Data API v3 and create credentials](https://developers.google.com/youtube/data/getting-started) |

For YouTube, create/select your own Google Cloud project, enable **YouTube Data API v3**, then create an API key for that project. A Gemini key is not a replacement for this enabled API and its quota. API billing and consumer chat subscriptions are separate products; check the provider's API account rather than assuming a chat subscription covers requests.

## Example setups

| You want… | Add and select… |
| --- | --- |
| One AI billing account for images + text + supported video | OpenRouter; choose GPT Image / Nano images, Opus/GPT/Gemini text and supported Seedance modes |
| Only images and video, writing prompts yourself | fal.ai; GPT Image / Nano, Seedance or H3 Max; no text key needed |
| Nano images + Gemini Enhance / Brainstorm | Gemini key; select Gemini 3.8 Flash as the text model |
| Direct GPT images + GPT text | OpenAI key; GPT Image 2.5 + GPT-6.1 Sol |
| YouTube analysis + new thumbnail concepts | OpenRouter + YouTube Data API; use supported image routes, or add your preferred image provider |
| Existing direct-provider setup | Keep your keys; Auto preserves the current primary route when configured, or pin your preference |

## Costs and key safety

The app's estimates are not a provider balance or invoice. Charges can include text reasoning, references, output quality, video duration and preprocessing. Set spending limits with your providers and review their usage dashboards.

Provider keys belong in **macOS Keychain / Windows Credential Manager** on desktop or **server environment variables** for web. Do not put them in a prompt, screenshot, GitHub issue, public repo or `VITE_*` variable. You do not need administrator-level billing keys to generate content. `FAL_ADMIN_KEY`, `OPENAI_ADMIN_KEY` and `OPENAI_PROJECT_ID` are optional hosted billing-report settings, not starter requirements.

Developer source of truth: [route registry](../../src/lib/providers.ts), [model choices](../../src/types.ts), [image routing](../../src/services/geminiService.ts), [video routing](../../src/services/runwayService.ts), [YouTube extraction](../../src/services/youtubeBriefService.ts), [native key fields](../../desktop/macos/Sources/BananaStudio/KeyVault.swift).

# OpenAI-compatible Local API

[Home](../../README.md) · [Türkçe](../tr/local-api.md)

Local API connects your OpenAI-compatible text/image server to Enhance, Brainstorm, variations, image generation and reference editing. It is separate from the official OpenAI provider.

## Desktop setup

Open **Provider keys** and complete the Local provider section:

| Field | Example |
| --- | --- |
| Local base URL | `http://localhost:20128/v1` |
| Local text model ID | `cx/gpt-6.1-sol` |
| Local image model ID | `cx/gpt-image-2.5` |
| Local API key | Your backend key; optional without authentication |

Save, then choose **Local API** in the generation bar or **AI settings → Provider routing**. The existing model choices act as presets on this route: the actual upstream model comes from the text/image ID above and appears beside the provider. All image presets use the configured image ID; all text presets use the configured text ID. Existing providers retain their Auto priority. Local API is not activated until local configuration or a local key is saved.

Any model ID supported by your backend can be entered, including `cx/gpt-image-2.5-flare`, `cx/gpt-image-2.5-sunburst`, `cx/gpt-image-2`, `cx/gpt-image-1.5`, `cx/gpt-5.6-sol-image`, `cx/gpt-5.6-terra-image` or `cx/gpt-5.6-luna-image`. Available models and controls depend on the backend.

Keys and configuration stay in macOS Keychain or Windows Credential Manager and reach the local server through its private process pipe. Blank key fields retain saved keys; **Remove** clears a key. Blank configuration fields restore the displayed defaults.

## Hosted setup

The owner sets `LOCAL_API_BASE_URL`, `LOCAL_TEXT_MODEL`, `LOCAL_IMAGE_MODEL` and optionally `LOCAL_API_KEY` on the server. An empty model ID disables that kind of request. `LOCAL_ENABLED=false` disables the provider. Redeploy after changing hosted environment variables.

The URL must be reachable from the backend. On Vercel, `localhost` means the Vercel function, not the browser user's computer. Never put keys in `VITE_*`, source files or URLs.

## Compatibility

- Text uses `POST /chat/completions` with standard messages, optional inline images and `stream: false`. Brainstorm requires JSON Schema structured output. Provider-specific reasoning parameters are omitted; the model uses its own defaults.
- Images use JSON `POST /images/generations` or `/images/edits`. References use `images: [{image_url: "data:..."}]`; the edit endpoint must support OpenAI's JSON request format.
- Outputs accept OpenAI `data[].b64_json`, inline image data URLs, image URLs on the provider's own origin, or completed OpenAI SSE image events. Partial-only streams and cross-origin downloads are rejected; use base64 for backends with external download URLs.
- Jobs keep their provider/model details in the gallery. Explicit area edits preserve source pixels outside the selection. Changing the base URL or image ID before a queued job dispatches rejects it; create a new job with the current settings.
- Uncertain submissions are not repeated or sent to another provider. Cost stays unknown unless the backend returns finite nonnegative `usage.cost`.

Local API does not generate videos or directly read YouTube footage. Keep Gemini, directly or through OpenRouter, for footage analysis; local text models can prepare the final brief from verified observations.

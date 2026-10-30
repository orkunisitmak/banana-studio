# Your first project in Banana Studio

[Home](../../README.md) · [Türkçe](../tr/guide.md) · [Install](desktop.md) · [Models and keys](models.md)

Banana Studio brings the steps of a creative project into one workspace: gather references, describe an idea, explore alternatives, generate, refine and save. The AI models are external services; the app is the interface and project organizer around them.

## Choose your workspace

For personal work on a Mac or Windows PC, use the [standalone download](desktop.md). It starts a local gallery and asks only for the provider keys you need. You do not create a Banana Studio account or set up a database.

For a shared browser workspace, use a [self-hosted web deployment](deploy.md). Its owner manages Google sign-in, access and server API keys. Desktop and web galleries are separate; there is no automatic transfer between them.

## Make your first image

1. Open **Provider keys** in the desktop app, or ask your web workspace owner to configure a provider.
2. Add the appropriate key. GPT Image 2.5, for example, uses an OpenAI API key.
3. Select image generation and a configured image model.
4. Describe your idea: “A warm editorial illustration of a mountain cabin at sunrise, simple shapes, wide composition.”
5. Choose aspect ratio, size, quality and image count where supported. The cost estimate is a guide, not a fixed price.
6. Select **Generate image**. Follow the job in the gallery, then open or download the result.

You can write the prompt yourself. Enhance and Brainstorm are optional and may need a different provider key.

## Use references without accidentally editing them

Add images with **REF / Add reference images**, from the reference library or from a gallery result. Use the `@` menu to identify their roles: an object, a person, a color palette or a style example.

For example: “Create a new split-screen scene. Use the person from `@[Reference 1]` on the left and the person from `@[Reference 2]` on the right.” Use the actual labels offered by the editor.

Attaching images creates a reference-based **new generation**. A protected area edit starts only when you explicitly enter **Edit image** and select an area. A style example guides the visual language; it should not silently become the scene to copy or the identity to use.

Saved **People** entries group identity photos of the same person. Multiple photos of one person do not request multiple people. State the desired pose, action and clothing in your brief.

## Enhance and brainstorm

![The real Brainstorm panel over existing generated covers](../assets/brainstorm-real.jpg)

In **Brainstorm**, choose **Simple** for general visual concepts or **YouTube** for cover concepts. Set the idea count independently from the image count in the generation toolbar. For example, five ideas and four images per idea create twenty outputs. The reference-role summary groups identity photos so six photos of one person still count as one person.

Use **Enhance** when you want to develop the current idea rather than request a batch of different concepts. It prepares instructions for your selected generation model; review or edit the text before submitting. **Revert** restores the draft from before preparation.

**Enhance** turns your brief into production instructions. **Brainstorm** proposes distinct concepts and can create multiple images per idea. In **AI settings**, choose Opus 5.5 through OpenRouter, GPT-6.1 Sol through OpenAI or Gemini 3.8 Flash through Google, and set the thinking/reasoning level. The initial creative setting is Opus 5.5 / Medium.

Production descriptions are prepared in English even if your draft is Turkish. Requested visible text, names and quoted dialogue keep their intended language. Review the enhanced prompt when exact wording matters.

For YouTube covers, Brainstorm includes camera-facing gaze guidance and distinct outfit plans across ideas unless you request a fixed outfit. These are instructions to a model, not guarantees of anatomy, likeness or click-through rate.

## Edit only a selected part

1. Open a gallery image and choose **Edit image**.
2. Use **Mask** to draw an outline or **Rectangle** to select a box. Closed masks fill their interior.
3. Use layers for multiple areas. **Shift + draw** adds a layer; select a layer to redraw it or remove it from the layer strip.
4. Describe the change, select the edit model, quality and image count, and optionally enhance the prompt.
5. Add optional reference images with **REF**, and type `@` to insert their labels into the edit prompt.
6. Submit the edit and inspect its new results. Use the source/result comparison slider to check the change.

The result is composited into the final selection; outside pixels remain from the source. Select enough surrounding context for a different silhouette or pose: removing a held object may also require selecting the hand and wrist. The app does not silently expand your selection.

![Real selected-area editor, references and prompt controls](../assets/edit-controls-real.jpg)

The Generate button becomes available for another submission once the job has been accepted; you do not need to keep waiting in a blocked “Generating” state. Results appear in the editor's result strip and as separate gallery items. Keep the current source and selections for another attempt, or inspect a finished result.

![A previously completed edit compared with its source](../assets/comparison-real.jpg)

Use **Edit this result** to continue from a result or return to the source for another attempt. Results are separate gallery items.

## Plan a YouTube thumbnail

1. Open **YT** and find a channel or video. Lookup uses a YouTube Data API key.
2. Analyze the video. Gemini reads the footage; the chosen creative text model prepares the final brief. See [combined key requirements](models.md).
3. Review the episode promise and selected people. Adjust the brief before Brainstorm to redirect the concept.
4. Add identity/object references or earlier channel covers as style examples. Explain a reference's role when it could be ambiguous.
5. Choose idea/image counts, brainstorm and compare the results.
6. Open a result and choose **YouTube Preview** to evaluate the cover in a simulated YouTube feed layout.

Footage analysis accepts published videos with a known duration up to 2.5 hours; active live streams are unsupported. Google/provider access to the video is also required. Review factual analysis before using it.

## Generate video

Choose a video model first: supported modes, durations, sizes and inputs differ.

| Family | Workflow |
| --- | --- |
| Seedance 2.0 / 2.5 Relaxed | Text, image and reference-based generation, plus supported edit/extend controls. Seedance 2.5 first/last-frame mode uses **two still images**, tagged as first and last frame. |
| MiniMax H3 Max | Text to Video Max, Image to Video Max, Reference to Video Max, Extend Video Max, Lip Sync Max and Recast. |

The interface validates inputs and shows mode-specific controls. Some reference-video preprocessing also needs fal.ai. Keep the desktop app open during jobs. The hosted version has a durable queue for OpenAI image jobs; other providers use their task histories and polling. A timeout does not prove that a paid request was never accepted. Check the task/result before submitting it again.

[![A real generated video preview](../assets/video-preview.gif)](https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4)

This is an existing MiniMax H3 clip, compressed and muted for documentation. [Download the full 15-second MP4](https://github.com/orkunisitmak/banana-studio/raw/refs/heads/main/docs/assets/video-demo.mp4). In the app player, use the timeline, play/pause, volume and fullscreen controls. It is a historical output, not a new H3 Max test.

## Organize and reuse

Use folders, favorites and search. Save references, people and templates. Details show available prompts, models, dimensions, cost and reference/edit metadata; older records may lack some fields. Re-create restores settings, while variations explore alternatives.

Open gallery images at their natural proportions. Scroll/pinch to zoom, drag to pan and double-click to fit. Use the Details toggle or **Shift+B** to hide the sidebar, and the left/right arrows to change items outside text fields. On mobile, swipe left/right to navigate and down on the image to dismiss the viewer. Editing gestures stay dedicated to drawing the selection.

Use multi-select to move or download work together, change the grid density and filter images/videos. The image comparison dialog can compare selected images; an edited image also has its own **Comparison** switch for the source/result slider. Search with the gallery search control (**⌘K / Ctrl+K**). Save templates to reuse prompts and settings, and keep identity collections in People separately from general references.

Public folder links and multi-user administration belong to the hosted web workspace. Local Mac folders do not get public URLs.

## Set a monthly spending limit

Open **AI settings** to see this month's estimated spend (calendar month, UTC). On the desktop app you can set a monthly budget there; leave it empty for no limit. In a hosted workspace, admins set a default for members under **Workspace admin → Settings → Monthly spending**, and can give an account its own limit or exempt it. Admins are not limited by the default unless they set a limit for their own account.

When the limit is reached, new generations, edits, videos, Enhance and Brainstorm requests stop with a *Spending Limit Reached* message. Jobs that were already accepted still finish, so the last request can take spend slightly past the limit. The limit uses Banana Studio's cost estimates; your provider bills separately.

Next: [Desktop](desktop.md) · [Keys](models.md) · [Web deployment](deploy.md) · [Development](development.md) · [Security](../../SECURITY.md)

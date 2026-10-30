# Issue 20: preserve reference transparency candidate

Review only; separate owner acceptance is required before merging.

PNG stays PNG and WebP uses alpha-capable WebP encoding (or the browser's actual
PNG fallback). JPEG sources remain JPEG. No white fill flattens transparent
references. The data URL's MIME takes precedence over stale attachment metadata;
returned MIME is read from the actual encoder output, not assumed from its input.
Unexpected lossy fallback preserves original bytes rather than silently flattening.

The shared attachment/saved-person compressor reuses that implementation and
retains strict decode/error rejection. Its dimension cap applies to the longest
side, so very tall images may be smaller than the prior width-only helper.
All reference-to-text call sites pass the returned bytes and MIME
together, including Brainstorm, Enhance, variations, video frames and H3 prompts.
The attachment caller also updates its stored MIME. PNG originals can be larger
than JPEG, so text requests progressively resize and reject images that still
exceed the existing combined 3,800,000-character base64 budget before dispatch.
This image budget is not a guarantee for arbitrarily large accompanying text.

Unit regressions cover format/dimensions, stale metadata, WebP encoder fallback,
strict/soft errors, the real Brainstorm request builder and request-budget
recompression/rejection. The browser fixture tests actual canvas encode/decode:
PNG, WebP and the attachment/saved-person path retain alpha 0/255 for a synthetic
transparent/opaque pixel pair. No provider call or user media is required.

Full synthetic local reference upload/storage acceptance is completed below.
Paid provider behavior and physical Windows UI remain unrun. Existing provider-supported MIME allowlists remain unchanged.
Use tests/ui/image-alpha.html for the synthetic review fixture.

## Full synthetic local pipeline (2026-10-28)

`node scripts/serve-ui-acceptance.mjs alpha` bundles the real compression,
storage, gallery and saved-person code. Its temporary local HTTP server uses the
actual LocalWorkspace SQLite/media implementation and authenticated bootstrap.
Browser requests are restricted to self. No provider operation/account is used.

2048×2048 PNG, 2048×2048 WebP and high-detail 4096×4096 PNG, each containing fully
transparent and alpha-128 pixels, were resized to 1568 px, uploaded over HTTP,
retrieved as their actual PNG/WebP MIME and extension, saved to the reference
gallery and retrieved with alpha 0/128 intact. Stored bytes were respectively
5,055,635; 1,018,534; 4,747,934. Saving the three URLs as an independent saved
person snapshot and reading it also preserved MIME and alpha. After restarting
the local server on another port with the same database, all three references
and their transparent pixels remained readable.

The test bundler exposes the actual private request-budget function only in
this test bundle; production exports remain unchanged. Four high-detail PNG
inputs shrank from 38,986,432 to 2,474,752 base64 characters, below the existing
3,800,000 budget, with PNG MIME and alpha intact. Existing automated tests cover
rejection when resizing still cannot fit. This is synthetic local acceptance,
not a claim about cloud storage or real paid-provider behavior.

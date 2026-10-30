# Issue 23: first bilingual interface candidate

Review only; this is not the complete translation of every screen.

The first slice translates the workspace bar, language control, AI settings
heading, primary image generation/Brainstorm/template labels, and history title.
User prompts, saved data, model/provider identifiers and generation instructions
are never translated by changing the interface language. Admin reports, detailed
settings/help, most Gallery dialogs and backend error messages remain outside
this first slice and can still appear in English or their existing language.

A typed English/Turkish dictionary supplies matching keys/placeholders. The
versioned local preference overrides browser-language detection; unavailable
storage still permits an in-memory selection. Browser Turkish is detected even
when storage access throws. Changes update html.lang and synchronize valid
cross-tab storage events. React renders substitutions as text rather than HTML.

The language context/switcher concept was independently reviewed from
thundergokhan's mixed PR #31 at 9f3cfaa3c0c3bb563d0bedc1cb86a7906d741b4b.
This candidate does not incorporate that PR's templates, shortcut modal,
YouTube safe zone, optimizer, proxy, lockfile or other unrelated changes.

Tests check dictionary/placeholder parity, preference failures, language fallback
and substitutions. The browser fixture at tests/ui/i18n.html checks both
languages, selection persistence after reload and the primary layout. All
application requests are synthetic. Translation completeness, smaller-window
layouts and physical Windows acceptance still require review before a final
product-wide language release.

## Desktop preference persistence acceptance (2026-10-28)

Browser localStorage is scoped to its origin and alone does not survive the
local desktop server choosing a new port. This draft now stores only the
validated `tr`/`en` preference in the existing local SQLite settings table, and
includes it in authenticated workspace bootstrap config. There is no migration,
cloud schema change or live setting operation. Local HTTP cookie/Host/Origin
checks remain intact. A valid server preference takes precedence over stale
origin-local cache. Cloud mode retains the existing browser preference behavior.

Writes are serialized in click order. A failed latest write shows a retryable
message and keeps the in-session choice; it never claims a successful durable
save. Regression tests execute the actual callback for ordering/failure/retry,
and the actual local HTTP server for invalid/cross-origin rejection and
preference bootstrap on a new port.

`node scripts/serve-ui-acceptance.mjs i18n` creates a marked temporary local
workspace. In the real browser fixture, Turkish and English each survived a
new server process, reopening the same SQLite database at a different loopback
port with empty localStorage for that origin. Stopping the server made save
failure visible; restarting it and Retry saved the choice, and another process/
port restart restored Turkish. Native app packaging and physical Windows UI
were not run. This remains only the documented first translation slice; no
full-interface translation or merge is implied.

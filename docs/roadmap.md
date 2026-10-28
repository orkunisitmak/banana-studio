# Studio roadmap

The roadmap is delivered as small, independently reviewable pull requests. A
phase starts only after its foundation is merged. Every phase must include
tests, a rollback path and a note about which provider keys or migrations it
needs.

## Phase 1 — Hardening and workflow foundation

| PR | Scope | Status |
| --- | --- | --- |
| #55 | Strict TypeScript, lint/format, tests, module splitting, CORS allowlist, daily quota | Open |
| #56 | Issue backlog closure record | Open |
| #57 | Seed lock, gallery tags, export metadata sidecar, job notifications, template variables, prompt history, model playground | Open |

Acceptance: all checks pass; no production dependency advisories; the gallery
and composer keep working in cloud and local modes.

## Phase 2 — Prompt productivity (delivered in #57)

- Prompt recipes: saved templates now include the seed, model and references.
- Template variables: `{{city}}`, `{{person}}` placeholders with a required-value
  dialog before applying a template.
- Prompt history with one-click restore, per-user storage and 30-entry cap.
- Model playground: compare two models for the same prompt, ratio and
  resolution using estimated cost and observed latency, then apply one without
  spending credits.

Rollback: revert #57. Provider keys: none. Migrations: none (prompt history and
templates use local storage).

Acceptance: a recipe survives reload and desktop/web export; the playground
shows measured costs from `usage_logs`.

## Phase 3 — Gallery intelligence

- Duplicate detection using output hashes and perceptual similarity.
- Saved views: tag + person + model + date filters stored per user.
- Bulk auto-QA: blank output, tiny dimensions, duplicate and missing-file checks.
- Contact-sheet PDF export with the existing `metadata.json` sidecar.

Acceptance: a 10k-item gallery stays responsive; saved views round-trip through
the local workspace.

Rollback: revert the Phase 3 PRs. Provider keys: none. Migrations: none; the
hash scan is client-side and bounded to 120 images.

## Phase 4 — Brand kit and export

- Brand colors, fonts, logos and thumbnail safe zones.
- Text overlay and template variables for exact typography.
- Export presets for YouTube, Shorts, Instagram and X, with watermark options.

Acceptance: an exported thumbnail matches the selected preset dimensions and
keeps its brand assets in both cloud and desktop builds.

## Phase 5 — Team workflow

- Workspace roles: owner, editor, viewer and reviewer.
- Image comments, approval state and revision requests.
- Review links that work without an account and expire.
- Audit log for generation, edit, delete and share actions.
- Per-user and per-provider spend guardrails with alerts.

Acceptance: RLS tests prove a viewer cannot write and a reviewer cannot see
other workspaces; the audit log is append-only.

## Phase 6 — Platform and ecosystem

- Public API and signed webhooks for job submission and status.
- Provider adapter layer for additional image/video providers.
- Template and prompt marketplace with moderation.
- Desktop ↔ web encrypted sync with conflict resolution.
- Video timeline: trim, captions, voiceover and audio ducking.
- Linux desktop, Windows Authenticode signing and automatic updates.
- Full i18n/RTL, accessibility audit, retention policy and GDPR export/delete.

Acceptance: each item is its own PR; native and platform work is verified on the
target OS, not only in CI.

## Rules

1. One PR per independently shippable slice; stack dependent PRs explicitly.
2. Add a DB migration only when the schema actually changes; keep migrations additive.
3. Put unfinished large features behind a flag and merge them disabled.
4. Do not close an issue until the merged change or an explicit maintainer
   decision resolves it.
5. Keep the MindAeon attribution in release and contributor documentation unless the fork owner replaces it.

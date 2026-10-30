# Security

Report vulnerabilities through GitHub's private vulnerability reporting feature. Do not post keys, signed media URLs, database exports, screenshots of private galleries or user prompts in public issues.

## Data boundaries

The repository ships with no configured workspace, provider credentials, user accounts, saved people, reference photos or generated media. It starts a new installation; it is not an export of a production system or its Git history.

The self-hosted web app keeps provider keys and the Supabase service-role key on its server. Its public runtime configuration contains only the owner's Supabase origin and publishable key. Access requires a verified identity and an active invitation. Registration never grants admin access. The owner deliberately bootstraps the first administrator from the database console.

Signing out of the hosted web app clears active media URLs and closes the workspace. Unsynced creations and pending deletions remain in account-scoped browser storage on that device so the same authorized account can recover them. Another signed-in account cannot load them through the app. Clear the site's browser storage to remove that local copy; doing so also deletes unsynced work.

The macOS app stores provider keys in macOS Keychain. Its SQLite database and media live in the current user's Application Support directory with private file permissions. The app's bundled server listens only on loopback, on a random port, and requires an HttpOnly launch credential. The web interface receives configuration status, never provider keys. Host and origin checks reject cross-site writes and DNS rebinding.

The Windows app stores provider keys in Windows Credential Manager and keeps its SQLite/media workspace under the current user's Local AppData. It uses the same loopback authentication and shared server. Its WebView2 profile is separate from the system browser. Native messages accept only local-origin key-dialog/quit commands; external pages are opened in the user's browser. The Windows community archive is unsigned and updates are manual; SHA-256 verification detects a mismatched archive but is not an Authenticode publisher signature. Do not disable SmartScreen or other system-wide protection.

AI features require network access. Prompts and selected references are sent to the provider chosen for that task. Local images are encoded for OpenAI requests. fal.ai and EvoLink video/image references may be uploaded to those providers' temporary file services; these can return bearer-like public URLs. Provider retention and billing policies apply. YouTube features contact Google. Sparkle checks for updates on GitHub. There is no analytics or first-party gallery sync in the desktop app.

Local files are not database-encrypted; protect your OS account and backups with FileVault or Windows device encryption/BitLocker. Deleting a local file does not recall copies already sent to a provider or downloaded elsewhere.

## Releases

Release artifacts must pass source, history, bundle and independent secret scans. Community releases deliberately use local ad hoc code signatures and do not provide Apple Developer ID signing or notarization. Users approve the app through macOS Privacy & Security on first launch. The application does not disable Gatekeeper, SIP or system-wide protections. The optional notarized distribution path still requires Developer ID, notarization and stapling.

Both distribution paths require Sparkle archives and the feed to be signed using the separate Ed25519 key stored in the maintainer's Keychain. Unsigned or changed update payloads must be rejected before extraction. Private signing material must never be committed, included in an app, or printed in CI logs. Apple notarization is not claimed for community builds; the verification record explicitly says `NotRequested`.

Development builds are for local testing and are not official distribution artifacts. A successful build does not prove a release has been signed, published or tested through the update flow.

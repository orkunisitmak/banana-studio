# Reliability and performance implementation plan

Goal: fix the verified data-integrity and desktop failures, improve scalability/type coverage, and add regression coverage without changing provider credential boundaries.

Authorization: the user approved the review recommendations and asked to continue finding improvements. Existing architecture and UI are retained. Changes remain local; no deployment or release.

- [x] Desktop: cancelled-response stream cleanup, atomic batch mutations, failed-upload cleanup, recoverable credential reads, bounded query work and stale WebView cleanup. Regression tests use synthetic temp workspaces.
- [x] Database: new upgrade migration enforcing folder ownership/cycle integrity, correct video result ownership, preserve provider cooldown on 429 recovery. Run isolated fresh-database tests, never configured databases.
- [x] Frontend: preserve mutations across history pages, bounded/cancellable export with a memory budget, lazy secondary interfaces and ZIP loading. Regression tests exercise actual production functions.
- [x] Storage: distinguish authoritative write failure from cache failure; complete folder/media pagination; preserve unsynced user-scoped records and deletion intents on logout while clearing bearer URLs.
- [x] Quality gates: React declarations and incremental strict checks; deliberate dependency remediation and CI dependency scan; automated real-browser smoke tests; startup retry/error recovery.
- [x] Independent Claude Code review for additional actionable issues and final-diff review; fix verified important regressions.
- [x] Final gates: Node suite, TypeScript, web/server builds, isolated PostgreSQL, native macOS tests, browser tests, public release/history audit. Report Windows/live-provider limits.

Ownership: desktop worker owns desktop runtime/native files; database worker owns new SQL and task-ownership APIs; frontend worker owns App/Gallery/history/export. Root owns storageService, AuthBoundary, package/lock/config/CI and browser tests. No overlapping edits without coordination.

Design decisions: user-scoped durable drafts remain on this device after logout and are readable only after the same account passes authorization; no shared legacy cache import. Folder deletion pages every collection before mutating. Database upgrades repair invalid associations before adding guards. Request-attempt antiabuse limits remain intact. Keep provider errors actionable without exposing request bodies, keys or user prompts.

Validation: tests are added first for each reproduced failure, then the narrow implementation is changed. Routine low-impact configuration/documentation changes use build/audit checks rather than mirror tests.

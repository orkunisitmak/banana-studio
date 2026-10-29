# Subscription CLI acceptance: BLOCKED, disabled by default

This draft is source preparation only. Do not enable
`BANANA_SUBSCRIPTION_CLI_PREVIEW`, merge or use an account/quota on this evidence.

## Verified offline

- The actual request/handler tests cover direct spawn arguments (no shell),
  request-only temporary input/output, cancellation, cleanup, model selection,
  a minimal environment and disabled-by-default behavior before any spawn.
- An official registry-integrity-verified Codex 0.165.0 Darwin ARM64 binary was
  inspected with offline help and `debug prompt-input` only, in a separate test
  sandbox with a synthetic HOME and no network/private-file access. No model,
  account or quota call was made.
- Despite the proposed flags, its rendered tool surface still includes
  `apply_patch`, `view_image` and collaboration methods. A tool declaration does
  not establish whether runtime policy permits execution; it does establish
  that flags alone are insufficient acceptance evidence.

## Exact unresolved boundary

`api/_lib/cliProviders.ts` spawns the CLI directly. Its `read-only`/tool flags do
not prove that the CLI process can read only the request directory. The outer
sandbox used by the reviewer protects this test, and is **not** an implemented
application sandbox. A fake child process, absence of writes, successful CI or
read-only wording cannot prove production filesystem confinement.

A safe production design must specify and test an OS-enforced allowlist for
request files, required runtime resources and explicitly approved credential
access, including denial canaries for unrelated files and tools. Authentication
storage, user CLI configuration/plugin discovery and both supported operating
systems need separate consideration. This design and signed-in provider testing
remain unresolved. No real-account validation is claimed for Claude or Codex;
no physical Windows CLI acceptance was run. Keep the preview disabled.

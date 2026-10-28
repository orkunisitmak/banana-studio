# Review automation rollout

This proposal prepares CodeRabbit and Mergify for `orkunisitmak/banana-studio`.
It does not install either GitHub App, enable a merge queue or automatic merge,
change branch protection, select a paid plan, or create credentials.

## Initial behavior

After separate installation and configuration approval, CodeRabbit can review
non-draft PRs targeting main in Turkish, revisit new commits, explain changed
files and link relevant issues. Automatic issue enrichment proposes context;
automatic planning, labels, reviewer assignment, approvals, source fixes,
generated follow-up PRs and post-merge actions are disabled. Cross-repository
context and web search are disabled. Chat auto-replies are disabled.

All three Mergify rules are disabled using the documented `disabled.reason`
field. Their only proposed action is an informational label: sensitive-path
review, incomplete CI, or a narrow maintainer-authored documentation candidate.
If separately enabled, each rule toggles only its own label as conditions change.
There is no merge, queue, update, rebase, close or delete action. Interactive
commands are restricted to `orkunisitmak` with repository admin permission;
these remain explicit human commands, not an automatic source-changing lane.
The configuration editor can inspect candidate matches without taking actions.

No current external source PR qualifies for automatic merging. Features, mixed
changes, refactors, dependencies, workflows, security and configuration changes
require Orkun's decision. A bot label, bot approval or short diff is not evidence
that code is a pure bugfix. Labels are hints, never authorization. PR authors
control their text and may modify their proposed CodeRabbit configuration;
that YAML is not a security boundary.

## Repository CI inventory

The successful main run at source commit
`c9fe7de8293dfb1d8521359452a61ded75351003` published these exact GitHub Actions
check names, verified using GitHub's check-run API on 2026-10-27:

| Check name | Coverage |
| --- | --- |
| `web-and-local` | Source tests, web/API types, web/server builds, source/history audits, independent secret scan and disposable database tests |
| `macos (macos-15, arm64)` | Apple Silicon native build/tests, packages and synthetic generation/update/distribution checks |
| `macos (macos-15-intel, x64)` | Intel native build/tests and equivalent package checks |
| `windows` | Source/types/build, native Windows package, isolated credential/window tests and synthetic generation |

Mergify check conditions are qualified with `@github-actions/` to reject an
unrelated app publishing the same check name. Missing, failed, skipped,
neutral, action-required and stale checks are not treated as successful gates.
The documentation candidate permits only `docs/en/guide.md`, `docs/tr/guide.md`,
`docs/en/faq.md` and `docs/tr/faq.md`, with no additional paths. Renames must be
evaluated using both old and new paths. This is an observation fixture, not an
enabled merge rule. It contains no approval predicate that could accept an old
approval as a current-head authorization.

## Activation requires separate approval

1. Review this draft and confirm the intended free/OSS entitlement in each
   service. Public pricing pages advertise OSS access, but optional products,
   account settings and future terms still need verification. Do not enable
   usage billing, trial-to-paid upgrades, optional paid products or new tokens.
2. At the GitHub installation screen, disclose the actual requested permissions
   and obtain action-time approval. Choose **Only select repositories**, selecting
   this repository, rather than access to all current and future repositories.
3. Review repository and account-level service defaults before triggering any
   review. Do not enable source-writing agents, CI auto-retry, merge queues,
   automatic merges, backports, or other products as an installation side effect.
4. Validate the resolved CodeRabbit configuration and the Mergify configuration
   check/editor on this draft. Confirm plan-supported issue features. A draft
   is intentionally excluded from automatic CodeRabbit reviews; a maintainer
   can explicitly request a review after approving repository access.
5. Approve and merge configuration separately only after the above checks. Keep
   all Mergify rules disabled until their informational effects are approved.
   Enabling a label rule does not authorize adding a merge action.

The current main branch reports no protection and no repository rulesets.
This proposal preserves that state; it does not claim to enforce merge safety
against a person or an installed app with write access. Before considering any
future merge lane, obtain separate approval for protected branch policy: exact
required CI providers/checks, current-head review, dismiss stale approvals,
approval of the most recent push, protected policy ownership, no bypass, and
integration verification against the current base. If current-head approval
cannot be established, do not merge. New commits invalidate prior decisions.
Confirm whether a merge would trigger a consequential deployment before acting.
Never add a privileged `pull_request_target` workflow executing fork code.

## Permission disclosure for installation review

These are the vendors' documented scopes, not permission grants made by this PR.
The live installation screen remains authoritative; stop if it differs.

CodeRabbit documents read access to Actions, discussions, members, metadata and
merge queues; write access to checks, contents/code, commit statuses, issues,
pull requests and workflows. Login may also request organization/team and email
read access. Disabling source-writing features does not reduce the App token's
capabilities. See [GitHub integration permissions](https://docs.coderabbit.ai/platforms/github-com).

Mergify documents repository read/write access to Actions, checks, contents,
deployments, issues, Pages, pull requests and workflows; read access to
administration, commit statuses, metadata and merge queues. Organization admin
and membership reads and dashboard email access may also be requested. This
exceeds the needs of disabled label rules, so the permission decision must be
explicit. See [Mergify permissions](https://docs.mergify.com/security/).

## Issue management and limitations

CodeRabbit can add issue context, related code and suggested work; it is not a
promise to diagnose or resolve every issue. Planning is disabled, and enrichment
does not authorize source changes or closing issues. Maintainers still reproduce,
prioritize and accept fixes. Mergify Workflow Automation evaluates pull requests;
its Issues permission also covers PR labels/comments through GitHub's Issues API
and is not an autonomous issue-resolution engine.

The draft was checked against the vendors' current JSON Schema 2020-12 files,
with schema hashes recorded in the PR validation evidence. Local representative
cases test missing/stale/wrong-app CI, external authors, forged labels/AI
approvals, drafts, source/config/dependency paths and renames. Those cases model
the documented conditions; they are not a live Mergify integration test. App
installation, service entitlements, the resolved server-side policy, live checks
and GitHub enforcement remain unverified until separately approved setup.
Application tests/native packages are not rerun for configuration-only changes.

References: [CodeRabbit schema](https://coderabbit.ai/integrations/schema.v2.json),
[CodeRabbit settings](https://docs.coderabbit.ai/reference/configuration),
[issue enrichment](https://docs.coderabbit.ai/issues/enrichment),
[Mergify schema](https://docs.mergify.com/mergify-configuration-schema.json),
[conditions](https://docs.mergify.com/configuration/conditions/),
[disabled rules](https://docs.mergify.com/workflow/rule-syntax/),
[CodeRabbit OSS](https://www.coderabbit.ai/oss),
[Mergify pricing](https://mergify.com/pricing).

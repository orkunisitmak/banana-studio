# Desktop release procedure

## Linux community archive

The `linux` verification job builds on Ubuntu 24.04 x86-64. It checks the pinned
Node runtime, shared web/server build, native boundary tests, an isolated Secret
Service entry, actual GTK/WebKit startup under Xvfb and packaged mock generation
with exact protected-edit pixels. It audits the assembled directory, then uploads
`prepared-linux-x64`: `Banana-Studio-<version>-linux-x64.tar.gz` and
`verification-linux-x64.json`. System Python/GTK/WebKitGTK/libsecret dependencies
are documented in `desktop/linux/README.md`; Node and sharp are bundled.

Use a clean committed source revision. Confirm the archive hash and source commit
match the verification record. Test file dialogs, clipboard, keyboard, video
codecs, HiDPI and Wayland/X11 on a target desktop before release. CI startup is
not full interactive acceptance. Publish the matching archive and verification
record together. Do not claim a publisher signature, automatic updates or a
Linux release until it has actually been published. Keep the existing Mac assets
and signed feeds available on the latest release.

## Windows community archive

The verification workflow builds Windows x64 on `windows-2022`, tests the shared workspace and an isolated Credential Manager entry, runs the packaged mocked generation/protected edit, then uploads `prepared-windows-x64`. The archive includes the self-contained .NET application, pinned Node runtime, shared web/server build and sharp's installed runtime dependencies with licenses. No user data or provider key is included. The archive is unsigned; do not claim Authenticode validation or automatic updates.

Download the artifact from the verified source commit. Confirm `verification-windows-x64.json` matches the zip hash and commit before attaching both to the release. Test interactive clipboard, keyboard, Library and image/video preview in a Windows session. CI does not claim to perform that interactive acceptance test. A tester needing only Windows can download the portable zip, extract all files together and run `BananaStudio.exe`. Document the WebView2 Runtime requirement.

Keep Mac assets and signed feeds on the latest release too; publishing a Windows-only latest release would interrupt the Mac update URL.

## macOS release procedure

Banana Studio supports community releases without Apple notarization, as well as optional Developer ID signed and notarized releases. Development builds disable updates and remain for local testing only. Community releases keep Sparkle's signed-feed and archive verification enabled.

Run the commands below from the repository root. See the [developer setup and verification guide](en/development.md), [web deployment tutorial](en/deploy.md) and [security policy](../SECURITY.md) for workspace configuration and data boundaries.

## Maintainer setup

The Sparkle Ed25519 private key is a Keychain entry under account `banana-studio`. Only its public key is tracked in `desktop/macos/Resources/SparklePublicKey.txt`. Keep this key secure and backed up outside the repository. Do not regenerate it for routine releases. Without Apple Developer ID, losing this key requires a new manual download rather than an automatic signing-key rotation. See [Sparkle's key management documentation](https://sparkle-project.org/documentation/).

Community releases need no Apple Developer membership, Developer ID certificate or notarization profile. macOS may ask the maintainer to allow the pinned Sparkle signing tool to use the update key in Keychain. This grants signing access to the update key, not to provider API keys.

Fork maintainers must use their own bundle identifier, Keychain service, Sparkle key pair and release repository. Update the feed/download URLs in the packaging/signing scripts and the repository default in `scripts/release-signatures.mjs`. A copy of this repository's public key cannot sign updates.

## Build and verify

Build from a clean committed revision. Increment the package version and choose a positive `BANANA_BUILD_NUMBER` greater than previous releases. Build separately on each supported Mac architecture. The packager rejects a runtime for the wrong architecture and records its source commit in the app.

Run the tests, type checks, web/backend builds, Swift tests, isolated database tests and source/history/independent secret scans listed in the developer guide and CI. First package a development app and run:

```sh
node scripts/test-local-generation.mjs '.build/staging/Banana Studio.app'
node scripts/test-update-signatures.mjs
```

These use synthetic images and an ephemeral in-memory update key. They call no paid AI provider, never read the maintainer's signing key and prove neither Apple's approval nor a real update installation. The generation test checks the packaged local queue, SQLite gallery and native codec, including exact source pixels outside an edit mask. The signature test checks the pinned Sparkle tools, an independent public-key verifier, tamper rejection and rejection of development builds as releases.

Download and verify the pinned official Node runtime, then package a community release:

```sh
node scripts/fetch-node-runtime.mjs
BANANA_NODE_RUNTIME="$PWD/.build/node-runtime/bin/node" \
BANANA_BUILD_NUMBER=2 \
node scripts/package-macos.mjs --community
```

Use the next build number for future releases. This signs the executables locally, verifies the app bundle, audits every bundled file, signs the update archive/feed with the Keychain key and writes architecture-specific verification records under ignored `release-artifacts/<version>/`. No Apple validation is requested. The scripts stop on failed checks.

CI can prepare a community app without any private signing material:

```sh
BANANA_NODE_RUNTIME="$PWD/.build/node-runtime/bin/node" \
BANANA_BUILD_NUMBER=2 \
node scripts/package-macos.mjs --community --prepare
```

A prepared app is not ready to publish: it still lacks signed update artifacts. On the maintainer's Mac, finish using the same clean source commit:

```sh
node scripts/sign-macos-release.mjs '/absolute/path/to/Banana Studio.app' --community
```

The final signer reads the app's architecture, so a CI-built Intel app can also be signed on an Apple silicon maintainer Mac. The app's source commit must match the checkout. Do not alter the bundle after final signing.

Recheck completed artifacts without Keychain access:

```sh
node scripts/verify-macos-release.mjs release-artifacts/0.1.0 arm64
```

Use the actual version and architecture. This verifies signatures, exact download URL/version/build/architecture/source-commit link and SHA-256 hashes in `verification-<architecture>.json`. Community records must say `distribution: community` and `notarization: NotRequested`. The command is read-only and does not replace actual installation/update tests.

## Installation and update gate

Test a downloaded community archive through macOS's app-specific **Open Anyway** flow. Move the app to Applications before launching. Never instruct users to disable Gatekeeper or SIP. See [Apple's instructions](https://support.apple.com/102445). Developer ID and notarized builds can use the usual approved-app path instead.

Verify first launch, Keychain save/remove, reference uploads and the local gallery with a tester's own provider account. Keep the app open during jobs; minimizing is fine. A dispatched OpenAI request interrupted by a quit/crash is retained but never automatically submitted again because it could charge twice.

Run an actual older-to-newer Sparkle update. Confirm the new build launches and the same local gallery and saved Keychain entries remain accessible. macOS may require renewed Keychain access for an ad hoc signed version. Check modified archives/feeds are rejected. Do not publish test feeds, profile data, signing keys or fixtures.

## Publish

Create a GitHub release `v<version>` at the tested source commit. Label community releases clearly as **not notarized by Apple**. Attach only the tested archive, matching signed `appcast-arm64.xml` / `appcast-x64.xml` and corresponding reviewed verification records. Do not upload environment files, databases, user media, test outputs, certificates, signing keys or local logs. Keep assets for every supported architecture on the latest release. Download the actual public assets into a version-named directory and rerun verification, then verify the public update path.

## Optional Apple-notarized release

For the notarized path, install a valid Developer ID Application certificate and private key in Keychain and store a notarization profile with `xcrun notarytool store-credentials`. Enter Apple credentials interactively, never in source, shell history or chat. Run packaging without `--community`, setting `BANANA_SIGNING_IDENTITY` and `BANANA_NOTARY_PROFILE` to their non-secret names. This path also notarizes, staples and checks Gatekeeper; its record must say `distribution: notarized` and `notarization: Accepted`.

Follow [Sparkle's publishing guide](https://sparkle-project.org/documentation/publishing/) when changing feed structure or signing policy.

# Standalone Linux desktop

Linux desktop support uses a separate Electron shell with the existing React build and `desktop/server` workspace. The initial distribution is an unsigned development preview. It does not change the Mac, Windows or hosted web launch paths. A portable Linux x86_64 bundle and an unsigned Ubuntu 24.04 `.deb` can be assembled with the commands below. No updates or release signing are provided. Linux GUI, sandbox, native dialogs and real keyring integration must be tested on Linux; macOS tests are not proof of those behaviors.

## Development prerequisites

Use a normal user in a graphical Linux session, with D-Bus, an unlocked GNOME Keyring or KWallet, Node.js **24.x** (including `node:sqlite`), npm and Git. Node must be a separate installation, not Electron's embedded Node. Use the same architecture for Node and installed npm dependencies. The alpha uses `/usr/bin/zenity` for native password forms, keeping credentials out of the renderer. Blank fields preserve saved keys; `REMOVE` deletes a key. Cancel leaves all keys unchanged.

Ubuntu 24.04, after installing Node.js 24 using your preferred Node version manager:

```sh
sudo apt update
sudo apt install git zenity gnome-keyring libsecret-1-0 libgtk-3-0t64 libnss3 libasound2t64 libgbm1
node --version # must be v24.x
npm ci --ignore-scripts
npm ci --prefix desktop/linux --ignore-scripts
node desktop/linux/node_modules/electron/install.js
npm test
npm run test:linux
npm run typecheck
npm run build
npm run build:desktop
npm run audit
git diff --check
npm run start:linux
```

CachyOS, from a graphical session with GNOME Keyring or an unlocked KDE Wallet (choose the service appropriate to your desktop):

```sh
sudo pacman -S --needed git zenity libsecret gtk3 nss alsa-lib mesa
# GNOME/Xfce: sudo pacman -S --needed gnome-keyring
# KDE Plasma: sudo pacman -S --needed kwallet
# Install/select Node.js 24 with your preferred Node version manager;
# the rolling distribution's default nodejs may be a different major.
node --version # must be v24.x
npm ci --ignore-scripts
npm ci --prefix desktop/linux --ignore-scripts
node desktop/linux/node_modules/electron/install.js
npm test
npm run test:linux
npm run typecheck
npm run build
npm run build:desktop
npm run audit
git diff --check
npm run start:linux
```

Run from the repository root. The explicit Electron install step downloads its pinned runtime after the script-disabled install. Sharp uses the existing root dependency and platform-specific optional packages; do not omit optional dependencies or rebuild sharp against Electron. On another architecture, reinstall dependencies there.

The launcher passes the actual Node executable to the shell. The shell verifies Node 24/SQLite, starts the workspace without a shell with a minimal environment, transfers keys and bootstrap over stdin, authenticates in the main process with a cancellable ten-second timeout and strict response-cookie validation, and installs an HttpOnly session cookie into a fresh memory-only browser session. It does not expose the bootstrap in page URLs, frontend config, preload or renderer request headers. Closing/locking exits the app and shuts down the workspace; a stuck child is killed after three seconds. Abrupt OS termination cannot guarantee graceful shutdown; server stdin EOF also triggers shutdown when the shell disappears.

The encrypted provider-key file is under `$XDG_CONFIG_HOME/banana-studio` (default `~/.config/banana-studio`), SQLite/media under `$XDG_DATA_HOME/banana-studio` (default `~/.local/share/banana-studio`), and Chromium disk cache under `$XDG_CACHE_HOME/banana-studio` (default `~/.cache/banana-studio`). Relative XDG overrides are ignored. Do not commit or upload these directories. Browser sessions are ephemeral; workspace records remain on disk.

`safeStorage` must report encryption available and one of `gnome_libsecret`, `kwallet`, `kwallet5`, `kwallet6`. `basic_text`, unknown and unavailable backends fail closed, including before first key entry. No plaintext fallback is supported. This alpha deliberately uses the synchronous safeStorage API because it identifies the selected backend; review its replacement before upgrading to Electron 46. Keep the desktop keyring unlocked; an encryption/decryption failure blocks startup or saving. Encrypted files remain protected by the keyring; this does not isolate keys from other applications running as the same user.

Never run as root or add `--no-sandbox`. If Chromium fails before an app window appears, inspect the terminal for system library or sandbox prerequisite errors. Ubuntu's AppArmor/user-namespace policy may prevent an unpackaged Electron binary from starting. Configure a narrowly scoped local AppArmor policy for the development Electron binary with your system administrator; do not globally disable AppArmor or Chromium sandboxing. The packaged `.deb` includes an application-specific profile; Ubuntu 24.04 GNOME desktop acceptance remains a follow-up check and can use a full VM with AppArmor enabled.

## Linux acceptance checks

Use a fresh disposable account or absolute XDG overrides for a synthetic workspace. `npm run test:linux` checks portable lifecycle/error handling (including shutdown during startup), sender/preload validation, fail-closed storage and atomic key-file replacement, bootstrap/session boundaries and cancellation and (on Linux only) sharp RGBA round trips and invalid-image rejection. `npm test` also exercises the shared server's exact host, origin and cookie protections. Vault unit tests use a fake encryptor; they do not establish real keyring security.

On Ubuntu and CachyOS, manually verify startup, password form cancel/save/remove, restart persistence, clipboard/reference image imports, PNG export/protected edits, download destination selection, external HTTPS links, gallery/folder persistence, fullscreen, lock/reopen and clean process exit. Kill the Node child and verify the app reports failure and exits. Test with the keyring service unavailable/locked: no insecure fallback or plaintext file may appear. Use only your own test provider account for a bounded real generation; no paid request is made by the automated tests. Never attach prompts, media, keys or local databases to bug reports.

## Build a self-contained development alpha

Build prerequisites are Git, Node.js 24.x/npm, `tar`, `unzip` and (for `.deb`) Linux x86_64 with `dpkg-deb`. Ubuntu builders can install `git ca-certificates tar unzip dpkg`; CachyOS builders can install `git ca-certificates tar unzip dpkg` with pacman. Keep the existing desktop/keyring prerequisites above for interactive testing. Installed users do **not** need Git, npm, system Node or a source checkout.

From the updated source tree, on either Ubuntu 24.04 x86_64 or CachyOS x86_64:

```sh
node --version # 24.x build tool; the shipped workspace Node is exactly 24.19.0
npm ci --ignore-scripts
npm ci --prefix desktop/linux --ignore-scripts
npm test
npm run typecheck
npm run build
npm run build:desktop
npm run audit
git diff --check
npm run package:linux
node scripts/audit-linux-distribution.mjs .build/linux-x64/BananaStudio
npm run test:linux:bundle
npm run package:linux:deb
```

The portable directory is `.build/linux-x64/BananaStudio/`; the archive and SHA-256 sidecar are `.build/linux-artifacts/banana-studio-0.1.3-linux-x64-alpha.tar.gz[.sha256]`. The Debian output is `.build/linux-artifacts/banana-studio-linux-alpha_0.1.3~linuxalpha1_amd64.deb[.sha256]`. The unsigned development version is intentionally below the corresponding stable version. None of these commands publishes anything.

The portable assembler also supports macOS **cross-assembly**, using only checksum-verified upstream Linux binaries; it never executes them on macOS. `.deb` construction is Linux-only. Never treat cross-assembly, an ELF/glibc scan, or a Linux container backend test as real desktop acceptance. No native addons are rebuilt against the build host glibc or Electron. Official Node/Electron archive SHA-256 values and binary/license hashes (Node) are pinned; the six sharp runtime npm packages are checked against both SHA-256 pins and the root lockfile SRI. Downloads are verified before extraction and no downloaded package lifecycle scripts run. Existing macOS/Windows packaging scripts and pins remain unchanged.

## Test the portable and installed application

On CachyOS, move/extract the archive somewhere outside the checkout and run as a normal desktop user:

```sh
sha256sum -c banana-studio-0.1.3-linux-x64-alpha.tar.gz.sha256
tar -xzf banana-studio-0.1.3-linux-x64-alpha.tar.gz
(cd BananaStudio && sha256sum --quiet -c SHA256SUMS)
./BananaStudio/banana-studio
```

On Ubuntu 24.04, verify and install the `.deb` (apt resolves its system library/Zenity/AppArmor dependencies):

```sh
sha256sum -c banana-studio-linux-alpha_0.1.3~linuxalpha1_amd64.deb.sha256
sudo apt install ./banana-studio-linux-alpha_0.1.3~linuxalpha1_amd64.deb
/usr/bin/banana-studio
# Or use the Banana Studio Linux Alpha desktop entry.
```

The `.deb` installs only its files under `/opt/banana-studio`, a launcher, icon, desktop entry and an application-specific AppArmor profile at `/etc/apparmor.d/banana-studio`. Maintainer scripts load/remove only that profile when AppArmor is enabled. Its attachment matches the fixed installed executable, following Ubuntu's documented shim-profile approach; this is not a per-process access list and descendants may inherit the label. Separately, Chromium's renderer namespace/seccomp sandbox remains enabled. No global sysctl changes or setuid permissions are added. Portable builds at arbitrary paths can still be blocked by Ubuntu's user-namespace policy: use the installed application for stock Ubuntu acceptance instead of adding sandbox-disabling flags. Do not install the Ubuntu `.deb` into CachyOS; test the portable directory there.

Both launch paths retain the same `banana-studio` XDG directories and application identity as the source alpha. Fully quit the source app before testing the package. Existing folders, reference-library entries and encrypted keys should reopen; the synthetic packaged test verifies this persistence on a disposable workspace, not on your private data. Test your existing workspace explicitly on Linux, keeping a private backup first. The bundled shell ignores `BANANA_NODE_RUNTIME` and uses its own Node/workspace regardless of the working directory. The launcher preserves KDE/GNOME session detection and strips environment credentials/Node/Electron overrides.

For a source-independent backend check, copy `scripts/test-linux-bundle.mjs` beside the extracted bundle and run its bundled Node:

```sh
./BananaStudio/resources/runtime/bin/node ./test-linux-bundle.mjs ./BananaStudio
```

This needs no npm or source checkout and tests SQLite, PNG pixels, authentication, frontend serving, folder/reference persistence across server restart and orderly EOF shutdown without contacting a provider. It does not test the Electron GUI, real keyring or the kernel sandbox.

The Linux artifact audit scans every file, including dependency files; rejects secrets/private files, links, writable/setuid files, development files, missing license files, transport-inventory changes, wrong ELF architectures and glibc symbol requirements above Ubuntu 24.04's 2.39. Electron/Chromium, Node and the actual included JS/image packages have accompanying license notices. Libvips component license texts and a matching upstream source/build recipe are recorded with SHA-256 provenance. See `desktop/linux/LINUX-SOURCES.md` for modification/relinking and corresponding-source requirements before public redistribution.

## Acceptance status and remaining distribution work

The reviewed portable bundle passed real-hardware acceptance on **CachyOS/KDE Plasma 6**, and the reviewed `.deb` on **Ubuntu 26.04.1/GNOME**: normal launch, native image selection, PNG Saved References reuse and gallery-folder persistence. Both desktops saved a nonempty synthetic OpenAI key and displayed its `(saved)` indicator after application restart; removing the isolated encrypted configuration removed that indicator. Ubuntu also passed actual same-version `apt --reinstall` and `apt remove` / `apt install`, preserving gallery folders and saved references. These are tester-reported observations. Ubuntu **24.04** has clean-container build, packaged runtime and dependency verification only; its GNOME GUI remains unverified.

The `(saved)` indicator establishes that a nonempty value was loaded after restart; it does not independently establish byte-for-byte recovery of the original synthetic key. Renderer `NoNewPrivs: 1`, `Seccomp: 2` and one seccomp filter are useful observations, not proof of every Chromium sandbox layer. The AppArmor `unconfined` label is deliberate: this follows Ubuntu's application-specific user-namespace shim, **not** an enforced filesystem/network confinement policy. It attaches only to `/opt/banana-studio/banana-studio-bin`; the package owns that path as root and does not grant namespaces globally or set a setuid helper. Review this separately from Chromium's renderer sandbox. [Ubuntu 24.04 rationale](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions).

Use the following non-destructive, container-only dpkg fixture to test install/upgrade/remove/reinstall/purge and preservation of synthetic user files. The harness refuses non-Docker/root contexts, creates its own chroot and dpkg database, and never mounts `/sys` there. `--install-dependencies` installs only the declared dependencies in the disposable container. The upgrade is a clearly marked control-version fixture, not a claimed new GUI build. These checks do not establish live desktop upgrades or kernel profile loading.

```sh
docker run --rm --platform linux/amd64 \
  --mount type=bind,src="$PWD",dst=/source,readonly \
  -w /source ubuntu:24.04 \
  /source/.build/linux-x64/BananaStudio/resources/runtime/bin/node \
  scripts/test-linux-deb.mjs \
  .build/linux-artifacts/banana-studio-linux-alpha_0.1.3~linuxalpha1_amd64.deb \
  --install-dependencies
```

For nonempty keyring persistence without paid calls or real keys, use the verified development Electron in a real KDE/GNOME desktop session. The probe uses the same Vault and backend refusal, a fresh private fixture, a random synthetic value, and a digest comparison in a **second Electron process**. It does not read the normal application workspace or provider key file, starts no backend and logs neither the value nor ciphertext. It does not by itself certify the installed shell's keyring identity: also repeat the GUI test in an isolated XDG profile, with a synthetic string only, without generating anything.

```sh
fixture=$(mktemp -d -t banana-keyring-test-XXXXXXXX)
node desktop/linux/node_modules/electron/cli.js scripts/test-linux-keyring.mjs --write "$fixture"
node desktop/linux/node_modules/electron/cli.js scripts/test-linux-keyring.mjs --read "$fixture"
# The fixture contains only synthetic test data; keep it private and remove it when done.
```

Quit the app fully before `.deb` lifecycle tests. Same-version reinstall and remove/install have passed on Ubuntu 26.04.1; different-version upgrades, purge/reinstall and upgrades while the app is running remain release QA. In a disposable Linux account, create a folder/reference and a synthetic provider value, close the app, upgrade to an independently versioned next alpha, reopen, remove/reinstall, and verify data and keyring behavior each time. Purge removes package conffiles, not XDG data. Follow up on Ubuntu 24.04 GNOME in a full VM or physical installation with AppArmor enabled; a headless container does not validate desktop/keyring integration. Do not use a personal workspace, real API key or paid provider request for these acceptance steps.

The artifact audit compares Node and native runtime hashes against the **repository's reviewed pins**, not only the bundle's self-reported metadata. SHA256SUMS remains a transport/inventory check, not a signature. Public redistribution still requires review of corresponding-source availability for native/LGPL components and separate dependency advisory review; signing and updates remain out of scope.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [safeStorage backends](https://www.electronjs.org/docs/latest/api/safe-storage), [Linux proposal](https://github.com/orkunisitmak/banana-studio/issues/10).

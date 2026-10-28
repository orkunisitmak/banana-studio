# Install and use Banana Studio

[Home](../../README.md) · [Türkçe](../tr/desktop.md) · [User guide](guide.md) · [Keys](models.md)

## Mac: download and open

The current release is **v0.1.2** and requires **macOS 13.5 or later**. It includes its own runtime: you do not install Node.js, Supabase, Vercel or a database.

1. In the Apple menu, open **About This Mac**. If it says **Chip: Apple M…**, choose Apple Silicon; if it says **Intel**, choose Intel.
2. Download the matching file:

   | Mac | Download |
   | --- | --- |
   | Apple Silicon — M1 and newer | [Banana-Studio-0.1.2-macos-arm64.zip](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-macos-arm64.zip) |
   | Intel | [Banana-Studio-0.1.2-macos-x64.zip](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-macos-x64.zip) |

3. Double-click the zip, then drag **Banana Studio.app** into **Applications**. Open it from there.
4. These community builds are not notarized by Apple. After trying to open the app, if macOS blocks it, go to **System Settings → Privacy & Security → Open Anyway** for Banana Studio and complete the system confirmation. Follow [Apple's instructions](https://support.apple.com/102445); leave system-wide protections enabled.
5. The local gallery opens. No Google sign-in or Banana Studio account is needed.

**Checkpoint:** you can see **Local workspace · This computer**, an empty gallery and the generation controls. Download the release zip, not GitHub's **Source code** zip, if you just want to use the app.

## Add the keys you need

1. Select **Provider keys** in the top bar, or **Banana Studio → Provider API Keys…** in the Mac menu.
2. Create a key with your chosen provider using the [provider links](models.md). The provider may require billing or model access before it accepts requests.
3. Paste it into the matching field and select **Save**. Do not paste API keys into the generation prompt.
4. Select the corresponding image/video model. If you use Enhance or Brainstorm, open **AI settings** and select a configured text model too.

The initial pairing is GPT Image 2.5 + Opus 5.5 / Medium, so it needs OpenAI + OpenRouter. For an OpenAI-only setup, select GPT-6.1 Sol for the text model as well, if your provider account can access it. You can also skip Enhance/Brainstorm and write image prompts directly.

**Checkpoint:** a saved field says **Saved in Keychain** when you reopen it. Blank fields keep an existing key; the **Remove** checkbox clears only that provider's saved key. Keys are stored in macOS Keychain and are not sent to a Banana Studio cloud account.

## Save, back up and update

| What | Where / how |
| --- | --- |
| Gallery, folders, references, templates and job records | Local SQLite database and media under `~/Library/Application Support/Banana Studio/` |
| API keys | macOS Keychain, separate from the gallery and app bundle |
| Find local data | **File → Open Local Data Folder** |
| Export a result | Download it from the gallery |
| Back up the workspace | Quit the app, then back up the whole local data folder. Include media as well as the database. |
| App updates | Sparkle checks the signed GitHub feed. Use **Banana Studio → Check for Updates…** for a manual check. |

Keep the application open during generation; minimizing it is fine. Let running jobs finish before quitting or installing an update. The app verifies signed feeds and update archives before extraction. Your workspace and Keychain items live outside the app bundle and are retained across updates. macOS may ask for renewed Keychain permission after a community update; check that the request names Banana Studio.

The local database is not separately encrypted; macOS account protection, FileVault and your backup settings protect local files. Reinstalling the app is not a gallery backup. AI generation still sends selected prompts and references to the chosen provider. [Full data policy](../../SECURITY.md).

## Windows: download and open

1. Download [Banana-Studio-0.1.2-windows-x64.zip](https://github.com/orkunisitmak/banana-studio/releases/download/v0.1.2/Banana-Studio-0.1.2-windows-x64.zip) for Windows 10/11 on 64-bit Intel/AMD PCs.
2. Choose **Extract all**. Keep the entire extracted **Banana Studio** folder together; do not run the executable inside the zip or move only the `.exe`.
3. Open **BananaStudio.exe**. Node.js, .NET and the local database are bundled. The app requires Microsoft's **Edge WebView2 Runtime**, normally present on Windows 10/11; if the app reports it missing, install it from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
4. Use **Provider keys** (or **File → Provider API Keys…**) and add only the keys you need. They stay in **Windows Credential Manager**. No Supabase, Google login or cloud setup is needed.
5. Use the same Library, gallery, preview, image/video generation and edit controls as on Mac.

This is an **unsigned community build**. Windows may show an unrecognized-publisher warning. Check that the archive came from this repository's release and compare its SHA-256 with `verification-windows-x64.json`. Do not disable Windows security or use a package from a different source.

The local gallery is under `%LOCALAPPDATA%\Banana Studio\`. Open **File → Open Local Data Folder** to find it. Quit before backing up the whole folder. Keys are separate in Credential Manager. Windows updates are manual: **File → Check for Updates…** opens GitHub Releases; quit the app, extract the new folder and open it. Gallery and keys remain outside the application folder.

Mac, Windows and Linux use the same React interface and SQLite workspace code. Native menus, file dialogs and key vaults follow each operating system. The Windows package has build, Credential Manager and protected-edit integration checks on Windows CI; an interactive Windows UI session is still needed for a full release acceptance test. [Platform comparison and shortcuts](desktop-parity.md).

## Linux: build and open

Linux uses the same React interface, Node/SQLite workspace and image codec as Windows, in a **GTK 4 + WebKitGTK 6.0** window (the same WebKit engine as the Mac app). It runs on 64-bit Intel/AMD or ARM with a glibc distribution and GTK 4.10+; Wayland and X11 both work. No Linux release archive is published yet: build it from source as in [Build the Linux app](development.md#build-the-linux-app), or use the `prepared-linux-x64` CI artifact from this repository.

1. Install the system shell stack once. The Node runtime and image codec are bundled; `gst-libav` plays generated MP4 videos.

| Distribution | Install the shell stack |
| --- | --- |
| Arch / CachyOS / Manjaro | `sudo pacman -S --needed python-gobject gtk4 webkitgtk-6.0 libsecret gst-libav` |
| Debian 13 / Ubuntu 24.04+ | `sudo apt install python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-secret-1 gstreamer1.0-libav` |
| Fedora 40+ | `sudo dnf install python3-gobject gtk4 webkitgtk6.0 libsecret gstreamer1-plugin-libav` |

2. Extract or build the **banana-studio** folder and keep it together. Run `./install.sh` inside it to add **Banana Studio** to your application menu, or start `./banana-studio` directly. `./install.sh --uninstall` removes only the menu entry.
3. Use **Provider keys** (or the ☰ menu → **Provider API Keys…**, Ctrl + comma). Keys are stored in your desktop's **Secret Service** keyring: GNOME Keyring, KWallet or KeePassXC. If no keyring answers, the gallery still opens but keys cannot be saved.

The local gallery is under `~/.local/share/banana-studio/` (or `$XDG_DATA_HOME/banana-studio/`). Open ☰ → **Open Local Data Folder** to find it, and quit before backing up the whole folder. Keys stay separately in the keyring. Updates are manual: ☰ → **Check for Updates…** opens GitHub Releases; replace the folder and run `./install.sh` again. A second launch raises the existing window instead of opening another workspace. Wayland compositors place windows themselves, so only the window size and maximized state are restored.

If the window stays blank on some NVIDIA drivers, start it once with `WEBKIT_DISABLE_DMABUF_RENDERER=1 ./banana-studio`.

## Common questions

| Symptom | What to check |
| --- | --- |
| Mac says the app cannot be opened | Download the right architecture, move it to Applications, then follow the app-specific Open Anyway flow above. |
| A model says its provider is not configured | Add that provider's key; a Gemini key does not replace `FAL_KEY` for Nano Banana in this app. |
| Brainstorm fails after image generation worked | The image model and text model may use different providers. Check **AI settings**. |
| The key is saved but a request is rejected | Check provider billing, available credits, model permissions, limits and the exact error. |
| The gallery looks different from your web account | Mac and hosted web workspaces store separate data. |
| You downloaded the source zip | Use the architecture-specific application zip on the [release page](https://github.com/orkunisitmak/banana-studio/releases/latest). |

Developers: [build a development app](development.md#build-the-mac-app). Maintainers: [signed release procedure](../RELEASING.md).

# Banana Studio on Linux

This native GTK 3 / WebKitGTK 4.1 application uses the same React interface and
local SQLite workspace as Mac and Windows. The portable archive includes Node.js
and the sharp image codec. It needs a glibc x86-64 Linux desktop, Python 3.9+,
PyGObject, GTK 3, WebKitGTK 4.1 and libsecret introspection. Ubuntu 24.04 is the CI
baseline. ARM and musl/Alpine packages are not provided.

On Ubuntu 24.04 / Debian 12, install the system dependencies:

```sh
sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 gir1.2-secret-1
```

On Arch Linux:

```sh
sudo pacman -S python-gobject gtk3 webkit2gtk-4.1 libsecret
```

An unlocked Secret Service keyring is required (GNOME Keyring, or KWallet with
its Secret Service interface enabled). Install/configure a keyring provider for
your desktop if needed. Keys never fall back to plaintext files. Run the app as
your normal desktop user, in a graphical session with its session D-Bus.

Extract `Banana-Studio-<version>-linux-x64.tar.gz`, keep the entire `Banana Studio`
directory together and run `./banana-studio` inside it. Do not launch it with
`sudo`. The app does not need Supabase, Vercel or a separate Node installation.
Use **Provider keys** or **File → Provider API Keys…** to configure providers.
Blank fields keep saved keys; **Remove** deletes the selected provider's key.

Gallery and media live in `$XDG_DATA_HOME/banana-studio` (normally
`~/.local/share/banana-studio`). **File → Open Local Data Folder** opens it.
Keys live separately in your desktop keyring. Quit before backing up the whole
data directory. Keep the app open during generation. Ctrl shortcuts follow the
Windows interface; **Ctrl+,** opens keys and **F11** toggles fullscreen. Window
size is remembered; placement is managed by your Wayland/X11 window manager.

Updates are manual: **File → Check for Updates…** opens GitHub Releases. Quit,
extract the new archive, and open the new folder. Your gallery and keys live
outside the application directory. Compare the archive SHA-256 with
`verification-linux-x64.json` from the same build. This is an unsigned community
package; a checksum is not a publisher signature. No Linux release is claimed
until a maintainer publishes an archive.

If startup fails, check the dependencies and unlock your keyring. Missing video
codecs depend on the distribution's WebKitGTK/GStreamer packages; install your
distribution's appropriate multimedia codecs. File selection and downloads use
GTK dialogs. The browser session is ephemeral. External HTTPS links open in
your system browser. No WebKit sandbox or system security protection is disabled.

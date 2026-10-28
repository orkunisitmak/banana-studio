"""Banana Studio for Linux. Started by the `banana-studio` launcher with `python3 -I`."""
import os
import sys

SHELL = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, SHELL)

MISSING = """Banana Studio needs GTK 4, WebKitGTK 6.0, libsecret and PyGObject:
  Arch / CachyOS / Manjaro: sudo pacman -S --needed python-gobject gtk4 webkitgtk-6.0 libsecret gst-libav
  Debian 13 / Ubuntu 24.04+: sudo apt install python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-secret-1 gstreamer1.0-libav
  Fedora 40+:                sudo dnf install python3-gobject gtk4 webkitgtk6.0 libsecret gstreamer1-plugin-libav
"""


def main(argv):
    try:
        if "--test-vault" in argv:
            import key_vault
            key_vault.test()
            return 0
        if "--test-window-placement" in argv:
            import window_placement
            window_placement.test()
            return 0
    except Exception:
        return 1
    try:
        import studio_window
    except (ImportError, ValueError):
        sys.stderr.write(MISSING)
        return 1
    # The packaged layout is <app>/shell/banana_studio.py beside runtime/ and workspace/.
    return studio_window.run(os.path.dirname(SHELL), argv[:1])


if __name__ == "__main__":
    sys.exit(main(sys.argv))

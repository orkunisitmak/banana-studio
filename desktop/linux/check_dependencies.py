"""Exit 0 when the system GTK/WebKitGTK/libsecret stack can start the shell."""
import sys

try:
    import gi
    for name, version in (("Gtk", "4.0"), ("WebKit", "6.0"), ("Secret", "1")):
        gi.require_version(name, version)
    from gi.repository import Gtk, WebKit, Secret  # noqa: F401
    if (Gtk.get_major_version(), Gtk.get_minor_version()) < (4, 10):
        raise ImportError("GTK 4.10 or newer is required.")
except (ImportError, ValueError):
    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    from banana_studio import MISSING
    sys.stderr.write(MISSING)
    sys.exit(1)

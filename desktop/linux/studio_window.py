"""GTK 4 + WebKitGTK shell. WebKitGTK is the same engine as the Mac WKWebView,
so `window.webkit.messageHandlers.bananaNative` reaches this shell unchanged."""
import os
from urllib.parse import urlsplit

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit  # noqa: E402

import key_vault  # noqa: E402
import window_placement  # noqa: E402
from workspace_process import WorkspaceProcess, data_directory  # noqa: E402

APP_ID = "com.bananastudio.BananaStudio"
RELEASES = "https://github.com/orkunisitmak/banana-studio/releases/latest"
BACKGROUND = "#0d1117"
CSS = b"""
window.banana, window.banana headerbar { background: #0d1117; color: #e5e7eb; }
.banana-status { color: #9ca3af; }
"""


def https(uri):
    try:
        parts = urlsplit(uri)
        return parts.scheme == "https" and bool(parts.hostname) and parts.username is None and parts.password is None
    except ValueError:
        return False


class StudioWindow(Gtk.ApplicationWindow):
    def __init__(self, app, root):
        super().__init__(application=app, title="Banana Studio")
        self.add_css_class("banana")
        self.origin = None
        self.keys_open = False
        self.normal_size = None
        saved = window_placement.load(data_directory())
        width, height = window_placement.constrain((saved["width"], saved["height"]) if saved else (1400, 900), self._monitors())
        self.set_default_size(width, height)
        self.set_size_request(min(760, width), min(560, height))
        if saved and saved["maximized"]:
            self.maximize()

        header = Gtk.HeaderBar()
        menu = Gio.Menu()
        main = Gio.Menu()
        main.append("Provider API Keys…", "app.keys")
        main.append("Open Local Data Folder", "app.open-data")
        main.append("Check for Updates…", "app.updates")
        menu.append_section(None, main)
        view = Gio.Menu()
        view.append("Full Screen", "app.fullscreen")
        menu.append_section(None, view)
        end = Gio.Menu()
        end.append("Quit", "app.quit")
        menu.append_section(None, end)
        button = Gtk.MenuButton(icon_name="open-menu-symbolic", menu_model=menu, tooltip_text="Menu")
        header.pack_end(button)
        self.set_titlebar(header)

        # A nonpersistent session matches the Mac shell and the per-launch
        # WebView2 profile. Durable user data lives in the SQLite workspace.
        self.session = WebKit.NetworkSession.new_ephemeral()
        self.session.connect("download-started", self._download_started)
        content = WebKit.UserContentManager()
        content.register_script_message_handler("bananaNative", None)
        content.connect("script-message-received::bananaNative", self._native_message)
        self.web = WebKit.WebView(network_session=self.session, user_content_manager=content)
        settings = self.web.get_settings()
        settings.set_enable_developer_extras(False)
        settings.set_javascript_can_open_windows_automatically(False)
        settings.set_enable_back_forward_navigation_gestures(True)
        background = Gdk.RGBA()
        background.parse(BACKGROUND)
        self.web.set_background_color(background)
        self.web.connect("decide-policy", self._decide_policy)
        self.web.connect("create", lambda *_: None)
        self.web.connect("permission-request", self._deny_permission)
        self.web.connect("load-changed", self._load_changed)
        self.web.connect("load-failed", self._load_failed)
        self.web.connect("web-process-terminated", lambda *_: self.show_failure("The display process stopped. Reopen Banana Studio. Your saved gallery is kept on this computer."))

        self.status = Gtk.Label(label="Opening your local workspace…", wrap=True, justify=Gtk.Justification.CENTER)
        self.status.add_css_class("banana-status")
        self.status.set_halign(Gtk.Align.CENTER)
        self.status.set_valign(Gtk.Align.CENTER)
        overlay = Gtk.Overlay(child=self.web)
        overlay.add_overlay(self.status)
        self.set_child(overlay)

        self.connect("notify::default-width", self._capture_size)
        self.connect("notify::default-height", self._capture_size)
        self.connect("close-request", self._close_request)
        self.workspace = WorkspaceProcess(root, self._ready, lambda: self.show_failure("The local workspace stopped. Reopen Banana Studio. Your saved gallery is kept on this computer."))
        GLib.idle_add(self._start_workspace)

    def _monitors(self):
        display = Gdk.Display.get_default()
        if display is None:
            return []
        monitors = display.get_monitors()
        areas = [monitors.get_item(i).get_geometry() for i in range(monitors.get_n_items())]
        return [(area.width, area.height) for area in areas]

    def _capture_size(self, *_):
        if not self.is_maximized() and not self.is_fullscreen():
            self.normal_size = self.get_default_size()

    def _close_request(self, *_):
        size = self.normal_size or self.get_default_size()
        window_placement.save(data_directory(), size[0], size[1], self.is_maximized())
        self.workspace.stop()
        return False

    def _start_workspace(self):
        keys = {}
        try:
            keys = key_vault.all_keys()
        except Exception:
            self.alert("Provider keys are unavailable.", "No Secret Service keyring answered (GNOME Keyring, KWallet or KeePassXC). The gallery still opens; unlock or install a keyring to add provider keys.")
        try:
            self.workspace.start(keys)
        except Exception:
            self.workspace.stop()
            self.show_failure("The local workspace could not start. Reopen Banana Studio. Your saved gallery is kept on this computer.")
        return GLib.SOURCE_REMOVE

    def _ready(self, origin, bootstrap):
        self.origin = urlsplit(origin)
        request = WebKit.URIRequest.new(origin + "/local/bootstrap")
        request.get_http_headers().append("X-Banana-Bootstrap", bootstrap)
        self.web.load_request(request)
        return GLib.SOURCE_REMOVE

    def local(self, uri):
        if not uri or self.origin is None:
            return False
        try:
            parts = urlsplit(uri)
            return parts.scheme == self.origin.scheme and parts.hostname == self.origin.hostname and parts.port == self.origin.port
        except ValueError:
            return False

    def _decide_policy(self, view, decision, kind):
        if kind in (WebKit.PolicyDecisionType.NAVIGATION_ACTION, WebKit.PolicyDecisionType.NEW_WINDOW_ACTION):
            action = decision.get_navigation_action()
            uri = action.get_request().get_uri()
            if kind == WebKit.PolicyDecisionType.NAVIGATION_ACTION and (self.local(uri) or uri == "about:blank" or (uri.startswith("blob:") and self.local(view.get_uri()))):
                decision.use()
                return True
            decision.ignore()
            if action.is_user_gesture():
                self.open_external(uri)
            return True
        if kind == WebKit.PolicyDecisionType.RESPONSE and not decision.is_mime_type_supported():
            decision.download()
            return True
        return False

    def _deny_permission(self, view, request):
        request.deny()
        return True

    def _load_changed(self, view, event):
        if event == WebKit.LoadEvent.FINISHED and self.local(view.get_uri()):
            self.status.set_visible(False)

    def _load_failed(self, view, event, uri, error):
        interrupted = error.matches(WebKit.NetworkError.quark(), WebKit.NetworkError.CANCELLED) or \
            error.matches(WebKit.PolicyError.quark(), WebKit.PolicyError.FRAME_LOAD_INTERRUPTED_BY_POLICY_CHANGE)
        if not interrupted and self.local(uri):
            self.show_failure("The workspace could not open. Reopen Banana Studio.")
        return False

    def _native_message(self, manager, value):
        if not self.local(self.web.get_uri()) or not value.is_object() or not value.object_has_property("action"):
            return
        action = value.object_get_property("action").to_string()
        if action == "keys":
            self.show_keys()
        elif action == "lock":
            self.close()

    def _download_started(self, session, download):
        uri = download.get_request().get_uri()
        if not self.local(uri) and not (uri.startswith("blob:") and self.local(self.web.get_uri())):
            download.cancel()
            return
        download.connect("decide-destination", self._decide_destination)

    def _decide_destination(self, download, suggested):
        dialog = Gtk.FileDialog(initial_name=os.path.basename(suggested or "download"), modal=True)

        def chosen(source, result):
            try:
                file = source.save_finish(result)
            except GLib.Error:
                download.cancel()
                return
            if file is None or file.get_path() is None:
                download.cancel()
                return
            download.set_allow_overwrite(True)  # The save dialog confirmed overwriting.
            download.set_destination(file.get_path())
        dialog.save(self, None, chosen)
        return True

    def open_external(self, uri):
        if https(uri):
            Gtk.UriLauncher.new(uri).launch(self, None, None, None)

    def open_data(self):
        directory = data_directory()
        os.makedirs(directory, mode=0o700, exist_ok=True)
        Gtk.FileLauncher.new(Gio.File.new_for_path(directory)).launch(self, None, None, None)

    def toggle_fullscreen(self):
        if self.is_fullscreen():
            self.unfullscreen()
        else:
            self.fullscreen()

    def show_failure(self, message):
        self.status.set_label(message)
        self.status.set_visible(True)

    def alert(self, message, detail):
        dialog = Gtk.AlertDialog(message=message, detail=detail, modal=True)
        dialog.show(self)

    def show_keys(self):
        if self.keys_open or self.origin is None:
            return
        try:
            saved = {name: key_vault.read(name) is not None for name, _ in key_vault.PROVIDERS}
        except Exception:
            self.alert("Provider keys are unavailable.", "Unlock your Secret Service keyring (GNOME Keyring, KWallet or KeePassXC) and try again. No key value is included in this message.")
            return
        dialog = Gtk.Window(title="Provider API Keys", transient_for=self, modal=True, resizable=False)
        dialog.add_css_class("banana")
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=16, margin_top=20, margin_bottom=20, margin_start=20, margin_end=20)
        info = Gtk.Label(label="Add only the providers you use. OpenRouter covers text, images and supported Seedance video; fal.ai covers images and video. Select routes in AI settings. Keys stay in your Secret Service keyring. Blank fields keep saved keys. Remove clears a key.",
                         wrap=True, max_width_chars=70, xalign=0)
        box.append(info)
        grid = Gtk.Grid(column_spacing=10, row_spacing=10)
        rows = []
        for index, (name, label) in enumerate(key_vault.PROVIDERS):
            field = Gtk.PasswordEntry(placeholder_text="Saved in keyring" if saved[name] else "Paste your API key", hexpand=True, width_chars=36)
            remove = Gtk.CheckButton(label="Remove")
            grid.attach(Gtk.Label(label=label, xalign=0), 0, index, 1, 1)
            grid.attach(field, 1, index, 1, 1)
            grid.attach(remove, 2, index, 1, 1)
            rows.append((name, field, remove))
        box.append(grid)
        buttons = Gtk.Box(spacing=8, halign=Gtk.Align.END)
        cancel = Gtk.Button(label="Cancel")
        save = Gtk.Button(label="Save")
        save.add_css_class("suggested-action")
        buttons.append(cancel)
        buttons.append(save)
        box.append(buttons)
        dialog.set_child(box)
        dialog.set_default_widget(save)
        for _, field, _ in rows:
            field.set_property("activates-default", True)
        escape = Gtk.ShortcutController()
        escape.add_shortcut(Gtk.Shortcut.new(Gtk.ShortcutTrigger.parse_string("Escape"), Gtk.CallbackAction.new(lambda *_: dialog.close() or True)))
        dialog.add_controller(escape)

        def closed(*_):
            for _, field, _ in rows:
                field.set_text("")
            self.keys_open = False
            return False

        def submit(*_):
            try:
                for name, field, remove in rows:
                    value = field.get_text().strip()
                    if remove.get_active():
                        key_vault.save(name, None)
                    elif value:
                        key_vault.save(name, value)
                self.workspace.refresh_keys(key_vault.all_keys())
            except Exception:
                self.alert("The keys could not be saved or activated.", "Unlock your Secret Service keyring and try again. No key value is included in this message.")
            dialog.close()
        cancel.connect("clicked", lambda *_: dialog.close())
        save.connect("clicked", submit)
        dialog.connect("close-request", closed)
        self.keys_open = True
        dialog.present()


class StudioApplication(Gtk.Application):
    def __init__(self, root):
        flags = getattr(Gio.ApplicationFlags, "DEFAULT_FLAGS", Gio.ApplicationFlags.FLAGS_NONE)
        super().__init__(application_id=APP_ID, flags=flags)
        self.root = root
        self.window = None

    def do_startup(self):
        Gtk.Application.do_startup(self)
        GLib.set_application_name("Banana Studio")
        settings = Gtk.Settings.get_default()
        if hasattr(Gtk, "InterfaceColorScheme") and settings.find_property("gtk-interface-color-scheme"):
            settings.set_property("gtk-interface-color-scheme", Gtk.InterfaceColorScheme.DARK)  # GTK 4.20+
        else:
            settings.set_property("gtk-application-prefer-dark-theme", True)
        display = Gdk.Display.get_default()
        provider = Gtk.CssProvider()
        provider.load_from_data(CSS, -1)
        Gtk.StyleContext.add_provider_for_display(display, provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        # Running from the extracted folder still shows the app icon on X11.
        Gtk.IconTheme.get_for_display(display).add_search_path(os.path.join(self.root, "icons"))
        Gtk.Window.set_default_icon_name(APP_ID)
        for name, accels, callback in (
            ("keys", ["<Control>comma"], lambda: self.window and self.window.show_keys()),
            ("open-data", [], lambda: self.window and self.window.open_data()),
            ("updates", [], lambda: self.window and self.window.open_external(RELEASES)),
            ("fullscreen", ["F11"], lambda: self.window and self.window.toggle_fullscreen()),
            ("quit", ["<Control>q"], lambda: self.window.close() if self.window else self.quit()),
        ):
            action = Gio.SimpleAction.new(name, None)
            action.connect("activate", lambda _a, _p, run=callback: run())
            self.add_action(action)
            self.set_accels_for_action("app." + name, accels)

    def do_activate(self):
        # Gtk.Application is single-instance over D-Bus; a second launch only
        # raises the existing window and never opens a second workspace.
        if self.window is None:
            self.window = StudioWindow(self, self.root)
        self.window.present()


def run(root, argv):
    return StudioApplication(root).run(argv)

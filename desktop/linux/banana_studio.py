#!/usr/bin/python3
"""Native GTK/WebKitGTK shell. Durable data belongs to the shared workspace."""
import fcntl
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.parse import urlsplit

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
gi.require_version('Secret', '1')
from gi.repository import Gio, GLib, Gtk, Secret, WebKit2

PROVIDERS = (
    ('OPENAI_API_KEY', 'OpenAI'), ('OPENROUTER_API_KEY', 'OpenRouter'),
    ('GEMINI_API_KEY', 'Google Gemini'), ('FAL_KEY', 'fal.ai'),
    ('EVOLINK_API_KEY', 'EvoLink'), ('YOUTUBE_API_KEY', 'YouTube Data API'),
)
RELEASES = 'https://github.com/orkunisitmak/banana-studio/releases/latest'


class KeyVault:
    def __init__(self, service='com.bananastudio.provider-keys'):
        self.schema = Secret.Schema.new(service, Secret.SchemaFlags.NONE,
                                        {'provider': Secret.SchemaAttributeType.STRING})

    def read(self, name):
        return Secret.password_lookup_sync(self.schema, {'provider': name}, None)

    def save(self, name, value):
        if value is None:
            Secret.password_clear_sync(self.schema, {'provider': name}, None)
        else:
            if not value or len(value.encode()) > 2560 or '\n' in value or '\r' in value:
                raise ValueError('Invalid API key.')
            if not Secret.password_store_sync(self.schema, {'provider': name},
                                              Secret.COLLECTION_DEFAULT,
                                              'Banana Studio / ' + name, value, None):
                raise RuntimeError('Secret Service could not save the key.')

    def all(self):
        return {name: value for name, _ in PROVIDERS if (value := self.read(name))}


def data_directory():
    base = Path(os.environ.get('XDG_DATA_HOME', ''))
    if not base.is_absolute():
        base = Path.home() / '.local/share'
    return base / 'banana-studio'


def local_url(value, origin):
    try:
        url = urlsplit(value or '')
        return bool(origin and not url.username and not url.password
                    and url.scheme == 'http' and url.netloc == urlsplit(origin).netloc)
    except ValueError:
        return False


def external_url(value):
    try:
        url = urlsplit(value)
        return url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password
    except ValueError:
        return False


class StudioWindow(Gtk.ApplicationWindow):
    def __init__(self, app, root, directory, vault):
        super().__init__(application=app, title='Banana Studio')
        self.root, self.directory, self.vault = root, directory, vault
        self.process = None
        self.origin = None
        self.closing = False
        self.keys_open = False
        self.ready = False
        self.output = bytearray()
        self.is_fullscreen = False
        self.set_default_size(1400, 900)
        self.set_size_request(760, 560)
        self.set_icon_from_file(str(root / 'icon.png'))
        self.connect('delete-event', self.close_workspace)
        self.connect('key-press-event', self.key_pressed)
        self.connect('window-state-event', self.window_state)
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.add(box)
        menu = Gtk.MenuBar()
        for label, items in [('File', [('Provider API Keys…', self.show_keys),
                                     ('Open Local Data Folder', lambda: self.open_uri(directory.as_uri())),
                                     ('Check for Updates…', lambda: self.open_uri(RELEASES)),
                                     ('Quit', self.close)]),
                             ('View', [('Full Screen (F11)', self.toggle_fullscreen)])]:
            parent, submenu = Gtk.MenuItem(label=label), Gtk.Menu()
            parent.set_submenu(submenu)
            for title, callback in items:
                item = Gtk.MenuItem(label=title)
                item.connect('activate', lambda _, fn=callback: fn())
                submenu.append(item)
            menu.append(parent)
        box.pack_start(menu, False, False, 0)
        self.status = Gtk.Label(label='Opening your local workspace…')
        box.pack_start(self.status, False, False, 8)
        self.manager = WebKit2.UserContentManager()
        # The privileged handler lives in an isolated JS world. Remote frames
        # and the page world cannot call it; only our local top-frame script can.
        self.manager.register_script_message_handler_in_world('bananaNative', 'banana-native')
        self.manager.connect('script-message-received::bananaNative', self.native_message)
        context = WebKit2.WebContext.new_ephemeral()
        self.web = WebKit2.WebView(web_context=context, user_content_manager=self.manager)
        self.web.get_settings().set_enable_developer_extras(False)
        self.web.get_settings().set_enable_html5_database(False)
        self.web.get_settings().set_enable_html5_local_storage(False)
        self.web.connect('decide-policy', self.decide_policy)
        self.web.connect('permission-request', lambda _, request: (request.deny(), True)[1])
        self.web.connect('load-changed', self.loaded)
        self.web.connect('load-failed', self.load_failed)
        self.web.connect('web-process-terminated', lambda *_: self.failure('The workspace view stopped. Reopen Banana Studio.'))
        context.connect('download-started', self.download)
        box.pack_start(self.web, True, True, 0)
        try:
            placement = json.loads((directory / 'window.json').read_text())
            work = self.get_screen().get_monitor_workarea(self.get_screen().get_primary_monitor())
            width, height = placement['width'], placement['height']
            if type(width) is int and type(height) is int:
                self.resize(max(760, min(width, work.width)), max(560, min(height, work.height)))
        except (OSError, ValueError, KeyError, TypeError):
            pass
        self.show_all()
        GLib.idle_add(self.start_workspace)

    def open_uri(self, uri):
        try:
            Gio.AppInfo.launch_default_for_uri(uri, self.get_display().get_app_launch_context())
        except GLib.Error:
            self.message('Could not open the system browser or file manager.')

    def message(self, text):
        dialog = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.ERROR,
                                   buttons=Gtk.ButtonsType.CLOSE, text=text)
        dialog.run()
        dialog.destroy()

    def failure(self, text):
        self.status.set_text(text)
        self.status.show()
        self.stop_process()
        return False

    def start_workspace(self):
        if self.closing:
            return False
        try:
            keys = self.vault.all()
            self.bootstrap = secrets.token_hex(32)
            # Do not inherit keys, NODE_OPTIONS, proxy settings or library hooks.
            self.process = subprocess.Popen(
                [str(self.root / 'runtime/node'), str(self.root / 'workspace/server.mjs')],
                cwd=self.root / 'workspace', env={'PATH': '/usr/bin:/bin', 'HOME': str(Path.home())},
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            self.send({'dataDirectory': str(self.directory), 'webRoot': str(self.root / 'workspace/web'),
                       'bootstrap': self.bootstrap, 'keys': keys})
            os.set_blocking(self.process.stdout.fileno(), False)
            self.deadline = GLib.get_monotonic_time() + 30_000_000
            GLib.timeout_add(50, self.check_process)
        except (OSError, GLib.Error, ValueError):
            self.failure('Could not start the workspace. Unlock your Secret Service keyring (GNOME Keyring or KWallet), then reopen Banana Studio. Your gallery is kept on this computer.')
        return False

    def send(self, message):
        self.process.stdin.write((json.dumps(message) + '\n').encode())
        self.process.stdin.flush()

    def check_process(self):
        if self.closing or not self.process:
            return False
        if self.process.poll() is not None:
            return self.failure('The local workspace stopped. Reopen Banana Studio. Your saved gallery is kept on this computer.')
        try:
            part = os.read(self.process.stdout.fileno(), 65536)
        except BlockingIOError:
            part = b''
        if self.ready:
            return True
        self.output.extend(part)
        if len(self.output) > 256000 or GLib.get_monotonic_time() > self.deadline:
            return self.failure('The local workspace did not become ready within 30 seconds. Reopen Banana Studio.')
        if b'\n' not in self.output:
            return True
        try:
            message = json.loads(self.output.split(b'\n', 1)[0])
            origin = message['origin']
            url = urlsplit(origin)
            if (message['event'] != 'ready' or url.scheme != 'http' or url.hostname != '127.0.0.1'
                    or url.username or url.password or not url.port or url.path or url.query or url.fragment):
                raise ValueError('Invalid workspace origin.')
            self.origin, self.ready = origin, True
            self.output.clear()
            # WebKit match patterns do not support ports. Check the complete
            # origin inside both scripts as well as at the native boundary.
            allowed = ['http://127.0.0.1/*']
            isolated = """document.addEventListener('banana-native-action', event => {
              if (event.detail === 'keys' || event.detail === 'lock')
                window.webkit.messageHandlers.bananaNative.postMessage(event.detail);
            });"""
            bridge = """window.bananaLinux = {postMessage(value) {
              if (value && (value.action === 'keys' || value.action === 'lock'))
                document.dispatchEvent(new CustomEvent('banana-native-action', {detail:value.action}));
            }};"""
            guard = 'if (location.origin !== ' + json.dumps(origin) + ') return;'
            isolated = '(() => {' + guard + isolated + '})();'
            bridge = '(() => {' + guard + bridge + '})();'
            self.manager.add_script(WebKit2.UserScript.new_for_world(
                isolated, WebKit2.UserContentInjectedFrames.TOP_FRAME,
                WebKit2.UserScriptInjectionTime.START, 'banana-native', allowed, None))
            self.manager.add_script(WebKit2.UserScript.new(
                bridge, WebKit2.UserContentInjectedFrames.TOP_FRAME,
                WebKit2.UserScriptInjectionTime.START, allowed, None))
            request = WebKit2.URIRequest.new(origin + '/local/bootstrap')
            request.get_http_headers().append('X-Banana-Bootstrap', self.bootstrap)
            self.web.load_request(request)
        except (ValueError, KeyError, TypeError, GLib.Error):
            return self.failure('The workspace returned an invalid startup response. Reopen Banana Studio.')
        return True

    def loaded(self, web, event):
        if event == WebKit2.LoadEvent.FINISHED and local_url(web.get_uri(), self.origin):
            self.status.hide()

    def load_failed(self, *_):
        self.status.set_text('The workspace could not open. Reopen Banana Studio.')
        self.status.show()
        return True

    def native_message(self, _, result):
        if not local_url(self.web.get_uri(), self.origin):
            return
        value = result.get_js_value().to_string()
        if value == 'keys':
            self.show_keys()
        elif value == 'lock':
            self.close()

    def owned_resource(self, uri):
        return local_url(uri, self.origin) or (
            bool(self.origin) and uri.startswith('blob:' + self.origin + '/')
            and local_url(self.web.get_uri(), self.origin))

    def decide_policy(self, _, decision, kind):
        if kind == WebKit2.PolicyDecisionType.RESPONSE:
            if decision.is_main_frame_main_resource() and not self.owned_resource(decision.get_request().get_uri()):
                decision.ignore()
                return True
            return False
        if kind not in (WebKit2.PolicyDecisionType.NAVIGATION_ACTION, WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION):
            return False
        action = decision.get_navigation_action()
        uri = action.get_request().get_uri()
        if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION and self.owned_resource(uri):
            return False
        # YouTube embeds have no access to the isolated native world. The
        # response policy above still rejects an external top-level document.
        url = urlsplit(uri)
        if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION and url.scheme == 'https' and url.hostname in ('www.youtube.com', 'www.youtube-nocookie.com') and url.path.startswith('/embed/'):
            return False
        decision.ignore()
        if action.is_user_gesture() and external_url(uri):
            self.open_uri(uri)
        return True

    def download(self, _, download):
        uri = download.get_request().get_uri()
        if not self.owned_resource(uri):
            download.cancel()
            return
        def destination(item, suggested):
            dialog = Gtk.FileChooserDialog(title='Save result', transient_for=self, action=Gtk.FileChooserAction.SAVE)
            dialog.add_buttons('_Cancel', Gtk.ResponseType.CANCEL, '_Save', Gtk.ResponseType.ACCEPT)
            dialog.set_do_overwrite_confirmation(True)
            dialog.set_current_name(Path(suggested).name or 'download')
            if dialog.run() == Gtk.ResponseType.ACCEPT:
                item.set_allow_overwrite(True)
                item.set_destination(Path(dialog.get_filename()).as_uri())
            else:
                item.cancel()
            dialog.destroy()
            return True
        download.connect('decide-destination', destination)
        def failed(_, error):
            if not error.matches(WebKit2.download_error_quark(), WebKit2.DownloadError.CANCELLED_BY_USER):
                self.message('The download could not be saved. Try again.')
        download.connect('failed', failed)

    def show_keys(self):
        if self.keys_open or not self.ready or self.process is None:
            return
        self.keys_open = True
        dialog = Gtk.Dialog(title='Provider API Keys', transient_for=self, modal=True)
        dialog.add_buttons('_Cancel', Gtk.ResponseType.CANCEL, '_Save', Gtk.ResponseType.OK)
        grid = Gtk.Grid(column_spacing=12, row_spacing=12, margin=20)
        dialog.get_content_area().add(grid)
        info = Gtk.Label(label='Keys stay in your Secret Service keyring. Blank fields keep saved keys. Remove clears a key.', wrap=True, max_width_chars=70)
        grid.attach(info, 0, 0, 3, 1)
        rows = []
        try:
            for row, (name, label) in enumerate(PROVIDERS, 1):
                field = Gtk.Entry(visibility=False, width_chars=36)
                field.set_placeholder_text('Saved in keyring' if self.vault.read(name) else 'Paste your API key')
                remove = Gtk.CheckButton(label='Remove')
                grid.attach(Gtk.Label(label=label, xalign=0), 0, row, 1, 1)
                grid.attach(field, 1, row, 1, 1)
                grid.attach(remove, 2, row, 1, 1)
                rows.append((name, field, remove))
            dialog.show_all()
            if dialog.run() == Gtk.ResponseType.OK:
                # Validate all entries before changing any stored provider.
                updates = [(name, None if remove.get_active() else field.get_text().strip())
                           for name, field, remove in rows if remove.get_active() or field.get_text().strip()]
                if any(value is not None and (len(value.encode()) > 2560 or '\n' in value or '\r' in value) for _, value in updates):
                    raise ValueError('Invalid API key.')
                for name, value in updates:
                    self.vault.save(name, value)
                self.send({'action': 'keys', 'keys': self.vault.all()})
        except (OSError, ValueError, GLib.Error, RuntimeError):
            self.message('Keys could not be saved or activated. Unlock your Secret Service keyring and try again. Reopen this dialog to check which keys were saved.')
        finally:
            for _, field, _ in rows:
                field.set_text('')
            dialog.destroy()
            self.keys_open = False

    def window_state(self, _, event):
        from gi.repository import Gdk
        self.is_fullscreen = bool(event.new_window_state & Gdk.WindowState.FULLSCREEN)

    def toggle_fullscreen(self):
        self.unfullscreen() if self.is_fullscreen else self.fullscreen()

    def key_pressed(self, _, event):
        from gi.repository import Gdk
        if event.keyval == Gdk.KEY_F11:
            self.toggle_fullscreen()
            return True
        if event.state & Gdk.ModifierType.CONTROL_MASK and event.keyval == Gdk.KEY_comma:
            self.show_keys()
            return True
        return False

    def stop_process(self):
        process, self.process = self.process, None
        if process:
            try:
                process.stdin.close()
                process.wait(timeout=3)
            except (OSError, subprocess.TimeoutExpired):
                process.kill()
                process.wait()
            finally:
                process.stdout.close()

    def close_workspace(self, *_):
        self.closing = True
        if not self.is_fullscreen and not self.is_maximized():
            width, height = self.get_size()
            temporary = self.directory / 'window.json.tmp'
            try:
                temporary.write_text(json.dumps({'width': width, 'height': height}))
                temporary.replace(self.directory / 'window.json')
            except OSError:
                pass
        self.stop_process()
        return False


def main():
    os.umask(0o077)
    root = Path(__file__).resolve().parent
    directory = data_directory()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (directory / 'workspace.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('Banana Studio is already running. Open its existing window.', file=sys.stderr)
        return 1
    app = Gtk.Application(application_id='com.bananastudio.BananaStudio', flags=Gio.ApplicationFlags.NON_UNIQUE)
    app.connect('activate', lambda app: StudioWindow(app, root, directory, KeyVault()))
    try:
        return app.run(sys.argv)
    finally:
        for window in app.get_windows():
            window.stop_process()
        lock.close()


if __name__ == '__main__':
    sys.exit(main())

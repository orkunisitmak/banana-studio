"""Synthetic Linux checks; never use a user's gallery or provider credentials."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
import uuid

sys.dont_write_bytecode = True
from banana_studio import KeyVault, StudioWindow, external_url, local_url
from gi.repository import Gio, GLib, Gtk, WebKit2


class Boundaries(unittest.TestCase):
    def test_navigation_origin(self):
        origin = 'http://127.0.0.1:12345'
        self.assertTrue(local_url(origin + '/local/bootstrap', origin))
        for value in ('http://127.0.0.1:12346/', 'https://127.0.0.1:12345/',
                      'http://evil.invalid:12345/', 'http://user@127.0.0.1:12345/',
                      'file:///etc/passwd', 'javascript:alert(1)', None):
            self.assertFalse(local_url(value, origin))
        self.assertFalse(local_url(origin, None))

    def test_external_links(self):
        self.assertTrue(external_url('https://github.com/orkunisitmak/banana-studio'))
        for value in ('http://example.invalid', 'file:///etc/passwd',
                      'https://user:password@example.invalid', 'javascript:alert(1)'):
            self.assertFalse(external_url(value))

    def test_key_validation(self):
        vault = KeyVault('com.bananastudio.test.' + uuid.uuid4().hex)
        for value in ('', 'a\nb', 'a\rb', 'a' * 2561):
            with self.assertRaises(ValueError):
                vault.save('fixture', value)

    def test_download_ownership(self):
        class Page:
            def get_uri(self):
                return 'http://127.0.0.1:12345/'
        class Window:
            origin = 'http://127.0.0.1:12345'
            web = Page()
        window = Window()
        self.assertTrue(StudioWindow.owned_resource(window, window.origin + '/media.png'))
        self.assertTrue(StudioWindow.owned_resource(window, 'blob:' + window.origin + '/fixture'))
        for uri in ('blob:http://127.0.0.1:12346/fixture', 'https://example.invalid/file', 'file:///etc/passwd'):
            self.assertFalse(StudioWindow.owned_resource(window, uri))


def vault_test():
    vault = KeyVault('com.bananastudio.test.' + uuid.uuid4().hex)
    try:
        assert vault.read('fixture') is None
        vault.save('fixture', 'synthetic-test-only')
        assert vault.read('fixture') == 'synthetic-test-only'
        vault.save('fixture', None)
        assert vault.read('fixture') is None
        print('Secret Service isolated save/read/delete passed.')
    finally:
        vault.save('fixture', None)


def smoke_test(root):
    # Test the packaged shell and real WebKit against disposable local data.
    # A separate vault fixture above covers Secret Service; no real keys load.
    class EmptyVault:
        def all(self):
            return {}

    os.umask(0o077)
    with tempfile.TemporaryDirectory(prefix='banana-linux-shell-') as temporary:
        assert (root / 'banana_studio.py').read_bytes() == Path(__file__).with_name('banana_studio.py').read_bytes(), 'Repackage the updated Linux shell before testing.'
        app = Gtk.Application(application_id='com.bananastudio.test.t' + uuid.uuid4().hex,
                              flags=Gio.ApplicationFlags.NON_UNIQUE)
        state = {'ok': False, 'checking': False, 'bridge': False}

        def activate(application):
            window = StudioWindow(application, root, Path(temporary), EmptyVault())
            state['window'] = window
            # Observe an actual page-world -> isolated-world message without
            # opening a modal provider dialog during the smoke test.
            window.manager.connect('script-message-received::bananaNative',
                                   lambda _, result: state.update(bridge=result.get_js_value().to_string() == 'keys'))
            window.show_keys = lambda: None

        def finish(error=None):
            window = state['window']
            if error:
                state['ok'] = False
                print(error, file=sys.stderr)
                window.close_workspace()
                window.destroy()
                app.quit()
            else:
                # Exercise the real page -> isolated world -> native quit path.
                window.web.evaluate_javascript("window.bananaLinux.postMessage({action:'lock'})",
                                               -1, None, None, None, None, None)
            return False

        def evaluated(web, result, _):
            try:
                value = json.loads(web.evaluate_javascript_finish(result).to_string())
                if value['loaded']:
                    assert value['wrapped'], 'Page world did not receive the DOM-only bridge: ' + json.dumps(value)
                    assert not value['privileged'], 'Page world can access the privileged handler.'
                    state['loaded'] = True
                else:
                    state['checking'] = False
            except (GLib.Error, AssertionError, ValueError) as error:
                finish(str(error))

        def tick():
            window = state['window']
            if state.get('loaded') and state['bridge']:
                state['ok'] = True
                assert (Path(temporary) / 'workspace.sqlite').exists()
                # An optional snapshot is synthetic and stays outside source.
                snapshot = os.environ.get('BANANA_TEST_SNAPSHOT')
                if snapshot:
                    def captured(web, result, _):
                        try:
                            web.get_snapshot_finish(result).write_to_png(snapshot)
                            finish()
                        except (GLib.Error, OSError) as error:
                            finish(str(error))
                    window.web.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, captured, None)
                    return False
                return finish()
            if window.ready and not window.web.is_loading() and not state['checking']:
                state['checking'] = True
                window.web.evaluate_javascript("""JSON.stringify((() => {
                  const loaded = document.body.innerText.includes('Local workspace');
                  const wrapped = String(window.bananaLinux?.postMessage).includes('dispatchEvent');
                  if (loaded) window.bananaLinux?.postMessage({action:'keys'});
                  return {loaded, wrapped, uri:location.href, bridge:String(window.bananaLinux?.postMessage), privileged:!!window.webkit?.messageHandlers?.bananaNative};
                })())""", -1, None, None, None, evaluated, None)
            return True

        app.connect('activate', activate)
        GLib.timeout_add(200, tick)
        GLib.timeout_add_seconds(45, lambda: finish('Linux UI smoke test timed out.'))
        app.run([sys.argv[0]])
        if not state['ok']:
            raise RuntimeError('Linux UI smoke test failed.')
        assert state['window'].process is None, 'Native quit did not reap the workspace child.'
        assert (Path(temporary) / 'window.json').exists(), 'Window size was not saved on quit.'
        print('Packaged GTK/WebKit UI, authenticated bootstrap, isolated native bridge, SQLite startup and native quit passed.')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--vault':
        vault_test()
    elif len(sys.argv) > 2 and sys.argv[1] == '--smoke':
        smoke_test(Path(sys.argv[2]).resolve())
    else:
        unittest.main()

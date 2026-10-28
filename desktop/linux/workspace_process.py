"""The bundled Node workspace server, started with an allowlisted environment."""
import json
import os
import secrets
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit

from gi.repository import GLib


def data_directory():
    base = os.environ.get("XDG_DATA_HOME")
    if not base or not os.path.isabs(base):
        base = os.path.join(os.path.expanduser("~"), ".local", "share")
    return os.path.join(base, "banana-studio")


class WorkspaceProcess:
    def __init__(self, root, ready, failed):
        self.root = root
        self.ready = ready
        self.failed = failed
        self.process = None
        self.bootstrap = ""
        self.closing = False
        self.started = False
        self.writer = threading.Lock()

    def start(self, keys):
        runtime = os.path.join(self.root, "runtime", "node")
        workspace = os.path.join(self.root, "workspace")
        server = os.path.join(workspace, "server.mjs")
        if not os.access(runtime, os.X_OK) or not os.path.isfile(server):
            raise FileNotFoundError("The bundled workspace runtime is missing.")
        self.bootstrap = secrets.token_hex(32)
        directory = data_directory()
        os.makedirs(directory, mode=0o700, exist_ok=True)
        # Never inherit provider keys, NODE_OPTIONS, proxies or other shell configuration.
        env = {"PATH": "/usr/bin:/bin", "HOME": os.path.expanduser("~"), "TMPDIR": tempfile.gettempdir()}
        # Upstream diagnostics must not become persistent logs containing media,
        # prompts or keys. Readiness uses a small allowlisted stdout protocol.
        self.process = subprocess.Popen([runtime, server], cwd=workspace, env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, close_fds=True)
        threading.Thread(target=self._read, daemon=True).start()
        GLib.timeout_add_seconds(30, self._startup_timeout)
        self._send({"dataDirectory": directory, "webRoot": os.path.join(workspace, "web"), "bootstrap": self.bootstrap, "keys": keys})

    def _read(self):
        stream = self.process.stdout
        while True:
            line = stream.readline(256_001)
            if not line or len(line) > 256_000:
                break
            if self.started:
                continue
            try:
                message = json.loads(line)
                origin = urlsplit(message["origin"]) if message.get("event") == "ready" else None
            except (ValueError, KeyError, TypeError, AttributeError):
                continue
            if origin and origin.scheme == "http" and origin.hostname == "127.0.0.1" and origin.port and not origin.path and not origin.username:
                self.started = True
                GLib.idle_add(self.ready, f"http://127.0.0.1:{origin.port}", self.bootstrap)
        GLib.idle_add(self._fail)

    def _startup_timeout(self):
        if not self.started:
            self._fail()
        return GLib.SOURCE_REMOVE

    def _fail(self):
        if self.closing:
            return GLib.SOURCE_REMOVE
        self.closing = True
        self._terminate()
        self.failed()
        return GLib.SOURCE_REMOVE

    def _send(self, value):
        with self.writer:
            if self.process is None or self.process.stdin is None:
                raise BrokenPipeError()
            self.process.stdin.write((json.dumps(value) + "\n").encode())
            self.process.stdin.flush()

    def refresh_keys(self, keys):
        self._send({"action": "keys", "keys": keys})

    def _terminate(self):
        if self.process is None:
            return
        try:
            self.process.stdin.close()
            self.process.wait(timeout=3)
        except (OSError, subprocess.TimeoutExpired):
            self.process.kill()
            self.process.wait()

    def stop(self):
        if self.closing:
            return
        self.closing = True
        try:
            self._send({"action": "shutdown"})
        except OSError:
            pass
        self._terminate()

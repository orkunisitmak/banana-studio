"""Provider keys in the freedesktop Secret Service (GNOME Keyring, KWallet, KeePassXC).

Keys never touch the workspace directory, frontend configuration or logs; they
cross only the native/backend stdin pipe, as on macOS and Windows.
"""
import uuid

import gi

gi.require_version("Secret", "1")
from gi.repository import Secret  # noqa: E402

PROVIDERS = (
    ("OPENAI_API_KEY", "OpenAI"), ("OPENROUTER_API_KEY", "OpenRouter"),
    ("GEMINI_API_KEY", "Google Gemini"), ("FAL_KEY", "fal.ai"),
    ("EVOLINK_API_KEY", "EvoLink"), ("YOUTUBE_API_KEY", "YouTube Data API"),
)
_LABELS = dict(PROVIDERS)
_SCHEMA_NAME = "com.bananastudio.provider-keys"


def _schema(name):
    return Secret.Schema.new(name, Secret.SchemaFlags.NONE, {"provider": Secret.SchemaAttributeType.STRING})


SCHEMA = _schema(_SCHEMA_NAME)


def read(name, schema=SCHEMA):
    value = Secret.password_lookup_sync(schema, {"provider": name}, None)
    if value is not None and len(value.encode()) > 2560:
        raise ValueError("A saved key is invalid.")
    return value


def save(name, value, schema=SCHEMA):
    if not value:
        Secret.password_clear_sync(schema, {"provider": name}, None)
        return
    if len(value.encode()) > 2560 or "\n" in value or "\r" in value:
        raise ValueError("The API key is invalid or too long.")
    label = "Banana Studio: " + _LABELS.get(name, name)
    if not Secret.password_store_sync(schema, {"provider": name}, Secret.COLLECTION_DEFAULT, label, value, None):
        raise OSError("The key could not be saved.")


def all_keys():
    keys = {}
    for name, _ in PROVIDERS:
        value = read(name)
        if value is not None:
            keys[name] = value
    return keys


def test():
    schema = _schema("com.bananastudio.test." + uuid.uuid4().hex)
    try:
        save("fixture", "synthetic-test-only", schema)
        if read("fixture", schema) != "synthetic-test-only":
            raise AssertionError("Secret Service round trip failed.")
        save("fixture", None, schema)
        if read("fixture", schema) is not None:
            raise AssertionError("Secret Service removal failed.")
    finally:
        save("fixture", None, schema)

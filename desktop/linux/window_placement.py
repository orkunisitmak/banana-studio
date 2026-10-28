"""Window size persistence.

Wayland compositors own window positions, so unlike macOS and Windows only the
size and maximized state are restored. The size is fitted to a current monitor
so a removed or smaller display never leaves the window unusable.
"""
import json
import os
import shutil
import tempfile
import uuid

MINIMUM = (760, 560)
FILE_NAME = "window-placement.json"


def constrain(size, monitors, minimum=MINIMUM):
    """Fit (width, height) to the largest monitor area that can hold it."""
    if not monitors:
        return size
    screen = max(monitors, key=lambda m: min(m[0], size[0]) * min(m[1], size[1]))
    return (min(screen[0], max(minimum[0], size[0])), min(screen[1], max(minimum[1], size[1])))


def load(directory):
    try:
        path = os.path.join(directory, FILE_NAME)
        if os.path.getsize(path) > 2048:
            return None
        with open(path, encoding="utf-8") as stream:
            value = json.load(stream)
        width, height, maximized = value["width"], value["height"], value.get("maximized", False)
        if value.get("version") != 1 or not all(type(n) is int and 0 < n <= 100000 for n in (width, height)) or type(maximized) is not bool:
            return None
        return {"width": width, "height": height, "maximized": maximized}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def save(directory, width, height, maximized):
    if width <= 0 or height <= 0:
        return
    temporary = os.path.join(directory, ".window-placement-" + uuid.uuid4().hex + ".tmp")
    try:
        os.makedirs(directory, mode=0o700, exist_ok=True)
        with open(temporary, "x", encoding="utf-8") as stream:
            json.dump({"version": 1, "width": width, "height": height, "maximized": maximized}, stream)
        os.replace(temporary, os.path.join(directory, FILE_NAME))
    except OSError:
        pass  # Preferences cannot prevent saving work.
    finally:
        try:
            os.remove(temporary)
        except OSError:
            pass


def test():
    directory = tempfile.mkdtemp(prefix="BananaStudio-window-test-")
    def require(value):
        if not value:
            raise AssertionError("Window placement test failed.")
    try:
        require(load(directory) is None)
        save(directory, 900, 650, False)
        require(load(directory) == {"width": 900, "height": 650, "maximized": False})
        save(directory, 1400, 900, True)
        require(load(directory) == {"width": 1400, "height": 900, "maximized": True})
        work = (1280, 720)
        require(constrain((900, 650), [work]) == (900, 650))
        require(constrain((5000, 5000), [work]) == work)
        require(constrain((50, 50), [work]) == MINIMUM)
        require(constrain((900, 650), [(600, 400)]) == (600, 400))
        require(constrain((1800, 1000), [(1280, 720), (1920, 1080)]) == (1800, 1000))
        with open(os.path.join(directory, FILE_NAME), "w", encoding="utf-8") as stream:
            stream.write("not json")
        require(load(directory) is None)
    finally:
        shutil.rmtree(directory, ignore_errors=True)

#!/bin/sh
set -eu
PATH=/usr/bin:/bin
export PATH
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
# Preserve only desktop-session inputs. No provider keys, NODE_OPTIONS or
# Electron overrides cross this boundary. No user-supplied Electron flags.
set -- /usr/bin/env -i "PATH=$PATH"
if [ "${HOME+x}" = x ]; then set -- "$@" "HOME=$HOME"; fi
if [ "${LANG+x}" = x ]; then set -- "$@" "LANG=$LANG"; fi
if [ "${LC_ALL+x}" = x ]; then set -- "$@" "LC_ALL=$LC_ALL"; fi
if [ "${DISPLAY+x}" = x ]; then set -- "$@" "DISPLAY=$DISPLAY"; fi
if [ "${WAYLAND_DISPLAY+x}" = x ]; then set -- "$@" "WAYLAND_DISPLAY=$WAYLAND_DISPLAY"; fi
if [ "${XAUTHORITY+x}" = x ]; then set -- "$@" "XAUTHORITY=$XAUTHORITY"; fi
if [ "${DBUS_SESSION_BUS_ADDRESS+x}" = x ]; then set -- "$@" "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"; fi
if [ "${XDG_RUNTIME_DIR+x}" = x ]; then set -- "$@" "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR"; fi
if [ "${XDG_CURRENT_DESKTOP+x}" = x ]; then set -- "$@" "XDG_CURRENT_DESKTOP=$XDG_CURRENT_DESKTOP"; fi
if [ "${KDE_SESSION_VERSION+x}" = x ]; then set -- "$@" "KDE_SESSION_VERSION=$KDE_SESSION_VERSION"; fi
if [ "${XDG_SESSION_TYPE+x}" = x ]; then set -- "$@" "XDG_SESSION_TYPE=$XDG_SESSION_TYPE"; fi
if [ "${XDG_DATA_HOME+x}" = x ]; then set -- "$@" "XDG_DATA_HOME=$XDG_DATA_HOME"; fi
if [ "${XDG_CONFIG_HOME+x}" = x ]; then set -- "$@" "XDG_CONFIG_HOME=$XDG_CONFIG_HOME"; fi
if [ "${XDG_CACHE_HOME+x}" = x ]; then set -- "$@" "XDG_CACHE_HOME=$XDG_CACHE_HOME"; fi
exec "$@" "$app_dir/banana-studio-bin" --class=banana-studio-linux-alpha

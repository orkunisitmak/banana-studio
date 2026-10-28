#!/bin/sh
# Adds Banana Studio to the application menu for the current user. The app
# stays in this folder; run `./install.sh --uninstall` to remove the menu entry.
set -eu
here=$(dirname "$(readlink -f "$0")")
data=${XDG_DATA_HOME:-$HOME/.local/share}
id=com.bananastudio.BananaStudio
entry="$data/applications/$id.desktop"
if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$entry" "$data/icons/hicolor/192x192/apps/$id.png" "$data/icons/hicolor/512x512/apps/$id.png"
  echo "Removed the menu entry. Your gallery in $data/banana-studio and keyring entries are kept."
  exit 0
fi
if ! /usr/bin/python3 -I "$here/shell/check_dependencies.py"; then exit 1; fi
mkdir -p "$data/applications"
for size in 192 512; do
  mkdir -p "$data/icons/hicolor/${size}x${size}/apps"
  cp "$here/icons/hicolor/${size}x${size}/apps/$id.png" "$data/icons/hicolor/${size}x${size}/apps/$id.png"
done
# Desktop Entry Exec quoting: inside a quoted argument \ " ` $ need a backslash,
# which the string escape rule doubles; % is a field code and becomes %%.
exec_path=$(printf '%s' "$here/banana-studio" | sed -e 's/[\\"`$]/\\\\&/g' -e 's/%/%%/g')
{ sed -e '/^Exec=/d' "$here/$id.desktop"; printf 'Exec="%s"\n' "$exec_path"; } > "$entry.tmp"
mv "$entry.tmp" "$entry"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$data/applications" || true
echo "Banana Studio is in your application menu. Keep this folder in place: $here"

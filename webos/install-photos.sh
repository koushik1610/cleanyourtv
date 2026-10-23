#!/usr/bin/env bash
# Package and install the Photos app (photos-app/) on the TV, then refresh the launcher so its tile
# shows up. Run sync-photos.py first to bring in the Favorites album.
#   TV_HOST=192.168.1.50 ./install-photos.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${TV_HOST:?set TV_HOST to the TV IP address, e.g. TV_HOST=192.168.1.50 $0}"
DEVICE="${DEVICE:-lgtv}"
APP_ID=com.vibehack.photos

ares() {
  if command -v "ares-$1" >/dev/null; then "ares-$1" "${@:2}"
  else npx -y -p @webos-tools/cli "ares-$1" "${@:2}"; fi
}

[ -f photos-app/photos.js ] || echo "window.TV_PHOTOS = [];" > photos-app/photos.js
# Your own icon if you made one (it stays out of git), else the launcher's.
ICON=assets/apple-photos-icon.png
[ -f "$ICON" ] || ICON=assets/icon.jpg
if [ ! -f photos-app/icon.png ]; then
  sips -s format png -z 80 80 "$ICON" --out photos-app/icon.png >/dev/null
  sips -s format png -z 130 130 "$ICON" --out photos-app/largeIcon.png >/dev/null
fi

rm -rf build-photos && mkdir build-photos
ares package photos-app -o build-photos
ares install -d "$DEVICE" build-photos/${APP_ID}_*.ipk
NO_LAUNCH="${NO_LAUNCH:-}" ./install.sh

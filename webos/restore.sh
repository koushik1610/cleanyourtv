#!/usr/bin/env bash
# Put the TV back the way LG ships it: Home opens LG's home, and the launcher and Photos are gone.
#   ./restore.sh
# Nothing in this project changes LG's own apps or settings, so this is the whole undo.
#
# Without a computer: press Home twice for LG's home, then delete "Home" and "Photos" from the app
# list; or open the Developer Mode app and turn off Dev Mode Status, which removes every app
# installed through it. If the Developer Mode session runs out, the apps stop opening and the TV
# behaves as stock until it is extended.
set -uo pipefail
cd "$(dirname "$0")"
DEVICE="${DEVICE:-lgtv}"

ares() {
  if command -v "ares-$1" >/dev/null; then "ares-$1" "${@:2}"
  else npx -y -p @webos-tools/cli "ares-$1" "${@:2}"; fi
}

echo "Stopping the Home service and its start-at-boot activity..."
ares launch -d "$DEVICE" com.gathin.tvhome -p '{"restore": true}' && sleep 5
for app in com.gathin.tvhome com.vibehack.photos; do
  ares install -d "$DEVICE" --remove "$app"
done
if [ -f "$HOME/Library/LaunchAgents/com.tvvibehack.homewatch.plist" ]; then
  ./home-watch-mac.sh uninstall
fi
echo "Done: Home opens LG's home again. ./install.sh puts the launcher back."

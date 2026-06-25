#!/usr/bin/env bash
# Deploy the mod overlay into Wall $treet Raider's local Workshop overlay dir for testing,
# WITHOUT publishing to the Steam Workshop.
#
# IMPORTANT: after deploying, launch the game in STEAM OFFLINE MODE. The loader wipes the overlay
# on launch if Steam reports zero installed Workshop mods (workshopLoader.js:188-196); it leaves a
# hand-made overlay alone only when the Workshop query fails (i.e. Steam is offline).
set -euo pipefail

APPID=3525620
PREFIX="${WSR_PREFIX:-$HOME/.steam/steam/steamapps/compatdata/$APPID/pfx}"
OVERLAY="$PREFIX/drive_c/users/steamuser/AppData/Local/Wall Street Raider/workshop/overlay"
SRC="$(cd "$(dirname "$0")" && pwd)/overlay"

if [ ! -d "$(dirname "$(dirname "$OVERLAY")")" ]; then
    echo "Could not find the WSR prefix at: $PREFIX" >&2
    echo "Set WSR_PREFIX to the game's Proton prefix and retry." >&2
    exit 1
fi

mkdir -p "$OVERLAY"
if command -v rsync >/dev/null 2>&1; then
    rsync -a "$SRC"/ "$OVERLAY"/
else
    cp -r "$SRC"/. "$OVERLAY"/
fi

echo "Deployed mod overlay -> $OVERLAY"
echo "Launch Wall \$treet Raider in STEAM OFFLINE MODE, then look for the floating"
echo "'Export This' / 'Export Portfolio' buttons (bottom-right). Output: ~/Documents/WSR Statements/"

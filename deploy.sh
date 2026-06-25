#!/usr/bin/env bash
# Deploy the WSR export mod locally. Three modes:
#
#   ./deploy.sh            (overlay)   Stage into the Steam Workshop overlay dir. The "proper"
#                                      mod path, BUT the loader wipes the overlay on launch unless
#                                      Steam reports >=1 installed Workshop mod. Under Proton the
#                                      Steam API often doesn't load, so the overlay is wiped every
#                                      launch -> use --install instead on Linux/Proton.
#   ./deploy.sh --install              Copy straight into the game install (resources/app/). Survives
#                                      relaunches and works online; the workshop loader never touches
#                                      resources/app/. Backs up index.html first. Reverted by
#                                      --uninstall, a game update, or Steam "Verify integrity".
#   ./deploy.sh --uninstall            Restore the original index.html and remove the installed mod.
set -euo pipefail

APPID=3525620
PREFIX="${WSR_PREFIX:-$HOME/.steam/steam/steamapps/compatdata/$APPID/pfx}"
OVERLAY="$PREFIX/drive_c/users/steamuser/AppData/Local/Wall Street Raider/workshop/overlay"
INSTALL="${WSR_INSTALL:-$HOME/.steam/steam/steamapps/common/Wall Street Raider/resources/app}"
SRC="$(cd "$(dirname "$0")" && pwd)/overlay"
MODE="${1:-overlay}"

case "$MODE" in
  --install)
    [ -d "$INSTALL" ] || { echo "Game install not found: $INSTALL (set WSR_INSTALL)" >&2; exit 1; }
    [ -f "$INSTALL/index.html.wsrmod-bak" ] || cp "$INSTALL/index.html" "$INSTALL/index.html.wsrmod-bak"
    cp "$SRC/index.html" "$INSTALL/index.html"
    mkdir -p "$INSTALL/js/wsr-export"
    cp "$SRC/js/wsr-export/"*.js "$INSTALL/js/wsr-export/"
    cp "$SRC/js/lib/xlsx.mjs" "$INSTALL/js/lib/xlsx.mjs"
    echo "Installed mod into $INSTALL (index.html backed up). Relaunch the game normally."
    ;;
  --uninstall)
    if [ -f "$INSTALL/index.html.wsrmod-bak" ]; then
        mv "$INSTALL/index.html.wsrmod-bak" "$INSTALL/index.html"
        echo "Restored original index.html."
    fi
    rm -rf "$INSTALL/js/wsr-export" "$INSTALL/js/lib/xlsx.mjs"
    echo "Removed installed mod files."
    ;;
  overlay)
    mkdir -p "$OVERLAY"
    if command -v rsync >/dev/null 2>&1; then rsync -a "$SRC"/ "$OVERLAY"/; else cp -r "$SRC"/. "$OVERLAY"/; fi
    echo "Staged overlay -> $OVERLAY"
    echo "NOTE: under Proton this is usually wiped on launch (Steam API not loaded). Use --install."
    ;;
  *)
    echo "Usage: ./deploy.sh [--install | --uninstall]   (no arg = overlay)" >&2; exit 1 ;;
esac

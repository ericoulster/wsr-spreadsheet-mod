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
DOCS="$PREFIX/drive_c/users/steamuser/Documents/WSR Mods"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/overlay"
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
  --workshop)
    # Stage the publishable content + preview where the Mod Uploader's pickers default to
    # (the Proton prefix's Documents\WSR Mods\). Content goes in its own folder; the preview
    # sits in the parent so it isn't published as mod content.
    DEST="$DOCS/WSR Spreadsheet Export"
    mkdir -p "$DEST"
    if command -v rsync >/dev/null 2>&1; then rsync -a "$SRC"/ "$DEST"/; else cp -r "$SRC"/. "$DEST"/; fi
    cp "$HERE/workshop/preview.png" "$DOCS/preview.png"
    # Preserve the published-item id across re-publishes (commit workshop/.wsrmod-id to keep it).
    [ -f "$HERE/workshop/.wsrmod-id" ] && cp "$HERE/workshop/.wsrmod-id" "$DEST/.wsrmod-id"
    echo "Staged Workshop package:"
    echo "  mod folder (pick this):    $DEST"
    echo "  preview image (pick this): $DOCS/preview.png"
    echo "Now launch the WSR Mod Uploader and publish (see PUBLISHING.md)."
    echo "After publishing, copy the new .wsrmod-id back: cp \"$DEST/.wsrmod-id\" \"$HERE/workshop/.wsrmod-id\""
    ;;
  *)
    echo "Usage: ./deploy.sh [--install | --uninstall | --workshop]   (no arg = overlay)" >&2; exit 1 ;;
esac

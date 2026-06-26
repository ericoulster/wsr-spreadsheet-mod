#!/usr/bin/env bash
# Publish the mod to the Steam Workshop via SteamCMD (native Linux), bypassing the Proton Mod
# Uploader (whose embedded Steam API doesn't initialize under Proton - it exits 0 with no output).
#
# Usage:   workshop/publish.sh <steam_username> [public|friends|private|unlisted]   (default: private)
#
# The FIRST run prompts for your Steam password + Steam Guard code in the terminal (SteamCMD has its
# own login, separate from the desktop Steam client); after that the session is cached. Run it from
# YOUR terminal so you can type those in.
set -euo pipefail

USER_ARG="${1:-}"
[ -n "$USER_ARG" ] || { echo "Usage: $0 <steam_username> [public|friends|private|unlisted]" >&2; exit 1; }
case "${2:-private}" in
  public) VIS=0 ;; friends) VIS=1 ;; private) VIS=2 ;; unlisted) VIS=3 ;;
  *) echo "visibility must be public|friends|private|unlisted" >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
CONTENT="$REPO/overlay"
PREVIEW="$HERE/preview.png"
STEAMCMD="${STEAMCMD:-$HOME/steamcmd/steamcmd.sh}"
IDFILE="$HERE/.published-id"
PUBID="0"; [ -f "$IDFILE" ] && PUBID="$(tr -dc '0-9' < "$IDFILE")"

[ -x "$STEAMCMD" ] || { echo "SteamCMD not found at $STEAMCMD (set STEAMCMD=path)" >&2; exit 1; }
[ -f "$CONTENT/index.html" ] || { echo "content folder missing: $CONTENT" >&2; exit 1; }
[ -f "$PREVIEW" ] || { echo "preview missing: $PREVIEW" >&2; exit 1; }

VDF="$(mktemp --suffix=.vdf)"
trap 'rm -f "$VDF"' EXIT

# Generate the Workshop item VDF with Python (clean string handling; no quotes/backslashes in the
# description, so no VDF escaping is needed).
APPID=3525620 PUBID="$PUBID" CONTENT="$CONTENT" PREVIEW="$PREVIEW" VIS="$VIS" \
CHANGENOTE="${CHANGENOTE:-Update}" python3 - "$VDF" <<'PYEOF'
import os, sys
desc = """Adds two in-game buttons that export your financial statements to an Excel ([b].xlsx[/b]) file, read live from the game with one click.

[b]Export This[/b] - the entity you're currently viewing (you, or a company).
[b]Export Portfolio[/b] - you plus every company you control.

Each workbook has a Summary sheet plus one sheet per entity: the balance sheet (assets / liabilities / equity, using the game's own industry totals so it matches the Financials screen, with an Assets - Liabilities - Equity check row) and the cash flow statement. All figures in $ millions.

[b]Where the file goes[/b]
[list]
[*]Desktop: a WSR Statements folder in your Documents
[*]Browser mode: downloaded through your browser
[/list]

[b]Safe and read-only[/b] - it only reads the running game and writes a spreadsheet. It changes nothing in your game and never touches your save files.

The buttons appear at the bottom-right of the screen."""
vals = [
    ("appid", os.environ["APPID"]),
    ("publishedfileid", os.environ["PUBID"]),
    ("contentfolder", os.environ["CONTENT"]),
    ("previewfile", os.environ["PREVIEW"]),
    ("visibility", os.environ["VIS"]),
    ("title", "Spreadsheet Export - Balance Sheets & Cash Flow to Excel"),
    ("description", desc),
    ("changenote", os.environ["CHANGENOTE"]),
]
esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
out = ['"workshopitem"', "{"] + [f'\t"{k}"\t"{esc(v)}"' for k, v in vals] + ["}"]
open(sys.argv[1], "w").write("\n".join(out) + "\n")
PYEOF

echo "Publishing to WSR Workshop (visibility=${2:-private}, item id ${PUBID}) ..."
# Don't let a non-zero SteamCMD exit (it sometimes returns one even on success) abort before we
# parse + save the id.
set +e
if [ -t 1 ]; then
    OUT="$("$STEAMCMD" +login "$USER_ARG" +workshop_build_item "$VDF" +quit 2>&1 | tee /dev/tty)"
else
    OUT="$("$STEAMCMD" +login "$USER_ARG" +workshop_build_item "$VDF" +quit 2>&1)"; printf '%s\n' "$OUT"
fi
# NOTE: keep errexit OFF for the rest - the id-parse greps below return non-zero on an UPDATE
# (no "PublishFileID" line) and, with pipefail, would otherwise abort before we save/confirm.
# SteamCMD prints "Create new workshop item ( PublishFileID NNNN)" (note: PublishFileID, no "ed");
# updates don't reprint it, so fall back to the known id.
NEWID="$(printf '%s\n' "$OUT" | grep -oiE 'Publish(ed)?FileID[^0-9]*[0-9]+' | grep -oE '[0-9]+' | tail -1)"
[ -z "${NEWID:-}" ] && [ "$PUBID" != "0" ] && NEWID="$PUBID"
if [ -n "${NEWID:-}" ] && printf '%s' "$OUT" | grep -qi 'Success'; then
    echo "$NEWID" > "$IDFILE"
    echo
    echo "Published. Workshop item id: $NEWID  (saved to workshop/.published-id)"
    echo "Item page:  https://steamcommunity.com/sharedfiles/filedetails/?id=$NEWID"
    echo "If this is a NEW item, open that page and accept the Workshop Legal Agreement to make it visible."
    echo "To re-publish updates later, just run this script again (it reuses that id)."
else
    echo
    echo "Could not confirm success - read the SteamCMD output above (login? rights? legal agreement?)." >&2
    exit 1
fi

# Publishing to the Steam Workshop

The mod is published with the **WSR Mod Uploader** (a separate tool bundled with the game). A Workshop
item is just the `resources/app/`-shaped content folder (our `overlay/`) plus Steam metadata you enter
in the uploader. No manifest file is needed inside the folder.

## 1. Stage the package

```
./deploy.sh --workshop
```

This copies the publishable content to **`…/Documents/WSR Mods/WSR Spreadsheet Export/`** (inside the
Proton prefix, where the uploader's folder picker defaults) and puts **`preview.png`** in the parent
`WSR Mods` folder. It prints the exact paths to pick.

## 2. Open the WSR Mod Uploader

- In-game: the Mods/Workshop screen has an **Open Mod Uploader** button, or
- Run it directly: `…/steamapps/common/Wall Street Raider/mod-uploader/wsr-mod-uploader.exe`
  (under Proton). Steam must be running and online.

## 3. Fill it in and publish

- **Mod folder:** select `Documents\WSR Mods\WSR Spreadsheet Export`.
- **Preview image:** select `preview.png` (the picker opens in the mod folder; go up one level to
  `WSR Mods\`). Must be PNG/JPG under 1 MB - ours is 32 KB.
- **Title / Description / Tags:** copy from `workshop/LISTING.md`.
- **Visibility:** start **Unlisted** (or Friends), publish, then flip to Public once verified.
- Click **Publish**.

The uploader validates the folder (it rejects `wsr.exe`/`ui.dll`; ours has neither) and uploads.

## 4. After the first publish

The uploader writes a **`.wsrmod-id`** file into the staged folder (the Workshop item id), so future
re-publishes **update the same item** instead of creating a duplicate. Preserve it:

```
cp "$HOME/.steam/steam/steamapps/compatdata/3525620/pfx/drive_c/users/steamuser/Documents/WSR Mods/WSR Spreadsheet Export/.wsrmod-id" ./workshop/.wsrmod-id
git add workshop/.wsrmod-id && git commit -m "record Workshop item id"
```

`./deploy.sh --workshop` copies `workshop/.wsrmod-id` back into the staged folder on later runs, so
re-publishing always targets the same item.

## 5. Updating later

Edit the mod -> `./deploy.sh --workshop` -> open the uploader -> same folder -> bump the changelog ->
Publish.

## Important caveat (Proton vs. Windows)

On this Linux/Proton machine the embedded Steam API doesn't load, so a *subscribed* Workshop mod gets
wiped on launch (see `README.md`) - you can't fully verify the subscriber experience here. That's a
Proton limitation, not a mod bug: **Windows players who subscribe get it normally.** The published
content is byte-identical to what's already validated locally via `./deploy.sh --install`, in both
browser and desktop modes.

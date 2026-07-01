# Roblox Account Manager

A local desktop app (Electron) to manage your Roblox accounts. 100% offline —
no data is ever sent to the internet.

## Per-account fields
Username · Password (masked) · Age range · Voice chat · Age verified ·
Banned games · Status (Active / Warned / Banned) · Tags · Date added · Notes.

The left sidebar gives you live-count views (All / Active / Warned / Banned),
attribute filters (Voice / Age verified) and a clickable tag list.

## Install (users)
Download the latest **Setup .exe** from the
[Releases page](https://github.com/joe-jns/roblox-account-manager/releases/latest)
and run it. No admin required. Since the app is not code-signed, Windows may show
"Windows protected your PC" on first launch → click **More info → Run anyway**.

The app updates itself automatically from GitHub Releases on launch.

## Run in development
```bash
npm install
npm start
```

## Build the installer
```bash
npm run dist       # local installer only, in dist/
npm run release    # build + publish a GitHub Release (needs GH_TOKEN)
```

## Where is my data?
An `accounts.json` file in the app data folder
(`%APPDATA%/roblox-account-manager/` on Windows). Use **Export** to back it up
elsewhere. Passwords are stored in plain text in that file (deliberate choice for
personal use on your own machine) — do not share `accounts.json`.

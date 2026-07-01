# Roblox Account Manager

A local desktop app (Electron) to manage many Roblox accounts from one place —
credentials, per-account info, one-click login, and more. **100% offline: your
data never leaves your PC.**

> Not affiliated with Roblox. Use it only with accounts you own.

## Features

**Accounts table**
- Full-width table with column sorting, live search, and a sidebar of views
  (All / Active / Banned) and filters (Voice, Age verified, Tags) with live counts.
- Per account: username, password (masked, copy), age range, voice chat,
  age verified, banned games, status, tags, date added, notes.
- Bulk **paste import** (`username:password`, one per line), multi-select with
  bulk actions (set status, add tag, delete), and import/export to JSON.

**Roblox integration**
- **Auto-fetch** account info from the username (user ID, display name, creation
  date, avatar, terminated flag) — cached, so it's only fetched once.
- **Banned games**: search any Roblox game by name (with icons) and click to add,
  or paste a game ID.
- **One-click login**: opens Roblox in a dedicated, isolated, persistent session
  per account and fills + submits the login form. Log in once and it stays logged
  in — you can keep several accounts open at the same time.
- **Detect from session**: for a logged-in account, reads private settings
  (voice chat, age range, age verification) straight from its session.

**App**
- Dark and light themes with a custom accent color.
- Optional **master password** — encrypts your data at rest (AES-256-GCM).
- **Auto-update** from GitHub Releases with an in-app prompt and progress bar.
- Auto-backup on close, confirm-before-delete, and quick access to the data folder.

## Install

Download the latest **Setup .exe** from the
[Releases page](https://github.com/joe-jns/roblox-account-manager/releases/latest)
and run the installer (no admin required).

The app is not code-signed, so Windows may show *"Windows protected your PC"* on
first launch → click **More info → Run anyway**. Once installed, the app updates
itself automatically.

## Data & privacy

Everything is stored locally in `%APPDATA%/roblox-account-manager/accounts.json`.
Passwords are stored in plain text by default (a deliberate choice for personal
use) — enable a **master password** in Settings to encrypt the file. Use
**Export** for backups, and never share `accounts.json`.

## Development

```bash
npm install
npm start          # run in dev
npm run dist       # build a local installer in dist/
npm run release    # build + publish a GitHub Release (needs GH_TOKEN)
```

Built with Electron. The app icon is generated from `build/icon.svg` via
`node build/gen-icon.mjs`.

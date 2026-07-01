const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs/promises');

const DATA_FILE = () => path.join(app.getPath('userData'), 'accounts.json');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0f1115',
    title: 'Roblox Account Manager',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  // Auto-update from GitHub Releases (only in the installed/packaged build).
  // Checks on launch; if an update is found it downloads and installs on quit.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Persistence -----------------------------------------------------------

ipcMain.handle('accounts:load', async () => {
  try {
    const raw = await fs.readFile(DATA_FILE(), 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === 'ENOENT') return []; // first launch, no data file yet
    throw err;
  }
});

ipcMain.handle('accounts:save', async (_evt, accounts) => {
  const json = JSON.stringify(accounts, null, 2);
  await fs.writeFile(DATA_FILE(), json, 'utf8');
  return true;
});

// ---- Export / Import -------------------------------------------------------

ipcMain.handle('accounts:export', async (_evt, accounts) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export accounts',
    defaultPath: 'roblox-accounts-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false };
  await fs.writeFile(filePath, JSON.stringify(accounts, null, 2), 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('accounts:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import accounts',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || filePaths.length === 0) return { ok: false };
  const raw = await fs.readFile(filePaths[0], 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Invalid JSON file.' };
  }
  if (!Array.isArray(data)) return { ok: false, error: 'Unexpected format (an array was expected).' };
  return { ok: true, accounts: data };
});

// ---- Roblox game name resolution ------------------------------------------

async function fetchJSON(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const opts = Object.assign({ signal: ctrl.signal }, options);
    opts.headers = Object.assign({ Accept: 'application/json' }, options && options.headers);
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Accepts a place ID (e.g. 14034093693) or a universe ID, returns the official name.
ipcMain.handle('game:resolve', async (_evt, rawId) => {
  const id = String(rawId).trim();
  if (!/^\d+$/.test(id)) return { ok: false, error: 'Invalid ID' };

  // 1) place ID -> universe ID
  let universeId = null;
  const uni = await fetchJSON(`https://apis.roblox.com/universes/v1/places/${id}/universe`);
  if (uni && uni.universeId) universeId = uni.universeId;

  // 2) otherwise try the ID as-is as a universe ID
  const candidate = universeId || id;
  const games = await fetchJSON(`https://games.roblox.com/v1/games?universeIds=${candidate}`);
  const name = games && Array.isArray(games.data) && games.data[0] && games.data[0].name;
  if (name) return { ok: true, id, name };
  return { ok: false, error: 'Game not found' };
});

// ---- Roblox account enrichment (username -> profile info + avatar) ---------

ipcMain.handle('roblox:enrich', async (_evt, username) => {
  const name = String(username || '').trim();
  if (!name) return { ok: false, error: 'Empty username' };

  // 1) username -> userId
  const lookup = await fetchJSON('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [name], excludeBannedUsers: false }),
  });
  const user = lookup && Array.isArray(lookup.data) && lookup.data[0];
  if (!user) return { ok: false, error: 'User not found' };
  const userId = user.id;

  // 2) profile details (creation date, terminated flag, display name)
  const details = await fetchJSON(`https://users.roblox.com/v1/users/${userId}`);

  // 3) avatar headshot
  const thumb = await fetchJSON(
    `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=48x48&format=Png&isCircular=false`
  );
  const avatarUrl = thumb && Array.isArray(thumb.data) && thumb.data[0] && thumb.data[0].imageUrl;

  return {
    ok: true,
    userId: String(userId),
    displayName: (details && details.displayName) || user.displayName || '',
    created: details && details.created ? String(details.created).slice(0, 10) : null,
    robloxBanned: !!(details && details.isBanned),
    avatarUrl: avatarUrl || null,
  };
});

// Batch version: resolve many usernames at once (1 lookup call per 100 names,
// 1 avatar call per 100 ids, then per-user details with limited concurrency).
// Returns a map keyed by lowercased username.
ipcMain.handle('roblox:enrichBatch', async (_evt, usernames) => {
  const names = (Array.isArray(usernames) ? usernames : [])
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  if (!names.length) return {};

  const out = {};
  for (let i = 0; i < names.length; i += 100) {
    const chunk = names.slice(i, i + 100);
    const lookup = await fetchJSON('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: chunk, excludeBannedUsers: false }),
    });
    const data = lookup && Array.isArray(lookup.data) ? lookup.data : [];
    const ids = [];
    for (const u of data) {
      const key = String(u.requestedUsername || u.name || '').toLowerCase();
      if (!key) continue;
      out[key] = {
        ok: true,
        userId: String(u.id),
        displayName: u.displayName || u.name || '',
        created: null,
        robloxBanned: false,
        avatarUrl: null,
      };
      ids.push(u.id);
    }
    if (ids.length) {
      const thumb = await fetchJSON(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${ids.join(',')}&size=48x48&format=Png&isCircular=false`
      );
      const byId = {};
      for (const t of (thumb && Array.isArray(thumb.data) ? thumb.data : [])) byId[String(t.targetId)] = t.imageUrl;
      for (const key of Object.keys(out)) {
        const r = out[key];
        if (r.userId && byId[r.userId]) r.avatarUrl = byId[r.userId];
      }
    }
  }

  // Per-user creation date + terminated flag, 5 at a time.
  const entries = Object.values(out).filter((r) => r.userId);
  const CONC = 5;
  for (let i = 0; i < entries.length; i += CONC) {
    const slice = entries.slice(i, i + CONC);
    await Promise.all(slice.map(async (r) => {
      const d = await fetchJSON(`https://users.roblox.com/v1/users/${r.userId}`);
      if (d) {
        r.created = d.created ? String(d.created).slice(0, 10) : null;
        r.robloxBanned = !!d.isBanned;
      }
    }));
  }

  return out;
});

ipcMain.handle('open:url', async (_evt, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('ui:confirm', async (_evt, { message, buttons }) => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'question',
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    message,
  });
  return response;
});

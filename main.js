const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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

async function fetchJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
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

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
    if (err.code === 'ENOENT') return []; // premier lancement
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
    title: 'Exporter les comptes',
    defaultPath: 'roblox-accounts-backup.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false };
  await fs.writeFile(filePath, JSON.stringify(accounts, null, 2), 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('accounts:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Importer des comptes',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || filePaths.length === 0) return { ok: false };
  const raw = await fs.readFile(filePaths[0], 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Fichier JSON invalide.' };
  }
  if (!Array.isArray(data)) return { ok: false, error: 'Format inattendu (tableau attendu).' };
  return { ok: true, accounts: data };
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

const { app, BrowserWindow, ipcMain, dialog, shell, session, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');

const DATA_FILE = () => path.join(app.getPath('userData'), 'accounts.json');
const CFG_FILE = () => path.join(app.getPath('userData'), 'appconfig.json');

let win;

// ---- Optional at-rest encryption (master password) -------------------------
// When a master password is set, accounts.json holds an AES-256-GCM envelope.
let sessionKey = null;     // Buffer, present once unlocked
let encEnabled = false;    // whether the on-disk data is encrypted
let currentSalt = null;    // Buffer salt used for the session key
let pendingEnvelope = null; // envelope read from disk while still locked
let autoBackup = false;

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, 32);
}

function encryptAccounts(accounts, key, salt) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = Buffer.from(JSON.stringify(accounts), 'utf8');
  const data = Buffer.concat([cipher.update(json), cipher.final()]);
  return {
    enc: true,
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptAccounts(env, key) {
  const iv = Buffer.from(env.iv, 'base64');
  const tag = Buffer.from(env.tag, 'base64');
  const data = Buffer.from(env.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  const parsed = JSON.parse(out.toString('utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0f1115',
    title: 'Roblox Account Manager',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#16191f',
      symbolColor: '#c8ccd4',
      height: 52,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Single instance only for the installed build (avoids installer-relaunch
// clashes). In dev we skip it so it can run alongside the installed app.
const gotTheLock = app.isPackaged ? app.requestSingleInstanceLock() : true;
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  if (!gotTheLock) return;
  try {
    const c = JSON.parse(fsSync.readFileSync(CFG_FILE(), 'utf8'));
    autoBackup = !!c.autoBackup;
  } catch {
    autoBackup = false;
  }

  createWindow();

  // Custom in-app auto-update flow (installed builds only).
  if (app.isPackaged) setupAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Dated backup of the data file on quit, if enabled.
app.on('before-quit', () => {
  if (!autoBackup) return;
  try {
    const src = DATA_FILE();
    if (!fsSync.existsSync(src)) return;
    const dir = path.join(app.getPath('userData'), 'backups');
    fsSync.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    fsSync.copyFileSync(src, path.join(dir, `accounts-${stamp}.json`));
  } catch {
    // best-effort
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Auto-update (custom in-app UI) ----------------------------------------

function sendUpd(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

let autoUpdateReady = false;
function setupAutoUpdate() {
  autoUpdater.autoDownload = false; // ask the user first
  if (!autoUpdateReady) {
    autoUpdateReady = true;
    autoUpdater.on('update-available', (info) => sendUpd('update:available', { version: info.version }));
    autoUpdater.on('update-not-available', () => sendUpd('update:none', {}));
    autoUpdater.on('download-progress', (p) => sendUpd('update:progress', { percent: p.percent }));
    autoUpdater.on('update-downloaded', (info) => sendUpd('update:downloaded', { version: info.version }));
    autoUpdater.on('error', (err) => sendUpd('update:error', { message: String((err && err.message) || err) }));
  }
  autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.handle('update:check', () => {
  autoUpdater.autoDownload = false;
  setupAutoUpdate();
  return true;
});
ipcMain.handle('update:download', () => {
  autoUpdater.downloadUpdate().catch((e) => sendUpd('update:error', { message: String((e && e.message) || e) }));
  return true;
});
ipcMain.handle('update:install', () => {
  // Silent install in the background, then relaunch (no installer wizard).
  autoUpdater.quitAndInstall(true, true);
  return true;
});

// ---- Persistence -----------------------------------------------------------

ipcMain.handle('accounts:load', async () => {
  let raw;
  try {
    raw = await fs.readFile(DATA_FILE(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') { encEnabled = false; return { locked: false, accounts: [] }; }
    throw err;
  }
  const data = JSON.parse(raw);
  if (data && data.enc) {
    encEnabled = true;
    pendingEnvelope = data;
    if (sessionKey) {
      return { locked: false, accounts: decryptAccounts(data, sessionKey) };
    }
    return { locked: true };
  }
  encEnabled = false;
  return { locked: false, accounts: Array.isArray(data) ? data : [] };
});

ipcMain.handle('accounts:save', async (_evt, accounts) => {
  if (encEnabled && sessionKey && currentSalt) {
    const env = encryptAccounts(accounts, sessionKey, currentSalt);
    await fs.writeFile(DATA_FILE(), JSON.stringify(env), 'utf8');
  } else {
    await fs.writeFile(DATA_FILE(), JSON.stringify(accounts, null, 2), 'utf8');
  }
  return true;
});

// ---- Master password -------------------------------------------------------

ipcMain.handle('secure:status', () => ({ encEnabled, unlocked: !!sessionKey }));

ipcMain.handle('secure:unlock', async (_evt, password) => {
  if (!pendingEnvelope) return { ok: false, error: 'Not encrypted' };
  try {
    const salt = Buffer.from(pendingEnvelope.salt, 'base64');
    const key = deriveKey(password, salt);
    const accounts = decryptAccounts(pendingEnvelope, key);
    sessionKey = key;
    currentSalt = salt;
    encEnabled = true;
    return { ok: true, accounts };
  } catch {
    return { ok: false, error: 'Wrong password' };
  }
});

// Enable/replace the master password and re-encrypt the current data.
ipcMain.handle('secure:set', async (_evt, { password, accounts }) => {
  if (!password || String(password).length < 4) return { ok: false, error: 'Password too short (min 4)' };
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  const env = encryptAccounts(accounts || [], key, salt);
  await fs.writeFile(DATA_FILE(), JSON.stringify(env), 'utf8');
  sessionKey = key;
  currentSalt = salt;
  encEnabled = true;
  return { ok: true };
});

// Remove the master password (must be unlocked) and write plaintext.
ipcMain.handle('secure:remove', async (_evt, { accounts }) => {
  if (!encEnabled) return { ok: true };
  if (!sessionKey) return { ok: false, error: 'Locked' };
  await fs.writeFile(DATA_FILE(), JSON.stringify(accounts || [], null, 2), 'utf8');
  sessionKey = null;
  currentSalt = null;
  encEnabled = false;
  pendingEnvelope = null;
  return { ok: true };
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

// Search Roblox games by name -> [{ id (rootPlaceId), name, iconUrl }]
ipcMain.handle('roblox:searchGames', async (_evt, query) => {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const sid = '00000000-0000-0000-0000-000000000000'; // any GUID works
  const url = `https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&pageType=Games&sessionId=${sid}`;
  const res = await fetchJSON(url);
  if (!res || !Array.isArray(res.searchResults)) return [];

  const games = [];
  for (const grp of res.searchResults) {
    for (const c of (grp.contents || [])) {
      if ((c.universeId || c.rootPlaceId) && c.name) {
        games.push({ universeId: c.universeId, rootPlaceId: c.rootPlaceId, name: c.name });
      }
      if (games.length >= 10) break;
    }
    if (games.length >= 10) break;
  }

  const uids = games.map((g) => g.universeId).filter(Boolean);
  const icons = {};
  if (uids.length) {
    const t = await fetchJSON(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${uids.join(',')}&size=50x50&format=Png&isCircular=false`
    );
    for (const it of (t && Array.isArray(t.data) ? t.data : [])) {
      if (it.imageUrl) icons[String(it.targetId)] = it.imageUrl;
    }
  }

  return games.map((g) => ({
    id: String(g.rootPlaceId || g.universeId || ''),
    name: g.name,
    iconUrl: icons[String(g.universeId)] || null,
  }));
});

// Recolor the native window controls to match the current theme (Windows).
let currentTheme = 'dark';

function overlayFor(theme, dim) {
  if (theme === 'light') {
    return { color: dim ? '#a7a9ac' : '#f6f7f9', symbolColor: '#1a1d23', height: 52 };
  }
  return { color: dim ? '#0d1014' : '#16191f', symbolColor: '#c8ccd4', height: 52 };
}

function applyOverlay(dim) {
  if (!win || process.platform !== 'win32') return;
  try { win.setTitleBarOverlay(overlayFor(currentTheme, dim)); } catch {}
}

ipcMain.handle('theme:set', (_evt, theme) => {
  currentTheme = theme === 'light' ? 'light' : 'dark';
  applyOverlay(false);
});

// Darken the native window controls to match a modal backdrop, and back.
ipcMain.handle('overlay:dim', (_evt, on) => { applyOverlay(!!on); });

ipcMain.handle('app:version', () => app.getVersion());

// ---- Bloxgen account generation --------------------------------------------

const BLOXGEN = 'https://core.bloxgen.net';

ipcMain.handle('bloxgen:balance', async (_evt, apiKey) => {
  const r = await fetchJSON(`${BLOXGEN}/api/balance?apiKey=${encodeURIComponent(apiKey || '')}`);
  if (r && r.success && r.data) return { ok: true, balance: r.data.balance };
  return { ok: false, error: (r && r.message) || 'Could not fetch balance' };
});

ipcMain.handle('bloxgen:generate', async (_evt, payload) => {
  const { apiKey, type } = payload || {};
  let status = 0;
  let json = null;
  try {
    const res = await fetch(`${BLOXGEN}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apiKey, type }),
    });
    status = res.status;
    try { json = await res.json(); } catch {}
  } catch (e) {
    return { ok: false, status: 0, error: String((e && e.message) || e) };
  }
  if (json && json.success && json.data) return { ok: true, data: json.data };
  return {
    ok: false,
    status,
    error: (json && json.message) || `HTTP ${status}`,
    timeRemaining: json && json.timeRemaining,
  };
});

// Inject a .ROBLOSECURITY cookie into an account's session so Login opens
// already authenticated (no password / captcha).
ipcMain.handle('roblox:setCookie', async (_evt, payload) => {
  const { accountId, cookie } = payload || {};
  if (!cookie) return false;
  try {
    const ses = session.fromPartition('persist:roblox-' + String(accountId || 'default'));
    await ses.cookies.set({
      url: 'https://www.roblox.com',
      name: '.ROBLOSECURITY',
      value: cookie,
      domain: '.roblox.com',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    });
    return true;
  } catch {
    return false;
  }
});

// Open the folder that holds accounts.json.
ipcMain.handle('data:openFolder', () => {
  const file = DATA_FILE();
  if (fsSync.existsSync(file)) shell.showItemInFolder(file);
  else shell.openPath(app.getPath('userData'));
  return true;
});

// Clear the persisted Roblox login sessions and close their windows.
ipcMain.handle('roblox:logoutAll', async (_evt, ids) => {
  const list = Array.isArray(ids) ? ids : [];
  let n = 0;
  for (const id of list) {
    try {
      await session.fromPartition('persist:roblox-' + String(id)).clearStorageData();
      n++;
    } catch {
      // partition may not exist
    }
  }
  for (const w of loginWindows.values()) {
    try { if (w && !w.isDestroyed()) w.close(); } catch {}
  }
  return n;
});

// Persist the few settings the main process needs (auto-backup on quit).
ipcMain.handle('config:set', async (_evt, cfg) => {
  if (cfg && typeof cfg.autoBackup === 'boolean') {
    autoBackup = cfg.autoBackup;
    try { await fs.writeFile(CFG_FILE(), JSON.stringify({ autoBackup }), 'utf8'); } catch {}
  }
  return true;
});

// ---- Open a Roblox window logged in as an account --------------------------
// Each account gets an isolated, persistent session partition, so once it is
// logged in the first time (solving any captcha), it stays logged in.

const loginWindows = new Map(); // accountId -> BrowserWindow

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function buildFillScript(username, password) {
  return `(function(){
    var U = ${JSON.stringify(username)}, P = ${JSON.stringify(password)};
    function setVal(el, val){
      var proto = Object.getPrototypeOf(el);
      var desc = Object.getOwnPropertyDescriptor(proto, 'value')
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    var tries = 0, clicked = false;
    var t = setInterval(function(){
      tries++;
      var u = document.querySelector('#login-username, input[name="username"]');
      var p = document.querySelector('#login-password, input[type="password"]');
      if (u && p) {
        setVal(u, U); setVal(p, P);
        var b = document.querySelector('#login-button, button.login-button');
        if (b && !b.disabled && !clicked) { clicked = true; clearInterval(t); setTimeout(function(){ b.click(); }, 300); }
        else if (tries > 40) { clearInterval(t); }
      } else if (tries > 40) { clearInterval(t); }
    }, 150);
  })();`;
}

// Authenticated GET using an account's persisted login session.
function authGet(partition, url) {
  return new Promise((resolve) => {
    let request;
    try {
      request = net.request({ method: 'GET', url, session: session.fromPartition(partition) });
    } catch {
      resolve(null);
      return;
    }
    let body = '';
    request.on('response', (res) => {
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        } else {
          resolve({ __status: res.statusCode });
        }
      });
    });
    request.on('error', () => resolve(null));
    request.end();
  });
}

function computeAge(y, m, d) {
  const now = new Date();
  let age = now.getFullYear() - y;
  const mo = now.getMonth() + 1;
  if (mo < m || (mo === m && now.getDate() < d)) age--;
  return age;
}

// Read private settings (voice / age / age-verified) from a logged-in session.
async function detectFor(key) {
  const partition = 'persist:roblox-' + key;
  const voice = await authGet(partition, 'https://voice.roblox.com/v1/settings');
  if (!voice || voice.__status === 401 || voice.__status === 403) return { loggedIn: false };

  const out = { loggedIn: true };
  if (typeof voice.isVoiceEnabled === 'boolean') out.voiceChat = voice.isVoiceEnabled;

  const bd = await authGet(partition, 'https://accountinformation.roblox.com/v1/birthdate');
  if (bd && bd.birthYear && !bd.__status) {
    const age = computeAge(bd.birthYear, bd.birthMonth || 1, bd.birthDay || 1);
    out.ageRange = age >= 21 ? '21+' : (age >= 18 ? '18-20' : 'Unknown');
  }

  // Age (ID) verification — best effort; endpoint shape can vary.
  const av = await authGet(partition, 'https://apis.roblox.com/age-verification-service/v1/age-verification/verified-age');
  if (av && !av.__status) {
    if (typeof av.isVerified === 'boolean') out.ageVerified = av.isVerified;
    else if (av.verifiedAge != null) out.ageVerified = true;
  }
  return out;
}

ipcMain.handle('roblox:detect', async (_evt, accountId) => detectFor(String(accountId || 'default')));

ipcMain.handle('roblox:login', async (_evt, payload) => {
  const { accountId, username, password } = payload || {};
  const key = String(accountId || 'default');

  const existing = loginWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return true;
  }

  const w = new BrowserWindow({
    width: 1200,
    height: 820,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'Roblox — ' + (username || ''),
    webPreferences: {
      preload: path.join(__dirname, 'login-preload.js'),
      partition: 'persist:roblox-' + key,
      contextIsolation: false,
      nodeIntegration: false,
    },
  });
  loginWindows.set(key, w);
  w.on('closed', () => loginWindows.delete(key));
  w.webContents.setUserAgent(CHROME_UA);

  let filled = false;
  w.webContents.on('did-finish-load', async () => {
    if (filled) return;
    if (!/\/login/i.test(w.webContents.getURL())) return; // already logged in elsewhere
    filled = true;
    try {
      await w.webContents.executeJavaScript(buildFillScript(username || '', password || ''), true);
    } catch {
      // page not ready / selectors changed — user can still log in manually
    }
  });

  // Once the window leaves the login page (logged in), read the private
  // settings from its session and push them to the main window.
  let detected = false;
  w.webContents.on('did-navigate', async (_e, url) => {
    if (detected) return;
    if (!/roblox\.com/i.test(url) || /\/login/i.test(url)) return;
    detected = true;
    const info = await detectFor(key);
    if (info.loggedIn && win && !win.isDestroyed()) {
      win.webContents.send('roblox:detected', Object.assign({ accountId: key }, info));
    }
  });

  await w.loadURL('https://www.roblox.com/login', { userAgent: CHROME_UA });
  return true;
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

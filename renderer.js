'use strict';

// ---- State -----------------------------------------------------------------

let accounts = [];
let selectedId = null;
let search = '';
const filters = { view: 'all', voice: false, verified: false, tag: null };
const sort = { key: null, dir: 'asc' };
const selected = new Set();

const $ = (sel, root = document) => root.querySelector(sel);
const bodyEl = $('#table-body');
const emptyEl = $('#table-empty');
const countEl = $('#count');
const drawerEl = $('#drawer');
const backdropEl = $('#backdrop');
const drawerBody = $('#drawer-body');
const sideStatus = $('#side-status');
const sideAttrs = $('#side-attrs');
const sideTags = $('#side-tags');
const activeFilterEl = $('#active-filter');

// ---- Model helpers ---------------------------------------------------------

const STATUSES = ['Active', 'Warned', 'Banned'];
const AGES = ['Unknown', '18-20', '21+'];
const STATUS_MIGRATE = { Actif: 'Active', Averti: 'Warned', Banni: 'Banned' };
const AGE_MIGRATE = { Inconnu: 'Unknown' };
const STATUS_RANK = { Active: 0, Warned: 1, Banned: 2 };
const AGE_RANK = { Unknown: 0, '18-20': 1, '21+': 2 };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeGame(g) {
  if (typeof g === 'string') {
    return { id: /^\d+$/.test(g) ? g : null, name: g };
  }
  return { id: g && g.id != null ? String(g.id) : null, name: (g && g.name) || String((g && g.id) || '') };
}

function normalize(a) {
  const status = STATUS_MIGRATE[a.status] || (STATUSES.includes(a.status) ? a.status : 'Active');
  const ageRange = AGE_MIGRATE[a.ageRange] || (AGES.includes(a.ageRange) ? a.ageRange : 'Unknown');
  return {
    id: a.id || crypto.randomUUID(),
    pseudo: a.pseudo || '',
    password: a.password || '',
    ageRange,
    voiceChat: !!a.voiceChat,
    ageVerified: !!a.ageVerified,
    bannedGames: (Array.isArray(a.bannedGames) ? a.bannedGames : []).map(normalizeGame),
    status,
    tags: Array.isArray(a.tags) ? a.tags : [],
    dateAdded: a.dateAdded || todayISO(),
    notes: a.notes || '',
    userId: a.userId ? String(a.userId) : null,
    displayName: a.displayName || '',
    created: a.created || null,
    avatarUrl: a.avatarUrl || null,
    robloxBanned: !!a.robloxBanned,
  };
}

function getSelected() {
  return accounts.find((a) => a.id === selectedId) || null;
}

// ---- Persistence -----------------------------------------------------------

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.api.save(accounts).catch((err) => toast('Save error: ' + err.message));
  }, 250);
}

// ---- Filtering + sorting ---------------------------------------------------

function sortValue(a, key) {
  switch (key) {
    case 'pseudo': return (a.pseudo || '').toLowerCase();
    case 'status': return STATUS_RANK[a.status] ?? 0;
    case 'ageRange': return AGE_RANK[a.ageRange] ?? 0;
    case 'voiceChat': return a.voiceChat ? 1 : 0;
    case 'ageVerified': return a.ageVerified ? 1 : 0;
    case 'bannedGames': return a.bannedGames.length;
    case 'dateAdded': return a.dateAdded || '';
    default: return '';
  }
}

function visibleAccounts() {
  const q = search.trim().toLowerCase();
  let list = accounts.filter((a) => {
    if (filters.view !== 'all' && a.status !== filters.view) return false;
    if (filters.voice && !a.voiceChat) return false;
    if (filters.verified && !a.ageVerified) return false;
    if (filters.tag && !a.tags.includes(filters.tag)) return false;
    if (q) {
      const hay = (a.pseudo + ' ' + a.tags.join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (sort.key) {
    const dir = sort.dir === 'desc' ? -1 : 1;
    list = list.slice().sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }
  return list;
}

function render() {
  for (const id of [...selected]) if (!accounts.some((a) => a.id === id)) selected.delete(id);
  renderSidebar();
  renderTable();
  renderActiveFilter();
  renderBulkBar();
}

// ---- Sidebar ---------------------------------------------------------------

function sideItem({ label, count, active, dotClass, onClick }) {
  const btn = document.createElement('button');
  btn.className = 'side-item' + (active ? ' active' : '');
  if (dotClass) {
    const dot = document.createElement('span');
    dot.className = 'dot ' + dotClass;
    btn.appendChild(dot);
  }
  const lab = document.createElement('span');
  lab.className = 'side-label';
  lab.textContent = label;
  btn.appendChild(lab);
  const c = document.createElement('span');
  c.className = 'side-count';
  c.textContent = count;
  btn.appendChild(c);
  btn.addEventListener('click', onClick);
  return btn;
}

function renderSidebar() {
  const byStatus = { Active: 0, Warned: 0, Banned: 0 };
  let voice = 0;
  let verified = 0;
  const tagCounts = new Map();
  for (const a of accounts) {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    if (a.voiceChat) voice++;
    if (a.ageVerified) verified++;
    for (const t of a.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  }

  sideStatus.innerHTML = '';
  sideStatus.appendChild(sideItem({
    label: 'All accounts', count: accounts.length, active: filters.view === 'all',
    onClick: () => setView('all'),
  }));
  for (const s of STATUSES) {
    sideStatus.appendChild(sideItem({
      label: s, count: byStatus[s] || 0, active: filters.view === s, dotClass: s,
      onClick: () => setView(s),
    }));
  }

  sideAttrs.innerHTML = '';
  sideAttrs.appendChild(sideItem({
    label: 'Voice enabled', count: voice, active: filters.voice,
    onClick: () => { filters.voice = !filters.voice; render(); },
  }));
  sideAttrs.appendChild(sideItem({
    label: 'Age verified', count: verified, active: filters.verified,
    onClick: () => { filters.verified = !filters.verified; render(); },
  }));

  sideTags.innerHTML = '';
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (tags.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'side-empty';
    empty.textContent = 'No tags yet';
    sideTags.appendChild(empty);
  } else {
    for (const [tag, count] of tags) {
      sideTags.appendChild(sideItem({
        label: tag, count, active: filters.tag === tag,
        onClick: () => { filters.tag = filters.tag === tag ? null : tag; render(); },
      }));
    }
  }
}

function setView(v) {
  filters.view = v;
  render();
}

function renderActiveFilter() {
  const parts = [];
  if (filters.voice) parts.push('Voice');
  if (filters.verified) parts.push('Verified');
  if (filters.tag) parts.push('#' + filters.tag);
  if (parts.length === 0) { activeFilterEl.innerHTML = ''; return; }
  activeFilterEl.innerHTML = '';
  activeFilterEl.append(document.createTextNode('Filtered by '));
  const b = document.createElement('b');
  b.textContent = parts.join(' · ');
  activeFilterEl.appendChild(b);
  const clear = document.createElement('span');
  clear.className = 'clear';
  clear.textContent = 'clear';
  clear.addEventListener('click', () => {
    filters.voice = false; filters.verified = false; filters.tag = null; render();
  });
  activeFilterEl.appendChild(clear);
}

// ---- Table -----------------------------------------------------------------

function renderTable() {
  const items = visibleAccounts();
  countEl.textContent = `${accounts.length} account${accounts.length === 1 ? '' : 's'}`;
  bodyEl.innerHTML = '';

  if (items.length === 0) {
    emptyEl.hidden = false;
    emptyEl.textContent = accounts.length === 0 ? 'No accounts yet. Click + New.' : 'No accounts match this filter.';
    updateSortIndicators();
    updateCheckAll();
    return;
  }
  emptyEl.hidden = true;

  for (const a of items) {
    const tr = document.createElement('tr');
    tr.dataset.id = a.id;
    if (selected.has(a.id)) tr.classList.add('selected');
    tr.appendChild(cellCheck(a));
    tr.appendChild(cellStatus(a));
    tr.appendChild(cellUser(a));
    tr.appendChild(cell(a.ageRange, a.ageRange === 'Unknown' ? 'cell-muted' : ''));
    tr.appendChild(boolCell(a.voiceChat));
    tr.appendChild(boolCell(a.ageVerified));
    tr.appendChild(gamesCell(a.bannedGames));
    tr.appendChild(tagsCell(a.tags));
    tr.appendChild(cell(a.dateAdded, 'cell-muted'));
    tr.appendChild(cellOpen(a));
    tr.addEventListener('click', () => openDrawer(a.id));
    bodyEl.appendChild(tr);
  }
  updateSortIndicators();
  updateCheckAll();
}

function cell(text, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text;
  return td;
}

function cellCheck(a) {
  const td = document.createElement('td');
  td.className = 'col-check';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = selected.has(a.id);
  cb.addEventListener('change', () => {
    if (cb.checked) selected.add(a.id); else selected.delete(a.id);
    const tr = cb.closest('tr');
    if (tr) tr.classList.toggle('selected', cb.checked);
    renderBulkBar();
    updateCheckAll();
  });
  // The whole cell is the hitbox and never opens the drawer.
  td.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target !== cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
  });
  td.appendChild(cb);
  return td;
}

function cellStatus(a) {
  const td = document.createElement('td');
  td.className = 'col-status';
  const wrap = document.createElement('span');
  wrap.className = 'cell-status';
  const dot = document.createElement('span');
  dot.className = 'dot ' + a.status;
  wrap.append(dot, document.createTextNode(a.status));
  td.appendChild(wrap);
  return td;
}

function cellUser(a) {
  const td = document.createElement('td');
  td.className = 'cell-pseudo';
  const wrap = document.createElement('span');
  wrap.className = 'cell-user';
  if (a.avatarUrl) {
    const img = document.createElement('img');
    img.className = 'avatar avatar-sm';
    img.src = a.avatarUrl;
    img.alt = '';
    img.addEventListener('error', () => img.remove());
    wrap.appendChild(img);
  }
  wrap.append(document.createTextNode(a.pseudo || '(no username)'));
  td.appendChild(wrap);
  return td;
}

function boolCell(v) {
  const td = document.createElement('td');
  td.className = 'center';
  const s = document.createElement('span');
  s.className = v ? 'yes' : 'no';
  s.textContent = v ? '✓' : '–';
  td.appendChild(s);
  return td;
}

function gamesCell(games) {
  if (!games.length) return cell('–', 'cell-muted');
  const td = document.createElement('td');
  td.textContent = games.map((g) => g.name).join(', ');
  return td;
}

function robloxLogin(a) {
  if (!a.pseudo.trim() || !a.password) { toast('Needs a username and a password'); return; }
  window.api.robloxLogin({ accountId: a.id, username: a.pseudo.trim(), password: a.password });
  toast('Opening Roblox…');
}

function cellOpen(a) {
  const td = document.createElement('td');
  td.className = 'col-open';
  const btn = document.createElement('button');
  btn.className = 'btn open-btn';
  btn.textContent = 'Open';
  btn.title = 'Open Roblox logged in as this account';
  btn.addEventListener('click', (e) => { e.stopPropagation(); robloxLogin(a); });
  td.appendChild(btn);
  return td;
}

function tagsCell(tags) {
  const td = document.createElement('td');
  if (!tags.length) { td.className = 'cell-muted'; td.textContent = '–'; return td; }
  const wrap = document.createElement('div');
  wrap.className = 'cell-tags';
  for (const t of tags) {
    const s = document.createElement('span');
    s.className = 'mini-tag';
    s.textContent = t;
    wrap.appendChild(s);
  }
  td.appendChild(wrap);
  return td;
}

function updateSortIndicators() {
  document.querySelectorAll('.accounts-table th.sortable').forEach((th) => {
    const ind = th.querySelector('.sort-ind');
    if (th.dataset.sort === sort.key) {
      th.classList.add('sorted');
      if (ind) ind.textContent = sort.dir === 'asc' ? '▲' : '▼';
    } else {
      th.classList.remove('sorted');
      if (ind) ind.textContent = '';
    }
  });
}

function updateCheckAll() {
  const items = visibleAccounts();
  const all = items.length > 0 && items.every((a) => selected.has(a.id));
  const some = items.some((a) => selected.has(a.id));
  const box = $('#check-all');
  box.checked = all;
  box.indeterminate = !all && some;
}

// ---- Bulk action bar -------------------------------------------------------

function renderBulkBar() {
  const n = selected.size;
  // The bulk actions REPLACE the search toolbar (same row) — no extra bar, no layout shift.
  $('#toolbar-normal').hidden = n > 0;
  $('#toolbar-bulk').hidden = n === 0;
  if (n > 0) $('#bulk-count').textContent = `${n} selected`;
}

// ---- Drawer ----------------------------------------------------------------

function openDrawer(id) {
  selectedId = id;
  renderDetail();
  drawerEl.classList.add('open');
  drawerEl.setAttribute('aria-hidden', 'false');
  backdropEl.hidden = false;
}

function closeDrawer() {
  drawerEl.classList.remove('open');
  drawerEl.setAttribute('aria-hidden', 'true');
  backdropEl.hidden = true;
  selectedId = null;
}

function renderDetail() {
  const a = getSelected();
  drawerBody.innerHTML = '';
  if (!a) return;

  const node = $('#tpl-detail').content.cloneNode(true);

  bindText(node, 'pseudo', a);
  bindText(node, 'password', a);
  bindText(node, 'notes', a);
  bindSelect(node, 'ageRange', a);
  bindDate(node, 'dateAdded', a);
  bindCheckbox(node, 'voiceChat', a);
  bindCheckbox(node, 'ageVerified', a);
  bindSegmented(node, 'status', a);
  bindGames(node, a);
  bindTags(node, 'tags', a);

  // Avatar + Roblox info
  const avatar = node.querySelector('[data-el="avatar"]');
  if (a.avatarUrl) { avatar.src = a.avatarUrl; avatar.hidden = false; } else { avatar.hidden = true; }
  paintRobloxMeta(node.querySelector('[data-el="roblox-meta"]'), a);

  const pwInput = node.querySelector('[data-field="password"]');
  node.querySelector('[data-act="toggle-pw"]').addEventListener('click', (e) => {
    const shown = pwInput.type === 'text';
    pwInput.type = shown ? 'password' : 'text';
    e.target.textContent = shown ? 'Show' : 'Hide';
  });
  node.querySelector('[data-act="copy-pw"]').addEventListener('click', () => copy(a.password, 'Password copied'));
  node.querySelector('[data-act="copy-pseudo"]').addEventListener('click', () => copy(a.pseudo, 'Username copied'));
  node.querySelector('[data-act="copy-combo"]').addEventListener('click', () => copy(`${a.pseudo}:${a.password}`, 'user:pass copied'));
  node.querySelector('[data-act="delete"]').addEventListener('click', () => deleteAccount(a.id));
  node.querySelector('[data-act="enrich"]').addEventListener('click', (e) => enrichAccount(a, e.target));
  node.querySelector('[data-act="open-profile"]').addEventListener('click', () => {
    if (!a.userId) { toast('Fetch Roblox info first'); return; }
    window.api.openUrl(`https://www.roblox.com/users/${a.userId}/profile`);
  });
  node.querySelector('[data-act="login"]').addEventListener('click', () => robloxLogin(a));

  drawerBody.appendChild(node);
}

function paintRobloxMeta(el, a) {
  el.innerHTML = '';
  if (!a.userId) {
    el.textContent = 'No Roblox info yet — click "Fetch Roblox info".';
    return;
  }
  const bits = [];
  if (a.displayName) bits.push(a.displayName);
  bits.push('id ' + a.userId);
  if (a.created) bits.push('created ' + a.created);
  el.append(document.createTextNode(bits.join('  ·  ')));
  if (a.robloxBanned) {
    const badge = document.createElement('span');
    badge.className = 'rb-badge';
    badge.textContent = 'Terminated';
    el.appendChild(badge);
  }
}

async function enrichAccount(a, btn) {
  const name = a.pseudo.trim();
  if (!name) { toast('Enter a username first'); return; }
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  const r = await window.api.enrich(name);
  btn.disabled = false;
  btn.textContent = old;
  if (!r.ok) { toast(r.error || 'Roblox lookup failed'); return; }
  a.userId = r.userId;
  a.displayName = r.displayName;
  a.created = r.created;
  a.avatarUrl = r.avatarUrl;
  a.robloxBanned = r.robloxBanned;
  save();
  renderDetail();
  render();
  toast('Roblox info updated' + (r.robloxBanned ? ' — account is terminated' : ''));
}

// ---- Field binders ---------------------------------------------------------

function onEdit(a, field, value) {
  a[field] = value;
  save();
  render();
}

function bindText(root, field, a) {
  const el = root.querySelector(`[data-field="${field}"]`);
  el.value = a[field];
  el.addEventListener('input', () => onEdit(a, field, el.value));
}

function bindSelect(root, field, a) {
  const el = root.querySelector(`[data-field="${field}"]`);
  el.value = a[field];
  el.addEventListener('change', () => onEdit(a, field, el.value));
}

function bindDate(root, field, a) {
  const el = root.querySelector(`[data-field="${field}"]`);
  el.value = a[field];
  el.addEventListener('change', () => onEdit(a, field, el.value || todayISO()));
}

function bindCheckbox(root, field, a) {
  const el = root.querySelector(`[data-field="${field}"]`);
  el.checked = a[field];
  el.addEventListener('change', () => onEdit(a, field, el.checked));
}

function bindSegmented(root, field, a) {
  const seg = root.querySelector(`[data-field="${field}"]`);
  for (const btn of seg.querySelectorAll('button')) {
    if (btn.dataset.value === a[field]) btn.classList.add('active');
    btn.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onEdit(a, field, btn.dataset.value);
    });
  }
}

function bindTags(root, field, a) {
  const wrap = root.querySelector(`[data-field="${field}"]`);
  const tagsBox = wrap.querySelector('.tags');
  const input = wrap.querySelector('input');

  function paint() {
    tagsBox.innerHTML = '';
    a[field].forEach((tag, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.append(document.createTextNode(tag));
      chip.appendChild(removeBtn(() => { a[field].splice(i, 1); paint(); onEdit(a, field, a[field]); }));
      tagsBox.appendChild(chip);
    });
  }

  function add() {
    const val = input.value.trim();
    if (val && !a[field].includes(val)) { a[field].push(val); paint(); onEdit(a, field, a[field]); }
    input.value = '';
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && input.value === '' && a[field].length) {
      a[field].pop(); paint(); onEdit(a, field, a[field]);
    }
  });
  input.addEventListener('blur', add);
  paint();
}

// Banned games: enter an ID -> official name fetched from the Roblox API.
function bindGames(root, a) {
  const wrap = root.querySelector('[data-field="bannedGames"]');
  const tagsBox = wrap.querySelector('.tags');
  const input = wrap.querySelector('input');
  const placeholder = input.placeholder;

  function paint() {
    tagsBox.innerHTML = '';
    a.bannedGames.forEach((g, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.append(document.createTextNode(g.name));
      if (g.id) {
        const idSpan = document.createElement('span');
        idSpan.className = 'tag-id';
        idSpan.textContent = '#' + g.id;
        chip.appendChild(idSpan);
      }
      chip.appendChild(removeBtn(() => { a.bannedGames.splice(i, 1); paint(); commit(); }));
      tagsBox.appendChild(chip);
    });
  }

  function commit() { save(); render(); }

  async function add() {
    const val = input.value.trim();
    input.value = '';
    if (!val) return;

    if (/^\d+$/.test(val)) {
      if (a.bannedGames.some((g) => g.id === val)) return;
      input.disabled = true;
      input.placeholder = 'fetching name…';
      const r = await window.api.resolveGame(val);
      input.disabled = false;
      input.placeholder = placeholder;
      input.focus();
      if (r.ok) {
        a.bannedGames.push({ id: r.id, name: r.name });
      } else {
        a.bannedGames.push({ id: val, name: 'Game ' + val });
        toast('No name found for this ID — added anyway');
      }
    } else {
      if (a.bannedGames.some((g) => g.name === val)) return;
      a.bannedGames.push({ id: null, name: val });
    }
    paint();
    commit();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && input.value === '' && a.bannedGames.length) {
      a.bannedGames.pop(); paint(); commit();
    }
  });
  input.addEventListener('blur', add);
  paint();
}

function removeBtn(onClick) {
  const x = document.createElement('button');
  x.type = 'button';
  x.textContent = '×';
  x.title = 'Remove';
  x.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return x;
}

// ---- Actions ---------------------------------------------------------------

function newAccount() {
  const a = normalize({ pseudo: '' });
  accounts.unshift(a);
  save();
  render();
  openDrawer(a.id);
  const field = drawerBody.querySelector('[data-field="pseudo"]');
  if (field) field.focus();
}

async function deleteAccount(id) {
  const a = accounts.find((x) => x.id === id);
  const name = a && a.pseudo ? `"${a.pseudo}"` : 'this account';
  const res = await window.api.confirm(`Delete ${name}? This cannot be undone.`, ['Delete', 'Cancel']);
  if (res !== 0) return;
  accounts = accounts.filter((x) => x.id !== id);
  save();
  closeDrawer();
  render();
  toast('Account deleted');
}

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text || '');
    toast(msg);
  } catch {
    toast('Copy failed');
  }
}

async function doExport() {
  const res = await window.api.export(accounts);
  if (res.ok) toast('Exported');
}

async function doImport() {
  const res = await window.api.import();
  if (!res.ok) { if (res.error) toast(res.error); return; }
  const incoming = res.accounts.map(normalize);
  if (incoming.length === 0) { toast('Empty file'); return; }

  let mode = 0;
  if (accounts.length > 0) {
    mode = await window.api.confirm(
      `Import ${incoming.length} account(s). Merge with your current accounts or replace them all?`,
      ['Merge', 'Replace', 'Cancel']
    );
    if (mode === 2) return;
  }
  if (mode === 1) {
    accounts = incoming;
  } else {
    const known = new Set(accounts.map((a) => a.id));
    for (const a of incoming) {
      if (known.has(a.id)) a.id = crypto.randomUUID();
      accounts.push(a);
    }
  }
  closeDrawer();
  save();
  render();
  toast(`${incoming.length} account(s) imported`);
  autoEnrich();
}

// ---- Auto-enrich (fetch Roblox info for all accounts, cached) --------------

let enriching = false;
const enrichAttempted = new Set(); // lowercased usernames tried this session

async function autoEnrich() {
  if (enriching) return;
  const pending = accounts.filter(
    (a) => a.pseudo.trim() && !a.userId && !enrichAttempted.has(a.pseudo.trim().toLowerCase())
  );
  if (pending.length === 0) return;

  enriching = true;
  const names = [...new Set(pending.map((a) => a.pseudo.trim()))];
  names.forEach((n) => enrichAttempted.add(n.toLowerCase()));
  let map = null;
  try {
    map = await window.api.enrichBatch(names);
  } catch {
    map = null;
  }
  enriching = false;
  if (!map) return;

  let changed = 0;
  for (const a of accounts) {
    if (a.userId || !a.pseudo.trim()) continue; // already cached
    const r = map[a.pseudo.trim().toLowerCase()];
    if (r && r.ok) {
      a.userId = r.userId;
      a.displayName = r.displayName;
      a.created = r.created;
      a.avatarUrl = r.avatarUrl;
      a.robloxBanned = r.robloxBanned;
      changed++;
    }
  }
  if (changed) {
    save();
    render();
    if (selectedId) renderDetail();
    toast(`Roblox info fetched for ${changed} account${changed === 1 ? '' : 's'}`);
  }
}

// ---- Bulk add (paste user:pass) -------------------------------------------

function parseBulk(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let user;
    let pass = '';
    const idx = line.search(/[:,\t]/);
    if (idx >= 0) {
      user = line.slice(0, idx).trim();
      pass = line.slice(idx + 1).trim();
    } else {
      const sp = line.search(/\s/);
      if (sp >= 0) { user = line.slice(0, sp).trim(); pass = line.slice(sp + 1).trim(); }
      else { user = line; }
    }
    if (user) out.push({ pseudo: user, password: pass });
  }
  return out;
}

function openBulk() {
  $('#bulk-text').value = '';
  $('#bulk-preview').textContent = '';
  $('#modal-backdrop').hidden = false;
  $('#bulk-modal').hidden = false;
  $('#bulk-text').focus();
}

function closeBulk() {
  $('#modal-backdrop').hidden = true;
  $('#bulk-modal').hidden = true;
}

function doBulkAdd() {
  const parsed = parseBulk($('#bulk-text').value);
  if (parsed.length === 0) { toast('Nothing to add'); return; }
  const created = parsed.map((p) => normalize(p));
  accounts.unshift(...created);
  closeBulk();
  save();
  render();
  toast(`${created.length} account(s) added`);
  autoEnrich();
}

// ---- Toast -----------------------------------------------------------------

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
}

// ---- Settings --------------------------------------------------------------

const SETTINGS_KEY = 'ram-settings';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
const settings = loadSettings();
if (!settings.theme) settings.theme = 'dark';

function applyTheme(theme) {
  document.documentElement.classList.toggle('theme-light', theme === 'light');
  window.api.setTheme(theme);
  document.querySelectorAll('#set-theme button').forEach((b) => b.classList.toggle('active', b.dataset.value === theme));
}

function openSettings() {
  document.querySelectorAll('#set-theme button').forEach((b) => b.classList.toggle('active', b.dataset.value === settings.theme));
  window.api.version().then((v) => { $('#set-version').textContent = 'v' + v; }).catch(() => {});
  $('#settings-backdrop').hidden = false;
  $('#settings-modal').hidden = false;
}

function closeSettings() {
  $('#settings-backdrop').hidden = true;
  $('#settings-modal').hidden = true;
}

applyTheme(settings.theme);

// ---- Wiring ----------------------------------------------------------------

$('#search').addEventListener('input', (e) => { search = e.target.value; renderTable(); });

$('#btn-settings').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closeSettings);
$('#settings-backdrop').addEventListener('click', closeSettings);
$('#set-theme').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  settings.theme = btn.dataset.value;
  saveSettings();
  applyTheme(settings.theme);
});

$('#btn-new').addEventListener('click', newAccount);
$('#btn-export').addEventListener('click', doExport);
$('#btn-import').addEventListener('click', doImport);
$('#btn-bulk').addEventListener('click', openBulk);
$('#drawer-close').addEventListener('click', closeDrawer);
backdropEl.addEventListener('click', closeDrawer);

// Sorting
document.querySelectorAll('.accounts-table th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
    else { sort.key = key; sort.dir = 'asc'; }
    renderTable();
  });
});

// Select all (visible)
const checkAll = $('#check-all');
checkAll.addEventListener('change', (e) => {
  const items = visibleAccounts();
  if (e.target.checked) items.forEach((a) => selected.add(a.id));
  else items.forEach((a) => selected.delete(a.id));
  renderTable();
  renderBulkBar();
});
// Whole header cell is the hitbox for select-all.
document.querySelector('th.col-check').addEventListener('click', (e) => {
  if (e.target === checkAll) return;
  checkAll.checked = !checkAll.checked;
  checkAll.dispatchEvent(new Event('change'));
});

// Bulk actions
$('#bulk-status').addEventListener('change', (e) => {
  const v = e.target.value;
  if (!v) return;
  accounts.forEach((a) => { if (selected.has(a.id)) a.status = v; });
  e.target.value = '';
  save();
  render();
  toast(`Status set for ${selected.size} account(s)`);
});
function bulkAddTag() {
  const t = $('#bulk-tag').value.trim();
  if (!t) return;
  accounts.forEach((a) => { if (selected.has(a.id) && !a.tags.includes(t)) a.tags.push(t); });
  $('#bulk-tag').value = '';
  save();
  render();
  toast(`Tag "${t}" added`);
}
$('#bulk-tag-btn').addEventListener('click', bulkAddTag);
$('#bulk-tag').addEventListener('keydown', (e) => { if (e.key === 'Enter') bulkAddTag(); });
$('#bulk-delete').addEventListener('click', async () => {
  const n = selected.size;
  if (!n) return;
  const res = await window.api.confirm(`Delete ${n} selected account(s)? This cannot be undone.`, ['Delete', 'Cancel']);
  if (res !== 0) return;
  accounts = accounts.filter((a) => !selected.has(a.id));
  selected.clear();
  if (selectedId && !accounts.some((a) => a.id === selectedId)) closeDrawer();
  save();
  render();
  toast(`${n} account(s) deleted`);
});
$('#bulk-clear').addEventListener('click', () => { selected.clear(); render(); });

// Bulk add modal
$('#bulk-text').addEventListener('input', () => {
  const n = parseBulk($('#bulk-text').value).length;
  $('#bulk-preview').textContent = n ? `${n} account(s) detected` : '';
});
$('#bulk-add').addEventListener('click', doBulkAdd);
$('#bulk-cancel').addEventListener('click', closeBulk);
$('#modal-backdrop').addEventListener('click', closeBulk);

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#settings-modal').hidden) closeSettings();
  else if (!$('#bulk-modal').hidden) closeBulk();
  else if (drawerEl.classList.contains('open')) closeDrawer();
});

// ---- Boot ------------------------------------------------------------------

(async function init() {
  try {
    const raw = await window.api.load();
    accounts = raw.map(normalize);
  } catch (err) {
    toast('Load error: ' + err.message);
    accounts = [];
  }
  render();
  autoEnrich();
})();

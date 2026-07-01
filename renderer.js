'use strict';

// ---- State -----------------------------------------------------------------

let accounts = [];
let selectedId = null;
let search = '';
const filters = { status: null, voice: false, verified: false };

const $ = (sel, root = document) => root.querySelector(sel);
const listEl = $('#account-list');
const detailEl = $('#detail');
const countEl = $('#count');

// ---- Model helpers ---------------------------------------------------------

const STATUSES = ['Actif', 'Averti', 'Banni'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(a) {
  return {
    id: a.id || crypto.randomUUID(),
    pseudo: a.pseudo || '',
    password: a.password || '',
    ageRange: a.ageRange || 'Inconnu',
    voiceChat: !!a.voiceChat,
    ageVerified: !!a.ageVerified,
    bannedGames: Array.isArray(a.bannedGames) ? a.bannedGames : [],
    status: STATUSES.includes(a.status) ? a.status : 'Actif',
    tags: Array.isArray(a.tags) ? a.tags : [],
    dateAdded: a.dateAdded || todayISO(),
    notes: a.notes || '',
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
    window.api.save(accounts).catch((err) => toast('Erreur de sauvegarde : ' + err.message));
  }, 250);
}

// ---- Filtering -------------------------------------------------------------

function visibleAccounts() {
  const q = search.trim().toLowerCase();
  return accounts.filter((a) => {
    if (filters.status && a.status !== filters.status) return false;
    if (filters.voice && !a.voiceChat) return false;
    if (filters.verified && !a.ageVerified) return false;
    if (q) {
      const hay = (a.pseudo + ' ' + a.tags.join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---- List rendering --------------------------------------------------------

function renderList() {
  const items = visibleAccounts();
  countEl.textContent = `${accounts.length} compte${accounts.length > 1 ? 's' : ''}`;
  listEl.innerHTML = '';

  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'list-empty';
    li.textContent = accounts.length === 0 ? 'Aucun compte. Clique sur + Nouveau.' : 'Aucun résultat.';
    listEl.appendChild(li);
    return;
  }

  for (const a of items) {
    const li = document.createElement('li');
    li.className = 'account-item' + (a.id === selectedId ? ' selected' : '');
    li.dataset.id = a.id;

    const dot = document.createElement('span');
    dot.className = 'dot ' + a.status;
    dot.title = a.status;

    const body = document.createElement('div');
    body.className = 'item-body';
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = a.pseudo || '(sans pseudo)';
    const meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = metaLine(a);
    body.append(name, meta);

    li.append(dot, body);
    li.addEventListener('click', () => selectAccount(a.id));
    listEl.appendChild(li);
  }
}

function metaLine(a) {
  const bits = [a.status];
  if (a.ageVerified) bits.push('vérifié');
  if (a.voiceChat) bits.push('voice');
  if (a.tags.length) bits.push('#' + a.tags.join(' #'));
  return bits.join(' · ');
}

// ---- Detail rendering ------------------------------------------------------

function selectAccount(id) {
  selectedId = id;
  renderList();
  renderDetail();
}

function renderDetail() {
  const a = getSelected();
  detailEl.innerHTML = '';

  if (!a) {
    detailEl.appendChild($('#tpl-empty').content.cloneNode(true));
    return;
  }

  const node = $('#tpl-detail').content.cloneNode(true);

  // Simple value fields
  bindText(node, 'pseudo', a);
  bindText(node, 'password', a);
  bindText(node, 'notes', a);
  bindSelect(node, 'ageRange', a);
  bindDate(node, 'dateAdded', a);
  bindCheckbox(node, 'voiceChat', a);
  bindCheckbox(node, 'ageVerified', a);
  bindSegmented(node, 'status', a);
  bindTags(node, 'bannedGames', a);
  bindTags(node, 'tags', a);

  // Password reveal + copy + delete + copy pseudo
  const pwInput = node.querySelector('[data-field="password"]');
  node.querySelector('[data-act="toggle-pw"]').addEventListener('click', (e) => {
    const shown = pwInput.type === 'text';
    pwInput.type = shown ? 'password' : 'text';
    e.target.textContent = shown ? 'Voir' : 'Cacher';
  });
  node.querySelector('[data-act="copy-pw"]').addEventListener('click', () => copy(a.password, 'Mot de passe copié'));
  node.querySelector('[data-act="copy-pseudo"]').addEventListener('click', () => copy(a.pseudo, 'Pseudo copié'));
  node.querySelector('[data-act="delete"]').addEventListener('click', () => deleteAccount(a.id));

  detailEl.appendChild(node);
}

// ---- Field binders ---------------------------------------------------------

function onEdit(a, field, value) {
  a[field] = value;
  save();
  renderList();
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
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = 'Retirer';
      x.addEventListener('click', () => {
        a[field].splice(i, 1);
        paint();
        onEdit(a, field, a[field]);
      });
      chip.appendChild(x);
      tagsBox.appendChild(chip);
    });
  }

  function add() {
    const val = input.value.trim();
    if (val && !a[field].includes(val)) {
      a[field].push(val);
      paint();
      onEdit(a, field, a[field]);
    }
    input.value = '';
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && input.value === '' && a[field].length) {
      a[field].pop();
      paint();
      onEdit(a, field, a[field]);
    }
  });
  input.addEventListener('blur', add);
  paint();
}

// ---- Actions ---------------------------------------------------------------

function newAccount() {
  const a = normalize({ pseudo: '' });
  accounts.unshift(a);
  selectAccount(a.id);
  save();
  const field = detailEl.querySelector('[data-field="pseudo"]');
  if (field) field.focus();
}

async function deleteAccount(id) {
  const a = accounts.find((x) => x.id === id);
  const name = a && a.pseudo ? `« ${a.pseudo} »` : 'ce compte';
  const res = await window.api.confirm(`Supprimer ${name} ? Cette action est définitive.`, ['Supprimer', 'Annuler']);
  if (res !== 0) return;
  accounts = accounts.filter((x) => x.id !== id);
  if (selectedId === id) selectedId = null;
  save();
  renderList();
  renderDetail();
  toast('Compte supprimé');
}

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text || '');
    toast(msg);
  } catch {
    toast('Copie impossible');
  }
}

async function doExport() {
  const res = await window.api.export(accounts);
  if (res.ok) toast('Exporté');
}

async function doImport() {
  const res = await window.api.import();
  if (!res.ok) {
    if (res.error) toast(res.error);
    return;
  }
  const incoming = res.accounts.map(normalize);
  if (incoming.length === 0) {
    toast('Fichier vide');
    return;
  }
  let mode = 0;
  if (accounts.length > 0) {
    mode = await window.api.confirm(
      `Importer ${incoming.length} compte(s). Fusionner avec les comptes actuels ou tout remplacer ?`,
      ['Fusionner', 'Remplacer', 'Annuler']
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
  selectedId = null;
  save();
  renderList();
  renderDetail();
  toast(`${incoming.length} compte(s) importé(s)`);
}

// ---- Toast -----------------------------------------------------------------

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// ---- Filters + search wiring ----------------------------------------------

$('#search').addEventListener('input', (e) => {
  search = e.target.value;
  renderList();
});

$('#filters').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const { filter, value } = chip.dataset;
  if (filter === 'status') {
    filters.status = filters.status === value ? null : value;
    document.querySelectorAll('.chip[data-filter="status"]').forEach((c) => {
      c.classList.toggle('active', c.dataset.value === filters.status);
    });
  } else {
    filters[filter] = !filters[filter];
    chip.classList.toggle('active', filters[filter]);
  }
  renderList();
});

$('#btn-new').addEventListener('click', newAccount);
$('#btn-export').addEventListener('click', doExport);
$('#btn-import').addEventListener('click', doImport);

// ---- Boot ------------------------------------------------------------------

(async function init() {
  try {
    const raw = await window.api.load();
    accounts = raw.map(normalize);
  } catch (err) {
    toast('Erreur de chargement : ' + err.message);
    accounts = [];
  }
  renderList();
  renderDetail();
})();

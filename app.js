/* Kitchen — phone web app. Plain JavaScript, no build step. */
'use strict';

// ======================================================================
//  Constants & small helpers
// ======================================================================

const CFG = window.KITCHEN_CONFIG || {};
const UNITS = ['', 'pcs', 'g', 'kg', 'ml', 'dl', 'l', 'tsp', 'tbsp', 'can', 'pack', 'bunch'];
const KNOWN_UNITS = new Set([...UNITS.filter(Boolean), 'pc', 'stk', 'mg', 'cl', 'tsk', 'spsk', 'x', 'pinch',
  'clove', 'cloves', 'slice', 'slices', 'cup', 'cups', 'cans', 'packs', 'bunches', 'fed', 'dåse', 'pk']);
const LOCATIONS = ['Fridge', 'Freezer', 'Pantry'];
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const TABLES = ['inventory_items', 'shopping_items', 'recipes', 'recipe_ingredients', 'meal_plan'];
const KEY = { inventory_items: 'inventory', shopping_items: 'shopping', recipes: 'recipes',
  recipe_ingredients: 'ingredients', meal_plan: 'meals' };

/** Build a DOM element: h('div', {class: 'x', onclick: fn}, 'text', child, [more]) */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'value') value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') e[k] = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    e.append(kid instanceof Node ? kid : String(kid));
  }
  if (value !== undefined) e.value = value;
  return e;
}

const $ = (sel, root = document) => root.querySelector(sel);

function fmtQty(q) {
  if (q === null || q === undefined || q === '') return '';
  const n = Number(q);
  if (Number.isNaN(n)) return String(q);
  return n.toFixed(3).replace(/\.?0+$/, '');
}
const qtyUnit = (q, u) => [fmtQty(q), u || ''].filter(Boolean).join(' ');

function parseNum(text) {
  const t = String(text ?? '').trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  if (Number.isNaN(n)) throw new Error(`“${text}” is not a number`);
  return n;
}

const QUICK = /^\s*(\d+(?:[.,]\d+)?)\s*([A-Za-zæøåÆØÅ]+)?\.?\s+(.+?)\s*$/;
const QUICK_TRAIL = /^\s*(.+?)\s+(\d+(?:[.,]\d+)?)\s*([A-Za-zæøåÆØÅ]+)?\s*$/;
/** '2 kg flour' / '3 eggs' / 'flour 500 g' / 'milk' -> {name, quantity, unit} (same rules as the desktop app) */
function parseQuickAdd(text) {
  text = text.trim();
  let m = text.match(QUICK);
  if (m) {
    let [, qty, unit, name] = m;
    if (unit && !KNOWN_UNITS.has(unit.toLowerCase())) { name = `${unit} ${name}`; unit = ''; }
    return { name: name.trim(), quantity: Number(qty.replace(',', '.')), unit: (unit || '').toLowerCase() };
  }
  m = text.match(QUICK_TRAIL);
  if (m && (!m[3] || KNOWN_UNITS.has(m[3].toLowerCase()))) {
    return { name: m[1].trim(), quantity: Number(m[2].replace(',', '.')), unit: (m[3] || '').toLowerCase() };
  }
  return { name: text, quantity: null, unit: '' };
}

// Dates are always local calendar days ("2026-11-16"), never UTC.
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const mondayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const fmtDay = (d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => d.toLocaleDateString('en-GB', opts);
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 864e5 + 1) / 7);
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  }));
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, error ? 5000 : 2600);
}
const errMsg = (e) => (e && (e.message || e.error_description)) || String(e);

// ======================================================================
//  State, offline cache and the change queue
// ======================================================================

const S = {
  inventory: [], shopping: [], recipes: [], ingredients: [], meals: [],
  week: mondayOf(new Date()),
  tab: localStorage.getItem('kitchen.tab') || 'shopping',
  user: null, offline: false,
};
let sb = null;                                         // Supabase client
let queue = JSON.parse(localStorage.getItem('kitchen.queue') || '[]');
let recent = [];   // changes the server confirmed lately: [{op, t}] (see reload)

function saveCache() {
  try {
    localStorage.setItem('kitchen.cache', JSON.stringify({
      inventory: S.inventory, shopping: S.shopping, recipes: S.recipes,
      ingredients: S.ingredients, meals: S.meals, week: iso(S.week),
    }));
  } catch { /* storage full or disabled: fine */ }
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('kitchen.cache') || 'null');
    if (!c) return false;
    Object.assign(S, { inventory: c.inventory, shopping: c.shopping, recipes: c.recipes,
      ingredients: c.ingredients, meals: iso(S.week) === c.week ? c.meals : [] });
    return true;
  } catch { return false; }
}
const saveQueue = () => localStorage.setItem('kitchen.queue', JSON.stringify(queue));

const DEFAULTS = {
  inventory_items: { unit: '', location: 'Pantry', category: '', notes: '', quantity: null, min_quantity: null, expiry_date: null },
  shopping_items: { unit: '', category: '', checked: false, source: 'manual', quantity: null },
  recipes: { servings: 4, instructions: '', notes: '', tags: '' },
  recipe_ingredients: { unit: '', position: 0, quantity: null },
  meal_plan: { meal: 'Dinner', title: '', servings: null, cooked: false, notes: '', recipe_id: null },
};
const defaults = (table) => ({ created_at: new Date().toISOString(), ...DEFAULTS[table] });

const matches = (row, match) => Object.entries(match).every(([k, v]) => (row[k] ?? '') === v);

/** Apply a change to the local copy so the screen updates instantly. */
function applyOp(op) {
  const k = KEY[op.table];
  if (op.type === 'insert') {
    if (!S[k].some((r) => r.id === op.row.id)) S[k].push({ ...defaults(op.table), ...op.row });
  } else if (op.type === 'update') {
    for (const r of S[k]) if (op.id ? r.id === op.id : matches(r, op.match)) Object.assign(r, op.values);
  } else if (op.type === 'delete') {
    S[k] = S[k].filter((r) => (op.id ? r.id !== op.id : !matches(r, op.match)));
    if (op.table === 'recipes') S.ingredients = S.ingredients.filter((i) => i.recipe_id !== op.id);
  }
}
const applyQueue = () => queue.forEach(applyOp);

/** Make changes: shown immediately, sent to the server now or as soon as we are back online. */
function mutate(...ops) {
  for (const op of ops.flat()) { applyOp(op); queue.push(op); }
  saveQueue();
  saveCache();
  refreshView();
  flush();
}

const isNetworkError = (res) => res.status === 0 || /fetch|network|load failed|offline/i.test(res.error?.message || '');

let flushing = false;
async function flush() {
  if (flushing || !sb || !S.user) return;
  flushing = true;
  try {
    while (queue.length) {
      const op = queue[0];
      let q = sb.from(op.table);
      if (op.type === 'insert') q = q.insert(op.row);
      else if (op.type === 'update') q = q.update(op.values);
      else q = q.delete();
      if (op.type !== 'insert') q = op.id ? q.eq('id', op.id) : q.match(op.match);
      const res = await q;
      if (res.error) {
        if (isNetworkError(res)) { setOffline(true); break; }
        if (!(op.type === 'insert' && res.error.code === '23505')) toast(`Could not save: ${errMsg(res.error)}`, true);
      }
      setOffline(false);
      queue.shift();
      saveQueue();
      const now = Date.now();
      recent = recent.filter((r) => now - r.t < 60_000);
      recent.push({ op, t: now });
    }
  } finally {
    flushing = false;
    updateSync();
  }
}

function setOffline(v) { S.offline = v; updateSync(); }
function updateSync() {
  const b = $('#sync');
  b.className = 'sync' + (S.offline ? ' offline' : queue.length ? ' pending' : '');
  b.textContent = S.offline ? (queue.length ? `Offline · ${queue.length} to sync` : 'Offline')
    : queue.length ? `Syncing ${queue.length}…` : 'Synced';
}

// ---- loading from the server

async function loadTable(t) {
  let q = sb.from(t).select('*');
  if (t === 'meal_plan') q = q.gte('plan_date', iso(S.week)).lte('plan_date', iso(addDays(S.week, 6)));
  q = q.order(t === 'recipe_ingredients' ? 'position' : 'created_at');
  const { data, error, status } = await q;
  if (error) { if (isNetworkError({ error, status })) setOffline(true); throw error; }
  S[KEY[t]] = data;
}

async function reload(tables = TABLES) {
  await flush();
  const started = Date.now();
  try {
    await Promise.all(tables.map(loadTable));
    setOffline(false);
  } catch (e) {
    if (!S.offline) toast(`Could not load: ${errMsg(e)}`, true);
  }
  // A change saved while we were downloading may be missing from what came back: put it back.
  for (const r of recent) if (r.t >= started) applyOp(r.op);
  applyQueue();
  saveCache();
  refreshView();
  updateDatalists();
}

const pendingReload = new Set();
let reloadTimer;
function scheduleReload(t) {
  pendingReload.add(t);
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { const ts = [...pendingReload]; pendingReload.clear(); reload(ts); }, 350);
}

async function rpc(name, params, reloadTables) {
  await flush();
  if (queue.length) throw new Error('You are offline — try again when you have signal.');
  const { data, error } = await sb.rpc(name, params);
  if (error) throw new Error(isNetworkError({ error }) ? 'You are offline — try again when you have signal.' : errMsg(error));
  await reload(reloadTables);
  return data;
}

// ======================================================================
//  Look-ups shared by several screens
// ======================================================================

const recipeById = (id) => S.recipes.find((r) => r.id === id);
function locations() {
  const l = [...LOCATIONS];
  for (const i of S.inventory) if (i.location && !l.includes(i.location)) l.push(i.location);
  return l;
}
function categories() {
  return [...new Set([...S.inventory, ...S.shopping].map((i) => i.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}
function updateDatalists() {
  const fill = (id, values) => $(id).replaceChildren(...[...new Set(values)].map((v) => h('option', { value: v })));
  fill('#dl-names', [...S.inventory, ...S.shopping].map((i) => i.name));
  fill('#dl-units', UNITS.filter(Boolean));
  fill('#dl-locations', locations());
  fill('#dl-categories', categories());
}
function flag(it) {
  const t = today();
  if (it.expiry_date) {
    const d = fromIso(it.expiry_date);
    if (d < t) return 'red';
    if (d <= addDays(t, 3)) return 'orange';
  }
  if (it.min_quantity != null && Number(it.quantity || 0) < Number(it.min_quantity)) return 'yellow';
  return null;
}
function mealLabel(m) {
  let name = recipeById(m.recipe_id)?.name || m.title || '?';
  if (m.recipe_id && m.title) name += ` (${m.title})`;
  return name;
}

// ======================================================================
//  Bottom sheet (modal) and form helpers
// ======================================================================

let sheetEl = null;
function openSheet(title, body, actions = [], { full = false } = {}) {
  closeSheet();
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) closeSheet(); } },
    h('div', { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-label': title },
      h('div', { class: 'sheet-head' }, h('h2', {}, title),
        h('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onclick: closeSheet }, '✕')),
      body,
      actions.length ? h('div', { class: 'sheet-actions' }, actions) : null));
  document.body.append(backdrop);
  sheetEl = backdrop;
}
function closeSheet() { sheetEl?.remove(); sheetEl = null; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
const input = (attrs) => h('input', { class: 'input', ...attrs });
const select = (options, value, attrs = {}) => h('select', { class: 'input', ...attrs, value },
  options.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))));
const btn = (text, onclick, cls = '') => h('button', { class: `btn ${cls}`, type: 'button', onclick }, text);

/** Run an async action, showing errors as a toast. */
async function attempt(fn) {
  try { return await fn(); } catch (e) { toast(errMsg(e), true); return undefined; }
}

// ======================================================================
//  Screens
// ======================================================================

const views = {};
let mounted = null;

function show(tab) {
  S.tab = tab;
  localStorage.setItem('kitchen.tab', tab);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  const v = $('#view');
  v.replaceChildren();
  mounted = views[tab];
  $('#title').textContent = mounted.title;
  mounted.mount(v);
  mounted.update();
  window.scrollTo(0, 0);
}
function refreshView() { if (mounted && S.user) mounted.update(); }

// ---------------------------------------------------------------- Shopping list

views.shopping = {
  title: 'Shopping list',
  mount(root) {
    const box = input({ placeholder: 'Add… “2 kg flour”, “3 eggs”, “milk”', list: 'dl-names',
      enterkeyhint: 'done', autocomplete: 'off', class: 'input grow' });
    const add = (e) => {
      e.preventDefault();
      const text = box.value.trim();
      if (!text) return;
      const v = parseQuickAdd(text);
      const known = S.inventory.find((i) => i.name.toLowerCase() === v.name.toLowerCase() && i.category);
      mutate({ type: 'insert', table: 'shopping_items',
        row: { id: uuid(), ...v, category: known?.category || '', source: 'manual' } });
      box.value = '';
    };
    root.append(
      h('form', { class: 'toolbar', onsubmit: add }, h('div', { class: 'row' }, box, h('button', { class: 'btn primary', type: 'submit' }, 'Add'))),
      this.listEl = h('div'),
      h('div', { class: 'actions' },
        btn('From meal plan…', () => generateSheet()),
        btn('Bought → kitchen', () => purchaseSheet()),
        btn('Remove ticked', () => {
          const done = S.shopping.filter((i) => i.checked);
          if (done.length && confirm(`Remove ${done.length} ticked item(s) without adding them to the kitchen?`))
            mutate(done.map((i) => ({ type: 'delete', table: 'shopping_items', id: i.id })));
        })));
  },
  update() {
    const todo = S.shopping.filter((i) => !i.checked);
    const done = S.shopping.filter((i) => i.checked).sort(byName);
    if (!S.shopping.length) {
      this.listEl.replaceChildren(h('div', { class: 'empty' }, 'The list is empty.', h('br'),
        h('span', { class: 'small' }, 'Type above, or fill it from the meal plan.')));
      return;
    }
    const groups = {};
    for (const i of todo) (groups[i.category || 'Other'] ||= []).push(i);
    const names = Object.keys(groups).sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
    this.listEl.replaceChildren(
      ...names.map((c) => this.group(c, groups[c].sort(byName))),
      ...(done.length ? [this.group(`In the basket (${done.length})`, done)] : []));
  },
  group(title, items) {
    return h('section', { class: 'group' }, h('h3', {}, title), h('div', { class: 'list' }, items.map((i) =>
      h('div', { class: 'item' + (i.checked ? ' done' : ''),
        onclick: () => mutate({ type: 'update', table: 'shopping_items', id: i.id, values: { checked: !i.checked } }) },
      h('span', { class: 'tick' }, i.checked ? '✓' : ''),
      h('div', { class: 'main' }, h('div', { class: 'name' }, i.name,
        i.source && i.source !== 'manual' ? h('span', { class: 'tag' }, i.source) : null)),
      h('span', { class: 'qty' }, qtyUnit(i.quantity, i.unit)),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Edit',
        onclick: (e) => { e.stopPropagation(); itemSheet('shopping', i); } }, '⋯')))));
  },
};

// ---------------------------------------------------------------- Kitchen inventory

views.kitchen = {
  title: 'Kitchen',
  filter: 'All',
  mount(root) {
    this.search = input({ placeholder: 'Search…', type: 'search', autocomplete: 'off',
      oninput: () => this.update() });
    root.append(h('div', { class: 'toolbar' }, this.search, this.chipsEl = h('div', { class: 'chips' })),
      this.listEl = h('div'),
      h('button', { class: 'fab', type: 'button', 'aria-label': 'Add item',
        onclick: () => itemSheet('kitchen', { location: LOCATIONS.includes(this.filter) || locations().includes(this.filter) ? this.filter : 'Pantry' }) }, '+'));
  },
  update() {
    const flagged = S.inventory.filter(flag).length;
    const chipNames = ['All', ...locations(), ...(flagged ? [`⚠ Check (${flagged})`] : [])];
    if (!chipNames.includes(this.filter) && !this.filter.startsWith('⚠')) this.filter = 'All';
    this.chipsEl.replaceChildren(...chipNames.map((c) => h('button', {
      class: 'chip' + ((c === this.filter || (c.startsWith('⚠') && this.filter.startsWith('⚠'))) ? ' on' : ''),
      type: 'button', onclick: () => { this.filter = c; this.update(); } }, c)));

    const q = this.search.value.trim().toLowerCase();
    const rows = S.inventory.filter((i) => (!q || i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))
      && (this.filter === 'All' || (this.filter.startsWith('⚠') ? flag(i) : i.location === this.filter))).sort(byName);
    if (!rows.length) {
      this.listEl.replaceChildren(h('div', { class: 'empty' }, S.inventory.length ? 'Nothing matches.' : 'Nothing in the kitchen yet — tap + to add.'));
      return;
    }
    // group by location when showing everything
    const groups = {};
    for (const i of rows) (groups[this.filter === 'All' ? (i.location || 'Other') : this.filter.replace(/ \(\d+\)$/, '')] ||= []).push(i);
    this.listEl.replaceChildren(...Object.entries(groups).map(([loc, items]) => h('section', { class: 'group' },
      h('h3', {}, loc), h('div', { class: 'list' }, items.map((i) => this.row(i))))));
  },
  row(i) {
    const f = flag(i);
    const sub = [i.category, i.expiry_date ? `best before ${fmtDay(fromIso(i.expiry_date))}` : null,
      i.min_quantity != null ? `keep ≥ ${qtyUnit(i.min_quantity, i.unit)}` : null].filter(Boolean).join(' · ');
    const step = (d) => (e) => {
      e.stopPropagation();
      mutate({ type: 'update', table: 'inventory_items', id: i.id, values: { quantity: Math.max(0, Number(i.quantity || 0) + d) } });
    };
    return h('div', { class: 'item' + (f ? ` flag-${f}` : ''), onclick: () => itemSheet('kitchen', i) },
      h('div', { class: 'main' }, h('div', { class: 'name' }, i.name), sub ? h('div', { class: 'sub' }, sub) : null),
      h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': 'One less', onclick: step(-1) }, '−'),
        h('span', { class: 'qty' }, qtyUnit(i.quantity, i.unit) || '–'),
        h('button', { type: 'button', 'aria-label': 'One more', onclick: step(1) }, '+')));
  },
};

// ---------------------------------------------------------------- Meal plan

views.plan = {
  title: 'Meal plan',
  mount(root) {
    const go = (days) => async () => {
      S.week = days === 0 ? mondayOf(new Date()) : addDays(S.week, days);
      S.meals = [];
      this.update();
      await attempt(() => reload(['meal_plan']));
    };
    root.append(
      h('div', { class: 'toolbar' },
        h('div', { class: 'weeknav' },
          h('button', { class: 'btn small', type: 'button', onclick: go(-7), 'aria-label': 'Previous week' }, '◀'),
          this.label = h('button', { class: 'label btn small', type: 'button', onclick: go(0) }),
          h('button', { class: 'btn small', type: 'button', onclick: go(7), 'aria-label': 'Next week' }, '▶')),
        btn('🛒 Shopping list for this week', () => generateSheet(S.week, addDays(S.week, 6)))),
      this.listEl = h('div'));
  },
  update() {
    const end = addDays(S.week, 6);
    this.label.textContent = `Week ${isoWeek(S.week)} · ${fmtDay(S.week, { day: 'numeric', month: 'short' })} – ${fmtDay(end, { day: 'numeric', month: 'short' })}`;
    const t = iso(today());
    const days = [];
    for (let n = 0; n < 7; n++) {
      const d = addDays(S.week, n);
      const meals = S.meals.filter((m) => m.plan_date === iso(d))
        .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.created_at.localeCompare(b.created_at));
      days.push(h('section', { class: 'day' + (iso(d) === t ? ' today' : '') },
        h('div', { class: 'day-head' }, h('span', { class: 'd' }, fmtDay(d, { weekday: 'long', day: 'numeric', month: 'short' }),
          iso(d) === t ? h('span', { class: 'tag' }, 'today') : null),
        h('button', { class: 'btn small', type: 'button', onclick: () => mealSheet({ plan_date: iso(d) }) }, '+ Add')),
        meals.length ? h('div', { class: 'list' }, meals.map((m) =>
          h('div', { class: 'item' + (m.cooked ? ' cooked' : ''), onclick: () => mealActions(m) },
            h('span', { class: 'meal-tag' }, m.meal),
            h('div', { class: 'main' }, h('div', { class: 'name' }, (m.cooked ? '✓ ' : '') + mealLabel(m)),
              m.servings || m.notes ? h('div', { class: 'sub' }, [m.servings ? `${fmtQty(m.servings)} servings` : null, m.notes].filter(Boolean).join(' · ')) : null)))) : null));
    }
    this.listEl.replaceChildren(...days);
  },
};

// ---------------------------------------------------------------- Recipes

views.recipes = {
  title: 'Recipes',
  mount(root) {
    this.search = input({ placeholder: 'Search recipes…', type: 'search', autocomplete: 'off', oninput: () => this.update() });
    root.append(h('div', { class: 'toolbar' }, this.search), this.listEl = h('div'),
      h('button', { class: 'fab', type: 'button', 'aria-label': 'New recipe', onclick: () => recipeEditSheet() }, '+'));
  },
  update() {
    const q = this.search.value.trim().toLowerCase();
    const rows = S.recipes.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.tags || '').toLowerCase().includes(q)).sort(byName);
    if (!rows.length) {
      this.listEl.replaceChildren(h('div', { class: 'empty' }, S.recipes.length ? 'Nothing matches.' : 'No recipes yet — tap + to add one.'));
      return;
    }
    this.listEl.replaceChildren(h('div', { class: 'list' }, rows.map((r) => {
      const n = S.ingredients.filter((i) => i.recipe_id === r.id).length;
      return h('div', { class: 'item', onclick: () => recipeSheet(r) },
        h('div', { class: 'main' }, h('div', { class: 'name' }, r.name),
          h('div', { class: 'sub' }, [`serves ${fmtQty(r.servings)}`, `${n} ingredient${n === 1 ? '' : 's'}`, r.tags].filter(Boolean).join(' · '))),
        h('span', { class: 'qty' }, '›'));
    })));
  },
};

// ======================================================================
//  Sheets (forms)
// ======================================================================

function itemSheet(kind, item = {}) {
  const shopping = kind === 'shopping';
  const table = shopping ? 'shopping_items' : 'inventory_items';
  const f = {
    name: input({ value: item.name || '', list: 'dl-names', autocomplete: 'off' }),
    quantity: input({ value: fmtQty(item.quantity), inputmode: 'decimal', placeholder: 'optional' }),
    unit: input({ value: item.unit || '', list: 'dl-units', autocomplete: 'off', placeholder: 'g, kg, pcs…' }),
    category: input({ value: item.category || '', list: 'dl-categories', autocomplete: 'off' }),
  };
  if (!shopping) {
    Object.assign(f, {
      location: input({ value: item.location || 'Pantry', list: 'dl-locations', autocomplete: 'off' }),
      expiry_date: input({ type: 'date', value: item.expiry_date || '' }),
      min_quantity: input({ value: fmtQty(item.min_quantity), inputmode: 'decimal', placeholder: 'optional — adds it to the list when below' }),
      notes: input({ value: item.notes || '' }),
    });
  }
  const body = h('div', {},
    field('Name', f.name),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Quantity', f.quantity)), h('div', { class: 'grow' }, field('Unit', f.unit))),
    shopping ? null : field('Location', f.location),
    field('Category', f.category),
    shopping ? null : [field('Best before', f.expiry_date), field('Keep at least', f.min_quantity), field('Notes', f.notes)]);

  const save = () => attempt(() => {
    const name = f.name.value.trim();
    if (!name) throw new Error('Please enter a name.');
    const values = { name, quantity: parseNum(f.quantity.value), unit: f.unit.value.trim(), category: f.category.value.trim() };
    if (!shopping) {
      Object.assign(values, { location: f.location.value.trim() || 'Pantry', expiry_date: f.expiry_date.value || null,
        min_quantity: parseNum(f.min_quantity.value), notes: f.notes.value.trim() });
    }
    if (item.id) mutate({ type: 'update', table, id: item.id, values });
    else mutate({ type: 'insert', table, row: { id: uuid(), ...values } });
    closeSheet();
  });

  const actions = [];
  if (item.id) {
    actions.push(btn('Delete', () => {
      if (shopping || confirm(`Delete ${item.name} from the kitchen?`)) {
        mutate({ type: 'delete', table, id: item.id });
        closeSheet();
      }
    }, 'danger'));
    if (!shopping) {
      actions.push(btn('To list', () => {
        const need = item.min_quantity != null ? Math.max(Number(item.min_quantity) - Number(item.quantity || 0), 0) || null : null;
        mutate({ type: 'insert', table: 'shopping_items',
          row: { id: uuid(), name: item.name, quantity: need, unit: item.unit || '', category: item.category || '', source: 'manual' } });
        closeSheet();
        toast(`${item.name} is on the shopping list`);
      }));
    }
  }
  actions.push(btn('Save', save, 'primary'));
  openSheet(item.id ? 'Edit item' : shopping ? 'Add to list' : 'Add to kitchen', body, actions);
  if (!item.id) setTimeout(() => { if (!sheetEl?.contains(document.activeElement)) f.name.focus(); }, 60);
}

function generateSheet(start, end) {
  if (!start) { start = mondayOf(new Date()); end = addDays(start, 6); }
  const from = input({ type: 'date', value: iso(start) });
  const to = input({ type: 'date', value: iso(end) });
  const low = h('input', { type: 'checkbox', checked: true });
  openSheet('From the meal plan', h('div', {},
    h('p', { class: 'muted small' }, 'Adds the ingredients for planned (not yet cooked) meals, minus what is in the kitchen and what is already on the list.'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('From', from)), h('div', { class: 'grow' }, field('To', to))),
    h('label', { class: 'check' }, low, 'Also add things that are running low')), [
    btn('Add to list', () => attempt(async () => {
      const n = await rpc('generate_shopping_list', { p_start: from.value, p_end: to.value, p_include_low_stock: low.checked },
        ['shopping_items']);
      closeSheet();
      if (S.tab !== 'shopping') show('shopping');
      toast(n ? `Added ${n} item${n === 1 ? '' : 's'}` : 'You already have everything 🎉');
    }), 'primary')]);
}

function purchaseSheet() {
  const n = S.shopping.filter((i) => i.checked).length;
  if (!n) { toast('Tick off what you bought first'); return; }
  const loc = select(locations(), 'Pantry');
  openSheet('Put shopping away', h('div', {},
    h('p', { class: 'muted small' }, `Adds the ${n} ticked item${n === 1 ? '' : 's'} to the kitchen and clears them from the list. Things you already have keep their place; new things go to:`),
    field('Location for new items', loc)), [
    btn('Put away', () => attempt(async () => {
      await rpc('purchase_checked', { p_location: loc.value }, ['shopping_items', 'inventory_items']);
      closeSheet();
      toast(`${n} item${n === 1 ? '' : 's'} moved into the kitchen`);
    }), 'primary')]);
}

function mealSheet(meal = {}) {
  const f = {
    plan_date: input({ type: 'date', value: meal.plan_date || iso(today()) }),
    meal: select(MEALS, meal.meal || 'Dinner'),
    recipe_id: select([['', '— no recipe, just a note —'], ...[...S.recipes].sort(byName).map((r) => [r.id, r.name])], meal.recipe_id || ''),
    title: input({ value: meal.title || '', placeholder: 'e.g. Leftovers, Eating out' }),
    servings: input({ value: fmtQty(meal.servings), inputmode: 'decimal', placeholder: 'recipe default' }),
    notes: input({ value: meal.notes || '' }),
  };
  openSheet(meal.id ? 'Edit meal' : 'Plan a meal', h('div', {},
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Day', f.plan_date)), h('div', { class: 'grow' }, field('Meal', f.meal))),
    field('Recipe', f.recipe_id), field('Note / title', f.title), field('Servings', f.servings), field('Notes', f.notes)), [
    btn('Save', () => attempt(() => {
      const values = { plan_date: f.plan_date.value, meal: f.meal.value, recipe_id: f.recipe_id.value || null,
        title: f.title.value.trim(), servings: parseNum(f.servings.value), notes: f.notes.value.trim() };
      if (!values.plan_date) throw new Error('Pick a day.');
      if (!values.recipe_id && !values.title) throw new Error('Pick a recipe or write a note.');
      if (values.servings !== null && values.servings <= 0) throw new Error('Servings must be more than 0.');
      if (meal.id) mutate({ type: 'update', table: 'meal_plan', id: meal.id, values });
      else mutate({ type: 'insert', table: 'meal_plan', row: { id: uuid(), ...values } });
      closeSheet();
      const d = fromIso(values.plan_date);
      if (d < S.week || d > addDays(S.week, 6)) toast(`Planned for ${fmtDay(d)}`);
    }), 'primary')]);
}

function mealActions(m) {
  const recipe = recipeById(m.recipe_id);
  const list = h('div', { class: 'menu-list' },
    recipe ? btn('📖 Show recipe', () => recipeSheet(recipe)) : null,
    m.cooked
      ? btn('↩︎ Mark as not cooked', () => { mutate({ type: 'update', table: 'meal_plan', id: m.id, values: { cooked: false } }); closeSheet(); })
      : btn(recipe ? '✓ Cooked — take ingredients from kitchen' : '✓ Mark as done', () => attempt(async () => {
        if (recipe) {
          await rpc('cook_meal', { p_meal_id: m.id }, ['meal_plan', 'inventory_items']);
          toast('Ingredients taken from the kitchen');
        } else {
          mutate({ type: 'update', table: 'meal_plan', id: m.id, values: { cooked: true } });
        }
        closeSheet();
      })),
    btn('✎ Edit', () => mealSheet(m)),
    btn('⧉ Copy to next day', () => {
      const { id, created_at, updated_at, cooked, recipes, ...rest } = m;
      mutate({ type: 'insert', table: 'meal_plan', row: { ...rest, id: uuid(), plan_date: iso(addDays(fromIso(m.plan_date), 1)) } });
      closeSheet();
    }),
    btn('🗑 Remove', () => { mutate({ type: 'delete', table: 'meal_plan', id: m.id }); closeSheet(); }, 'danger'));
  openSheet(`${m.meal} · ${fmtDay(fromIso(m.plan_date))}`, h('div', {}, h('p', {}, h('strong', {}, mealLabel(m))), list));
}

function recipeSheet(r) {
  const ings = S.ingredients.filter((i) => i.recipe_id === r.id).sort((a, b) => a.position - b.position);
  const servings = input({ value: fmtQty(r.servings), inputmode: 'decimal', style: 'width:80px' });
  const listEl = h('ul');
  const draw = () => {
    let factor = 1;
    try { const s = parseNum(servings.value); if (s > 0) factor = s / Number(r.servings); } catch { /* keep 1 */ }
    listEl.replaceChildren(...ings.map((i) => h('li', {}, i.quantity != null ? h('strong', {}, `${qtyUnit(i.quantity * factor, i.unit)} `) : null, i.name)));
  };
  servings.addEventListener('input', draw);
  draw();
  openSheet(r.name, h('div', { class: 'recipe' },
    r.tags ? h('div', { class: 'muted small' }, r.tags) : null,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('span', {}, 'Servings'), servings),
    h('h4', {}, 'Ingredients'), ings.length ? listEl : h('p', { class: 'muted' }, 'No ingredients yet.'),
    r.instructions ? [h('h4', {}, 'Method'), h('div', { class: 'method' }, r.instructions)] : null,
    r.notes ? [h('h4', {}, 'Notes'), h('p', {}, r.notes)] : null), [
    btn('Delete', () => {
      if (!confirm(`Delete the recipe “${r.name}”? Planned meals keep its name as a note.`)) return;
      mutate({ type: 'update', table: 'meal_plan', match: { recipe_id: r.id, title: '' }, values: { title: r.name } },
        { type: 'delete', table: 'recipes', id: r.id });
      closeSheet();
    }, 'danger'),
    btn('Edit', () => recipeEditSheet(r)),
    btn('Plan', () => mealSheet({ recipe_id: r.id }), 'primary')], { full: true });
}

function recipeEditSheet(r = {}) {
  const ings = r.id ? S.ingredients.filter((i) => i.recipe_id === r.id).sort((a, b) => a.position - b.position) : [];
  const f = {
    name: input({ value: r.name || '' }),
    servings: input({ value: fmtQty(r.servings ?? 4), inputmode: 'decimal' }),
    tags: input({ value: r.tags || '', placeholder: 'quick, vegetarian…' }),
    ingredients: h('textarea', { class: 'input', rows: 8, placeholder: '300 g flour\n6 dl milk\n3 eggs\nsalt',
      value: ings.map((i) => [fmtQty(i.quantity), i.unit, i.name].filter(Boolean).join(' ')).join('\n') }),
    instructions: h('textarea', { class: 'input', rows: 8, value: r.instructions || '' }),
    notes: input({ value: r.notes || '' }),
  };
  openSheet(r.id ? 'Edit recipe' : 'New recipe', h('div', {},
    field('Name', f.name),
    h('div', { class: 'row' }, h('div', { style: 'width:110px' }, field('Serves', f.servings)), h('div', { class: 'grow' }, field('Tags', f.tags))),
    field('Ingredients — one per line', f.ingredients),
    field('Method', f.instructions),
    field('Notes', f.notes)), [
    btn('Cancel', closeSheet),
    btn('Save', () => attempt(() => {
      const name = f.name.value.trim();
      if (!name) throw new Error('Give the recipe a name.');
      const servings = parseNum(f.servings.value) || 4;
      if (servings <= 0) throw new Error('Servings must be more than 0.');
      const id = r.id || uuid();
      const values = { name, servings, tags: f.tags.value.trim(), instructions: f.instructions.value, notes: f.notes.value.trim() };
      const newIngs = f.ingredients.value.split('\n').map((l) => l.trim().replace(/^[-•*·]\s*/, '')).filter(Boolean)
        .map((l, position) => ({ id: uuid(), recipe_id: id, position, ...parseQuickAdd(l) }));
      mutate(
        r.id ? { type: 'update', table: 'recipes', id, values } : { type: 'insert', table: 'recipes', row: { id, ...values } },
        ings.map((i) => ({ type: 'delete', table: 'recipe_ingredients', id: i.id })),
        newIngs.map((row) => ({ type: 'insert', table: 'recipe_ingredients', row })));
      const saved = recipeById(id);
      closeSheet();
      if (saved) recipeSheet(saved);
    }), 'primary')], { full: true });
}

function menuSheet() {
  openSheet('Kitchen', h('div', { class: 'menu-list' },
    h('p', { class: 'muted small' }, `Signed in as ${S.user?.email || '?'}`),
    btn('⟳ Refresh now', () => { closeSheet(); reload(); }),
    btn('Sign out', async () => {
      if (queue.length && !confirm(`${queue.length} change(s) have not synced yet and will be lost. Sign out anyway?`)) return;
      closeSheet();
      await sb.auth.signOut();
    }, 'danger')));
}

// ======================================================================
//  Sign-in and start-up
// ======================================================================

function showLogin(message) {
  S.user = null;
  mounted = null;
  document.body.classList.add('signed-out');
  $('#title').textContent = 'Kitchen';
  const email = input({ type: 'email', autocomplete: 'username', value: localStorage.getItem('kitchen.email') || '' });
  const pw = input({ type: 'password', autocomplete: 'current-password' });
  const submit = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'Sign in');
  $('#view').replaceChildren(h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
    submit.disabled = false;
    if (error) { toast(errMsg(error), true); return; }
    localStorage.setItem('kitchen.email', email.value.trim());
    signedIn(data.user);
  } }, h('h2', {}, 'Sign in'),
  message ? h('p', { class: 'muted' }, message) : null,
  field('E-mail', email), field('Password', pw), submit));
}

function signedIn(user) {
  const changed = S.user?.id !== user.id;
  S.user = user;
  document.body.classList.remove('signed-out');
  if (changed) {
    if (loadCache()) applyQueue();
    show(views[S.tab] ? S.tab : 'shopping');
    updateDatalists();
    subscribe();
  }
  updateSync();
  reload();
}

let channel = null;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('kitchen-changes');
  for (const table of TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleReload(table));
  }
  channel.subscribe();
}

async function start() {
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => show(b.dataset.tab));
  $('#menu').addEventListener('click', menuSheet);
  $('#sync').addEventListener('click', () => reload());

  if (!CFG.url || !CFG.key || !window.supabase) {
    document.body.classList.add('signed-out');
    $('#view').replaceChildren(h('div', { class: 'login' }, h('h2', {}, 'Almost there'),
      h('p', {}, 'Open config.js and fill in your Supabase project URL and publishable (anon) key, then upload the files again.')));
    return;
  }
  sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kitchen.auth' } });
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      queue = []; saveQueue();
      localStorage.removeItem('kitchen.cache');
      Object.assign(S, { inventory: [], shopping: [], recipes: [], ingredients: [], meals: [] });
      if (channel) { sb.removeChannel(channel); channel = null; }
      showLogin();
    }
  });
  const { data } = await sb.auth.getSession();
  if (data.session?.user) signedIn(data.session.user);
  else showLogin();

  // keep things fresh when the app comes back to the front, and as a fallback poll
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) reload(); });
  window.addEventListener('online', () => { if (S.user) reload(); });
  window.addEventListener('offline', () => setOffline(true));
  setInterval(() => { if (!document.hidden && S.user && !sheetEl) reload(); }, 60_000);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
start();

/* Køkken — telefon-app. Almindelig JavaScript, intet byggetrin. */
'use strict';

// ======================================================================
//  Fødevareregler (samme regler som desktop-appens foods.py)
// ======================================================================

const CFG = window.KITCHEN_CONFIG || {};
const UNITS = ['', 'stk', 'g', 'kg', 'ml', 'cl', 'dl', 'l', 'tsk', 'spsk', 'knivspids', 'dåse', 'pakke',
  'pose', 'bakke', 'glas', 'flaske', 'fed', 'bundt', 'skive', 'håndfuld', 'stilk', 'blad'];
const UNIT_SET = new Set(UNITS.filter(Boolean));
const PLURALS = { dåse: 'dåser', pakke: 'pakker', pose: 'poser', bakke: 'bakker', flaske: 'flasker', skive: 'skiver',
  knivspids: 'knivspidser', håndfuld: 'håndfulde', stilk: 'stilke', blad: 'blade' };
const UNIT_ALIASES = {
  ...Object.fromEntries(Object.entries(PLURALS).map(([s, p]) => [p, s])),
  pcs: 'stk', pc: 'stk', styk: 'stk', stykker: 'stk', 'stk.': 'stk', gram: 'g', gr: 'g', kilo: 'kg', liter: 'l', ltr: 'l',
  tsp: 'tsk', teske: 'tsk', teskefuld: 'tsk', tbsp: 'spsk', spiseske: 'spsk', spiseskefuld: 'spsk',
  can: 'dåse', cans: 'dåse', ds: 'dåse', pack: 'pakke', packs: 'pakke', pk: 'pakke', pkt: 'pakke', pakning: 'pakke',
  bunch: 'bundt', bdt: 'bundt', clove: 'fed', cloves: 'fed', slice: 'skive', slices: 'skive', pinch: 'knivspids',
  knsp: 'knivspids', fl: 'flaske',
};
const COUNTABLE = new Set(['', 'stk', 'dåse', 'pakke', 'pose', 'bakke', 'flaske', 'glas']);
const LOCATIONS = ['Køleskab', 'Fryser', 'Spisekammer'];
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];                 // som i databasen
const MEAL_DA = { Breakfast: 'Morgenmad', Lunch: 'Frokost', Dinner: 'Aftensmad', Snack: 'Mellemmåltid' };
const SOURCE_DA = { 'meal plan': 'madplan', 'low stock': 'lav beholdning' };
const DAYS = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const PALETTE = ['#e5484d', '#f76b15', '#e2a400', '#30a46c', '#12a594', '#0090ff', '#3e63dd', '#8e4ec6', '#d6409f', '#8d6e63'];
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#888888');

function canonUnit(u) {
  let k = String(u ?? '').trim().toLowerCase();
  if (UNIT_ALIASES[k]) return UNIT_ALIASES[k];
  k = k.replace(/\.+$/, '');
  return UNIT_ALIASES[k] || k;
}
const isUnit = (w) => UNIT_SET.has(canonUnit(w));
const unitLabel = (u, q) => (q != null && Number(q) > 1 && PLURALS[u] ? PLURALS[u] : (u || ''));

function fmtQty(q) {
  if (q === null || q === undefined || q === '') return '';
  const n = Number(q);
  if (Number.isNaN(n)) return String(q);
  return n.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
}
const fmtAmount = (q, u) => [fmtQty(q), unitLabel(u, q)].filter(Boolean).join(' ');

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
function parseNum(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/^(\d+)\s*-\s*(\d+)$/))) return Math.max(+m[1], +m[2]);
  if ((m = t.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/))) return +(m[1] || 0) + (+m[2]) / (+m[3]);
  if ((m = t.match(/^(\d*)\s*([½¼¾⅓⅔])$/))) return +(m[1] || 0) + FRACTIONS[m[2]];
  const n = Number(t.replace(',', '.'));
  if (Number.isNaN(n)) throw new Error(`“${text}” er ikke et tal`);
  return n;
}
const NUM = String.raw`(?:\d+\s*-\s*\d+|\d+\s+\d+/\d+|\d+/\d+|\d*\s*[½¼¾⅓⅔]|\d+(?:[.,]\d+)?)`;
const QUICK = new RegExp(String.raw`^\s*(${NUM})\s*(\p{L}+\.?)?\s+(.+?)\s*$`, 'u');
const QUICK_TRAIL = new RegExp(String.raw`^\s*(.+?)\s+(${NUM})\s*(\p{L}+\.?)?\s*$`, 'u');

/** '2 dåser hakkede tomater' / '3 æg' / 'mælk 1 l' / '½ tsk salt' / 'salt' -> {name, quantity, unit} */
function parseQuickAdd(text) {
  text = String(text || '').trim().replace(/^[-•*·]\s*/, '').trim();
  let m = text.match(QUICK);
  if (m) {
    let [, qty, unit, name] = m;
    if (unit && !isUnit(unit)) { name = `${unit} ${name}`; unit = ''; }
    return { name: name.trim(), quantity: parseNum(qty), unit: canonUnit(unit) };
  }
  m = text.match(QUICK_TRAIL);
  if (m && (!m[3] || isUnit(m[3]))) return { name: m[1].trim(), quantity: parseNum(m[2]), unit: canonUnit(m[3]) };
  return { name: text, quantity: null, unit: '' };
}
const ingredientLine = (i) => [fmtAmount(i.quantity, i.unit), i.name].filter(Boolean).join(' ');

// ---- samme vare, forskellig stavemåde
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/^[ .,;:]+|[ .,;:]+$/g, '');
const SUFFIXES = ['erne', 'ene', 'er', 'et', 'en', 'ne', 'e', 'r', 's'];
function stem(w) {
  for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length);
  return w;
}
function foodKey(s) {
  const w = norm(s).split(' ');
  if (w.length && w[w.length - 1]) w[w.length - 1] = stem(w[w.length - 1]);
  return w.join(' ');
}
function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
    }
    if (Math.min(...cur) > limit) return limit + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}
const typoLimit = (a, b) => { const n = Math.min(a.length, b.length); return n >= 9 ? 2 : n >= 5 ? 1 : 0; };
function typoDistance(a, ka, b, kb) {
  let best = null;
  for (const [x, y] of [[a, b], [ka, kb]]) {
    const lim = typoLimit(x, y);
    if (lim) { const d = distance(x, y, lim); if (d <= lim && (best === null || d < best)) best = d; }
  }
  return best;
}
class FoodNames {
  constructor(names, aliases = {}) {
    const seen = new Set();
    this.names = [];
    for (const n of names) { const k = norm(n); if (k && !seen.has(k)) { seen.add(k); this.names.push(String(n).trim()); } }
    this.aliases = Object.fromEntries(Object.entries(aliases).map(([k, v]) => [norm(k), v]));
    this.keys = this.names.map((n) => [n, norm(n), foodKey(n)]);
  }
  /** -> [kendt navn, 'exact'|'alias'|'variant'|'typo'] eller null for en ny vare */
  match(name) {
    const n = norm(name);
    if (!n) return null;
    for (const [known, k] of this.keys) if (k === n) return [known, 'exact'];
    if (this.aliases[n]) return [this.aliases[n], 'alias'];
    const key = foodKey(n);
    for (const [known, , fk] of this.keys) if (fk === key) return [known, 'variant'];
    let best = null;
    for (const [known, k, fk] of this.keys) {
      const d = typoDistance(n, key, k, fk);
      if (d !== null && (!best || d < best[0])) best = [d, known];
    }
    return best ? [best[1], 'typo'] : null;
  }
}
function duplicateGroups(names) {
  const byKey = new Map();
  for (const n of names) {
    const k = norm(n);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    const v = byKey.get(k);
    if (!v.includes(String(n).trim())) v.push(String(n).trim());
  }
  const uniq = [...byKey.keys()];
  const keys = uniq.map((k) => [k, foodKey(k)]);
  const parent = uniq.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const [a, ka] = keys[i]; const [b, kb] = keys[j];
      if (ka === kb || typoDistance(a, ka, b, kb) !== null) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  uniq.forEach((k, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(...byKey.get(k)); });
  return [...groups.values()].filter((g) => g.length > 1);
}

// ======================================================================
//  Små hjælpere
// ======================================================================

/** Lav et DOM-element: h('div', {class: 'x', onclick: fn}, 'tekst', barn, [flere]) */
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

// Datoer er altid lokale kalenderdage ("2026-11-16"), aldrig UTC.
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const mondayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const daysBetween = (a, b) => Math.round((b - a) / 864e5);
const dayName = (d) => DAYS[(d.getDay() + 6) % 7];
const daDate = (d) => `${d.getDate()}. ${MONTHS[d.getMonth()]}`;
const daDay = (d) => `${dayName(d)} ${daDate(d)}`;
const daShortDay = (d) => `${dayName(d).slice(0, 3)} ${d.getDate()}/${d.getMonth() + 1}`;
function daysText(n) {
  if (n < -1) return `udløb for ${-n} dage siden`;
  return { '-1': 'udløb i går', 0: 'i dag', 1: 'i morgen' }[n] ?? `om ${n} dage`;
}
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
const byName = (a, b) => a.name.localeCompare(b.name, 'da', { sensitivity: 'base' });

let toastTimer;
function toast(msg, { error = false, action = null } = {}) {
  const t = $('#toast');
  t.replaceChildren(h('span', {}, msg), ...(action ? [h('button', { class: 'toast-action', type: 'button',
    onclick: () => { t.className = ''; action.fn(); } }, action.label)] : []));
  t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, action ? 7000 : error ? 5000 : 2600);
}
const errMsg = (e) => (e && (e.message || e.error_description)) || String(e);

/** Hvornår varen skal bruges: "bedst før", eller tidligere hvis den er åbnet. */
function effExpiry(it) {
  let e = it.expiry_date ? fromIso(it.expiry_date) : null;
  if (it.opened_on && it.open_days != null) {
    const o = addDays(fromIso(it.opened_on), Number(it.open_days));
    e = e && e < o ? e : o;
  }
  return e;
}
const inStock = (it) => it.quantity == null || Number(it.quantity) > 0;
function flag(it) {
  const e = effExpiry(it);
  if (e && inStock(it)) {
    const n = daysBetween(today(), e);
    if (n < 0) return 'red';
    if (n <= 3) return 'orange';
  }
  if (it.min_quantity != null && Number(it.quantity || 0) < Number(it.min_quantity)) return 'yellow';
  return null;
}

// ======================================================================
//  Tilstand, offline-kopi og kø af ændringer
// ======================================================================

const TABLES = ['inventory_items', 'shopping_items', 'recipes', 'recipe_ingredients', 'meal_plan',
  'household_members', 'meal_absences', 'food_memory', 'food_aliases'];
const KEY = { inventory_items: 'inventory', shopping_items: 'shopping', recipes: 'recipes',
  recipe_ingredients: 'ingredients', meal_plan: 'meals', meal_ingredients: 'mealIngredients',
  household_members: 'members', meal_absences: 'absences', food_memory: 'memory', food_aliases: 'aliases' };
const S = {
  inventory: [], shopping: [], recipes: [], ingredients: [], meals: [], mealIngredients: [], members: [],
  absences: [], memory: [], aliases: [], suggestions: null,
  week: mondayOf(new Date()),
  tab: localStorage.getItem('kitchen.tab') || 'shopping',
  user: null, offline: false,
};
let sb = null;
let queue = JSON.parse(localStorage.getItem('kitchen.queue') || '[]');
let recent = [];
const declined = new Set(JSON.parse(localStorage.getItem('kitchen.declined') || '[]'));
const saveDeclined = () => localStorage.setItem('kitchen.declined', JSON.stringify([...declined]));

function saveCache() {
  try {
    const c = { week: iso(S.week) };
    for (const k of Object.values(KEY)) c[k] = S[k];
    localStorage.setItem('kitchen.cache', JSON.stringify(c));
  } catch { /* fuld eller slået fra: ok */ }
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem('kitchen.cache') || 'null');
    if (!c) return false;
    const sameWeek = iso(S.week) === c.week;
    for (const k of Object.values(KEY)) {
      if (['meals', 'absences', 'mealIngredients'].includes(k) && !sameWeek) continue;
      if (Array.isArray(c[k])) S[k] = c[k];
    }
    return true;
  } catch { return false; }
}
const saveQueue = () => localStorage.setItem('kitchen.queue', JSON.stringify(queue));

const DEFAULTS = {
  inventory_items: { unit: '', location: 'Spisekammer', category: '', notes: '', quantity: null, min_quantity: null,
    expiry_date: null, opened_on: null, open_days: null },
  shopping_items: { unit: '', category: '', checked: false, source: 'manual', quantity: null },
  recipes: { servings: 4, instructions: '', notes: '', tags: '' },
  recipe_ingredients: { unit: '', position: 0, quantity: null },
  meal_plan: { meal: 'Dinner', title: '', servings: null, cooked: false, notes: '', recipe_id: null, custom_ingredients: false },
  meal_ingredients: { unit: '', position: 0, quantity: null },
  household_members: { color: PALETTE[0], user_id: null, position: 0 },
  meal_absences: {}, food_memory: {}, food_aliases: {},
};
const defaults = (table) => ({ created_at: new Date().toISOString(), ...DEFAULTS[table] });
const matches = (row, match) => Object.entries(match).every(([k, v]) => (row[k] ?? '') === v);

function applyOp(op) {
  const k = KEY[op.table];
  if (op.type === 'insert') {
    if (!S[k].some((r) => r.id === op.row.id)) S[k].push({ ...defaults(op.table), ...op.row });
  } else if (op.type === 'update') {
    for (const r of S[k]) if (op.id ? r.id === op.id : matches(r, op.match)) Object.assign(r, op.values);
  } else if (op.type === 'delete') {
    S[k] = S[k].filter((r) => (op.id ? r.id !== op.id : !matches(r, op.match)));
    if (op.table === 'recipes') S.ingredients = S.ingredients.filter((i) => i.recipe_id !== op.id);
    if (op.table === 'meal_plan') S.mealIngredients = S.mealIngredients.filter((i) => i.meal_id !== op.id);
  }
  foodsCache = null;
}
const applyQueue = () => queue.forEach(applyOp);

/** Ændringer: vises med det samme, sendes nu eller så snart der er forbindelse igen. */
function mutate(...ops) {
  for (const op of ops.flat()) { applyOp(op); queue.push(op); }
  saveQueue();
  saveCache();
  refreshView();
  flush();
}

const isNetworkError = (res) => res.status === 0 || /fetch|network|load failed|offline/i.test(res.error?.message || '');
const OFFLINE_MSG = 'Du er offline – prøv igen, når der er forbindelse.';

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
        if (!(op.type === 'insert' && res.error.code === '23505')) toast(`Kunne ikke gemme: ${errMsg(res.error)}`, { error: true });
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
  b.textContent = S.offline ? (queue.length ? `Offline · ${queue.length} venter` : 'Offline')
    : queue.length ? `Gemmer ${queue.length}…` : 'Synkroniseret';
}

async function loadTable(t) {
  let q;
  if (t === 'meal_ingredients') {
    const ids = S.meals.map((m) => m.id);
    if (!ids.length) { S.mealIngredients = []; return; }
    q = sb.from(t).select('*').in('meal_id', ids).order('position');
  } else {
    q = sb.from(t).select('*');
    if (t === 'meal_plan' || t === 'meal_absences') q = q.gte('plan_date', iso(S.week)).lte('plan_date', iso(addDays(S.week, 6)));
    if (t === 'food_memory') q = q.order('key');
    else if (t === 'food_aliases') q = q.order('alias');
    else q = q.order(['recipe_ingredients', 'household_members'].includes(t) ? 'position' : 'created_at');
  }
  const { data, error, status } = await q;
  if (error) { if (isNetworkError({ error, status })) setOffline(true); throw error; }
  S[KEY[t]] = data;
}

async function reload(tables = TABLES) {
  await flush();
  const started = Date.now();
  try {
    await Promise.all(tables.filter((t) => t !== 'meal_ingredients').map(loadTable));
    if (tables.includes('meal_plan') || tables.includes('meal_ingredients')) await loadTable('meal_ingredients');
    setOffline(false);
  } catch (e) {
    if (!S.offline) toast(`Kunne ikke hente: ${errMsg(e)}`, { error: true });
  }
  for (const r of recent) if (r.t >= started) applyOp(r.op);
  applyQueue();
  foodsCache = null;
  saveCache();
  refreshView();
  updateDatalists();
  if (tables.includes('inventory_items') || tables.includes('recipe_ingredients')) loadSuggestions();
  if (!S.offline) maybeAskWhoAmI();
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
  if (queue.length) throw new Error(OFFLINE_MSG);
  const { data, error } = await sb.rpc(name, params);
  if (error) throw new Error(isNetworkError({ error }) ? OFFLINE_MSG : errMsg(error));
  if (reloadTables) await reload(reloadTables);
  return data;
}

let suggestTimer;
function loadSuggestions() {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(async () => {
    if (!sb || !S.user) return;
    const { data, error } = await sb.rpc('suggest_recipes', { p_days: 7 });
    if (!error) { S.suggestions = data || []; if (S.tab === 'soon') refreshView(); }
  }, 500);
}

// ======================================================================
//  Opslag brugt flere steder
// ======================================================================

const recipeById = (id) => S.recipes.find((r) => r.id === id);
const memoryFor = (name) => S.memory.find((m) => m.key === norm(name));
function locations() {
  const l = [...LOCATIONS];
  for (const i of S.inventory) if (i.location && !l.includes(i.location)) l.push(i.location);
  return l;
}
function categories() {
  return [...new Set([...S.inventory, ...S.shopping, ...S.memory].map((i) => i.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'da'));
}
const foodNameList = () => [...S.inventory.map((i) => i.name), ...S.memory.map((m) => m.name),
  ...S.ingredients.map((i) => i.name), ...S.mealIngredients.map((i) => i.name), ...S.shopping.map((i) => i.name)];
let foodsCache = null;
function foods() {
  if (!foodsCache) foodsCache = new FoodNames(foodNameList(), Object.fromEntries(S.aliases.map((a) => [a.alias, a.name])));
  return foodsCache;
}
function updateDatalists() {
  const names = [...new Set(foodNameList().map((n) => n.trim()))].sort((a, b) => a.localeCompare(b, 'da'));
  $('#dl-names').replaceChildren(...names.map((v) => h('option', { value: v })));
}
const members = () => [...S.members].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
const isMe = (p) => !!p.user_id && p.user_id === S.user?.id;
const isAway = (mid, ds, meal) => S.absences.some((a) => a.member_id === mid && a.plan_date === ds && a.meal === meal);
const dot = (p, away = false, big = false) => h('span', { class: `dot${away ? ' away' : ''}${big ? ' big' : ''}`, style: `--c:${safeColor(p.color)}` });

function setAway(p, ds, meals, away) {
  const ops = [];
  for (const meal of meals) {
    const row = S.absences.find((a) => a.member_id === p.id && a.plan_date === ds && a.meal === meal);
    if (away && !row) ops.push({ type: 'insert', table: 'meal_absences', row: { id: uuid(), member_id: p.id, plan_date: ds, meal } });
    if (!away && row) ops.push({ type: 'delete', table: 'meal_absences', id: row.id });
  }
  if (ops.length) mutate(ops);
}

function mealLabel(m) {
  let name = recipeById(m.recipe_id)?.name || m.title || '?';
  if (m.recipe_id && m.title) name += ` (${m.title})`;
  return name;
}
/** Skala fra opskrift til dette måltid, og opskriftens antal personer. */
function mealFactor(m) {
  const r = recipeById(m.recipe_id);
  if (!r) return [1, null];
  return [Number(m.servings || r.servings) / Number(r.servings), Number(r.servings)];
}
/** Ingredienserne til et planlagt måltid (engangsændringer hvis der er nogen), skaleret til måltidet. */
function mealIngredients(m) {
  const [f] = mealFactor(m);
  const list = m.custom_ingredients
    ? S.mealIngredients.filter((i) => i.meal_id === m.id)
    : S.ingredients.filter((i) => i.recipe_id === m.recipe_id);
  return [...list].sort((a, b) => a.position - b.position)
    .map((i) => ({ ...i, quantity: i.quantity == null ? null : Number(i.quantity) * f }));
}

// ======================================================================
//  Ark (modal) og formular-hjælpere
// ======================================================================

let sheetEl = null;
function openSheet(title, body, actions = [], { full = false } = {}) {
  closeSheet();
  const backdrop = h('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) closeSheet(); } },
    h('div', { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-label': title },
      h('div', { class: 'sheet-head' }, h('h2', {}, title),
        h('button', { class: 'icon', type: 'button', 'aria-label': 'Luk', onclick: closeSheet }, '✕')),
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
async function attempt(fn) {
  try { return await fn(); } catch (e) { toast(errMsg(e), { error: true }); return undefined; }
}

/** Rullemenu der altid viser alle muligheder, plus "Ny…" til at skrive en ny. */
function combo(options, value, { blank = null, newLabel = '＋ Ny…', placeholder = '', labels = {} } = {}) {
  const opts = [...new Set(options.filter(Boolean))];
  if (value && !opts.includes(value)) opts.push(value);
  const NEW = '__new__';
  const sel = h('select', { class: 'input grow', value: value || (blank !== null ? '' : opts[0] || '') },
    blank !== null ? h('option', { value: '' }, blank) : null,
    opts.map((o) => h('option', { value: o }, labels[o] || o)),
    h('option', { value: NEW }, newLabel));
  const text = input({ placeholder, autocomplete: 'off', style: 'display:none' });
  sel.addEventListener('change', () => {
    const isNew = sel.value === NEW;
    text.style.display = isNew ? '' : 'none';
    if (isNew) { text.value = ''; text.focus(); }
  });
  return {
    el: h('div', { class: 'combo' }, sel, text),
    get value() { return sel.value === NEW ? text.value.trim() : sel.value; },
    set value(v) {
      if (v && ![...sel.options].some((o) => o.value === v)) sel.insertBefore(h('option', { value: v }, labels[v] || v), sel.lastChild);
      sel.value = v || ''; text.style.display = 'none';
    },
  };
}
const unitCombo = (value) => combo(UNITS.filter(Boolean), canonUnit(value), { blank: '— ingen —', placeholder: 'fx portion' });

/** Retter et navn til en vare appen kender ('tomat' -> 'Tomater'), med "Fortryd". */
function autocorrect(inputEl, noteEl) {
  const t = inputEl.value.trim();
  if (t && t === inputEl.dataset.corrected) return t;      // already corrected: keep the note
  noteEl.replaceChildren();
  delete inputEl.dataset.corrected;
  if (!t || declined.has(norm(t))) return t;
  const m = foods().match(t);
  if (!m || m[0] === t) return t;
  inputEl.value = m[0];
  inputEl.dataset.corrected = m[0];
  if (m[1] !== 'exact') {
    noteEl.replaceChildren(`Rettet fra “${t}” – samme vare som du har i forvejen. `,
      h('button', { class: 'link', type: 'button', onclick: () => {
        declined.add(norm(t)); saveDeclined();
        inputEl.value = t; noteEl.replaceChildren();
        inputEl.dispatchEvent(new Event('undo'));
      } }, 'Fortryd'));
  }
  return m[0];
}

/** Ingrediens-editor: én række pr. ingrediens med Mængde / Enhed / Navn. Skriver du
 *  "2 dåser tomater" i navnet, udfyldes mængde og enhed – og du kan rette dem bagefter. */
function ingredientEditor(ings = []) {
  const rows = h('div', { class: 'ing-rows' });
  const all = [];
  const addRow = (ing = {}, focus = false) => {
    const qty = input({ value: fmtQty(ing.quantity), inputmode: 'decimal', placeholder: 'Mængde', class: 'input ing-qty' });
    const unit = unitCombo(ing.unit || '');
    const name = input({ value: ing.name || '', placeholder: 'Ingrediens – fx “2 dåser tomater”', list: 'dl-names',
      autocomplete: 'off', class: 'input ing-name' });
    const note = h('div', { class: 'ing-note' });
    name.addEventListener('change', () => {
      const t = name.value.trim();
      if (!qty.value.trim() && !unit.value) {
        const p = parseQuickAdd(t);
        if (p.quantity != null) { qty.value = fmtQty(p.quantity); unit.value = p.unit; name.value = p.name; }
      }
      autocorrect(name, note);
    });
    const row = h('div', { class: 'ing-row' }, name,
      h('button', { class: 'icon ing-x', type: 'button', 'aria-label': 'Fjern', onclick: () => {
        row.remove(); all.splice(all.indexOf(entry), 1);
      } }, '✕'), qty, unit.el, note);
    const entry = { qty, unit, name };
    all.push(entry);
    rows.append(row);
    if (focus) setTimeout(() => name.focus(), 30);
  };
  ings.forEach((i) => addRow(i));
  const paste = h('textarea', { class: 'input', rows: 5, style: 'display:none',
    placeholder: 'Én ingrediens pr. linje, fx\n300 g hvedemel\n2 dåser hakkede tomater\n½ tsk salt' });
  const pasteBtn = btn('Tilføj linjerne', () => {
    const names = foods();
    for (const line of paste.value.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const p = parseQuickAdd(line);
      if (!declined.has(norm(p.name))) { const m = names.match(p.name); if (m) p.name = m[0]; }
      addRow(p);
    }
    paste.value = ''; paste.style.display = 'none'; pasteBtn.style.display = 'none';
  }, 'small');
  pasteBtn.style.display = 'none';
  return {
    el: h('div', { class: 'ing-editor' }, rows,
      h('div', { class: 'row wrap', style: 'margin-top:8px' },
        btn('＋ Ingrediens', () => addRow({}, true), 'small'),
        btn('Indsæt liste…', () => { paste.style.display = ''; pasteBtn.style.display = ''; paste.focus(); }, 'small')),
      paste, pasteBtn),
    get value() {
      return all.map((e) => ({ name: e.name.value.trim(), quantity: parseNum(e.qty.value), unit: canonUnit(e.unit.value) }))
        .filter((i) => i.name);
    },
  };
}

// ======================================================================
//  Skærme
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
  if (tab === 'soon') loadSuggestions();
}
function refreshView() {
  if (mounted && S.user) mounted.update();
  const n = S.inventory.filter((i) => { const e = effExpiry(i); return e && inStock(i) && daysBetween(today(), e) <= 3; }).length;
  const badge = $('#tabs button[data-tab=soon] .badge');
  if (badge) { badge.textContent = n || ''; badge.style.display = n ? '' : 'none'; }
}

// ---------------------------------------------------------------- Indkøbsliste

views.shopping = {
  title: 'Indkøbsliste',
  mount(root) {
    const box = input({ placeholder: 'Tilføj… “2 dåser tomater”, “10 æg”, “mælk”', list: 'dl-names',
      enterkeyhint: 'done', autocomplete: 'off', class: 'input grow' });
    const add = (e) => {
      e.preventDefault();
      const text = box.value.trim();
      if (!text) return;
      const v = parseQuickAdd(text);
      const typed = v.name;
      const m = declined.has(norm(typed)) ? null : foods().match(typed);
      if (m) v.name = m[0];
      const known = S.inventory.find((i) => norm(i.name) === norm(v.name) && i.category);
      const id = uuid();
      mutate({ type: 'insert', table: 'shopping_items',
        row: { id, ...v, category: known?.category || memoryFor(v.name)?.category || '', source: 'manual' } });
      box.value = '';
      if (m && m[1] !== 'exact') {
        toast(`“${typed}” er rettet til “${m[0]}”`, { action: { label: 'Fortryd', fn: () => {
          declined.add(norm(typed)); saveDeclined();
          mutate({ type: 'update', table: 'shopping_items', id, values: { name: typed } });
        } } });
      }
    };
    root.append(
      h('form', { class: 'toolbar', onsubmit: add }, h('div', { class: 'row' }, box, h('button', { class: 'btn primary', type: 'submit' }, 'Tilføj'))),
      this.listEl = h('div'),
      h('div', { class: 'actions' },
        btn('Fra madplanen…', () => generateSheet()),
        btn('Købt → køkken', () => purchaseSheet()),
        btn('Fjern afkrydsede', () => {
          const done = S.shopping.filter((i) => i.checked);
          if (done.length && confirm(`Fjern ${done.length} afkrydsede vare(r) uden at lægge dem i køkkenet?`))
            mutate(done.map((i) => ({ type: 'delete', table: 'shopping_items', id: i.id })));
        })));
  },
  update() {
    const todo = S.shopping.filter((i) => !i.checked);
    const done = S.shopping.filter((i) => i.checked).sort(byName);
    if (!S.shopping.length) {
      this.listEl.replaceChildren(h('div', { class: 'empty' }, 'Listen er tom.', h('br'),
        h('span', { class: 'small' }, 'Skriv ovenfor, eller fyld den fra madplanen.')));
      return;
    }
    const groups = {};
    for (const i of todo) (groups[i.category || 'Andet'] ||= []).push(i);
    const names = Object.keys(groups).sort((a, b) => (a === 'Andet') - (b === 'Andet') || a.localeCompare(b, 'da'));
    this.listEl.replaceChildren(
      ...names.map((c) => this.group(c, groups[c].sort(byName))),
      ...(done.length ? [this.group(`I kurven (${done.length})`, done)] : []));
  },
  group(title, items) {
    return h('section', { class: 'group' }, h('h3', {}, title), h('div', { class: 'list' }, items.map((i) =>
      h('div', { class: 'item' + (i.checked ? ' done' : ''),
        onclick: () => mutate({ type: 'update', table: 'shopping_items', id: i.id, values: { checked: !i.checked } }) },
      h('span', { class: 'tick' }, i.checked ? '✓' : ''),
      h('div', { class: 'main' }, h('div', { class: 'name' }, i.name,
        SOURCE_DA[i.source] ? h('span', { class: 'tag' }, SOURCE_DA[i.source]) : null)),
      h('span', { class: 'qty' }, fmtAmount(i.quantity, i.unit)),
      h('button', { class: 'icon', type: 'button', 'aria-label': 'Ret',
        onclick: (e) => { e.stopPropagation(); itemSheet('shopping', i); } }, '⋯')))));
  },
};

// ---------------------------------------------------------------- Køkken

function itemSub(i) {
  const e = effExpiry(i);
  return [i.category,
    e ? `holdbar til ${daDate(e)} (${daysText(daysBetween(today(), e))})` : null,
    i.opened_on ? `åbnet ${daDate(fromIso(i.opened_on))}` : null,
    i.min_quantity != null ? `hold mindst ${fmtAmount(i.min_quantity, i.unit)}` : null].filter(Boolean).join(' · ');
}

views.kitchen = {
  title: 'Køkken',
  filter: 'Alle',
  mount(root) {
    this.search = input({ placeholder: 'Søg…', type: 'search', autocomplete: 'off', oninput: () => this.update() });
    root.append(h('div', { class: 'toolbar' }, this.search, this.chipsEl = h('div', { class: 'chips' })),
      this.listEl = h('div'),
      h('button', { class: 'fab', type: 'button', 'aria-label': 'Tilføj vare',
        onclick: () => itemSheet('kitchen', { location: locations().includes(this.filter) ? this.filter : 'Spisekammer' }) }, '+'));
  },
  update() {
    const flagged = S.inventory.filter(flag).length;
    const check = `⚠ Tjek (${flagged})`;
    const chipNames = ['Alle', ...locations(), ...(flagged ? [check] : [])];
    if (!chipNames.includes(this.filter) && !this.filter.startsWith('⚠')) this.filter = 'Alle';
    this.chipsEl.replaceChildren(...chipNames.map((c) => h('button', {
      class: 'chip' + ((c === this.filter || (c.startsWith('⚠') && this.filter.startsWith('⚠'))) ? ' on' : ''),
      type: 'button', onclick: () => { this.filter = c; this.update(); } }, c)));
    const q = this.search.value.trim().toLowerCase();
    const rows = S.inventory.filter((i) => (!q || i.name.toLowerCase().includes(q) || (i.category || '').toLowerCase().includes(q))
      && (this.filter === 'Alle' || (this.filter.startsWith('⚠') ? flag(i) : i.location === this.filter))).sort(byName);
    if (!rows.length) {
      this.listEl.replaceChildren(h('div', { class: 'empty' }, S.inventory.length ? 'Intet passer.' : 'Køkkenet er tomt – tryk + for at tilføje.'));
      return;
    }
    const groups = {};
    for (const i of rows) (groups[this.filter === 'Alle' ? (i.location || 'Andet') : this.filter.replace(/ \(\d+\)$/, '')] ||= []).push(i);
    this.listEl.replaceChildren(...Object.entries(groups).map(([loc, items]) => h('section', { class: 'group' },
      h('h3', {}, loc), h('div', { class: 'list' }, items.map((i) => kitchenRow(i))))));
  },
};

function kitchenRow(i) {
  const f = flag(i);
  const step = (d) => (e) => {
    e.stopPropagation();
    mutate({ type: 'update', table: 'inventory_items', id: i.id, values: { quantity: Math.max(0, Number(i.quantity || 0) + d) } });
  };
  const sub = itemSub(i);
  return h('div', { class: 'item' + (f ? ` flag-${f}` : ''), onclick: () => itemSheet('kitchen', i) },
    h('div', { class: 'main' }, h('div', { class: 'name' }, i.name, i.opened_on ? h('span', { class: 'tag' }, 'åbnet') : null),
      sub ? h('div', { class: 'sub' }, sub) : null),
    h('div', { class: 'stepper' },
      h('button', { type: 'button', 'aria-label': 'En mindre', onclick: step(-1) }, '−'),
      h('span', { class: 'qty' }, fmtAmount(i.quantity, i.unit) || '–'),
      h('button', { type: 'button', 'aria-label': 'En mere', onclick: step(1) }, '+')));
}

// ---------------------------------------------------------------- Brug snart

views.soon = {
  title: 'Brug snart',
  mount(root) {
    root.append(h('p', { class: 'muted small intro' }, 'Mad der udløber inden for en uge – også åbnede varer, der kun holder et par dage – og opskrifter der bruger den.'),
      this.listEl = h('div'), h('h2', { class: 'section-title' }, 'Opskrifter der bruger dem'), this.recEl = h('div'));
  },
  update() {
    const t = today();
    const soon = S.inventory.map((i) => [i, effExpiry(i)]).filter(([i, e]) => e && inStock(i) && daysBetween(t, e) <= 7)
      .map(([i, e]) => [i, daysBetween(t, e)]).sort((a, b) => a[1] - b[1] || byName(a[0], b[0]));
    const groups = [['Udløbet', (n) => n < 0], ['I dag', (n) => n === 0], ['I morgen', (n) => n === 1],
      ['Inden for 3 dage', (n) => n <= 3], ['Inden for en uge', (n) => n <= 7]];
    let rest = soon;
    const sections = [];
    for (const [title, test] of groups) {
      const rows = rest.filter(([, n]) => test(n));
      rest = rest.filter(([, n]) => !test(n));
      if (rows.length) sections.push(h('section', { class: 'group' }, h('h3', {}, `${title} (${rows.length})`),
        h('div', { class: 'list' }, rows.map(([i]) => kitchenRow(i)))));
    }
    this.listEl.replaceChildren(...(sections.length ? sections : [h('div', { class: 'empty' }, 'Intet udløber den næste uge. 🎉')]));
    if (S.suggestions === null) { this.recEl.replaceChildren(h('p', { class: 'muted' }, S.offline ? 'Forslag kræver forbindelse.' : 'Henter forslag…')); return; }
    if (!S.suggestions.length) { this.recEl.replaceChildren(h('p', { class: 'muted' }, 'Ingen af dine opskrifter bruger de varer, der snart udløber.')); return; }
    this.recEl.replaceChildren(...S.suggestions.map((s) => {
      const r = recipeById(s.recipe_id);
      return h('div', { class: 'card' },
        h('div', { class: 'card-title' }, s.recipe_name),
        h('div', { class: 'small' }, 'Bruger: ', ...(s.uses || []).flatMap((u, k) => [k ? ', ' : '', h('strong', { class: 'use' }, u)])),
        h('div', { class: 'small muted' }, `Du har ${s.have_count} af ${s.total_count} ingredienser`),
        h('div', { class: 'row', style: 'margin-top:10px' },
          r ? btn('Vis opskrift', () => recipeSheet(r), 'small') : null,
          btn('Planlæg', () => mealSheet({ recipe_id: s.recipe_id, plan_date: iso(today()) }), 'small primary')));
    }));
  },
};

// ---------------------------------------------------------------- Madplan

views.plan = {
  title: 'Madplan',
  mode: localStorage.getItem('kitchen.planView') || 'list',
  mount(root) {
    const go = (days) => async () => {
      S.week = days === 0 ? mondayOf(new Date()) : addDays(S.week, days);
      S.meals = []; S.absences = []; S.mealIngredients = [];
      this.update();
      await attempt(() => reload(['meal_plan', 'meal_absences']));
    };
    const seg = (mode, label) => h('button', { type: 'button', class: 'seg' + (this.mode === mode ? ' on' : ''),
      onclick: () => { this.mode = mode; localStorage.setItem('kitchen.planView', mode); show('plan'); } }, label);
    root.append(
      h('div', { class: 'toolbar' },
        h('div', { class: 'weeknav' },
          h('button', { class: 'btn small', type: 'button', onclick: go(-7), 'aria-label': 'Forrige uge' }, '◀'),
          this.label = h('button', { class: 'label btn small', type: 'button', onclick: go(0) }),
          h('button', { class: 'btn small', type: 'button', onclick: go(7), 'aria-label': 'Næste uge' }, '▶')),
        h('div', { class: 'row' },
          h('div', { class: 'segmented' }, seg('list', '☰ Liste'), seg('calendar', '▦ Kalender')),
          btn('🛒 Indkøb for ugen', () => generateSheet(S.week, addDays(S.week, 6)), 'small grow')),
        this.legendEl = h('button', { class: 'legend', type: 'button', onclick: () => householdSheet() })),
      this.listEl = h('div'));
    if (!this.onResize) {
      let t;
      this.onResize = () => { clearTimeout(t); t = setTimeout(() => { if (mounted === this && this.mode === 'calendar') this.update(); }, 200); };
      window.addEventListener('resize', this.onResize);
    }
  },
  update() {
    const end = addDays(S.week, 6);
    this.label.textContent = `Uge ${isoWeek(S.week)} · ${daDate(S.week)} – ${daDate(end)}`;
    this.legendEl.replaceChildren(...(S.members.length
      ? members().map((p) => h('span', { class: 'who' }, dot(p), p.name))
      : [h('span', {}, 'Tilføj husstanden for at se, hvem der er hjemme →')]));
    if (this.mode === 'calendar') this.calendar(); else this.list();
  },
  list() {
    const t = iso(today());
    const days = [];
    for (let n = 0; n < 7; n++) {
      const d = addDays(S.week, n);
      const ds = iso(d);
      const dayMeals = S.meals.filter((m) => m.plan_date === ds);
      const slots = MEALS.filter((slot) => slot !== 'Snack' || dayMeals.some((m) => m.meal === 'Snack'));
      days.push(h('section', { class: 'day' + (ds === t ? ' today' : '') },
        h('div', { class: 'day-head' }, h('span', { class: 'd' }, daDay(d), ds === t ? h('span', { class: 'tag' }, 'i dag') : null),
          h('button', { class: 'btn small', type: 'button', onclick: () => mealSheet({ plan_date: ds }) }, '+ Tilføj')),
        h('div', { class: 'list' }, slots.map((slot) => {
          const meals = dayMeals.filter((m) => m.meal === slot).sort((a, b) => a.created_at.localeCompare(b.created_at));
          return h('div', { class: 'slot' },
            h('span', { class: 'meal-tag' }, MEAL_DA[slot]),
            h('div', { class: 'main' }, meals.length
              ? meals.map((m) => h('button', { class: 'meal-line' + (m.cooked ? ' cooked' : ''), type: 'button', onclick: () => mealActions(m) },
                (m.cooked ? '✓ ' : '') + mealLabel(m), m.custom_ingredients ? ' ✎' : '',
                m.servings ? h('span', { class: 'sub' }, ` · ${fmtQty(m.servings)} pers.`) : null))
              : h('button', { class: 'meal-line empty', type: 'button', onclick: () => mealSheet({ plan_date: ds, meal: slot }) }, '+ planlæg')),
            this.dots(ds, slot));
        }))));
    }
    this.listEl.replaceChildren(...days);
  },
  dots(ds, slot) {
    return S.members.length ? h('button', { class: 'dots', type: 'button', 'aria-label': `Hvem er hjemme til ${MEAL_DA[slot]}`,
      onclick: (e) => { e.stopPropagation(); attendanceSheet(ds, slot); } }, members().map((p) => dot(p, isAway(p.id, ds, slot)))) : null;
  },
  calendar() {
    const wide = window.innerWidth >= 700;
    const t = iso(today());
    const days = Array.from({ length: 7 }, (_, n) => addDays(S.week, n));
    const slots = MEALS.filter((s) => s !== 'Snack' || wide || S.meals.some((m) => m.meal === 'Snack'));
    const cell = (d, slot) => {
      const ds = iso(d);
      const meals = S.meals.filter((m) => m.plan_date === ds && m.meal === slot);
      return h('div', { class: 'cal-cell' + (ds === t ? ' today' : '') + (meals.length && meals.every((m) => m.cooked) ? ' cooked' : ''),
        role: 'button', tabindex: 0, onclick: () => (meals.length === 1 ? mealActions(meals[0])
          : meals.length ? cellSheet(ds, slot, meals) : mealSheet({ plan_date: ds, meal: slot })) },
      h('div', { class: 'cal-meals' }, meals.map((m) => h('div', { class: 'cal-meal' }, (m.cooked ? '✓ ' : '') + mealLabel(m) + (m.custom_ingredients ? ' ✎' : '')))),
      this.dots(ds, slot));
    };
    const corner = h('div', { class: 'cal-head' });
    let grid;
    if (wide) {
      grid = h('div', { class: 'cal wide', style: `grid-template-columns: 90px repeat(7, 1fr)` },
        corner, days.map((d) => h('div', { class: 'cal-head' + (iso(d) === t ? ' today' : '') }, `${dayName(d).slice(0, 3)} ${daDate(d)}`)),
        slots.map((slot) => [h('div', { class: 'cal-side' }, MEAL_DA[slot]), days.map((d) => cell(d, slot))]));
    } else {
      grid = h('div', { class: 'cal narrow', style: `grid-template-columns: 52px repeat(${slots.length}, 1fr)` },
        corner, slots.map((slot) => h('div', { class: 'cal-head' }, MEAL_DA[slot] === 'Mellemmåltid' ? 'Mellem' : MEAL_DA[slot])),
        days.map((d) => [h('div', { class: 'cal-side' + (iso(d) === t ? ' today' : '') }, h('strong', {}, dayName(d).slice(0, 3)), h('br'), `${d.getDate()}/${d.getMonth() + 1}`),
          slots.map((slot) => cell(d, slot))]));
    }
    this.listEl.replaceChildren(grid, h('p', { class: 'muted small', style: 'margin-top:10px' },
      'Tryk på et felt for at planlægge eller se måltidet. Tryk på prikkerne for at vælge, hvem der er hjemme. ✎ = tilpasset.'));
  },
};

// ---------------------------------------------------------------- Opskrifter

views.recipes = {
  title: 'Opskrifter',
  mount(root) {
    this.search = input({ placeholder: 'Søg i opskrifter…', type: 'search', autocomplete: 'off', oninput: () => this.update() });
    root.append(h('div', { class: 'toolbar' }, this.search), this.listEl = h('div'),
      h('button', { class: 'fab', type: 'button', 'aria-label': 'Ny opskrift', onclick: () => recipeEditSheet() }, '+'));
  },
  update() {
    const q = this.search.value.trim().toLowerCase();
    const rows = S.recipes.filter((r) => !q || r.name.toLowerCase().includes(q) || (r.tags || '').toLowerCase().includes(q)).sort(byName);
    if (!rows.length) {
      this.listEl.replaceChildren(h('div', { class: 'empty' }, S.recipes.length ? 'Intet passer.' : 'Ingen opskrifter endnu – tryk + for at tilføje.'));
      return;
    }
    this.listEl.replaceChildren(h('div', { class: 'list' }, rows.map((r) => {
      const n = S.ingredients.filter((i) => i.recipe_id === r.id).length;
      return h('div', { class: 'item', onclick: () => recipeSheet(r) },
        h('div', { class: 'main' }, h('div', { class: 'name' }, r.name),
          h('div', { class: 'sub' }, [`til ${fmtQty(r.servings)} pers.`, `${n} ingrediens${n === 1 ? '' : 'er'}`, r.tags].filter(Boolean).join(' · '))),
        h('span', { class: 'qty' }, '›'));
    })));
  },
};

// ======================================================================
//  Ark (formularer)
// ======================================================================

function itemSheet(kind, item = {}) {
  const shopping = kind === 'shopping';
  const table = shopping ? 'shopping_items' : 'inventory_items';
  const adding = !item.id;
  const note = h('div', { class: 'ing-note' });
  const memo = h('p', { class: 'muted small memo' });
  const f = {
    name: input({ value: item.name || '', list: 'dl-names', autocomplete: 'off' }),
    quantity: input({ value: fmtQty(item.quantity), inputmode: 'decimal', placeholder: 'valgfri' }),
    unit: unitCombo(item.unit || ''),
    category: combo(categories(), item.category || '', { blank: '— ingen —', placeholder: 'fx Bageri' }),
  };
  if (!shopping) {
    Object.assign(f, {
      location: combo(locations(), item.location || 'Spisekammer', { placeholder: 'fx Vinreol' }),
      expiry_date: input({ type: 'date', value: item.expiry_date || '' }),
      open_days: input({ value: item.open_days ?? '', inputmode: 'numeric', placeholder: 'fx 4' }),
      opened_on: input({ type: 'date', value: item.opened_on || '' }),
      min_quantity: input({ value: fmtQty(item.min_quantity), inputmode: 'decimal', placeholder: 'valgfri – kommer på listen når der er mindre' }),
      notes: input({ value: item.notes || '' }),
    });
  }
  const prefill = () => {
    const mem = adding ? memoryFor(f.name.value) : null;
    if (!mem) { memo.textContent = ''; return; }
    const used = [];
    if (!f.quantity.value.trim() && mem.quantity != null) {
      f.quantity.value = fmtQty(mem.quantity); f.unit.value = mem.unit || ''; used.push(fmtAmount(mem.quantity, mem.unit));
    } else if (!f.unit.value && mem.unit) f.unit.value = mem.unit;
    if (!f.category.value && mem.category) f.category.value = mem.category;
    if (!shopping) {
      if (mem.location) { f.location.value = mem.location; used.push(mem.location.toLowerCase()); }
      if (mem.shelf_days != null && !f.expiry_date.value) {
        f.expiry_date.value = iso(addDays(today(), mem.shelf_days)); used.push(`bedst før om ${mem.shelf_days} dage`);
      }
      if (mem.open_days && !String(f.open_days.value).trim()) {
        f.open_days.value = mem.open_days; used.push(`holdbar ${mem.open_days} dage efter åbning`);
      }
      if (mem.min_quantity != null && !f.min_quantity.value.trim()) f.min_quantity.value = fmtQty(mem.min_quantity);
    }
    memo.textContent = used.length ? `Udfyldt som sidst: ${used.join(', ')}. Ret frit.` : '';
  };
  f.name.addEventListener('change', () => { autocorrect(f.name, note); prefill(); });
  f.name.addEventListener('undo', prefill);

  const body = h('div', {},
    field('Navn', f.name), note, memo,
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Mængde', f.quantity)), h('div', { class: 'grow' }, field('Enhed', f.unit.el))),
    shopping ? null : field('Placering', f.location.el),
    field('Kategori', f.category.el),
    shopping ? null : [
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Bedst før', f.expiry_date)),
        h('div', { class: 'grow' }, field('Holdbar efter åbning (dage)', f.open_days))),
      field('Åbnet den', f.opened_on), field('Hold mindst', f.min_quantity), field('Noter', f.notes)]);

  const save = () => attempt(() => {
    autocorrect(f.name, note);
    const name = f.name.value.trim();
    if (!name) throw new Error('Skriv venligst et navn.');
    const values = { name, quantity: parseNum(f.quantity.value), unit: canonUnit(f.unit.value), category: f.category.value };
    if (!shopping) {
      const od = String(f.open_days.value).trim();
      if (od && !/^\d+$/.test(od)) throw new Error('“Holdbar efter åbning” skal være et helt antal dage.');
      Object.assign(values, { location: f.location.value || 'Spisekammer', expiry_date: f.expiry_date.value || null,
        open_days: od ? Number(od) : null, opened_on: f.opened_on.value || null,
        min_quantity: parseNum(f.min_quantity.value), notes: f.notes.value.trim() });
    }
    if (item.id) mutate({ type: 'update', table, id: item.id, values });
    else mutate({ type: 'insert', table, row: { id: uuid(), ...values } });
    closeSheet();
  });

  const actions = [];
  if (item.id) {
    actions.push(btn('Slet', () => {
      if (shopping || confirm(`Slet ${item.name} fra køkkenet?`)) { mutate({ type: 'delete', table, id: item.id }); closeSheet(); }
    }, 'danger'));
    if (!shopping) {
      if (!item.opened_on) actions.push(btn('Åbn', () => openItemSheet(item)));
      actions.push(btn('På listen', () => {
        const need = item.min_quantity != null ? Math.max(Number(item.min_quantity) - Number(item.quantity || 0), 0) || null : null;
        mutate({ type: 'insert', table: 'shopping_items',
          row: { id: uuid(), name: item.name, quantity: need, unit: item.unit || '', category: item.category || '', source: 'manual' } });
        closeSheet();
        toast(`${item.name} er sat på indkøbslisten`);
      }));
    }
  }
  actions.push(btn('Gem', save, 'primary'));
  openSheet(item.id ? 'Ret vare' : shopping ? 'Tilføj til listen' : 'Tilføj til køkkenet', body, actions);
  if (adding) setTimeout(() => f.name.focus(), 60);
}

function openItemSheet(item) {
  const total = item.quantity;
  const countable = COUNTABLE.has(item.unit || '');
  const amount = input({ value: fmtQty(countable && total != null && Number(total) > 1 ? 1 : total), inputmode: 'decimal' });
  const days = input({ value: item.open_days ?? memoryFor(item.name)?.open_days ?? '', inputmode: 'numeric', placeholder: 'fx 4' });
  openSheet(`Åbn ${item.name}`, h('div', {},
    total != null ? field(`Hvor meget (af ${fmtAmount(total, item.unit)})`, amount) : null,
    field('Holdbar efter åbning (dage)', days),
    h('p', { class: 'muted small' }, 'Åbner du kun en del, bliver resten stående som uåbnet.')), [
    btn('Åbn', () => attempt(() => {
      const amt = total != null ? parseNum(amount.value) : null;
      const d = String(days.value).trim();
      if (d && !/^\d+$/.test(d)) throw new Error('Skriv et helt antal dage.');
      const od = d ? Number(d) : null;
      const opened = { opened_on: iso(today()), open_days: od };
      if (amt != null && total != null && amt > 0 && amt < Number(total)) {
        const { id, created_at, updated_at, ...rest } = item;
        mutate({ type: 'update', table: 'inventory_items', id: item.id, values: { quantity: Math.round((Number(total) - amt) * 1000) / 1000 } },
          { type: 'insert', table: 'inventory_items', row: { ...rest, id: uuid(), quantity: amt, ...opened } });
      } else {
        mutate({ type: 'update', table: 'inventory_items', id: item.id, values: opened });
      }
      closeSheet();
      toast(`${item.name} er markeret som åbnet`);
    }), 'primary')]);
}

function generateSheet(start, end) {
  if (!start) { start = mondayOf(new Date()); end = addDays(start, 6); }
  const from = input({ type: 'date', value: iso(start) });
  const to = input({ type: 'date', value: iso(end) });
  const low = h('input', { type: 'checkbox', checked: true });
  openSheet('Fra madplanen', h('div', {},
    h('p', { class: 'muted small' }, 'Tilføjer ingredienserne til planlagte (ikke lavede) måltider – minus det du har i køkkenet, og det der allerede står på listen.'),
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Fra', from)), h('div', { class: 'grow' }, field('Til', to))),
    h('label', { class: 'check' }, low, 'Tilføj også varer der er ved at slippe op')), [
    btn('Tilføj til listen', () => attempt(async () => {
      const n = await rpc('generate_shopping_list', { p_start: from.value, p_end: to.value, p_include_low_stock: low.checked }, ['shopping_items']);
      closeSheet();
      if (S.tab !== 'shopping') show('shopping');
      toast(n ? `${n} vare${n === 1 ? '' : 'r'} tilføjet` : 'Du har det hele allerede 🎉');
    }), 'primary')]);
}

function purchaseSheet() {
  const n = S.shopping.filter((i) => i.checked).length;
  if (!n) { toast('Kryds først de varer af, du har købt'); return; }
  const loc = select(locations(), 'Spisekammer');
  openSheet('Læg varerne på plads', h('div', {},
    h('p', { class: 'muted small' }, `Lægger de ${n} afkrydsede varer i køkkenet og fjerner dem fra listen. Varer appen kender, kommer samme sted hen som sidst – med “bedst før” udfyldt.`),
    field('Nye varer lægges i', loc)), [
    btn('Læg på plads', () => attempt(async () => {
      await rpc('purchase_checked', { p_location: loc.value }, ['shopping_items', 'inventory_items', 'food_memory']);
      closeSheet();
      toast(`${n} vare${n === 1 ? '' : 'r'} lagt i køkkenet`);
    }), 'primary')]);
}

function mealSheet(meal = {}) {
  const f = {
    plan_date: input({ type: 'date', value: meal.plan_date || iso(today()) }),
    meal: select(MEALS.map((m) => [m, MEAL_DA[m]]), meal.meal || 'Dinner'),
    recipe_id: select([['', '— ingen opskrift, bare en note —'], ...[...S.recipes].sort(byName).map((r) => [r.id, r.name])], meal.recipe_id || ''),
    title: input({ value: meal.title || '', placeholder: 'fx Rester, Ude at spise' }),
    servings: input({ value: fmtQty(meal.servings), inputmode: 'decimal', placeholder: 'som i opskriften' }),
    notes: input({ value: meal.notes || '' }),
  };
  openSheet(meal.id ? 'Ret måltid' : 'Planlæg måltid', h('div', {},
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Dag', f.plan_date)), h('div', { class: 'grow' }, field('Måltid', f.meal))),
    field('Opskrift', f.recipe_id), field('Note / titel', f.title), field('Personer', f.servings), field('Noter', f.notes)), [
    btn('Gem', () => attempt(() => {
      const values = { plan_date: f.plan_date.value, meal: f.meal.value, recipe_id: f.recipe_id.value || null,
        title: f.title.value.trim(), servings: parseNum(f.servings.value), notes: f.notes.value.trim() };
      if (!values.plan_date) throw new Error('Vælg en dag.');
      if (!values.recipe_id && !values.title) throw new Error('Vælg en opskrift eller skriv en note.');
      if (values.servings !== null && values.servings <= 0) throw new Error('Antal personer skal være over 0.');
      if (meal.id) mutate({ type: 'update', table: 'meal_plan', id: meal.id, values });
      else mutate({ type: 'insert', table: 'meal_plan', row: { id: uuid(), ...values } });
      closeSheet();
      const d = fromIso(values.plan_date);
      if (d < S.week || d > addDays(S.week, 6)) toast(`Planlagt til ${daDay(d)}`);
    }), 'primary')]);
}

function cellSheet(ds, slot, meals) {
  openSheet(`${MEAL_DA[slot]} · ${daDay(fromIso(ds))}`, h('div', { class: 'menu-list' },
    meals.map((m) => btn((m.cooked ? '✓ ' : '') + mealLabel(m), () => mealActions(m))),
    btn('＋ Planlæg endnu et', () => mealSheet({ plan_date: ds, meal: slot })),
    S.members.length ? btn('👪 Hvem er hjemme', () => attendanceSheet(ds, slot)) : null));
}

function mealActions(m) {
  const recipe = recipeById(m.recipe_id);
  const ings = mealIngredients(m);
  const list = h('div', { class: 'menu-list' },
    recipe ? btn('📖 Vis opskrift', () => recipeSheet(recipe)) : null,
    btn('✎ Tilpas ingredienser (kun dette måltid)', () => mealIngredientsSheet(m)),
    m.cooked
      ? btn('↩︎ Markér som ikke lavet', () => { mutate({ type: 'update', table: 'meal_plan', id: m.id, values: { cooked: false } }); closeSheet(); })
      : btn(ings.length ? '✓ Lavet – træk ingredienserne fra køkkenet' : '✓ Markér som lavet', () => attempt(async () => {
        if (ings.length) {
          await rpc('cook_meal', { p_meal_id: m.id }, ['meal_plan', 'inventory_items']);
          toast('Ingredienserne er trukket fra køkkenet');
        } else {
          mutate({ type: 'update', table: 'meal_plan', id: m.id, values: { cooked: true } });
        }
        closeSheet();
      })),
    btn('🗓 Ret dag, måltid eller personer', () => mealSheet(m)),
    S.members.length ? btn('👪 Hvem er hjemme', () => attendanceSheet(m.plan_date, m.meal)) : null,
    btn('⧉ Kopiér til næste dag', () => {
      const { id, created_at, updated_at, cooked, ...rest } = m;
      const newId = uuid();
      mutate({ type: 'insert', table: 'meal_plan', row: { ...rest, id: newId, plan_date: iso(addDays(fromIso(m.plan_date), 1)) } },
        S.mealIngredients.filter((i) => i.meal_id === m.id).map(({ id: _, ...i }) => ({ type: 'insert', table: 'meal_ingredients', row: { ...i, id: uuid(), meal_id: newId } })));
      closeSheet();
    }),
    btn('🗑 Fjern', () => { mutate({ type: 'delete', table: 'meal_plan', id: m.id }); closeSheet(); }, 'danger'));
  openSheet(`${MEAL_DA[m.meal]} · ${daDay(fromIso(m.plan_date))}`, h('div', {},
    h('p', {}, h('strong', {}, mealLabel(m)), m.custom_ingredients ? h('span', { class: 'tag' }, 'tilpasset') : null,
      m.servings ? h('span', { class: 'muted' }, ` · ${fmtQty(m.servings)} pers.`) : null),
    ings.length ? h('ul', { class: 'ing-summary' }, ings.map((i) => h('li', {}, ingredientLine(i)))) : null,
    list));
}

function mealIngredientsSheet(m) {
  const [factor, base] = mealFactor(m);
  const persons = m.servings || base;
  const editor = ingredientEditor(mealIngredients(m));
  const recipe = recipeById(m.recipe_id);
  const save = () => attempt(() => {
    const rows = editor.value.map((i, position) => ({ id: uuid(), meal_id: m.id, position, name: i.name, unit: i.unit,
      quantity: i.quantity == null ? null : Math.round((i.quantity / factor) * 10000) / 10000 }));
    mutate(S.mealIngredients.filter((i) => i.meal_id === m.id).map((i) => ({ type: 'delete', table: 'meal_ingredients', id: i.id })),
      rows.map((row) => ({ type: 'insert', table: 'meal_ingredients', row })),
      { type: 'update', table: 'meal_plan', id: m.id, values: { custom_ingredients: true } });
    closeSheet();
    toast('Ændringerne gælder kun dette måltid');
  });
  const actions = [];
  if (m.custom_ingredients && recipe) {
    actions.push(btn('Nulstil', () => {
      mutate(S.mealIngredients.filter((i) => i.meal_id === m.id).map((i) => ({ type: 'delete', table: 'meal_ingredients', id: i.id })),
        { type: 'update', table: 'meal_plan', id: m.id, values: { custom_ingredients: false } });
      closeSheet();
    }));
  }
  actions.push(btn('Gem', save, 'primary'));
  openSheet('Tilpas ingredienser', h('div', {},
    h('p', { class: 'muted small' }, `Gælder kun ${MEAL_DA[m.meal].toLowerCase()} ${daDay(fromIso(m.plan_date))}.`,
      recipe ? ` Opskriften “${recipe.name}” ændres ikke.` : '', persons ? ` Mængderne er til ${fmtQty(persons)} personer.` : ''),
    editor.el), actions, { full: true });
}

function attendanceSheet(ds, slot) {
  const body = h('div');
  const draw = () => body.replaceChildren(
    h('p', { class: 'muted small' }, 'Alle er hjemme, medmindre de er markeret som væk. Tryk på en person for at skifte.'),
    h('div', { class: 'list' }, members().map((p) => {
      const away = isAway(p.id, ds, slot);
      return h('div', { class: 'item', onclick: () => { setAway(p, ds, [slot], !away); draw(); } },
        dot(p, away, true), h('div', { class: 'main' }, h('div', { class: 'name' }, p.name + (isMe(p) ? ' (dig)' : ''))),
        h('span', { class: `pill ${away ? 'away' : 'home'}` }, away ? 'Væk' : 'Hjemme'));
    })),
    h('h4', {}, `Hele dagen · ${dayName(fromIso(ds))}`),
    h('div', { class: 'list' }, members().map((p) => {
      const allAway = MEALS.every((m) => isAway(p.id, ds, m));
      return h('div', { class: 'item', onclick: () => { setAway(p, ds, MEALS, !allAway); draw(); } },
        dot(p, allAway, true), h('div', { class: 'main' }, h('div', { class: 'name' }, p.name)),
        h('span', { class: 'qty' }, allAway ? 'Hjemme igen' : 'Væk hele dagen'));
    })));
  draw();
  openSheet(`${MEAL_DA[slot]} · ${daDay(fromIso(ds))}`, body, [btn('Færdig', closeSheet, 'primary')]);
}

function recipeSheet(r) {
  const ings = S.ingredients.filter((i) => i.recipe_id === r.id).sort((a, b) => a.position - b.position);
  const servings = input({ value: fmtQty(r.servings), inputmode: 'decimal', style: 'width:80px' });
  const listEl = h('ul');
  const soonKeys = new Set(S.inventory.filter((i) => { const e = effExpiry(i); return e && inStock(i) && daysBetween(today(), e) <= 3; }).map((i) => norm(i.name)));
  const draw = () => {
    let factor = 1;
    try { const s = parseNum(servings.value); if (s > 0) factor = s / Number(r.servings); } catch { /* behold 1 */ }
    listEl.replaceChildren(...ings.map((i) => h('li', {}, i.quantity != null ? h('strong', {}, `${fmtAmount(i.quantity * factor, i.unit)} `) : null,
      i.name, soonKeys.has(norm(i.name)) ? h('span', { class: 'tag warn' }, 'brug snart') : null)));
  };
  servings.addEventListener('input', draw);
  draw();
  openSheet(r.name, h('div', { class: 'recipe' },
    r.tags ? h('div', { class: 'muted small' }, r.tags) : null,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('span', {}, 'Personer'), servings),
    h('h4', {}, 'Ingredienser'), ings.length ? listEl : h('p', { class: 'muted' }, 'Ingen ingredienser endnu.'),
    r.instructions ? [h('h4', {}, 'Fremgangsmåde'), h('div', { class: 'method' }, r.instructions)] : null,
    r.notes ? [h('h4', {}, 'Noter'), h('p', {}, r.notes)] : null), [
    btn('Slet', () => {
      if (!confirm(`Slet opskriften “${r.name}”? Planlagte måltider beholder navnet som note.`)) return;
      mutate({ type: 'update', table: 'meal_plan', match: { recipe_id: r.id, title: '' }, values: { title: r.name } },
        { type: 'delete', table: 'recipes', id: r.id });
      closeSheet();
    }, 'danger'),
    btn('Ret', () => recipeEditSheet(r)),
    btn('Planlæg', () => mealSheet({ recipe_id: r.id }), 'primary')], { full: true });
}

function recipeEditSheet(r = {}) {
  const ings = r.id ? S.ingredients.filter((i) => i.recipe_id === r.id).sort((a, b) => a.position - b.position) : [];
  const editor = ingredientEditor(ings);
  const f = {
    name: input({ value: r.name || '' }),
    servings: input({ value: fmtQty(r.servings ?? 4), inputmode: 'decimal' }),
    tags: input({ value: r.tags || '', placeholder: 'hurtig, vegetar…' }),
    instructions: h('textarea', { class: 'input', rows: 8, value: r.instructions || '' }),
    notes: input({ value: r.notes || '' }),
  };
  openSheet(r.id ? 'Ret opskrift' : 'Ny opskrift', h('div', {},
    field('Navn', f.name),
    h('div', { class: 'row' }, h('div', { style: 'width:110px' }, field('Personer', f.servings)), h('div', { class: 'grow' }, field('Mærker', f.tags))),
    h('div', { class: 'field' }, h('span', {}, 'Ingredienser'), editor.el),
    field('Fremgangsmåde', f.instructions),
    field('Noter', f.notes)), [
    btn('Annuller', closeSheet),
    btn('Gem', () => attempt(() => {
      const name = f.name.value.trim();
      if (!name) throw new Error('Giv opskriften et navn.');
      const servings = parseNum(f.servings.value) || 4;
      if (servings <= 0) throw new Error('Antal personer skal være over 0.');
      const id = r.id || uuid();
      const values = { name, servings, tags: f.tags.value.trim(), instructions: f.instructions.value, notes: f.notes.value.trim() };
      const newIngs = editor.value.map((i, position) => ({ id: uuid(), recipe_id: id, position, ...i }));
      mutate(
        r.id ? { type: 'update', table: 'recipes', id, values } : { type: 'insert', table: 'recipes', row: { id, ...values } },
        ings.map((i) => ({ type: 'delete', table: 'recipe_ingredients', id: i.id })),
        newIngs.map((row) => ({ type: 'insert', table: 'recipe_ingredients', row })));
      const saved = recipeById(id);
      closeSheet();
      if (saved) recipeSheet(saved);
    }), 'primary')], { full: true });
}

function householdSheet() {
  const list = members();
  openSheet('Husstand', h('div', {},
    h('p', { class: 'muted small' }, 'Alle her får en farvet prik i madplanen og regnes som hjemme til alle måltider, medmindre de er markeret som væk. Man behøver ikke et login (fx børn).'),
    list.length ? h('div', { class: 'list' }, list.map((p) => h('div', { class: 'item', onclick: () => memberSheet(p) },
      dot(p, false, true),
      h('div', { class: 'main' }, h('div', { class: 'name' }, p.name),
        h('div', { class: 'sub' }, isMe(p) ? 'dig' : p.user_id ? 'har login' : 'uden login')),
      h('span', { class: 'qty' }, '›')))) : h('p', { class: 'empty' }, 'Ingen tilføjet endnu.')),
  [btn('＋ Tilføj person', () => memberSheet({}), 'primary')]);
}

function colorPicker(value) {
  let color = safeColor(value);
  const custom = h('input', { type: 'color', class: 'swatch-input', value: color, 'aria-label': 'Anden farve' });
  const wrap = h('div', { class: 'swatches' });
  const draw = () => wrap.replaceChildren(
    ...PALETTE.map((c) => h('button', { type: 'button', class: 'swatch' + (c.toLowerCase() === color.toLowerCase() ? ' on' : ''),
      style: `--c:${c}`, 'aria-label': c, onclick: () => { color = c; draw(); } })),
    h('label', { class: 'swatch other' + (PALETTE.includes(color) ? '' : ' on'), style: `--c:${PALETTE.includes(color) ? 'transparent' : color}`, title: 'Anden farve' },
      PALETTE.includes(color) ? '+' : '', custom));
  custom.addEventListener('input', () => { color = custom.value; draw(); });
  draw();
  return { el: wrap, get value() { return color; } };
}

function memberSheet(p = {}, { whoAmI = false } = {}) {
  const used = new Set(S.members.map((m) => m.color));
  const guess = (S.user?.email || '').split('@')[0].replace(/[._]/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  const name = input({ value: p.name || (whoAmI ? guess : ''), autocomplete: 'off' });
  const color = colorPicker(p.color || PALETTE.find((c) => !used.has(c)) || PALETTE[0]);
  const unlinked = whoAmI ? members().filter((m) => !m.user_id) : [];
  const save = () => attempt(() => {
    const values = { name: name.value.trim(), color: color.value };
    if (!values.name) throw new Error('Skriv venligst et navn.');
    if (p.id) mutate({ type: 'update', table: 'household_members', id: p.id, values });
    else mutate({ type: 'insert', table: 'household_members',
      row: { id: uuid(), ...values, position: S.members.length, user_id: whoAmI ? S.user.id : null } });
    if (whoAmI) closeSheet(); else householdSheet();
  });
  const actions = [];
  if (p.id && !whoAmI) {
    actions.push(btn('Fjern', () => {
      if (!confirm(`Fjern ${p.name} fra husstanden?`)) return;
      mutate({ type: 'delete', table: 'household_members', id: p.id });
      S.absences = S.absences.filter((a) => a.member_id !== p.id);
      householdSheet();
    }, 'danger'));
  }
  if (whoAmI) actions.push(btn('Senere', () => { sessionStorage.setItem('kitchen.whoLater', '1'); closeSheet(); }));
  actions.push(btn('Gem', save, 'primary'));
  openSheet(whoAmI ? 'Hvem er du?' : p.id ? 'Ret person' : 'Tilføj person', h('div', {},
    whoAmI ? h('p', { class: 'muted small' }, 'Alle i husstanden får en farvet prik i madplanen, så I kan se, hvem der er hjemme til hvert måltid.') : null,
    unlinked.length ? [h('p', { class: 'small' }, 'Står du allerede på listen? Tryk på dit navn:'),
      h('div', { class: 'list', style: 'margin-bottom:14px' }, unlinked.map((m) => h('div', { class: 'item', onclick: () => {
        mutate({ type: 'update', table: 'household_members', id: m.id, values: { user_id: S.user.id } });
        closeSheet();
        toast(`Velkommen, ${m.name}`);
      } }, dot(m, false, true), h('div', { class: 'main' }, h('div', { class: 'name' }, `Jeg er ${m.name}`))))),
      h('p', { class: 'small' }, 'Eller tilføj dig selv:')] : null,
    field('Navn', name), h('div', { class: 'field' }, h('span', {}, 'Farve'), color.el)), actions);
}

function maybeAskWhoAmI() {
  if (!S.user || sheetEl || sessionStorage.getItem('kitchen.whoLater')) return;
  if (S.members.some((m) => m.user_id === S.user.id)) return;
  memberSheet({}, { whoAmI: true });
}

function namesSheet() {
  const groups = duplicateGroups(foodNameList());
  const aliasIn = input({ placeholder: 'andet navn, fx piskefløde', autocomplete: 'off' });
  const target = input({ placeholder: 'samme som, fx Fløde 38%', list: 'dl-names', autocomplete: 'off' });
  openSheet('Ryd op i navne', h('div', {},
    h('p', { class: 'muted small' }, 'Navne der ligner hinanden – fx “tomat” og “Tomater” – lægges ikke sammen på indkøbslisten. Vælg det navn, der skal bruges, og tryk “Slå sammen”: navnet rettes i køkkenet, opskrifterne og listen, og appen retter det automatisk fremover.'),
    groups.length ? groups.map((g) => {
      const pick = select(g, g[0]);
      const b = btn('Slå sammen', () => attempt(async () => {
        const to = pick.value;
        for (const n of g) if (n !== to) await rpc('merge_food_names', { p_from: n, p_to: to });
        await rpc('merge_food_names', { p_from: to, p_to: to }, TABLES);
        b.textContent = '✓ Slået sammen'; b.disabled = true;
      }), 'small primary');
      return h('div', { class: 'card' }, h('div', { class: 'small' }, g.join(' · ')),
        h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'small muted' }, 'Brug:'), pick, b));
    }) : h('p', { class: 'empty' }, 'Ingen navne ligner hinanden. 👍'),
    h('h4', {}, 'Andet navn for en vare'),
    field('Andet navn', aliasIn), field('Er det samme som', target),
    btn('Gem', () => attempt(async () => {
      const a = aliasIn.value.trim(); const t = target.value.trim();
      if (!a || !t || norm(a) === norm(t)) throw new Error('Skriv to forskellige navne.');
      await rpc('merge_food_names', { p_from: a, p_to: t }, TABLES);
      toast(`“${a}” bliver nu til “${t}”`);
      aliasIn.value = ''; target.value = '';
    }), 'small')), [], { full: true });
}

function menuSheet() {
  openSheet('Køkken', h('div', { class: 'menu-list' },
    h('p', { class: 'muted small' }, `Logget ind som ${S.user?.email || '?'}`),
    btn('👪 Husstand & farver', () => householdSheet()),
    btn('🔤 Ryd op i navne', () => namesSheet()),
    btn('⟳ Opdater nu', () => { closeSheet(); reload(); }),
    btn('Log ud', async () => {
      if (queue.length && !confirm(`${queue.length} ændring(er) er ikke gemt endnu og går tabt. Log ud alligevel?`)) return;
      closeSheet();
      await sb.auth.signOut();
    }, 'danger')));
}

// ======================================================================
//  Log ind og opstart
// ======================================================================

function showLogin(message) {
  S.user = null;
  mounted = null;
  document.body.classList.add('signed-out');
  $('#title').textContent = 'Køkken';
  const email = input({ type: 'email', autocomplete: 'username', value: localStorage.getItem('kitchen.email') || '' });
  const pw = input({ type: 'password', autocomplete: 'current-password' });
  const submit = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'Log ind');
  $('#view').replaceChildren(h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
    submit.disabled = false;
    if (error) { toast(/invalid/i.test(errMsg(error)) ? 'Forkert e-mail eller adgangskode' : errMsg(error), { error: true }); return; }
    localStorage.setItem('kitchen.email', email.value.trim());
    signedIn(data.user);
  } }, h('h2', {}, 'Log ind'),
  message ? h('p', { class: 'muted' }, message) : null,
  field('E-mail', email), field('Adgangskode', pw), submit));
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
  for (const table of [...TABLES, 'meal_ingredients']) {
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
    $('#view').replaceChildren(h('div', { class: 'login' }, h('h2', {}, 'Næsten klar'),
      h('p', {}, 'Åbn config.js og udfyld din Supabase projekt-URL og publishable key, og upload filerne igen.')));
    return;
  }
  sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kitchen.auth' } });
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      queue = []; saveQueue();
      localStorage.removeItem('kitchen.cache');
      for (const k of Object.values(KEY)) S[k] = [];
      S.suggestions = null;
      sessionStorage.removeItem('kitchen.whoLater');
      if (channel) { sb.removeChannel(channel); channel = null; }
      showLogin();
    }
  });
  const { data } = await sb.auth.getSession();
  if (data.session?.user) signedIn(data.session.user);
  else showLogin();

  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) reload(); });
  window.addEventListener('online', () => { if (S.user) reload(); });
  window.addEventListener('offline', () => setOffline(true));
  setInterval(() => { if (!document.hidden && S.user && !sheetEl) reload(); }, 60_000);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
start();

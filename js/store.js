/**
 * Local persistence. Everything lives in localStorage on the device —
 * no server, no network, no analytics.
 */

const KEY = 'calorie-tracker:v1';

const EMPTY = {
  version: 1,
  profile: null,
  days: {},      // 'YYYY-MM-DD' -> { food: [], activity: [] }
  weights: [],   // [{ date, kg }]
  customFoods: [],
  recents: [],
  settings: { theme: 'system', useKg: true, onboarded: false },
};

/* ---------- date helpers ---------- */

function isoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}

export const today = () => isoDate(new Date());

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/* ---------- store ---------- */

function deepMerge(base, patch) {
  const out = { ...base };
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(EMPTY);
    return deepMerge(structuredClone(EMPTY), JSON.parse(raw));
  } catch (err) {
    console.warn('Could not read saved data, starting fresh.', err);
    return structuredClone(EMPTY);
  }
}

let state = read();
const listeners = new Set();
let writeTimer = null;
let pending = false;

function writeNow() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    pending = false;
  } catch (err) {
    console.error('Save failed (storage full?)', err);
    alert('Could not save: device storage is full.');
  }
}

function persist() {
  pending = true;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(writeNow, 120);
}

/** Force any queued write out immediately. */
export function flush() {
  if (!pending) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  writeNow();
}

// Mobile browsers can discard a backgrounded tab without warning, so make sure
// a queued write is committed when the page is hidden or closed.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

function emit() {
  persist();
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getState = () => state;

const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- profile ---------- */

export function saveProfile(profile) {
  state.profile = { ...(state.profile || {}), ...profile };
  state.settings.onboarded = true;
  emit();
}

export const getProfile = () => state.profile;

/* ---------- day log ---------- */

function day(iso) {
  if (!state.days[iso]) state.days[iso] = { food: [], activity: [], water: [] };
  const d = state.days[iso];
  if (!d.food) d.food = [];
  if (!d.activity) d.activity = [];
  if (!d.water) d.water = [];
  return d;
}

export const getDay = (iso) => state.days[iso] || { food: [], activity: [], water: [] };

export const waterFor = (iso) =>
  (state.days[iso]?.water || []).reduce((s, w) => s + (w.ml || 0), 0);

export function addWater(iso, ml) {
  day(iso).water.push({ id: uid(), ml, ts: Date.now() });
  emit();
}

export function removeWater(iso, id) {
  const d = day(iso);
  d.water = d.water.filter((w) => w.id !== id);
  emit();
}

export function addFoodEntry(iso, entry) {
  day(iso).food.push({ id: uid(), ts: Date.now(), ...entry });
  emit();
}

export function removeEntry(iso, id) {
  const d = day(iso);
  d.food = d.food.filter((e) => e.id !== id);
  d.activity = d.activity.filter((e) => e.id !== id);
  emit();
}

export function updateEntry(iso, id, patch) {
  const e = day(iso).food.find((x) => x.id === id);
  if (e) Object.assign(e, patch);
  emit();
}

export function addActivityEntry(iso, entry) {
  day(iso).activity.push({ id: uid(), ts: Date.now(), ...entry });
  emit();
}

export function copyDay(fromIso, toIso) {
  const src = getDay(fromIso);
  day(toIso).food.push(...src.food.map((e) => ({ ...e, id: uid(), ts: Date.now() })));
  day(toIso).activity.push(...src.activity.map((e) => ({ ...e, id: uid(), ts: Date.now() })));
  day(toIso).water.push(...(src.water || []).map((w) => ({ ...w, id: uid(), ts: Date.now() })));
  emit();
}

/* ---------- weight ---------- */

export function addWeight(iso, kg) {
  const i = state.weights.findIndex((w) => w.date === iso);
  if (i >= 0) state.weights[i].kg = kg;
  else state.weights.push({ date: iso, kg });
  state.weights.sort((a, b) => a.date.localeCompare(b.date));
  emit();
}

export const getWeights = () => state.weights;

/* ---------- custom foods ---------- */

export function addCustomFood(food) {
  state.customFoods.push({ id: uid(), created: Date.now(), ...food });
  emit();
}

export function removeCustomFood(id) {
  state.customFoods = state.customFoods.filter((f) => f.id !== id);
  emit();
}

export const getCustomFoods = () => state.customFoods;

/* ---------- recents ---------- */

export function rememberFood(foodId) {
  state.recents = [foodId, ...state.recents.filter((x) => x !== foodId)].slice(0, 12);
}

/* ---------- settings & data ---------- */

export function setSetting(patch) {
  state.settings = { ...state.settings, ...patch };
  emit();
}

export function exportJSON() {
  flush();
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Not a valid export');
  state = deepMerge(structuredClone(EMPTY), parsed);
  emit();
  flush();
}

export function resetAll() {
  state = structuredClone(EMPTY);
  emit();
  flush();
}

export { state as store };
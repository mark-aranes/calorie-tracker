import { FOOD_DB, CATEGORIES, ACTIVITIES, ACTIVITY_MULTIPLIERS, GOALS } from './foods.js';
import * as store from './store.js';
import {
  targets, totalsFor, buildAdvice, analyseTrends, trendInsights,
  activityBurn, metFor, dayProgress, round, clamp,
  projectGoal, streaks, timingInsights,
} from './nutrition.js';
import { calorieChart, weightChart, macroCharts } from './charts.js';
import {
  $, $$, h, toast, openSheet, closeSheet, initSheet,
  numberField, segmented, radioGroup, selectField, btn, fmtKcal, fmtQty, esc,
} from './ui.js';

/* ================= app state ================= */

let date = store.today();
let tab = 'today';
let trendRange = 7;
let installPrompt = null;

/* ================= units ================= */

const useMetric = () => store.getState().settings.useKg !== false;
const KG_PER_LB = 0.45359237;
const weightOut = (kg) => (useMetric() ? round(kg, 1) : round(kg / KG_PER_LB, 1));
const weightIn = (v) => (useMetric() ? v : v * KG_PER_LB);
const heightOut = (cm) => (useMetric() ? Math.round(cm) : Math.round(cm / 2.54));
const heightIn = (v) => (useMetric() ? v : v * 2.54);

/* ================= food index ================= */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const INDEX = [];
for (const category of CATEGORIES) {
  for (const row of FOOD_DB[category] || []) {
    const [name, kcal, protein, carbs, fat, fibre, unit = 'g', serving = 100, aliases = ''] = row;
    const id = `${category}|${name}`;
    INDEX.push({
      id, name, category, kcal, protein, carbs, fat, fibre, unit, serving,
      per: unit === 'ml' ? '100 ml' : '100 g',
      _name: name.toLowerCase(),
      _alias: aliases.toLowerCase(),
    });
  }
}

function searchFoods(q, limit = 50) {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [];
  for (const f of INDEX) {
    let score = 0;
    let ok = true;
    for (const t of terms) {
      if (f._name.startsWith(t)) score += 120;
      else if (new RegExp(`\\b${escapeRe(t)}`).test(f._name)) score += 60;
      else if (f._name.includes(t)) score += 25;
      else if (f._alias.includes(t)) score += 12;
      else if (f.category.toLowerCase().includes(t)) score += 8;
      else { ok = false; break; }
    }
    if (ok && score > 0) scored.push({ f, score });
  }
  scored.sort((a, b) => b.score - a.score || a.f.name.localeCompare(b.f.name));
  return scored.slice(0, limit).map((x) => x.f);
}

function customAsFood(c) {
  return {
    id: c.id, name: c.name, category: c.category || 'Your foods',
    kcal: c.kcal, protein: c.protein, carbs: c.carbs, fat: c.fat, fibre: c.fibre || 0,
    unit: c.unit || 'g', serving: c.serving || 100, custom: true,
    per: (c.unit || 'g') === 'ml' ? '100 ml' : '100 g',
    _name: c.name.toLowerCase(), _alias: (c.aliases || '').toLowerCase(),
  };
}

const byId = new Map(INDEX.map((f) => [f.id, f]));

/** Custom foods live in their own map so deletions cannot leave stale rows. */
let customIndex = [];
const customById = new Map();

function refreshCustomIndex() {
  customIndex = store.getCustomFoods().map(customAsFood);
  customById.clear();
  for (const f of customIndex) customById.set(f.id, f);
}
refreshCustomIndex();

const lookupFood = (id) => customById.get(id) || byId.get(id);

function searchAll(q, limit = 50) {
  if (!q.trim()) {
    return [...store.getState().recents.map(lookupFood), ...customIndex].filter(Boolean).slice(0, 12);
  }
  const bundled = searchFoods(q, limit);
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const customHits = [];
  for (const f of customIndex) {
    let score = 0, ok = true;
    for (const t of terms) {
      if (f._name.startsWith(t)) score += 130;
      else if (f._name.includes(t)) score += 30;
      else if (f._alias.includes(t)) score += 15;
      else { ok = false; break; }
    }
    if (ok) customHits.push({ f, score });
  }
  customHits.sort((a, b) => b.score - a.score);
  return [...customHits.map((x) => x.f), ...bundled].slice(0, limit);
}

/* ================= helpers ================= */

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

function mealForTime(d = new Date()) {
  const hgt = d.getHours();
  if (hgt < 11) return 'Breakfast';
  if (hgt < 15) return 'Lunch';
  if (hgt < 18) return 'Dinner';
  return 'Snack';
}

const toneIcon = { good: '✓', warn: '!', info: 'i', tip: '→' };

/* ================= rendering: today ================= */

function renderToday() {
  const profile = store.getProfile();
  const tg = targets(profile);
  if (!tg) return;
  const day = store.getDay(date);
  const totals = totalsFor(day);

  $('#kcalRemaining').textContent = fmtKcal(tg.kcal + totals.burned - totals.kcal);
  $('#statEaten').textContent = fmtKcal(totals.kcal);
  $('#statBurned').textContent = fmtKcal(totals.burned);
  $('#statTarget').textContent = fmtKcal(tg.kcal);

  const ring = $('#kcalRing');
  const circumference = 2 * Math.PI * 86;
  const budget = tg.kcal + totals.burned;
  const pct = clamp(totals.kcal / budget, 0, 1);
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference * (1 - pct)}`;
  ring.classList.toggle('over', totals.kcal > budget);

  setMacro('p', totals.protein, tg.protein);
  setMacro('c', totals.carbs, tg.carbs);
  setMacro('f', totals.fat, tg.fat);

  const isToday = date === store.today();
  renderDayStats(tg, isToday);

  const advice = buildAdvice({
    totals, tg, profile, day,
    progress: isToday ? dayProgress() : 1,
    isToday, now: new Date(),
    water: store.waterFor(date),
    timing: timingInsights(store.getState().days, [date]),
  });
  renderAdvice($('#advice'), advice, 1);

  renderMeals(day);
  renderActivityList(day);
}

const WATER_PRESETS = [250, 330, 500];

/** Water intake and streaks, kept in one compact card. */
function renderDayStats(tg, isToday) {
  const wrap = $('#dayStats');
  wrap.innerHTML = '';

  const glasses = store.getDay(date).water || [];
  const total = glasses.reduce((s, g) => s + g.ml, 0);
  const pct = clamp((total / tg.water) * 100, 0, 100);

  wrap.append(h('div', { class: 'ds-head' },
    h('span', { class: 'ds-name' }, 'Water'),
    h('span', { class: 'ds-val' }, `${total.toLocaleString()} / ${tg.water.toLocaleString()} ml`),
  ));
  wrap.append(h('div', { class: 'bar' },
    h('div', { class: `bar-fill water${total >= tg.water ? ' hit' : ''}`, style: `width:${pct}%` }),
  ));

  const addChips = h('div', { class: 'chip-row' });
  for (const ml of WATER_PRESETS) {
    addChips.append(h('button', {
      type: 'button', class: 'chip', onclick: () => { store.addWater(date, ml); toast(`+${ml} ml`); },
    }, `+${ml}`));
  }
  addChips.append(h('button', { type: 'button', class: 'chip', onclick: openCustomWater }, 'Custom'));
  for (const g of glasses.slice(-6).reverse()) {
    addChips.append(h('button', {
      type: 'button', class: 'chip chip-logged', title: `Remove ${g.ml} ml`,
      onclick: () => store.removeWater(date, g.id),
    }, `${g.ml} ✕`));
  }
  wrap.append(addChips);

  const st = streaks(store.getState().days, tg, store.today());
  wrap.append(h('div', { class: 'ds-streak' },
    h('span', { class: 'ds-streak-n' }, `${st.logging} ${st.logging === 1 ? 'day' : 'days'} logged`),
    h('span', { class: 'ds-streak-sep' }, '·'),
    h('span', {}, st.onTarget > 0
      ? `${st.onTarget} in a row on target`
      : 'no on-target run yet'),
  ));
}

function openCustomWater() {
  const body = h('div', {});
  const input = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '3000', value: '250' });
  body.append(h('label', { class: 'field' },
    h('span', { class: 'field-label' }, 'Amount (ml)'),
    h('div', { class: 'field-row' }, input),
  ));
  body.append(h('div', { class: 'sheet-actions' },
    btn('Add', {
      kind: 'btn-primary',
      onclick: () => {
        const ml = parseInt(input.value, 10);
        if (!Number.isFinite(ml) || ml <= 0) { toast('Enter an amount'); input.focus(); return; }
        store.addWater(date, Math.min(ml, 3000));
        toast(`+${ml} ml`);
        closeSheet();
      },
    }),
    btn('Cancel', { kind: 'btn-ghost', onclick: closeSheet }),
  ));
  openSheet(body, { title: 'Add water' });
}

function setMacro(prefix, value, target) {
  $(`#${prefix}Val`).textContent = `${Math.round(value)}g`;
  $(`#${prefix}Sub`).textContent = `of ${target}g`;
  const el = $(`#${prefix}Bar`);
  el.style.width = `${clamp((value / target) * 100, 0, 100)}%`;
  const box = el.closest('.macro');
  box.classList.toggle('hit', value >= target);
  box.classList.toggle('over', value > target * 1.1);
}

/**
 * Render advice cards. `limit` keeps the most important ones visible and
 * collapses the rest behind a toggle, so the meal log stays reachable.
 */
function adviceCard(a) {
  return h('div', { class: `advice-item tone-${a.tone}` },
    h('span', { class: 'advice-dot', 'aria-hidden': 'true' }, toneIcon[a.tone] || 'i'),
    h('div', {},
      h('div', { class: 'advice-title' }, a.title),
      h('div', { class: 'advice-body' }, a.body),
    ),
  );
}

/**
 * The most important insight is shown in full; the rest become one-line chips
 * so every topic is visible without pushing the meal log off the screen.
 * Tapping a chip expands it into the full card in place.
 */
function renderAdvice(container, list, lead = 1) {
  container.innerHTML = '';
  if (!list.length) return;

  const shown = list.slice(0, lead);
  for (const a of shown) container.append(adviceCard(a));

  const rest = list.slice(lead);
  if (!rest.length) return;

  const chips = h('div', { class: 'advice-chips' });
  for (const a of rest) {
    const chip = h('button', { type: 'button', class: `advice-chip tone-${a.tone}` },
      h('span', { class: 'ac-dot', 'aria-hidden': 'true' }, toneIcon[a.tone] || 'i'),
      h('span', {}, a.title),
    );
    chip.addEventListener('click', () => {
      const card = adviceCard(a);
      chip.replaceWith(card);
      chip.remove();
    });
    chips.append(chip);
  }
  container.append(chips);
}

function renderMeals(day) {
  const wrap = $('#meals');
  wrap.innerHTML = '';
  const groups = MEALS.map((m) => [m, (day.food || []).filter((e) => e.meal === m)]);
  const present = groups.filter(([, list]) => list.length);

  if (!present.length) {
    const yesterday = store.getDay(store.addDays(date, -1));
    const canRepeat = (yesterday.food || []).length > 0;
    wrap.append(h('div', { class: 'empty' },
      h('p', {}, 'No food logged for this day.'),
      btn('Add your first food', { kind: 'btn-primary', onclick: () => openFoodPicker() }),
      canRepeat && date === store.today()
        ? btn(`Repeat yesterday (${yesterday.food.length} items)`, {
            kind: 'btn-ghost',
            onclick: () => {
              if (!confirm('Copy yesterday’s meals into today?')) return;
              store.copyDay(store.addDays(date, -1), date);
              toast('Yesterday copied to today');
            },
          })
        : null,
    ));
    return;
  }

  for (const [meal, list] of present) {
    const sub = list.reduce((s, e) => ({
      kcal: s.kcal + e.kcal, protein: s.protein + e.protein, carbs: s.carbs + e.carbs, fat: s.fat + e.fat,
    }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });

    const card = h('div', { class: 'card meal-card' });
    card.append(h('div', { class: 'meal-head' },
      h('h3', {}, meal),
      h('span', { class: 'meal-sub' }, `${fmtKcal(sub.kcal)} kcal`),
    ));
    card.append(h('div', { class: 'meal-macros' },
      `P ${Math.round(sub.protein)}g · C ${Math.round(sub.carbs)}g · F ${Math.round(sub.fat)}g`,
    ));

    const ul = h('ul', { class: 'entry-list' });
    for (const e of list) {
      ul.append(h('li', {},
        h('button', { class: 'entry', onclick: () => openFoodPicker(e) },
          h('span', { class: 'entry-name' }, e.name),
          h('span', { class: 'entry-qty' }, fmtQty(e.grams)),
        ),
        h('span', { class: 'entry-kcal' }, fmtKcal(e.kcal)),
        h('button', {
          class: 'icon-btn danger', 'aria-label': `Delete ${e.name}`,
          onclick: (ev) => {
            ev.stopPropagation();
            if (confirm(`Remove ${e.name} from ${meal.toLowerCase()}?`)) {
              store.removeEntry(date, e.id);
              toast('Entry removed');
            }
          },
        }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' })),
      ));
    }
    card.append(ul);
    wrap.append(card);
  }
}

function renderActivityList(day) {
  const wrap = $('#activityList');
  wrap.innerHTML = '';
  if (!(day.activity || []).length) {
    wrap.append(h('div', { class: 'empty small' },
      h('p', {}, 'No activity logged. Add exercise to see its effect on your budget.'),
    ));
    return;
  }
  const ul = h('ul', { class: 'entry-list' });
  for (const a of day.activity) {
    ul.append(h('li', {},
      h('div', { class: 'entry static' },
        h('span', { class: 'entry-name' }, a.name),
        h('span', { class: 'entry-qty' }, `${a.minutes} min`),
      ),
      h('span', { class: 'entry-kcal' }, `+${fmtKcal(a.kcal)}`),
      h('button', {
        class: 'icon-btn danger', 'aria-label': `Delete ${a.name}`,
        onclick: () => {
          if (confirm(`Remove ${a.name}?`)) { store.removeEntry(date, a.id); toast('Activity removed'); }
        },
      }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' })),
    ));
  }
  wrap.append(ul);
}

/* ================= rendering: add ================= */

function renderSearch(query) {
  const wrap = $('#searchResults');
  wrap.innerHTML = '';
  const results = searchAll(query);

  if (!query.trim()) {
    const recents = results;
    if (!recents.length) {
      wrap.append(h('div', { class: 'empty small' }, h('p', {}, 'Type to search the built-in database, or create your own food below.')));
    } else {
      wrap.append(h('div', { class: 'list-head' }, 'Recently logged'));
      renderRows(recents, wrap);
    }
  } else if (!results.length) {
    wrap.append(h('div', { class: 'empty' },
      h('p', {}, `No match for “${query}”.`),
      btn('Create this food', { kind: 'btn-primary', onclick: () => openCustomFood({ name: query }) }),
    ));
  } else {
    renderRows(results, wrap);
  }
}

function renderRows(foods, wrap) {
  const list = h('div', { class: 'card-list' });
  for (const f of foods) {
    list.append(h('button', { class: 'food-row', onclick: () => openFoodPicker(f) },
      h('span', { class: 'food-main' },
        h('span', { class: 'food-name' }, f.name, f.custom ? h('span', { class: 'tag' }, 'yours') : null),
        h('span', { class: 'food-meta' }, `${f.category} · per ${f.per}`),
      ),
      h('span', { class: 'food-kcal' },
        h('b', {}, String(Math.round(f.kcal))),
        h('small', {}, 'kcal'),
      ),
    ));
  }
  wrap.append(list);
}

/* ================= rendering: trends ================= */

function renderTrends() {
  const profile = store.getProfile();
  const tg = targets(profile);

  const series = [];
  for (let i = trendRange - 1; i >= 0; i--) {
    const iso = store.addDays(store.today(), -i);
    const day = store.getDay(iso);
    const t = totalsFor(day);
    series.push({ date: iso, kcal: t.kcal, burned: t.burned, protein: t.protein, carbs: t.carbs, fat: t.fat, fibre: t.fibre, count: t.count });
  }

  const weights = store.getWeights();
  const t = analyseTrends(series, weights, profile, tg);

  $('#calChart').innerHTML = calorieChart(series, tg.kcal);
  $('#macroChart').innerHTML = macroCharts(series, tg);

  $('#avgGrid').innerHTML = '';
  const stats = [
    ['Avg intake', `${fmtKcal(t.avgKcal)} kcal`],
    ['Avg burned', `${fmtKcal(t.avgBurned)} kcal`],
    ['Avg protein', `${t.avgProtein} g`],
    ['Avg carbs', `${t.avgCarbs} g`],
    ['Avg fat', `${t.avgFat} g`],
    ['Avg fibre', `${t.avgFibre} g`],
    ['Days on target', `${t.onTargetPct}%`],
    ['Day spread', `±${t.sd} kcal`],
  ];
  for (const [k, v] of stats) {
    $('#avgGrid').append(h('div', { class: 'avg-cell' },
      h('span', { class: 'avg-k' }, k),
      h('span', { class: 'avg-v' }, v),
    ));
  }

  const goal = profile?.goalWeightKg || null;
  const projection = projectGoal(weights, goal);

  $('#weightChart').innerHTML = weightChart(weights, goal);
  const wt = $('#weightTrend');
  if (t.weightChange !== null) {
    wt.innerHTML = `<strong>${t.weightChange > 0 ? '+' : ''}${round(t.weightChange, 1)} kg</strong> total · ${t.weeklyRate > 0 ? '+' : ''}${round(t.weeklyRate, 2)} kg per week`;
  } else {
    wt.textContent = 'Log your weight to track progress.';
  }

  const proj = $('#weightProjection');
  proj.innerHTML = '';
  if (goal && projection) {
    const toGo = Math.abs(projection.toGo).toFixed(1);
    const rateTxt = projection.rate != null ? `${Math.abs(projection.rate).toFixed(2)} kg/week` : null;
    let tone = 'info';
    let text;
    if (projection.status === 'reached') {
      tone = 'good';
      text = `You have reached your goal weight of ${weightOut(goal)} ${useMetric() ? 'kg' : 'lb'}.`;
    } else if (projection.status === 'stalled') {
      tone = 'warn';
      text = `Your weight has held steady near ${weightOut(projection.current)} ${useMetric() ? 'kg' : 'lb'}. That is ${toGo} ${useMetric() ? 'kg' : 'lb'} from your goal — worth adjusting intake rather than logging harder.`;
    } else if (projection.status === 'away') {
      tone = 'warn';
      text = `At ${rateTxt} your weight is moving away from your goal of ${weightOut(goal)} ${useMetric() ? 'kg' : 'lb'}. You are ${toGo} ${useMetric() ? 'kg' : 'lb'} from it.`;
    } else if (projection.status === 'onTrack') {
      tone = 'good';
      const eta = new Date(projection.eta + 'T00:00:00');
      const etaTxt = eta.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
      text = `At ${rateTxt} you would reach ${weightOut(goal)} ${useMetric() ? 'kg' : 'lb'} around ${etaTxt} — about ${Math.round(projection.days / 7)} weeks away.`;
    } else {
      tone = 'info';
      text = `${toGo} ${useMetric() ? 'kg' : 'lb'} to your goal of ${weightOut(goal)} ${useMetric() ? 'kg' : 'lb'}. Keep logging your weight for at least a week to get a projection.`;
    }
    proj.append(h('div', { class: `proj-box tone-${tone}` },
      h('span', { class: 'proj-title' }, 'Goal projection'),
      h('span', { class: 'proj-body' }, text),
    ));
  } else if (!goal) {
    proj.append(h('div', { class: 'proj-box tone-info' },
      h('span', { class: 'proj-title' }, 'No goal weight set'),
      h('span', { class: 'proj-body' }, 'Add one in Your profile to see how your current trend lines up against where you want to get to.'),
    ));
  }

  renderAdvice($('#patterns'), trendInsights(t, tg, profile));
}

/* ================= rendering: you ================= */

function renderYou() {
  const profile = store.getProfile();
  const tg = targets(profile);

  $('#targetSummary').innerHTML = `
    <div class="ts-row"><span>Basal rate (BMR)</span><b>${fmtKcal(tg.bmr)} kcal</b></div>
    <div class="ts-row"><span>Maintenance</span><b>${fmtKcal(tg.tdee)} kcal</b></div>
    <div class="ts-row"><span>Daily target</span><b>${fmtKcal(tg.kcal)} kcal</b></div>
    <div class="ts-row"><span>Goal</span><b>${esc(tg.goalLabel)} · ${esc(tg.goalRate)}</b></div>
    ${profile?.goalWeightKg ? `<div class="ts-row"><span>Goal weight</span><b>${weightOut(profile.goalWeightKg)} ${useMetric() ? 'kg' : 'lb'}</b></div>` : ''}
    <div class="ts-row"><span>Protein</span><b>${tg.protein} g</b></div>
    <div class="ts-row"><span>Carbs</span><b>${tg.carbs} g</b></div>
    <div class="ts-row"><span>Fat</span><b>${tg.fat} g</b></div>
    <div class="ts-row"><span>Fibre</span><b>${tg.fibre} g</b></div>
    <div class="ts-row"><span>Water</span><b>${tg.water.toLocaleString()} ml</b></div>`;

  const customs = store.getCustomFoods();
  $('#customCount').textContent = customs.length
    ? `${customs.length} custom ${customs.length === 1 ? 'food' : 'foods'} saved. They appear at the top of search results.`
    : 'Create your own foods for anything not in the built-in database.';

  const weights = store.getWeights();
  const ws = $('#weightSummary');
  if (weights.length) {
    const last = weights[weights.length - 1];
    const change = weights.length > 1 ? last.kg - weights[0].kg : 0;
    ws.textContent = `Latest: ${weightOut(last.kg)} ${useMetric() ? 'kg' : 'lb'} on ${last.date}` +
      (weights.length > 1 ? ` · ${change > 0 ? '+' : ''}${round(weightOut(last.kg) - weightOut(weights[0].kg), 1)} ${useMetric() ? 'kg' : 'lb'} overall` : '');
  } else {
    ws.textContent = 'No weights logged yet.';
  }

  $('#logWeight').onclick = openWeightSheet;
  $('#newFood').onclick = () => openCustomFood();
  $('#editProfile').onclick = () => openProfileSheet(store.getProfile());
  $('#manageCustom').onclick = openCustomManager;
  $('#exportData').onclick = exportData;
  $('#importData').onclick = () => $('#importFile').click();
  $('#importFile').onchange = importData;
  $('#resetData').onclick = doReset;

  for (const b of $$('#unitToggle button')) {
    b.classList.toggle('active', (b.dataset.unit === 'metric') === useMetric());
    b.onclick = () => {
      store.setSetting({ useKg: b.dataset.unit === 'metric' });
      toast(`Units: ${b.dataset.unit}`);
    };
  }

  const installCard = $('#installCard');
  if (installCard) installCard.hidden = !installPrompt;
  if (installPrompt) {
    $('#installBtn').onclick = async () => {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      renderYou();
    };
  }
}

/* ================= sheets: food ================= */

/**
 * Add a food, or edit an existing log entry.
 * An item with a `grams` field is a log entry; otherwise it is a database food.
 */
function openFoodPicker(item) {
  const entry = item && item.grams !== undefined ? item : null;
  const food = entry ? (lookupFood(item.id) || customAsFood(item)) : item;
  const body = h('div', {});

  const gramsInput = h('input', {
    type: 'number', inputmode: 'decimal', min: '1', step: '1',
    value: entry ? entry.grams : food.serving,
  });

  const preview = h('div', { class: 'portion-preview' });
  const perLabel = h('div', { class: 'portion-per' }, `${food.kcal} kcal per ${food.per}`);

  function recalc() {
    const g = Math.max(0, parseFloat(gramsInput.value) || 0);
    const f = g / 100;
    preview.innerHTML = `
      <div class="pp-main"><b>${fmtKcal(food.kcal * f)}</b> kcal</div>
      <div class="pp-macros">
        P ${round(food.protein * f, 1)}g · C ${round(food.carbs * f, 1)}g · F ${round(food.fat * f, 1)}g
      </div>`;
  }

  gramsInput.addEventListener('input', recalc);
  recalc();

  body.append(h('div', { class: 'portion-head' },
    h('h3', {}, food.name),
    perLabel,
    food.custom ? null : h('div', { class: 'food-meta' }, food.category),
  ));

  const chips = h('div', { class: 'chip-row' });
  for (const [label, val] of [['1 serving', food.serving], ['50', 50], ['100', 100], ['150', 150], ['200', 200]]) {
    chips.append(h('button', {
      type: 'button', class: 'chip',
      onclick: () => { gramsInput.value = val; recalc(); },
    }, label));
  }
  body.append(chips);

  body.append(h('label', { class: 'field' },
    h('span', { class: 'field-label' }, `Amount (${food.unit === 'ml' ? 'ml' : 'g'})`),
    h('div', { class: 'field-row' }, gramsInput),
  ));
  body.append(preview);

  let meal = entry ? entry.meal : mealForTime();
  body.append(h('span', { class: 'field-label' }, 'Meal'));
  body.append(segmented(MEALS.map((m) => ({ label: m, value: m })), meal, (v) => { meal = v; }));

  const actions = h('div', { class: 'sheet-actions' });
  actions.append(btn(entry ? 'Update entry' : 'Add to log', {
    kind: 'btn-primary', onclick: () => {
      const grams = Math.max(1, parseFloat(gramsInput.value) || food.serving);
      const f = grams / 100;
      const payload = {
        id: food.id,
        name: food.name,
        category: food.category,
        grams,
        kcal: Math.round(food.kcal * f),
        protein: round(food.protein * f, 1),
        carbs: round(food.carbs * f, 1),
        fat: round(food.fat * f, 1),
        fibre: round((food.fibre || 0) * f, 1),
        meal,
      };
      if (entry) {
        store.updateEntry(date, entry.id, payload);
        toast('Entry updated');
      } else {
        store.addFoodEntry(date, payload);
        store.rememberFood(food.id);
        toast(`${food.name} added to ${meal.toLowerCase()}`);
      }
      closeSheet();
      switchTab('today');
    },
  }));
  if (!food.custom) {
    actions.append(btn('Customise', {
      kind: 'btn-ghost', onclick: () => { closeSheet(); openCustomFood(food); },
    }));
  }
  body.append(actions);

  openSheet(body, { title: entry ? 'Edit entry' : 'Add food' });
}

/* ================= sheets: custom food ================= */

function openCustomFood(seed) {
  const src = seed || {};
  const body = h('div', {});

  const name = h('input', { type: 'text', value: src.name || '', placeholder: 'e.g. Gran’s porridge', autocomplete: 'off' });
  const kcal = h('input', { type: 'number', inputmode: 'decimal', step: '1', min: '0', value: src.kcal ?? '' });
  const protein = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '0', value: src.protein ?? '' });
  const carbs = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '0', value: src.carbs ?? '' });
  const fat = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '0', value: src.fat ?? '' });
  const fibre = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '0', value: src.fibre ?? 0 });
  const serving = h('input', { type: 'number', inputmode: 'decimal', step: '1', min: '1', value: src.serving ?? 100 });

  body.append(h('p', { class: 'muted small' },
    'Enter values for the amount shown in the serving box — for example per 100 g or per 100 ml.'));

  body.append(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name));
  body.append(h('div', { class: 'grid-2' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Calories'), kcal),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Protein (g)'), protein),
  ));
  body.append(h('div', { class: 'grid-2' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Carbs (g)'), carbs),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Fat (g)'), fat),
  ));
  body.append(h('div', { class: 'grid-2' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Fibre (g)'), fibre),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Typical serving'), serving),
  ));

  body.append(h('div', { class: 'sheet-actions' },
    btn('Save food', {
      kind: 'btn-primary', onclick: () => {
        const n = name.value.trim();
        if (!n) { toast('Give the food a name'); name.focus(); return; }
        const k = parseFloat(kcal.value);
        if (!Number.isFinite(k) || k < 0) { toast('Enter calories'); kcal.focus(); return; }

        const food = {
          name: n,
          category: 'Your foods',
          kcal: k,
          protein: parseFloat(protein.value) || 0,
          carbs: parseFloat(carbs.value) || 0,
          fat: parseFloat(fat.value) || 0,
          fibre: parseFloat(fibre.value) || 0,
          unit: 'g',
          serving: parseFloat(serving.value) || 100,
        };

        // Re-derive kcal from macros when they were provided, as an accuracy net.
        const fromMacros = food.protein * 4 + food.carbs * 4 + food.fat * 9;
        if (fromMacros > 0 && Math.abs(fromMacros - k) / k > 0.25) {
          if (!confirm(`Your macros add up to ${Math.round(fromMacros)} kcal but you entered ${Math.round(k)} kcal. Save the calorie value you entered?`)) return;
        }

        store.addCustomFood(food);
        refreshCustomIndex();
        toast('Food saved');
        closeSheet();
        switchTab('add');
      },
    }),
    btn('Cancel', { kind: 'btn-ghost', onclick: closeSheet }),
  ));

  openSheet(body, { title: 'Custom food' });
}

function openCustomManager() {
  const body = h('div', {});
  const list = store.getCustomFoods();
  if (!list.length) {
    body.append(h('p', { class: 'muted' }, 'You have not created any custom foods yet.'));
  } else {
    const ul = h('ul', { class: 'entry-list' });
    for (const f of list) {
      ul.append(h('li', {},
        h('div', { class: 'entry static' },
          h('span', { class: 'entry-name' }, f.name),
          h('span', { class: 'entry-qty' }, `${Math.round(f.kcal)} kcal / 100 g`),
        ),
        h('button', {
          class: 'icon-btn danger', 'aria-label': `Delete ${f.name}`,
          onclick: () => {
            if (!confirm(`Delete “${f.name}”? Past entries stay in your log.`)) return;
            store.removeCustomFood(f.id);
            refreshCustomIndex();
            renderYou();
            openCustomManager();
          },
        }, h('span', { html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>' })),
      ));
    }
    body.append(ul);
  }
  body.append(h('div', { class: 'sheet-actions' },
    btn('New food', { kind: 'btn-primary', onclick: () => { closeSheet(); openCustomFood(); } }),
  ));
  openSheet(body, { title: 'Custom foods' });
}

/* ================= sheets: activity ================= */

function openActivitySheet() {
  const profile = store.getProfile();
  const weight = profile?.weightKg || 70;
  const body = h('div', {});

  const nameSel = selectField({
    label: 'Activity', id: 'actName', value: ACTIVITIES[0].name,
    options: ACTIVITIES.map((a) => ({ value: a.name, label: `${a.name} (MET ${a.met})` })),
  });
  const minutes = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '600', value: '30' });
  const preview = h('div', { class: 'portion-preview' });

  function recalc() {
    const met = metFor(nameSel.input.value);
    const mins = Math.max(0, parseFloat(minutes.value) || 0);
    preview.innerHTML = `<div class="pp-main"><b>${fmtKcal(activityBurn(met, mins, weight))}</b> kcal</div>
      <div class="pp-macros">based on ${round(weight, 1)} kg body weight</div>`;
  }
  nameSel.input.addEventListener('change', recalc);
  minutes.addEventListener('input', recalc);
  recalc();

  body.append(nameSel);
  body.append(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Duration (minutes)'), minutes));
  const chips = h('div', { class: 'chip-row' });
  for (const m of [15, 30, 45, 60, 90]) {
    chips.append(h('button', { type: 'button', class: 'chip', onclick: () => { minutes.value = m; recalc(); } }, `${m} min`));
  }
  body.append(chips);
  body.append(preview);
  body.append(h('div', { class: 'sheet-actions' },
    btn('Add activity', {
      kind: 'btn-primary', onclick: () => {
        const name = nameSel.input.value;
        const mins = parseFloat(minutes.value);
        if (!Number.isFinite(mins) || mins <= 0) { toast('Enter how many minutes'); minutes.focus(); return; }
        store.addActivityEntry(date, {
          name, minutes: mins,
          kcal: activityBurn(metFor(name), mins, weight),
        });
        toast('Activity added');
        closeSheet();
        switchTab('today');
      },
    }),
  ));

  openSheet(body, { title: 'Add activity' });
}

/* ================= sheets: weight ================= */

function openWeightSheet() {
  const body = h('div', {});
  const existing = store.getWeights().find((w) => w.date === store.today());
  const field = numberField({
    label: `Weight (${useMetric() ? 'kg' : 'lb'})`,
    id: 'wVal',
    value: existing ? weightOut(existing.kg) : weightOut(store.getProfile()?.weightKg || 70),
    step: '0.1',
  });
  body.append(field);
  body.append(h('div', { class: 'sheet-actions' },
    btn('Save weight', {
      kind: 'btn-primary', onclick: () => {
        const v = parseFloat(field.input.value);
        if (!Number.isFinite(v) || v <= 0) { toast('Enter a valid weight'); field.input.focus(); return; }
        store.addWeight(store.today(), weightIn(v));
        toast('Weight logged');
        closeSheet();
        switchTab('trends');
      },
    }),
  ));
  openSheet(body, { title: 'Log weight' });
}

/* ================= sheets: profile ================= */

function openProfileSheet(existing) {
  const p = existing || { sex: 'female', birthYear: 1995, heightCm: 165, weightKg: 65, activity: 'light', goal: 'maintain' };
  const body = h('div', {});

  const birthYear = numberField({ label: 'Year of birth', id: 'pBirth', value: p.birthYear, min: 1920, max: 2012, step: 1 });
  const height = numberField({
    label: `Height (${useMetric() ? 'cm' : 'inches'})`, id: 'pHeight',
    value: useMetric() ? Math.round(p.heightCm) : Math.round(p.heightCm / 2.54), step: 1,
  });
  const weight = numberField({
    label: `Weight (${useMetric() ? 'kg' : 'lb'})`, id: 'pWeight',
    value: weightOut(p.weightKg), step: '0.1',
  });
  const goalWeight = numberField({
    label: `Goal weight (${useMetric() ? 'kg' : 'lb'}) — optional`, id: 'pGoalW',
    value: p.goalWeightKg ? weightOut(p.goalWeightKg) : '',
    step: '0.1', presets: [],
  });

  const live = h('div', { class: 'live-targets' });

  function current() {
    const by = parseInt(birthYear.input.value, 10) || 1990;
    const hv = parseFloat(height.input.value) || 170;
    const wv = parseFloat(weight.input.value) || 65;
    const gv = parseFloat(goalWeight.input.value);
    return {
      sex: p.sex,
      birthYear: by,
      heightCm: useMetric() ? hv : hv * 2.54,
      weightKg: weightIn(wv),
      goalWeightKg: Number.isFinite(gv) && gv > 0 ? weightIn(gv) : null,
      activity: p.activity,
      goal: p.goal,
    };
  }

  function refresh() {
    const t = targets(current());
    if (!t) return;
    live.innerHTML = `
      <div class="lt-row"><span>Maintenance</span><b>${fmtKcal(t.tdee)} kcal</b></div>
      <div class="lt-row hl"><span>Your daily target</span><b>${fmtKcal(t.kcal)} kcal</b></div>
      <div class="lt-row"><span>Protein · Carbs · Fat</span><b>${t.protein}g · ${t.carbs}g · ${t.fat}g</b></div>
      <div class="lt-row"><span>Expected pace</span><b>${esc(t.goalRate)}</b></div>`;
  }

  for (const f of [birthYear, height, weight, goalWeight]) f.input.addEventListener('input', refresh);

  body.append(h('span', { class: 'field-label' }, 'Sex (used by the metabolic formula)'));
  body.append(radioGroup('pSex', [{ value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }], p.sex));
  body.querySelectorAll('input[name="pSex"]').forEach((i) =>
    i.addEventListener('change', () => { p.sex = i.value; refresh(); }));

  body.append(birthYear, height, weight, goalWeight);

  body.append(h('span', { class: 'field-label' }, 'Activity level'));
  const actField = selectField({
    label: '', id: 'pActivity', value: p.activity,
    options: Object.entries(ACTIVITY_MULTIPLIERS).map(([value, m]) => ({ value, label: `${m.label} — ${m.hint}` })),
  });
  body.append(actField);
  actField.input.addEventListener('change', () => { p.activity = actField.input.value; refresh(); });

  body.append(h('span', { class: 'field-label' }, 'Goal'));
  body.append(radioGroup('pGoal', Object.entries(GOALS).map(([value, g]) => ({ value, label: g.label, hint: g.rate })), p.goal));
  body.querySelectorAll('input[name="pGoal"]').forEach((i) =>
    i.addEventListener('change', () => { p.goal = i.value; refresh(); }));

  body.append(live);
  refresh();

  body.append(h('div', { class: 'sheet-actions' },
    btn('Save profile', {
      kind: 'btn-primary', onclick: () => {
        const c = current();
        if (c.birthYear < 1920 || c.birthYear > new Date().getFullYear() - 14) {
          toast('Enter a valid year of birth'); birthYear.input.focus(); return;
        }
        if (c.heightCm < 100 || c.heightCm > 250) { toast('Check your height'); height.input.focus(); return; }
        if (c.weightKg < 30 || c.weightKg > 300) { toast('Check your weight'); weight.input.focus(); return; }
        if (c.goalWeightKg != null && (c.goalWeightKg < 30 || c.goalWeightKg > 300)) {
          toast('Goal weight must be between 30 and 300');
          goalWeight.input.focus();
          return;
        }
        store.saveProfile(c);
        toast('Targets updated');
        closeSheet();
        switchTab('today');
      },
    }),
  ));

  openSheet(body, { title: existing ? 'Profile & goals' : 'Welcome' });
}

/* ================= data ================= */

function exportData() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `calorie-tracker-${store.today()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Export downloaded');
}

function importData(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (!confirm('Importing replaces all current data. Continue?')) return;
    try {
      store.importJSON(String(reader.result));
      refreshCustomIndex();
      applyTheme();
      toast('Data imported');
      renderAll();
      maybeOnboard();
    } catch (err) {
      toast('Could not read that file');
    }
  };
  reader.readAsText(file);
}

function doReset() {
  if (!confirm('Delete everything — profile, log, weights and custom foods? This cannot be undone.')) return;
  if (!confirm('Really delete all data?')) return;
  store.resetAll();
  refreshCustomIndex();
  applyTheme();
  toast('All data deleted');
  renderAll();
  maybeOnboard();
}

/* ================= navigation ================= */

function switchTab(next) {
  tab = next;
  for (const s of $$('.screen')) s.hidden = s.id !== `screen-${next}`;
  for (const b of $$('.tab')) b.classList.toggle('active', b.dataset.tab === next);
  const bar = $('#appBar');
  bar.hidden = next === 'you';
  window.scrollTo({ top: 0, behavior: 'instant' });
  renderAll();
}

function setDate(next) {
  const todayISO = store.today();
  if (next > todayISO) return;
  date = next;
  updateDateBar();
  renderToday();
}

function updateDateBar() {
  const todayISO = store.today();
  $('#dateLabel').textContent = prettyLabel(date);
  $('#dateNext').disabled = date >= todayISO;
  $('#todayBtn').hidden = date === todayISO;
}

function prettyLabel(iso) {
  const t = store.today();
  const diff = Math.round((new Date(iso) - new Date(t)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  const d = new Date(iso);
  const same = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric',
    month: same ? 'short' : 'short', year: same ? undefined : 'numeric',
  });
}

function openDateSheet() {
  const body = h('div', {});
  const todayISO = store.today();

  const quick = [
    ['Today', todayISO],
    ['Yesterday', store.addDays(todayISO, -1)],
    ['2 days ago', store.addDays(todayISO, -2)],
    ['3 days ago', store.addDays(todayISO, -3)],
    ['1 week ago', store.addDays(todayISO, -7)],
    ['2 weeks ago', store.addDays(todayISO, -14)],
  ];

  const list = h('div', { class: 'date-list' });
  for (const [label, iso] of quick) {
    const count = (store.getDay(iso).food || []).length;
    list.append(h('button', {
      type: 'button',
      class: `date-opt${iso === date ? ' current' : ''}`,
      onclick: () => { closeSheet(); setDate(iso); switchTab('today'); },
    },
      h('span', { class: 'date-opt-main' }, label),
      h('span', { class: 'date-opt-sub' },
        `${count ? `${count} ${count === 1 ? 'item' : 'items'}` : 'nothing logged'}`),
    ));
  }
  body.append(list);

  // A visible native picker for anything older.
  const picker = h('input', { type: 'date', id: 'datePick', value: date, max: todayISO });
  picker.addEventListener('change', () => {
    if (!picker.value) return;
    closeSheet();
    setDate(picker.value);
    switchTab('today');
  });
  body.append(h('label', { class: 'field', for: 'datePick' },
    h('span', { class: 'field-label' }, 'Go to a date'),
    h('div', { class: 'field-row' }, picker),
  ));

  openSheet(body, { title: 'Jump to date' });
}

function renderAll() {
  // Before onboarding there is no profile, so there is nothing to compute yet.
  if (!store.getProfile()) return;
  if (tab === 'today') { updateDateBar(); renderToday(); }
  if (tab === 'add') renderSearch($('#foodSearch').value);
  if (tab === 'trends') renderTrends();
  if (tab === 'you') renderYou();
}

/* ================= theme ================= */

function applyTheme() {
  const mode = store.getState().settings.theme;
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const icon = $('#themeIcon');
  if (icon) {
    icon.innerHTML = dark
      ? '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>'
      : '<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>';
  }
}

function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const cur = store.getState().settings.theme;
  const next = order[(order.indexOf(cur) + 1) % order.length];
  store.setSetting({ theme: next });
  applyTheme();
  toast(`Theme: ${next}`);
}

/* ================= onboarding ================= */

function maybeOnboard() {
  if (store.getState().settings.onboarded && store.getProfile()) return;
  setTimeout(() => openProfileSheet(null), 400);
}

/* ================= init ================= */

function initEvents() {
  for (const b of $$('.tab')) {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  }

  $('#datePrev').addEventListener('click', () => setDate(store.addDays(date, -1)));
  $('#dateNext').addEventListener('click', () => setDate(store.addDays(date, 1)));
  $('#todayBtn').addEventListener('click', () => setDate(store.today()));
  $('#themeBtn').addEventListener('click', cycleTheme);

  // iOS Safari will not open a date picker from a programmatic .click() on a
  // hidden input, so offer a real sheet instead.
  $('#dateLabel').addEventListener('click', openDateSheet);

  const search = $('#foodSearch');
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      $('#searchClear').hidden = !search.value;
      renderSearch(search.value);
    }, 90);
  });
  $('#searchClear').addEventListener('click', () => {
    search.value = '';
    $('#searchClear').hidden = true;
    renderSearch('');
    search.focus();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('#searchResults .food-row');
      if (first) first.click();
    }
  });

  $('[data-open-sheet="activity"]').addEventListener('click', openActivitySheet);

  for (const b of $$('#trendRange button')) {
    b.addEventListener('click', () => {
      trendRange = Number(b.dataset.range);
      for (const x of $$('#trendRange button')) x.classList.toggle('active', x === b);
      renderTrends();
    });
  }

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    const card = $('#installCard');
    if (card) { card.hidden = false; }
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    const card = $('#installCard');
    if (card) card.hidden = true;
  });
}

function initServiceWorker() {
  const note = $('#swNote');
  const warn = (msg) => {
    if (!note) return;
    note.textContent = msg;
    note.hidden = false;
  };

  if (!window.isSecureContext) {
    warn('Offline mode needs HTTPS (or localhost). Open the app over a secure address to install it on your phone.');
    return;
  }
  if (!('serviceWorker' in navigator)) {
    warn('This browser has no offline support, so the app needs a connection to open.');
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('SW registration failed', err);
      warn('Offline caching could not start. You can still use the app, but it needs a connection to open.');
    });
  });
}

function boot() {
  initSheet();
  initEvents();
  initInstallPrompt();
  initServiceWorker();
  applyTheme();

  store.subscribe(() => renderAll());

  // The boot overlay sits at z-index 200 over everything. If a render throws
  // before it is removed, the whole app becomes untouchable — so it always goes.
  try {
    switchTab('today');
    if (!store.getProfile()) maybeOnboard();
  } catch (err) {
    console.error('Startup failed', err);
    toast('Something went wrong starting up. Try reloading.');
  } finally {
    $('#boot')?.remove();
  }

  setInterval(() => { if (tab === 'today' && date === store.today()) renderToday(); }, 60000);
}

document.addEventListener('DOMContentLoaded', boot);
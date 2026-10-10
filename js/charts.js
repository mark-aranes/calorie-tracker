/** Tiny dependency-free SVG chart builders. */

import { parseISO } from './store.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Daily intake columns with a target reference line.
 * @param {Array} rows [{ date, kcal, burned }]
 */
export function calorieChart(rows, target) {
  const W = 380, H = 210, PAD = 26, BASE = H - 26, TOP = 16;
  const n = rows.length;
  if (!n) return '<p class="muted pad">No data yet.</p>';

  const budgets = rows.map((r) => r.kcal + (r.burned || 0));
  const max = Math.max(target, ...budgets, ...rows.map((r) => r.kcal)) * 1.12 || 2000;
  const slot = (W - PAD * 2) / n;
  const bw = Math.max(3, Math.min(26, slot * 0.62));
  const y = (v) => BASE - (v / max) * (BASE - TOP);

  const targetY = y(target);
  const bars = rows.map((r, i) => {
    const cx = PAD + slot * i + slot / 2;
    const budget = budgets[i];
    const v = r.kcal;
    const h = Math.max(v > 0 ? 3 : 0, BASE - y(v));
    let fill = 'var(--ok)';
    if (budget > 0) {
      const dev = v / budget;
      fill = dev > 1.1 ? 'var(--bad)' : dev < 0.7 ? 'var(--warn)' : 'var(--ok)';
    }
    const title = `${r.date}: ${Math.round(v)} kcal${r.burned ? ` (+${r.burned} burned)` : ''}`;
    const label = i % Math.ceil(n / 7) === 0 || i === n - 1
      ? `<text x="${cx}" y="${BASE + 17}" class="ax">${parseISO(r.date).getDate()}</text>`
      : '';
    return `<g><title>${esc(title)}</title>
      <rect x="${cx - bw / 2}" y="${y(v)}" width="${bw}" height="${h}" rx="3" fill="${fill}" opacity="0.92"/></g>${label}`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Daily calorie intake against target">
    <line x1="${PAD}" y1="${targetY}" x2="${W - PAD}" y2="${targetY}" class="target-line"/>
    <text x="${W - PAD}" y="${targetY - 6}" class="ax target-label" text-anchor="end">target ${Math.round(target)}</text>
    <line x1="${PAD}" y1="${BASE}" x2="${W - PAD}" y2="${BASE}" class="axis-line"/>
    ${bars}
  </svg>`;
}

/** Weight line chart with an optional goal line. */
export function weightChart(points, goalKg = null) {
  const W = 380, H = 200, PAD = 28, BASE = H - 26, TOP = 18;
  if (points.length < 2) return '<p class="muted pad">Log your weight on at least two days to see the trend.</p>';

  const xs = points.map((p) => parseISO(p.date).getTime());
  const ys = points.map((p) => p.kg);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1.5; hi = mid + 1.5; }

  const pad = (hi - lo) * 0.18;
  lo -= pad; hi += pad;

  // Only draw the goal when it actually lands inside the plotted range,
  // otherwise it sits off-canvas and the real trend flattens to fit it.
  const showGoal = goalKg != null && goalKg >= lo && goalKg <= hi;

  const tMin = Math.min(...xs), tMax = Math.max(...xs);
  const x = (t) => PAD + ((t - tMin) / (tMax - tMin || 1)) * (W - PAD * 2);
  const y = (v) => BASE - ((v - lo) / (hi - lo)) * (BASE - TOP);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(ys[i]).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(xs[i]).toFixed(1)}" cy="${y(ys[i]).toFixed(1)}" r="4" class="pt"><title>${esc(p.date)}: ${p.kg.toFixed(1)} kg</title></circle>`).join('');
  const first = points[0], last = points[points.length - 1];

  const shortDate = (iso) => parseISO(iso)
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  const goalMark = showGoal
    ? `<line x1="${PAD}" y1="${y(goalKg).toFixed(1)}" x2="${W - PAD}" y2="${y(goalKg).toFixed(1)}" class="goal-line"/>
       <text x="${W - PAD}" y="${(y(goalKg) - 6).toFixed(1)}" class="ax goal-label" text-anchor="end">goal ${goalKg.toFixed(1)}</text>`
    : '';

  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Weight over time${showGoal ? `, goal ${goalKg.toFixed(1)} kilograms` : ''}">
    <line x1="${PAD}" y1="${BASE}" x2="${W - PAD}" y2="${BASE}" class="axis-line"/>
    ${goalMark}
    <path d="${path}" class="line"/>
    ${dots}
    <text x="${PAD}" y="${H - 6}" class="ax">${esc(shortDate(first.date))} · ${first.kg.toFixed(1)}</text>
    <text x="${W - PAD}" y="${H - 6}" class="ax" text-anchor="end">${esc(shortDate(last.date))} · ${last.kg.toFixed(1)}</text>
  </svg>`;
}

const MACRO_STYLE = {
  protein: { cls: 'm-prot', label: 'Protein' },
  carbs: { cls: 'm-carb', label: 'Carbs' },
  fat: { cls: 'm-fat', label: 'Fat' },
};

/**
 * Small multiples: one compact bar chart per macro, sharing a day axis,
 * each with its own target line. Answers "which days did I hit protein?"
 * rather than only showing the period average.
 */
export function macroCharts(rows, tg) {
  const W = 380, PAD = 26;
  const n = rows.length;
  if (!n) return '<p class="muted pad">No data yet.</p>';

  const PANEL = 86;      // vertical space per macro
  const BASE = 54;       // baseline inside a panel
  const PLOT = 38;       // usable height for bars
  const TITLE = 11;

  const panels = Object.entries(MACRO_STYLE).map(([key, style], pi) => {
    const target = tg[key];
    const peak = Math.max(target, ...rows.map((r) => r[key] || 0)) * 1.15 || 1;
    const slot = (W - PAD * 2) / n;
    const bw = Math.max(2, Math.min(16, slot * 0.58));
    const y = (v) => BASE - (v / peak) * PLOT;

    const bars = rows.map((r, i) => {
      const v = r[key] || 0;
      const h = Math.max(v > 0 ? 2 : 0, BASE - y(v));
      const cls = target > 0 && v > target * 1.1 ? 'over'
        : target > 0 && v < target * 0.6 ? 'under' : 'hit';
      const cx = PAD + slot * i + slot / 2;
      return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="mb ${cls}"><title>${esc(r.date)}: ${Math.round(v)} g ${esc(style.label.toLowerCase())} (target ${target} g)</title></rect>`;
    }).join('');

    const dayTicks = rows.map((r, i) =>
      (i % Math.ceil(n / 7) === 0 || i === n - 1)
        ? `<text x="${(PAD + slot * i + slot / 2).toFixed(1)}" y="${BASE + 16}" class="ax" text-anchor="middle">${parseISO(r.date).getDate()}</text>`
        : '').join('');

    return `<g transform="translate(0,${pi * PANEL})">
      <text x="${PAD}" y="${TITLE}" class="ax m-title">${esc(style.label)} · target ${target} g</text>
      <line x1="${PAD}" y1="${BASE}" x2="${W - PAD}" y2="${BASE}" class="axis-line"/>
      <line x1="${PAD}" y1="${y(target).toFixed(1)}" x2="${W - PAD}" y2="${y(target).toFixed(1)}" class="m-target"/>
      ${bars}
      ${dayTicks}
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${PANEL * 3}" class="chart-svg macro-svg" role="img" aria-label="Daily protein, carbohydrate and fat against their targets">
    ${panels}
  </svg>`;
}
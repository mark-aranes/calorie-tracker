/** Tiny dependency-free SVG chart builders. */

import { parseISO } from './store.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Daily intake columns with a target reference line.
 * @param {Array} rows [{ date, kcal, burned }]
 */
export function calorieChart(rows, target) {
  const W = 700, H = 260, PAD = 34, BASE = H - 30, TOP = 18;
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

/** Weight line chart with first/last labels. */
export function weightChart(points) {
  const W = 700, H = 220, PAD = 40, BASE = H - 28, TOP = 20;
  if (points.length < 2) return '<p class="muted pad">Log your weight on at least two days to see the trend.</p>';

  const xs = points.map((p) => parseISO(p.date).getTime());
  const ys = points.map((p) => p.kg);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1.5; hi = mid + 1.5; }
  const pad = (hi - lo) * 0.18;
  lo -= pad; hi += pad;

  const tMin = Math.min(...xs), tMax = Math.max(...xs);
  const x = (t) => PAD + ((t - tMin) / (tMax - tMin || 1)) * (W - PAD * 2);
  const y = (v) => BASE - ((v - lo) / (hi - lo)) * (BASE - TOP);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(ys[i]).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(xs[i]).toFixed(1)}" cy="${y(ys[i]).toFixed(1)}" r="4" class="pt"><title>${esc(p.date)}: ${p.kg} kg</title></circle>`).join('');
  const first = points[0], last = points[points.length - 1];

  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="Weight over time">
    <line x1="${PAD}" y1="${BASE}" x2="${W - PAD}" y2="${BASE}" class="axis-line"/>
    <path d="${path}" class="line"/>
    ${dots}
    <text x="${PAD}" y="${H - 6}" class="ax">${esc(first.date)} · ${first.kg} kg</text>
    <text x="${W - PAD}" y="${H - 6}" class="ax" text-anchor="end">${esc(last.date)} · ${last.kg} kg</text>
  </svg>`;
}
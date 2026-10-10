/** DOM helpers, bottom sheet, toasts and number formatting. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Escape untrusted text before it goes anywhere near innerHTML. */
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtKcal = (n) => Math.round(n).toLocaleString();

export function fmtQty(grams) {
  if (grams >= 1000) return `${(grams / 1000).toFixed(grams % 1000 ? 1 : 0)} kg`;
  return `${Math.round(grams)} g`;
}

/* ---------- toast ---------- */

let toastTimer;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------- bottom sheet ---------- */

let onCloseCb = null;
let clearTimer = null;

export function openSheet(content, { title } = {}) {
  const sheet = $('#sheet');
  const body = $('#sheetBody');

  // A pending close() would otherwise wipe the content we are about to add.
  clearTimeout(clearTimer);

  body.innerHTML = '';
  if (title) body.append(h('h2', { class: 'sheet-title' }, title));
  body.append(typeof content === 'string' ? h('div', { html: content }) : content);
  sheet.scrollTop = 0;
  requestAnimationFrame(() => sheet.classList.add('open'));
  document.body.classList.add('sheet-open');
  return body;
}

export function closeSheet() {
  const sheet = $('#sheet');
  if (!sheet.classList.contains('open')) return;
  sheet.classList.remove('open');
  document.body.classList.remove('sheet-open');
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => { $('#sheetBody').innerHTML = ''; }, 260);
  if (onCloseCb) { onCloseCb(); onCloseCb = null; }
}

export function initSheet() {
  $('#backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
}

/* ---------- controls ---------- */

/** Number field with quick stepper chips. */
export function numberField({ label, id, value, min = 0, max = 1000, step = 1, unit = '', presets = [] }) {
  const wrap = h('label', { class: 'field', for: id });
  wrap.append(h('span', { class: 'field-label' }, label));
  const row = h('div', { class: 'field-row' });
  const input = h('input', {
    type: 'number', id, name: id, value: value ?? '', min, max, step,
    inputmode: 'decimal', autocomplete: 'off',
  });
  row.append(input);
  if (unit) row.append(h('span', { class: 'field-unit' }, unit));
  wrap.append(row);
  if (presets.length) {
    const chips = h('div', { class: 'chip-row tight' });
    for (const p of presets) {
      chips.append(h('button', {
        type: 'button', class: 'chip',
        onclick: () => { input.value = p; input.dispatchEvent(new Event('input', { bubbles: true })); },
      }, String(p)));
    }
    wrap.append(chips);
  }
  wrap.input = input;
  return wrap;
}

export function segmented(options, value, onPick) {
  const wrap = h('div', { class: 'segmented in-sheet' });
  for (const o of options) {
    wrap.append(h('button', {
      type: 'button',
      class: value === o.value ? 'active' : '',
      onclick: () => {
        [...wrap.children].forEach((c) => c.classList.remove('active'));
        wrap.querySelector(`[data-v="${CSS.escape(String(o.value))}"]`)?.classList.add('active');
        onPick(o.value);
      },
      'data-v': o.value,
      title: o.hint || '',
    }, o.label));
  }
  return wrap;
}

export function radioGroup(name, options, value) {
  const wrap = h('div', { class: 'radio-grid' });
  const sync = () => {
    for (const input of wrap.querySelectorAll('input')) {
      input.closest('.radio').classList.toggle('selected', input.checked);
    }
  };
  for (const o of options) {
    const id = `${name}-${o.value}`;
    const input = h('input', {
      type: 'radio', name, id, value: o.value, checked: o.value === value,
      onchange: sync,
    });
    wrap.append(h('label', { class: 'radio', for: id },
      input,
      h('span', { class: 'radio-label' }, o.label),
      o.hint ? h('span', { class: 'radio-hint' }, o.hint) : null,
    ));
  }
  sync();
  return wrap;
}

export function selectField({ label, id, value, options }) {
  const wrap = h('label', { class: 'field', for: id });
  wrap.append(h('span', { class: 'field-label' }, label));
  const sel = h('select', { id, name: id });
  for (const o of options) {
    sel.append(h('option', { value: o.value, selected: o.value === value }, o.label));
  }
  wrap.append(sel);
  wrap.input = sel;
  return wrap;
}

export function btn(label, { kind = '', onclick, type = 'button' } = {}) {
  return h('button', { type, class: `btn ${kind}`.trim(), onclick }, label);
}
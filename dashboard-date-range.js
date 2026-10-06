import { validateRange } from '/dashboard-data.js';
import { icon, escape as h } from '/dashboard-icons.js';

const DAY = 86400000;
const utcDate = iso => new Date(`${iso}T00:00:00Z`);
const key = date => date.toISOString().slice(0, 10);
const monthStart = iso => `${iso.slice(0, 7)}-01`;
export function localDateKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function shiftDate(iso, deltaDays) { return key(new Date(utcDate(iso).getTime() + deltaDays * DAY)); }
export function shiftMonth(iso, deltaMonths) {
  const date = utcDate(monthStart(iso));
  date.setUTCMonth(date.getUTCMonth() + deltaMonths);
  return key(date);
}
export function monthDays(month) {
  const first = monthStart(month), start = shiftDate(first, -utcDate(first).getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = shiftDate(start, index);
    return { date, inMonth: date.slice(0, 7) === first.slice(0, 7) };
  });
}
export function dateLabel(iso, { short = false } = {}) {
  return utcDate(iso).toLocaleDateString('id-ID', { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' });
}
export function formatRange({ start, end }) {
  return start === end ? dateLabel(start, { short: true }) : `${dateLabel(start, { short: true })} – ${dateLabel(end, { short: true })}`;
}
export function rangePresets(today) {
  const first = monthStart(today), weekStart = shiftDate(today, -(utcDate(today).getUTCDay() + 6) % 7);
  return [
    { id: 'today', label: 'Hari ini', start: today, end: today },
    { id: 'yesterday', label: 'Kemarin', start: shiftDate(today, -1), end: shiftDate(today, -1) },
    { id: 'last7', label: '7 hari terakhir', start: shiftDate(today, -6), end: today },
    { id: 'thisWeek', label: 'Minggu ini', start: weekStart, end: shiftDate(weekStart, 6) },
    { id: 'lastWeek', label: 'Minggu lalu', start: shiftDate(weekStart, -7), end: shiftDate(weekStart, -1) },
    { id: 'last30', label: '30 hari terakhir', start: shiftDate(today, -29), end: today },
    { id: 'thisMonth', label: 'Bulan ini', start: first, end: shiftDate(shiftMonth(first, 1), -1) },
    { id: 'lastMonth', label: 'Bulan lalu', start: shiftMonth(first, -1), end: shiftDate(first, -1) },
  ];
}
export function selectRangeDate(range, date) {
  if (range.end || !range.start) return { start: date, end: '' };
  return date < range.start ? { start: date, end: range.start } : { start: range.start, end: date };
}

// Draft selection stays inside the dialog. Reports only change after Apply.
export function mountDateRange(panel, { range, onApply, signal }) {
  const host = panel.querySelector('[data-range-picker]');
  const summary = panel.querySelector('[data-range-summary]');
  const apply = panel.querySelector('[data-range-apply]');
  const wide = window.matchMedia('(min-width: 860px)');
  const today = localDateKey(), presets = rangePresets(today);
  let draft = { ...range }, month = monthStart(range.start), focusDate = range.start, hoverDate = '';
  const count = () => wide.matches ? 2 : 1;
  const visible = date => date >= month && date < shiftMonth(month, count());
  const contains = (date, start, end) => !!start && !!end && date >= start && date <= end;
  const listen = (target, event, handler) => target.addEventListener(event, handler, { signal });
  const validationError = () => {
    if (!draft.end) return '';
    try { validateRange(draft); return ''; } catch (error) { return error.message; }
  };
  function calendar(value) {
    const title = utcDate(value).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const cells = monthDays(value);
    const rows = Array.from({ length: 6 }, (_, row) => `<tr>${cells.slice(row * 7, row * 7 + 7).map(({ date, inMonth }) => {
      if (!inMonth) return '<td class="range-empty"></td>';
      const start = date === draft.start, end = date === draft.end;
      return `<td class="range-cell ${contains(date, draft.start, draft.end) ? 'in-range' : ''} ${start ? 'range-start' : ''} ${end ? 'range-end' : ''}"><button type="button" class="range-day ${date === today ? 'is-today' : ''}" data-date="${date}" tabindex="${date === focusDate ? '0' : '-1'}" aria-label="${h(dateLabel(date))}${start ? ', tanggal awal' : ''}${end ? ', tanggal akhir' : ''}" aria-pressed="${contains(date, draft.start, draft.end) || start}" ${date === today ? 'aria-current="date"' : ''}>${Number(date.slice(-2))}</button></td>`;
    }).join('')}</tr>`).join('');
    return `<section class="range-month" aria-label="${h(title)}"><h3>${h(title)}</h3><table class="range-calendar" aria-label="${h(title)}"><thead><tr>${['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map(day => `<th scope="col">${day}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></section>`;
  }
  function paint(focusSelector) {
    if (!visible(focusDate)) focusDate = month;
    const error = validationError();
    host.innerHTML = `<div class="range-layout"><nav class="range-presets" aria-label="Pilihan periode cepat"><span class="range-eyebrow">PERIODE CEPAT</span>${presets.map(preset => `<button type="button" data-range-preset="${preset.id}" class="range-preset ${draft.start === preset.start && draft.end === preset.end ? 'selected' : ''}" aria-pressed="${draft.start === preset.start && draft.end === preset.end}">${preset.label}</button>`).join('')}</nav><div class="range-main"><div class="range-endpoints"><div class="range-endpoint ${draft.end ? '' : 'has-selection'}"><span>Dari tanggal</span><strong>${h(dateLabel(draft.start))}</strong></div><span class="range-between" aria-hidden="true">${icon('arrow')}</span><div class="range-endpoint ${draft.end ? '' : 'awaiting'}"><span>Sampai tanggal</span><strong>${draft.end ? h(dateLabel(draft.end)) : 'Pilih tanggal akhir'}</strong></div></div><div class="range-calendar-wrap"><div class="range-month-nav"><button type="button" class="icon-btn range-prev" data-range-nav="-1" aria-label="Bulan sebelumnya">${icon('chevron')}</button><button type="button" class="icon-btn" data-range-nav="1" aria-label="Bulan berikutnya">${icon('chevron')}</button></div><div class="range-months">${calendar(month)}${wide.matches ? calendar(shiftMonth(month, 1)) : ''}</div></div><p class="range-hint" aria-live="polite">${draft.end ? 'Klik tanggal untuk mulai memilih rentang baru.' : 'Sekarang pilih tanggal akhir. Klik tanggal yang sama untuk satu hari.'}</p><p id="period-error" role="alert">${h(error)}</p></div></div>`;
    const days = draft.end ? Math.round((utcDate(draft.end) - utcDate(draft.start)) / DAY) + 1 : 0;
    summary.innerHTML = `<strong>${draft.end ? h(formatRange(draft)) : h(dateLabel(draft.start)) + ' – …'}</strong><span>${draft.end ? `${days} hari dipilih` : 'Pilih tanggal akhir untuk melanjutkan'}</span>`;
    apply.disabled = !draft.end || !!error;
    if (focusSelector) {
      const focused = host.querySelector(focusSelector);
      focused?.focus({ preventScroll: true });
      // Keep keyboard-selected dates visible when the dialog body must scroll.
      if (focused?.dataset.date) focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
  function preview(date = '') {
    if (draft.end || hoverDate === date) return;
    hoverDate = date;
    const range = date ? selectRangeDate(draft, date) : null;
    host.querySelectorAll('[data-date]').forEach(button => {
      const cell = button.parentElement;
      cell.classList.toggle('range-preview', !!range && contains(button.dataset.date, range.start, range.end));
      cell.classList.toggle('preview-start', !!range && button.dataset.date === range.start);
      cell.classList.toggle('preview-end', !!range && button.dataset.date === range.end);
    });
  }
  listen(host, 'click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.rangePreset) {
      const preset = presets.find(item => item.id === button.dataset.rangePreset);
      draft = { start: preset.start, end: preset.end }; month = monthStart(draft.start); focusDate = draft.start; hoverDate = '';
      paint(`[data-range-preset="${preset.id}"]`);
    } else if (button.dataset.rangeNav) {
      month = shiftMonth(month, Number(button.dataset.rangeNav)); hoverDate = '';
      paint(`[data-range-nav="${button.dataset.rangeNav}"]`);
    } else if (button.dataset.date) {
      draft = selectRangeDate(draft, button.dataset.date); focusDate = button.dataset.date; hoverDate = '';
      paint(`[data-date="${focusDate}"]`);
    }
  });
  listen(host, 'pointerover', event => {
    if (event.pointerType === 'touch') return;
    const date = event.target.closest('[data-date]')?.dataset.date;
    preview(date || '');
  });
  listen(host, 'pointerleave', () => preview());
  listen(host, 'focusin', event => {
    const button = event.target.closest('[data-date]');
    if (!button) return;
    focusDate = button.dataset.date;
    host.querySelectorAll('[data-date]').forEach(day => { day.tabIndex = day === button ? 0 : -1; });
    preview(focusDate);
  });
  listen(host, 'keydown', event => {
    const button = event.target.closest('[data-date]');
    if (!button) return;
    const date = button.dataset.date;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    let next;
    if (delta) next = shiftDate(date, delta);
    if (event.key === 'Home') next = shiftDate(date, -utcDate(date).getUTCDay());
    if (event.key === 'End') next = shiftDate(date, 6 - utcDate(date).getUTCDay());
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const targetMonth = shiftMonth(date, event.key === 'PageUp' ? -1 : 1);
      const lastDay = Number(shiftDate(shiftMonth(targetMonth, 1), -1).slice(-2));
      next = shiftDate(targetMonth, Math.min(Number(date.slice(-2)), lastDay) - 1);
    }
    if (!next) return;
    event.preventDefault(); focusDate = next; hoverDate = '';
    if (!visible(next)) month = monthStart(next);
    paint(`[data-date="${next}"]`);
  });
  listen(apply, 'click', () => {
    if (!draft.end || validationError()) return;
    onApply({ ...validateRange(draft) });
  });
  listen(wide, 'change', () => {
    const active = panel.ownerDocument.activeElement;
    const focusedDate = active?.dataset.date;
    const focusedControl = focusedDate ? `[data-date="${focusedDate}"]`
      : active?.dataset.rangePreset ? `[data-range-preset="${active.dataset.rangePreset}"]`
      : active?.dataset.rangeNav ? `[data-range-nav="${active.dataset.rangeNav}"]` : undefined;
    if (focusedDate && !visible(focusedDate)) month = monthStart(focusedDate);
    paint(focusedControl);
  });
  paint();
}

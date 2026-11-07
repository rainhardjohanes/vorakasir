import { readExpense } from '/dashboard-lib-businessExpenses.js';

const DEFAULT_TIME_ZONE = 'Asia/Makassar';
const validId = value => typeof value === 'string' && value.trim().length > 0;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number(value.slice(0, 4)) > 0 && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

export function resolveCashOutTimezone(value) {
  const zone = typeof value === 'string' ? value.trim() : '';
  if (zone) {
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); return zone; }
    catch { /* An absent/invalid outlet setting uses the established outlet default. */ }
  }
  return DEFAULT_TIME_ZONE;
}

function cashFlowTimestamp(value) {
  // A timestamp without its UTC offset would silently use the browser's timezone.
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!match || !validDay(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59
    || Number(match[4]) > 59 || Number(match[6] || 0) > 23 || Number(match[7] || 0) > 59) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : null;
}

function positiveAmount(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+(?:\.0+)?$/.test(value))) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/** Drawer movements awaiting classification; these are never operating expenses. */
export function summarizeManualCashOut(mixedCashFlowsAndLedger, outletId, range, timeZone = DEFAULT_TIME_ZONE) {
  const zone = resolveCashOutTimezone(timeZone);
  if (!validDay(range?.start) || !validDay(range?.end) || range.start > range.end) {
    throw new Error('Pilih tanggal laporan yang valid.');
  }
  const records = Array.isArray(mixedCashFlowsAndLedger) ? mixedCashFlowsAndLedger : [];
  const scoped = validId(outletId) ? records.filter(row => row && row.outlet_id === outletId && validId(row.id)) : [];
  const linkedFlowIds = new Set();
  // Find links before filtering dates: an expense's business date can differ from
  // the cash movement date, and a nested join may return one object or an array.
  for (const row of scoped) {
    if (validId(row.cash_flow_id)) linkedFlowIds.add(row.cash_flow_id);
    const children = Array.isArray(row.linked_expenses) ? row.linked_expenses
      : row.linked_expenses && typeof row.linked_expenses === 'object' ? [row.linked_expenses] : [];
    if (children.some(child => child && validId(child.id) && child.outlet_id === outletId
      && validId(child.cash_flow_id) && child.cash_flow_id === row.id)) linkedFlowIds.add(row.id);
    // A repeated record must not make an already classified/refund/stock flow
    // appear manual just because another copy has fewer fields.
    if (row.type === 'OUT' && (row.refund_id || row.inventory_document_id || readExpense(row))) linkedFlowIds.add(row.id);
  }
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const unique = new Map();
  for (const record of scoped) {
    if (record.type !== 'OUT' || record.funding_source || record.cash_flow_id || linkedFlowIds.has(record.id)
      || unique.has(record.id)) continue;
    const amount = positiveAmount(record.amount), stamp = cashFlowTimestamp(record.created_at);
    if (amount === null || stamp === null) continue;
    const parts = Object.fromEntries(formatter.formatToParts(stamp).map(part => [part.type, part.value]));
    const date = `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
    if (date < range.start || date > range.end) continue;
    unique.set(record.id, { id: record.id, date, label: 'Kas keluar manual',
      description: typeof record.description === 'string' ? record.description : '', amount,
      staff: typeof record.staff_name === 'string' ? record.staff_name : '', source: 'Kas laci', manual: true, record });
  }
  const rows = [...unique.values()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const total = rows.reduce((sum, row) => {
    const next = sum + row.amount;
    if (!Number.isSafeInteger(next)) throw new Error('Total kas keluar melebihi batas angka yang aman.');
    return next;
  }, 0);
  return { rows, total, timeZone: zone };
}

import { verifyOwner } from '/dashboard-operations-data.js';
import { validateRange } from '/dashboard-data.js';
import { resolveCashOutTimezone } from '/dashboard-manual-cash-out.js';

// Existing, owner-readable tables only. This report never changes a shift,
// receipt, refund, staff profile, or the stored closing figures.
export const SHIFT_REPORT_FIELDS = 'id,outlet_id,staff_id,starting_cash,opened_at,closed_at,status,expected_cash,actual_cash,difference,notes';
export const SHIFT_STAFF_FIELDS = 'id,outlet_id,name,role,updated_at,deleted_at';
export const SHIFT_SALE_FIELDS = 'id,outlet_id,date,time,cashier,table_type,items,total,subtotal,service,tax,method,status,cart_data,customer,discount,promo_id,payment_surcharge,mdr_fee,refunded_amount,refunded_quantities,refund_revision,refunded_stock_quantities,refund_requires_review,refund_cash_flow_amount,receipt_number,receipt_business_date,receipt_sequence,receipt_created_at,receipt_terminal_code,receipt_device_id';
const CASH_FIELDS = 'id,outlet_id,shift_id,staff_name,type,amount,description,created_at,refund_id';
const REFUND_FIELDS = 'id,outlet_id,sale_id,amount,lines,return_stock,created_at';
const LOG_FIELDS = 'id,outlet_id,created_at,cashier_name,authorizer_name,item_name,qty,total_amount,reason,sale_id,date,time';
const EXPENSE_FIELDS = 'id,outlet_id,business_date,category,amount,funding_source,description,staff_id,staff_name,reverses_id,cash_flow_id,created_at';
const SETTINGS_FIELDS = 'id,outlet_id,timezone:profile_data->timezone,payment_methods';
const PAGE_SIZE = 500, BATCH_SIZE = 100;
const abort = signal => { if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError'); };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 300;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// Never parse a timezone-less database timestamp with the browser's timezone.
export function shiftReportInstant(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!match || !validDay(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59
    || Number(match[4]) > 59 || Number(match[6] || 0) > 23 || Number(match[7] || 0) > 59) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : null;
}

export function shiftReportBusinessDay(value, timeZone) {
  const stamp = shiftReportInstant(value);
  if (stamp === null) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(stamp).map(part => [part.type, part.value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

export function shiftReportPeriodDate(shift, timeZone) {
  if (!['open', 'closed'].includes(shift.status)) return null;
  return shiftReportBusinessDay(shift.status === 'closed' ? shift.closed_at : shift.opened_at, timeZone);
}

async function result(query, signal) {
  abort(signal);
  const response = await (signal ? query.abortSignal(signal) : query);
  abort(signal);
  if (response?.error) throw response.error;
  return response?.data;
}

// Do not stop at a short page: the REST server may cap a response below 500.
// Pagination stops only at an empty page and refuses duplicates/non-progress.
async function pages(makeQuery, outletId, signal, validate = () => true) {
  const rows = [], seen = new Set(); let cursor;
  for (;;) {
    abort(signal);
    let query = makeQuery().order('id', { ascending: true }).limit(PAGE_SIZE);
    if (cursor !== undefined) query = query.gt('id', cursor);
    const page = await result(query, signal);
    if (!Array.isArray(page)) throw new Error('Data laporan shift belum lengkap. Muat ulang laporan.');
    if (!page.length) return rows;
    for (const row of page) {
      const id = row?.id;
      if (!row || row.outlet_id !== outletId || !(validId(id) || Number.isSafeInteger(id)) || !validate(row)) {
        throw new Error('Data laporan shift tidak sesuai outlet atau permintaan.');
      }
      // PostgreSQL text collation need not equal JavaScript string ordering;
      // the server applies the keyset bound, while uniqueness prevents cycles.
      if (seen.has(id) || id === cursor) throw new Error('Halaman laporan shift berubah atau berulang. Muat ulang laporan.');
      seen.add(id); rows.push(row); cursor = id;
    }
  }
}

async function batched(client, table, fields, outletId, key, values, signal) {
  const rows = [], seen = new Set(), ids = [...new Set(values)];
  if (ids.some(id => !validId(id))) throw new Error('Referensi aktivitas shift belum valid. Muat ulang laporan.');
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE), allowed = new Set(batch);
    const found = await pages(() => client.from(table).select(fields).eq('outlet_id', outletId).in(key, batch), outletId, signal,
      row => allowed.has(row[key]));
    for (const row of found) {
      if (seen.has(row.id)) throw new Error('Data laporan shift berulang. Muat ulang laporan.');
      seen.add(row.id); rows.push(row);
    }
  }
  return rows;
}

function mergeExact(first, second) {
  const map = new Map(first.map(row => [row.id, row]));
  for (const row of second) {
    const prior = map.get(row.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error('Transaksi berubah saat laporan dimuat. Muat ulang laporan.');
    map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function sourceScope(user, outlet) {
  const uid = typeof user === 'string' ? user : user?.id;
  if (!uid || !validId(outlet?.id) || outlet.merchant_id !== uid || outlet.is_deleted !== false) {
    throw new Error('Outlet tidak tersedia untuk akun ini.');
  }
}

export async function loadShiftReportSnapshot(client, user, outlet, range, signal) {
  sourceScope(user, outlet); validateRange(range); abort(signal);
  const selectedRange = { start: range.start, end: range.end };
  await verifyOwner(client, user, outlet, signal);
  const scoped = (table, fields) => () => client.from(table).select(fields).eq('outlet_id', outlet.id);
  const [allShifts, staff, settingsRows] = await Promise.all([
    pages(scoped('shifts', SHIFT_REPORT_FIELDS), outlet.id, signal),
    // Archived staff are necessary to disambiguate historical names; PIN is
    // deliberately absent from the projection.
    pages(scoped('staff', SHIFT_STAFF_FIELDS), outlet.id, signal),
    pages(scoped('settings', SETTINGS_FIELDS), outlet.id, signal),
  ]);
  if (settingsRows.length > 1) throw new Error('Pengaturan outlet berulang. Muat ulang laporan.');
  const settings = settingsRows[0] || { outlet_id: outlet.id }, timeZone = resolveCashOutTimezone(settings.timezone);
  const invalidDateShiftIds = allShifts.filter(shift => shiftReportPeriodDate(shift, timeZone) === null).map(shift => shift.id);
  const shifts = allShifts.filter(shift => {
    const date = shiftReportPeriodDate(shift, timeZone);
    return date !== null && date >= selectedRange.start && date <= selectedRange.end;
  });
  const shiftIds = shifts.map(shift => shift.id), now = Date.now();
  const times = shifts.flatMap(shift => [shiftReportInstant(shift.opened_at),
    shift.status === 'closed' ? shiftReportInstant(shift.closed_at) : now]).filter(stamp => stamp !== null);
  // The old sales.date is a local calendar string. UTC +/-14h safely covers
  // every supported outlet timezone and keeps overnight shifts complete.
  const saleWindow = times.length ? {
    fromDate: new Date(Math.min(...times) - 14 * 3600000).toISOString().slice(0, 10),
    untilDate: new Date(Math.max(...times) + 14 * 3600000).toISOString().slice(0, 10),
    fromInstant: new Date(Math.min(...times)).toISOString(),
    untilInstant: new Date(Math.max(...times)).toISOString(),
  } : null;
  const [calendarSales, timestampSales, cashFlows, windowLogs, timestampRefunds] = await Promise.all([
    saleWindow ? pages(() => client.from('sales').select(SHIFT_SALE_FIELDS).eq('outlet_id', outlet.id)
      .gte('date', saleWindow.fromDate).lte('date', saleWindow.untilDate), outlet.id, signal,
      row => typeof row.date === 'string' && row.date >= saleWindow.fromDate && row.date <= saleWindow.untilDate) : [],
    // A precise receipt timestamp is independent of sales.date. Preserve it
    // even when an old client saved an inconsistent business calendar date.
    saleWindow ? pages(() => client.from('sales').select(SHIFT_SALE_FIELDS).eq('outlet_id', outlet.id)
      .gte('receipt_created_at', saleWindow.fromInstant).lte('receipt_created_at', saleWindow.untilInstant), outlet.id, signal,
      row => { const stamp = shiftReportInstant(row.receipt_created_at); return stamp !== null
        && stamp >= Date.parse(saleWindow.fromInstant) && stamp <= Date.parse(saleWindow.untilInstant); }) : [],
    // A flow's explicit shift_id is authoritative even when its created_at is
    // outside the selected calendar period or the original sale is much older.
    batched(client, 'cash_flows', CASH_FIELDS, outlet.id, 'shift_id', shiftIds, signal),
    saleWindow ? pages(() => client.from('void_logs').select(LOG_FIELDS).eq('outlet_id', outlet.id)
      .gte('date', saleWindow.fromDate).lte('date', saleWindow.untilDate), outlet.id, signal,
      row => typeof row.date === 'string' && row.date >= saleWindow.fromDate && row.date <= saleWindow.untilDate) : [],
    saleWindow ? pages(() => client.from('vora_sale_refunds').select(REFUND_FIELDS).eq('outlet_id', outlet.id)
      .gte('created_at', saleWindow.fromInstant).lte('created_at', saleWindow.untilInstant), outlet.id, signal,
      row => { const stamp = shiftReportInstant(row.created_at); return stamp !== null
        && stamp >= Date.parse(saleWindow.fromInstant) && stamp <= Date.parse(saleWindow.untilInstant); }) : [],
  ]);
  const windowSales = mergeExact(calendarSales, timestampSales);
  const linkedRefundIds = cashFlows.map(flow => validId(flow.refund_id) ? flow.refund_id
    : typeof flow.id === 'string' && flow.id.startsWith('CF-RF-') && validId(flow.id.slice(6)) ? flow.id.slice(6) : null).filter(Boolean);
  // Refund ledger created_at is server receipt time. Offline submissions can
  // arrive days later; exact VOID-RF-<refund id> links retain those events.
  const logRefundIds = windowLogs.filter(log => typeof log.id === 'string' && log.id.startsWith('VOID-RF-')
    && validId(log.id.slice(8))).map(log => log.id.slice(8));
  const [linkedRefunds, expenses] = await Promise.all([
    batched(client, 'vora_sale_refunds', REFUND_FIELDS, outlet.id, 'id', [...linkedRefundIds, ...logRefundIds], signal),
    batched(client, 'vora_operating_expenses', EXPENSE_FIELDS, outlet.id, 'cash_flow_id', cashFlows.map(flow => flow.id), signal),
  ]);
  const windowRefunds = mergeExact(timestampRefunds, linkedRefunds);
  const windowSaleIds = new Set(windowSales.map(sale => sale.id));
  const originalSaleIds = [...windowRefunds.map(refund => refund.sale_id), ...windowLogs.map(log => log.sale_id)]
    .filter(id => validId(id) && !windowSaleIds.has(id));
  const originals = await batched(client, 'sales', SHIFT_SALE_FIELDS, outlet.id, 'id', originalSaleIds, signal);
  const sales = mergeExact(windowSales, originals), saleIds = sales.map(sale => sale.id);
  const [saleRefunds, saleLogs] = await Promise.all([
    batched(client, 'vora_sale_refunds', REFUND_FIELDS, outlet.id, 'sale_id', saleIds, signal),
    batched(client, 'void_logs', LOG_FIELDS, outlet.id, 'sale_id', saleIds, signal),
  ]);
  const refunds = mergeExact(windowRefunds, saleRefunds), logs = mergeExact(windowLogs, saleLogs);
  // Avoid returning a report whose shift bounds/cashier identities/settings
  // changed while its related activity was being read.
  const [currentShifts, currentStaff, currentSettings] = await Promise.all([
    pages(scoped('shifts', SHIFT_REPORT_FIELDS), outlet.id, signal),
    pages(scoped('staff', SHIFT_STAFF_FIELDS), outlet.id, signal),
    pages(scoped('settings', SETTINGS_FIELDS), outlet.id, signal),
  ]);
  if (JSON.stringify(allShifts) !== JSON.stringify(currentShifts) || JSON.stringify(staff) !== JSON.stringify(currentStaff)
    || JSON.stringify(settingsRows) !== JSON.stringify(currentSettings)) throw new Error('Shift atau pengaturan berubah saat laporan dimuat. Muat ulang laporan.');
  await verifyOwner(client, user, outlet, signal); abort(signal);
  return { outletId: outlet.id, outlet: { ...outlet }, timeZone, range: selectedRange, shifts, allShifts,
    contextShifts: allShifts, staff, sales, cashFlows, refunds, logs, voidLogs: logs, expenses, settings, saleWindow, invalidDateShiftIds,
    loadedAt: new Date().toISOString(), complete: true,
    warnings: ['Hanya data yang sudah diterima server ditampilkan. Data kasir yang belum tersinkron belum tersedia di dashboard.',
      'Periode mengikuti tanggal tutup shift; shift yang masih terbuka mengikuti tanggal pembukaan. Rincian mencakup seluruh durasi shift, termasuk lintas hari.',
      'Laporan dimuat saat operasional berlangsung. Muat ulang untuk memperoleh perubahan terbaru.',
      ...(invalidDateShiftIds.length ? [`${invalidDateShiftIds.length} shift memiliki status atau tanggal pembukaan/penutupan yang belum valid dan belum dapat dimasukkan ke periode laporan.`] : [])] };
}

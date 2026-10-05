import { calculateProfitLoss } from '/dashboard-lib-profitLoss.js';
import { summarizeExpenses } from '/dashboard-lib-businessExpenses.js';
import { netSaleAmount, refundAmount, remainingLineQty } from '/dashboard-lib-refundReports.js';

export const PAGE_SIZE = 500;
export const MAX_ROWS = 25000;
export function validateRange(range) {
  for (const date of [range?.start, range?.end]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Pilih tanggal laporan yang valid.');
  }
  const days = (Date.parse(range.end) - Date.parse(range.start)) / 86400000;
  if (days < 0 || days > 92) throw new Error('Pilih rentang 1–93 hari. Untuk laporan yang besar, gunakan periode lebih pendek.');
  return range;
}
export function requestScope() {
  let generation = 0, controller;
  return {
    cancel() { generation++; controller?.abort(); },
    begin() {
      controller?.abort(); controller = new AbortController();
      const version = ++generation, signal = controller.signal;
      return { signal, current: () => generation === version && !signal.aborted };
    },
  };
}
export async function collect(makeQuery, validate, signal, limit = MAX_ROWS) {
  const rows = [], seen = new Set(); let cursor;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError');
    let q = makeQuery().order('id', { ascending: true }).limit(PAGE_SIZE);
    if (cursor !== undefined) q = q.gt('id', cursor);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError');
    if (error) throw error;
    if (!Array.isArray(data) || data.some(row => !validate(row))) throw new Error('Data tidak sesuai akses outlet. Laporan tidak ditampilkan.');
    // Keep paging even when a server caps results below our requested page size.
    if (!data.length) return rows;
    for (const row of data) {
      if (!row.id || seen.has(row.id)) throw new Error('Halaman laporan berubah atau berulang. Muat ulang laporan.');
      seen.add(row.id); rows.push(row);
    }
    if (rows.length > limit) throw new Error('Data periode ini terlalu besar untuk dimuat sekaligus. Persempit rentang tanggal; tidak ada angka yang dipotong.');
    cursor = data[data.length - 1].id;
  }
}
export function loadOutlets(client, userId, signal) {
  if (!userId) throw new Error('Masuk terlebih dahulu.');
  return collect(() => client.from('outlets').select('id,name,merchant_id,address,is_deleted,subscription_plan,subscription_end_date')
    .eq('merchant_id', userId).eq('is_deleted', false), row => row.merchant_id === userId && row.is_deleted === false, signal, 1000);
}
export async function loadReport(client, userId, outlet, range, signal) {
  validateRange(range);
  if (!userId || outlet?.merchant_id !== userId || outlet?.is_deleted !== false || !outlet?.id) throw new Error('Outlet tidak tersedia untuk akun ini.');
  const valid = row => row.outlet_id === outlet.id;
  const inRange = row => valid(row) && row.date >= range.start && row.date <= range.end;
  const envelopeStart = new Date(Date.parse(range.start) - 14 * 3600000).toISOString();
  const envelopeEnd = new Date(Date.parse(range.end) + 38 * 3600000).toISOString();
  const [sales, legacy, ledger] = await Promise.all([
    collect(() => client.from('sales').select('*').eq('outlet_id', outlet.id).gte('date', range.start).lte('date', range.end), inRange, signal),
    collect(() => client.from('cash_flows').select('*').eq('outlet_id', outlet.id).eq('type', 'OUT').gte('created_at', envelopeStart).lt('created_at', envelopeEnd), valid, signal),
    collect(() => client.from('vora_operating_expenses').select('*').eq('outlet_id', outlet.id).gte('business_date', range.start).lte('business_date', range.end), valid, signal),
  ]);
  const refundIds = sales.filter(s => ['PARTIAL_REFUND', 'REFUNDED'].includes(s.status) || Number(s.refunded_amount) > 0).map(s => s.id);
  const logMap = new Map();
  for (let i = 0; i < refundIds.length; i += 100) {
    const batch = refundIds.slice(i, i + 100), allowed = new Set(batch);
    const logs = await collect(() => client.from('void_logs').select('*').eq('outlet_id', outlet.id).in('sale_id', batch), row => valid(row) && allowed.has(row.sale_id), signal);
    logs.forEach(log => logMap.set(log.id, log));
    if (logMap.size > MAX_ROWS) throw new Error('Riwayat refund terlalu besar. Persempit periode laporan.');
  }
  return summarizeReport(sales, [...logMap.values()], [...legacy, ...ledger], outlet.id, range);
}

export function summarizeReport(sales, logs, expenses, outletId, range) {
  // Even in-memory fixtures/imports must not merge data belonging to another outlet.
  if (sales.some(s => s.outlet_id !== outletId) || logs.some(s => s.outlet_id !== outletId) || expenses.some(s => s.outlet_id !== outletId)) throw new Error('Data lintas outlet ditolak.');
  const finance = calculateProfitLoss(sales, logs);
  const expense = summarizeExpenses(expenses, outletId, range);
  const days = new Map(), methods = new Map(), cashiers = new Map(), orderTypes = new Map(), products = new Map();
  const group = (map, name, sale, net) => {
    const item = map.get(name) || { name, count: 0, gross: 0, refund: 0, net: 0, mdr: 0 };
    item.count++; item.gross += Number(sale.total) || 0; item.refund += refundAmount(sale, logs) ?? 0;
    item.net += net; item.mdr += Number(sale.mdr_fee) || 0; map.set(name, item);
  };
  for (let d = Date.parse(range.start); d <= Date.parse(range.end); d += 86400000) days.set(new Date(d).toISOString().slice(0, 10), { net: 0, count: 0 });
  for (const sale of sales) {
    // Same provisional convention as APK; shared finance.issues prominently marks uncertainty.
    const net = netSaleAmount(sale, logs) ?? Number(sale.total);
    const day = days.get(sale.date); if (day) { day.net += net; day.count++; }
    group(methods, sale.method || 'Belum tercatat', sale, net);
    group(cashiers, sale.cashier || 'Belum tercatat', sale, net);
    group(orderTypes, sale.table_type || 'Belum tercatat', sale, net);
    for (const [index, item] of (sale.cart_data || []).entries()) {
      if (item.isPayment) continue;
      const qty = remainingLineQty(sale, index), key = JSON.stringify([item.id, item.name]);
      const product = products.get(key) || { name: item.name || 'Produk', category: item.category || 'Tanpa kategori', qty: 0, amount: 0 };
      product.qty += qty; product.amount += Number(item.price || 0) * qty; products.set(key, product);
    }
  }
  const ranked = map => [...map.values()].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  return { sales: [...sales].sort((a, b) => `${b.date} ${b.time} ${b.id}`.localeCompare(`${a.date} ${a.time} ${a.id}`)), logs,
    finance, expense, operatingProfit: finance.contribution - expense.total,
    days: [...days].map(([date, value]) => ({ date, ...value })), methods: ranked(methods), cashiers: ranked(cashiers), orderTypes: ranked(orderTypes),
    products: [...products.values()].filter(p => p.qty > 0).sort((a, b) => b.qty - a.qty || b.amount - a.amount),
    refunds: sales.filter(s => ['REFUNDED', 'PARTIAL_REFUND'].includes(s.status) || Number(s.refunded_amount) > 0),
    range: { ...range }, outletId, loadedAt: new Date().toISOString() };
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet formulas may be hidden behind whitespace, tabs or carriage returns.
  if (typeof value !== 'number' && (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export const makeCsv = rows => '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

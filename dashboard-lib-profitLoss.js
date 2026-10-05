import { refundAmount } from '/dashboard-lib-refundReports.js';
import { readReceiptCost, readCostReturn } from '/dashboard-lib-paymentCost.js';

const amount = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

// Read-only report query; never replaces the transactional/offline cache.
export async function fetchReportSales(client, outletId, range, cancelled = () => false) {
  if (!outletId) throw new Error('Outlet belum tersedia.');
  const rows = [];
  let cursor;
  while (!cancelled()) {
    let query = client.from('sales').select('*').eq('outlet_id', outletId)
      .gte('date', range.start).lte('date', range.end).order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (cancelled()) throw new Error('Laporan dibatalkan.');
    if (error) throw error;
    if (!Array.isArray(data) || data.some(row => row.outlet_id !== outletId)) throw new Error('Data laporan tidak sesuai outlet.');
    rows.push(...data);
    if (data.length < 500) return rows;
    const next = data[data.length - 1].id;
    if (!next || next === cursor) throw new Error('Halaman laporan tidak dapat dilanjutkan.');
    cursor = next;
  }
  throw new Error('Laporan dibatalkan.');
}

export function mergeReportSales(remote, local, outletId, range) {
  const rows = new Map();
  for (const sale of [...remote, ...local]) {
    if (sale.outlet_id !== outletId || sale.date < range.start || sale.date > range.end) continue;
    const prior = rows.get(sale.id);
    // Preserve fresh remote refunds, and include locally committed offline refunds.
    if (!prior || Number(sale.refund_revision || 0) > Number(prior.refund_revision || 0)) rows.set(sale.id, sale);
  }
  return [...rows.values()].map(sale => ({ ...sale, cartData: sale.cart_data ?? sale.cartData, table: sale.table_type ?? sale.table }));
}

/** Management report on original-sale-date basis, not a statutory ledger.
 * Missing costs remain unknown. Never substitute today's product cost.
 */
export function calculateProfitLoss(sales, logs = []) {
  const result = { transactions: sales.length, receipts: 0, refunds: 0, netReceipts: 0,
    subtotal: 0, discount: 0, rounding: 0, tax: 0, service: 0, surcharge: 0,
    revenue: 0, cogs: 0, mdr: 0, grossProfit: 0, contribution: 0, margin: null,
    issues: [], complete: true };
  const issues = new Set();
  for (const sale of sales) {
    if (!amount(sale.total)) { issues.add('Ada nominal transaksi tidak valid.'); continue; }
    const total = Number(sale.total);
    const refund = refundAmount(sale, logs);
    if (refund === null) issues.add('Ada refund lama yang perlu direkonsiliasi.');
    const kept = total > 0 ? (total - (refund ?? 0)) / total : 1;
    const parts = {};
    for (const key of ['subtotal', 'discount', 'tax', 'service', 'payment_surcharge', 'mdr_fee']) {
      if (!amount(sale[key])) issues.add('Ada komponen tagihan atau biaya pembayaran yang belum tercatat.');
      parts[key] = amount(sale[key]) ? Number(sale[key]) : 0;
    }
    result.receipts += total;
    result.refunds += refund ?? 0;
    result.subtotal += parts.subtotal;
    result.discount += parts.discount;
    result.rounding += total - (parts.subtotal - parts.discount + parts.tax + parts.service + parts.payment_surcharge);
    result.tax += Math.round(parts.tax * kept);
    result.service += Math.round(parts.service * kept);
    result.surcharge += Math.round(parts.payment_surcharge * kept);
    // Actual MDR charged to merchant is not automatically returned on refund.
    result.mdr += parts.mdr_fee;
    const items = sale.cart_data ?? sale.cartData;
    if (!Array.isArray(items) || !items.length) issues.add('Ada rincian item transaksi yang belum tersedia.');
    const cost = readReceiptCost(items);
    if (cost.kind !== 'legacy') {
      const returned = readCostReturn(Array.isArray(items) ? items : [], sale.refunded_stock_quantities);
      if (cost.kind === 'invalid' || returned === null) issues.add('Snapshot alokasi HPP atau pengembalian stok tidak valid.');
      else result.cogs += cost.amount - returned;
      if (!Number(sale.refund_revision) && ['REFUNDED', 'PARTIAL_REFUND'].includes(sale.status)) issues.add('Pengembalian stok refund lama belum dapat dipastikan.');
      continue;
    }
    for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
      if (item.isPayment) {
        issues.add('Pembayaran nominal terpisah memerlukan rekonsiliasi HPP antarstruk/periode.');
        continue;
      }
      if (!amount(item.buyPrice) || !amount(item.qty)) { issues.add('Ada item tanpa snapshot HPP yang valid.'); continue; }
      if (!Number(sale.refund_revision) && ['REFUNDED', 'PARTIAL_REFUND'].includes(sale.status)) {
        issues.add('Pengembalian stok refund lama belum dapat dipastikan.');
      }
      const returned = Number(sale.refunded_stock_quantities?.[index] ?? 0);
      if (!Number.isFinite(returned) || returned < 0 || returned > Number(item.qty)) {
        issues.add('Jumlah pengembalian stok perlu diperiksa.'); continue;
      }
      result.cogs += Number(item.buyPrice) * (Number(item.qty) - returned);
    }
  }
  result.netReceipts = result.receipts - result.refunds;
  result.revenue = result.netReceipts - result.tax - result.service - result.surcharge;
  result.grossProfit = result.revenue - result.cogs;
  result.contribution = result.grossProfit - result.mdr;
  result.issues = [...issues];
  result.complete = !issues.size;
  result.margin = result.complete && result.revenue > 0 ? result.contribution / result.revenue * 100 : null;
  return result;
}

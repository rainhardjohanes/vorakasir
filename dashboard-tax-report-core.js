// Exact read-only APK 1.0.42 tax model; see qa/tax-source-parity.json.
// Never reconstruct historical tax from current settings or current prices.
import { refundAmount } from '/dashboard-lib-refundReports.js';
import { receiptIdentity } from '/dashboard-lib-importedHistory.js';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const amount = value => finite(value) && Number.isSafeInteger(value) && value >= 0;
const itemsOf = sale => sale.cart_data ?? sale.cartData ?? [];
const validSales = sales => sales.filter(sale => ['SUCCESS', 'PARTIAL_REFUND', 'REFUNDED'].includes(sale.status));
const sumKnown = values => values.some(value => value === null) ? null : values.reduce((sum, value) => sum + value, 0);
const compare = (a, b) => a.localeCompare(b, 'id', { numeric: true, sensitivity: 'base' });

export function buildTaxReport(sales, logs = []) {
  const rows = validSales(sales).map(sale => {
    const saved = itemsOf(sale)[0]?._voraTaxSnapshot;
    const snapshot = saved?.version === 1 ? saved : null;
    const refund = refundAmount(sale, logs), tax = amount(sale.tax) ? sale.tax : null;
    const keptRatio = amount(sale.total) && sale.total > 0 && refund !== null ? (sale.total - refund) / sale.total : sale.total === 0 && refund === 0 ? 1 : null;
    const netTax = tax === null || keptRatio === null ? null : Math.round(tax * keptRatio);
    return { id: sale.id, receipt: receiptIdentity(sale), date: sale.date, name: snapshot?.label || 'Nama pajak belum tersimpan',
      rate: finite(snapshot?.rate) ? snapshot.rate : null,
      inclusive: typeof snapshot?.inclusive === 'boolean' ? (snapshot.inclusive ? 'Termasuk harga' : 'Di luar harga') : 'Belum tersedia',
      base: amount(snapshot?.base) ? snapshot.base : null, tax, refundTax: tax === null || netTax === null ? null : tax - netTax, netTax };
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)) || compare(a.receipt, b.receipt));
  return { rows, totals: { tax: sumKnown(rows.map(row => row.tax)), refundTax: sumKnown(rows.map(row => row.refundTax)), net: sumKnown(rows.map(row => row.netTax)) }, warnings: [
    'Pajak mengikuti nominal yang disimpan saat transaksi. Koreksi refund mengikuti proporsi nilai refund tercatat. Laporan ini merupakan ringkasan operasional, bukan formulir pelaporan pajak resmi.',
    ...(rows.some(row => row.rate === null || row.base === null) ? ['Nama, tarif atau dasar pajak pada transaksi lama belum tersimpan. Pengaturan pajak saat ini tidak digunakan untuk menebaknya.'] : []),
  ] };
}

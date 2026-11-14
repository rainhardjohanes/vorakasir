import { buildTaxReport } from '/dashboard-tax-report-core.js';
import { outletDisplayName, validateRange } from '/dashboard-data.js';
import { dateLabel } from '/dashboard-date-range.js';

const known = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sum = values => {
  if (values.some(value => !known(value))) return null;
  const value = values.reduce((total, item) => total + BigInt(item), 0n);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
};
function scope(report, outlet, range) {
  validateRange(range);
  if (!outlet?.id || report?.outletId !== outlet.id || report?.range?.start !== range.start || report?.range?.end !== range.end || !Array.isArray(report.sales) || !Array.isArray(report.logs)) throw new Error('Periode atau outlet laporan pajak belum sesuai. Muat ulang laporan.');
  const sales = new Set(), logs = new Set();
  for (const row of report.sales) {
    if (!row?.id || sales.has(row.id) || row.outlet_id !== outlet.id || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || !Number.isFinite(Date.parse(row.date)) || new Date(row.date).toISOString().slice(0, 10) !== row.date || row.date < range.start || row.date > range.end || !Array.isArray(row.cart_data ?? row.cartData ?? [])) throw new Error('Transaksi pajak tidak sesuai outlet, periode, atau berulang. Muat ulang laporan.');
    sales.add(row.id);
  }
  for (const row of report.logs) {
    if (!row?.id || logs.has(row.id) || row.outlet_id !== outlet.id || !sales.has(row.sale_id)) throw new Error('Catatan refund pajak tidak sesuai outlet atau berulang. Muat ulang laporan.');
    logs.add(row.id);
  }
}
export function buildDashboardTaxReport(report, { outlet, range = report?.range, search = '', page = 1, pageSize = 25 } = {}) {
  scope(report, outlet, range);
  const core = buildTaxReport(report.sales, report.logs);
  const query = String(search).trim().slice(0, 200);
  const rows = core.rows.filter(row => !query || [row.receipt, row.id, row.name, row.inclusive, row.rate === null ? '' : `${row.rate}%`].join(' ').toLocaleLowerCase('id-ID').includes(query.toLocaleLowerCase('id-ID')));
  const size = Number.isSafeInteger(pageSize) ? Math.min(100, Math.max(1, pageSize)) : 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const current = Number.isSafeInteger(page) ? Math.min(pageCount, Math.max(1, page)) : 1;
  const totals = { tax: sum(rows.map(row => row.tax)), refundTax: sum(rows.map(row => row.refundTax)), net: sum(rows.map(row => row.netTax)) };
  const warnings = [...core.warnings, 'Periode mengikuti tanggal transaksi asal. Koreksi refund mengikuti transaksi asal, bukan tanggal pengembalian uang.', 'Pesanan yang belum dibayar dan VOID tidak dimasukkan. Transaksi yang belum tersinkron dari perangkat belum tersedia pada dashboard.'];
  if (rows.some(row => row.tax === null || row.refundTax === null || row.netTax === null)) warnings.push('Sebagian nilai pajak atau refund belum dapat diverifikasi. Total yang terkait ditampilkan sebagai —, bukan nol.');
  if (Object.values(totals).some(value => value === null) && rows.every(row => known(row.tax) && known(row.refundTax) && known(row.netTax))) warnings.push('Total melampaui batas angka aman; pilih periode lebih pendek. Nilai tidak dipotong atau dibulatkan diam-diam.');
  return { outletId: outlet.id, outletName: outletDisplayName(outlet), range: { ...range }, allRows: rows, rows: rows.slice((current - 1) * size, current * size), totals, warnings, totalCount: core.rows.length, filteredCount: rows.length, page: current, pageSize: size, pageCount, filters: { search: query }, loadedAt: report.loadedAt || null };
}
const scalar = value => {
  if (value == null) return '—';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('Angka ekspor pajak tidak valid.'); return value; }
  if (typeof value !== 'string') throw new TypeError('Nilai ekspor pajak tidak didukung.');
  const text = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
  if (text.length > 32767) throw new TypeError('Teks melebihi satu sel Excel; isi tidak dipotong.');
  return text;
};
export const TAX_REPORT_HEADERS = ['No. struk', 'ID transaksi', 'Tanggal transaksi', 'Nama pajak tercatat', 'Tarif (%)', 'Perlakuan harga', 'Dasar pajak tercatat', 'Pajak awal', 'Koreksi refund', 'Pajak bersih'];
export function taxReportExportModel({ report, outlet, range = report?.range, filters = {}, generatedAt = new Date().toISOString(), timeZone } = {}) {
  const selected = buildDashboardTaxReport(report, { outlet, range, search: filters.search });
  if (selected.allRows.length > 50000) throw new TypeError('Laporan melebihi 50.000 catatan. Pilih periode lebih pendek; ekspor tidak dipotong.');
  const instant = new Date(generatedAt), zone = timeZone || outlet.timezone || outlet.time_zone || 'Asia/Makassar';
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Waktu pembuatan laporan tidak valid.');
  let generatedLabel;
  try { generatedLabel = new Intl.DateTimeFormat('id-ID', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instant); }
  catch { throw new TypeError('Zona waktu laporan tidak valid.'); }
  return { outletId: outlet.id, outletName: scalar(selected.outletName), dateFrom: dateLabel(range.start, { short: true }), dateUntil: dateLabel(range.end, { short: true }), generatedAt: instant.toISOString(), generatedLabel, timeZone: zone,
    filterLabel: selected.filters.search ? `Pencarian: ${selected.filters.search}` : 'Semua transaksi sesuai periode',
    headers: [...TAX_REPORT_HEADERS], moneyColumns: TAX_REPORT_HEADERS.map((_, index) => index >= 6),
    rows: selected.allRows.map(row => [row.receipt, row.id, dateLabel(row.date, { short: true }), row.name, row.rate, row.inclusive, row.base, row.tax, row.refundTax, row.netTax].map(scalar)),
    totals: { ...selected.totals }, notes: [...selected.warnings, 'Seluruh catatan sesuai pencarian dan periode disertakan, termasuk halaman layar lain. Dasar pajak tercatat adalah snapshot transaksi awal; bukan hasil rekonstruksi atau dasar pajak neto setelah refund.'].map(scalar) };
}

import { reportWorkbookModel, REPORT_EXPORT_LIMIT } from '/dashboard-report-workbook.js';
import { commissionReportModel, commissionSummaryRows, commissionDetailRows } from '/dashboard-commission-report-model.js';

const escape = value => String(value ?? '—').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const number = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 8 }).format(value);
function display(value, money = false) {
  if (value == null) return '—';
  if (typeof value === 'number') return money ? `Rp ${new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}` : number(value);
  return String(value);
}

// Mount the returned markup in a direct body child #vora-full-report-print.
// Caller owns before/afterprint cleanup and identity/outlet/range lifecycle checks.
// It must not print a stale snapshot after auth, outlet, route or period changes.
const styles = `<style>
#vora-full-report-print{display:none}
@media print{
 @page{size:A4 landscape;margin:12mm}
 body>*:not(#vora-full-report-print){display:none!important}
 body{margin:0!important;background:#fff!important;color:#172d22!important}
 #vora-full-report-print{display:block!important;font:9pt/1.45 Arial,sans-serif;color:#172d22}
 #vora-full-report-print *{box-sizing:border-box}
 #vora-full-report-print h1{font-size:20pt;margin:4mm 0 2mm}
 #vora-full-report-print h2{font-size:14pt;margin:6mm 0 3mm;break-after:avoid}
 #vora-full-report-print h3{font-size:10pt;margin:0 0 3mm;break-after:avoid}
 #vora-full-report-print p{margin:1mm 0 2mm;white-space:pre-wrap;overflow-wrap:anywhere}
 #vora-full-report-print .vx-brand{color:#17664c;font-size:12pt;font-weight:700;letter-spacing:1pt}
 #vora-full-report-print .vx-meta{padding-bottom:4mm;border-bottom:1px solid #b9ccbf;margin-bottom:4mm}
 #vora-full-report-print .vx-note{font-size:8pt;color:#465e4f;margin:2mm 0}
 #vora-full-report-print table{width:100%;border-collapse:collapse;margin:3mm 0;table-layout:fixed}
 #vora-full-report-print thead{display:table-header-group}
 #vora-full-report-print tr{break-inside:avoid;page-break-inside:avoid}
 #vora-full-report-print th,#vora-full-report-print td{border:1px solid #cbd8ce;padding:2.5mm;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}
 #vora-full-report-print th{background:#edf5ef!important;color:#17664c;font-size:8pt;font-weight:700}
 #vora-full-report-print .vx-number{text-align:right;font-variant-numeric:tabular-nums}
 #vora-full-report-print .vx-record{border:1px solid #cbd8ce;padding:4mm;margin:0 0 4mm;break-inside:avoid;page-break-inside:avoid}
 #vora-full-report-print dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3mm 5mm;margin:0}
 #vora-full-report-print dl>div{min-width:0;overflow-wrap:anywhere}
 #vora-full-report-print dt{font-size:7.5pt;color:#52695b;font-weight:600;margin:0 0 1mm}
 #vora-full-report-print dd{font-size:8.5pt;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
}
</style>`;

function table(headers, rows, currency = []) {
  return `<table><thead><tr>${headers.map(header => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${headers.map((_, column) => `<td class="${typeof row[column] === 'number' ? 'vx-number' : ''}">${escape(display(row[column], currency[column]))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Tidak ada catatan pada periode ini.</td></tr>`}</tbody></table>`;
}

function fullRows(headers, rows, currency = []) {
  // Wide exports are printed as complete records instead of shrinking 17–28
  // columns to unreadable A4 text. Every field and every row is retained.
  if (headers.length <= 9) return table(headers, rows, currency);
  return rows.length ? rows.map((row, index) => `<article class="vx-record"><h3>Catatan ${index + 1}</h3><dl>${headers.map((header, column) => `<div><dt>${escape(header)}</dt><dd>${escape(display(row[column], currency[column]))}</dd></div>`).join('')}</dl></article>`).join('') : '<p>Tidak ada catatan pada periode ini.</p>';
}

/** Complete, escaped print markup. No screen pagination, network or side effects. */
export function createReportPrintMarkup(options = {}) {
  if (options.view === 'commission-report') {
    const model = commissionReportModel(options.report, options);
    if (options.range && (options.range.start !== model.dateFrom || options.range.end !== model.dateUntil)) throw new TypeError('Periode komisi berubah. Muat ulang sebelum mencetak.');
    if (model.items.length > REPORT_EXPORT_LIMIT) throw new TypeError('Laporan melebihi 50.000 baris. Pilih periode lebih pendek; cetak tidak dipotong.');
    const [summaryHeaders, ...summaryRows] = commissionSummaryRows(model);
    const [detailHeaders, ...detailRows] = commissionDetailRows(model);
    return `${styles}<header class="vx-meta"><span class="vx-brand">VORA POS</span><h1>Laporan komisi karyawan</h1><p>Outlet: ${escape(model.outletName)}</p><p>Periode transaksi: ${escape(model.dateFrom)} s.d. ${escape(model.dateUntil)}</p><p>Dibuat: ${escape(model.generatedLabel)} (${escape(model.timeZone)})</p><p>Filter: ${escape(model.filters.search || 'Semua karyawan dan cabang')}</p><p>${escape(model.totalLabel)}: <strong>${escape(display(model.totals.net, true))}</strong></p></header><h2>Ringkasan komisi</h2>${table(summaryHeaders, summaryRows, [false, false, false, false, true])}<p class="vx-note">${escape(model.countNote)}</p>${model.warnings.map(warning => `<p class="vx-note">${escape(warning)}</p>`).join('')}<h2>Seluruh rincian komisi · ${detailRows.length} catatan</h2>${fullRows(detailHeaders, detailRows, detailHeaders.map((_, index) => [20, 21, 22, 23].includes(index)))}<p class="vx-note">— berarti data belum tersedia atau tidak berlaku. Catatan komisi bukan bukti pembayaran gaji.</p>`;
  }
  const model = reportWorkbookModel(options);
  return `${styles}<header class="vx-meta"><span class="vx-brand">VORA POS</span><h1>${escape(model.title)}</h1><p>Outlet: ${escape(model.outletName)}</p><p>Periode usaha: ${escape(model.range.start)} s.d. ${escape(model.range.end)}</p><p>Dibuat: ${escape(model.generatedLabel)} (${escape(model.timeZone)})</p></header>${model.notes.map(note => `<p class="vx-note">${escape(note)}</p>`).join('')}${fullRows(model.headers, model.rows, model.moneyColumns)}`;
}

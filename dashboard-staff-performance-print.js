import { staffPerformanceExportModel } from '/dashboard-staff-performance.js';

const escape = value => String(value ?? '—').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const display = (value, money) => typeof value === 'number'
  ? money ? `Rp ${(value === 0 ? 0 : value).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : (value === 0 ? 0 : value).toLocaleString('id-ID', { maximumFractionDigits: 8 })
  : String(value ?? '—');
const styles = `<style>
#vora-full-report-print{display:none}
@media print{
 @page{size:A4 landscape;margin:12mm}
 body>*:not(#vora-full-report-print){display:none!important}
 body{margin:0!important;background:#fff!important;color:#18372b!important}
 #vora-full-report-print{display:block!important;font:9pt/1.5 Arial,sans-serif;color:#18372b}
 #vora-full-report-print *{box-sizing:border-box}
 #vora-full-report-print h1{font-size:20pt;margin:3mm 0}
 #vora-full-report-print h2{font-size:14pt;margin:6mm 0 3mm;break-after:avoid}
 #vora-full-report-print h3{font-size:10pt;margin:0 0 3mm;break-after:avoid;overflow-wrap:anywhere}
 #vora-full-report-print p{margin:1mm 0 2mm;white-space:pre-wrap;overflow-wrap:anywhere}
 #vora-full-report-print .sp-print-meta{border-bottom:1px solid #cbd9ce;padding-bottom:4mm;margin-bottom:4mm}
 #vora-full-report-print .sp-print-brand{font-weight:750;color:#17664c;font-size:12pt}
 #vora-full-report-print .sp-print-note{font-size:8pt;color:#425e4e;line-height:1.65}
 #vora-full-report-print table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8pt;margin:3mm 0}
 #vora-full-report-print th,#vora-full-report-print td{border:1px solid #cbd9ce;padding:2.5mm;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}
 #vora-full-report-print th{background:#eff6f1!important;color:#17664c}
 #vora-full-report-print thead{display:table-header-group}
 #vora-full-report-print tr{break-inside:avoid}
 #vora-full-report-print .sp-print-number{text-align:right;font-variant-numeric:tabular-nums}
 #vora-full-report-print .sp-print-record{border:1px solid #cbd9ce;padding:4mm;margin-bottom:4mm;break-inside:auto}
 #vora-full-report-print dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3mm 5mm;margin:0}
 #vora-full-report-print dl>div{min-width:0;overflow-wrap:anywhere}
 #vora-full-report-print dt{font-size:7.5pt;color:#425e4e;font-weight:700}
 #vora-full-report-print dd{margin:1mm 0 0;font-size:8.5pt;white-space:pre-wrap;overflow-wrap:anywhere}
 #vora-full-report-print .sp-print-wide{grid-column:1/-1}
}
</style>`;

/** Complete local print markup. The caller owns auth/scope and print cleanup. */
export function createStaffPerformancePrintMarkup(options = {}) {
  const model = staffPerformanceExportModel(options), summary = model.summary, details = model.details;
  const table = `<table><thead><tr>${summary.headers.map(header => `<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${summary.rows.length ? summary.rows.map(row => `<tr>${row.map((value, index) => `<td${typeof value === 'number' ? ' class="sp-print-number"' : ''}>${escape(display(value, summary.moneyColumns[index]))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${summary.headers.length}">Tidak ada staf yang sesuai dengan periode dan filter ini.</td></tr>`}</tbody></table>`;
  const records = details.rows.map((row, index) => `<article class="sp-print-record"><h3>Catatan ${index + 1} · ${escape(row[0])}</h3><dl>${details.headers.map((header, column) => `<div${/Catatan|Keterangan|Ekstra|Sumber/.test(header) ? ' class="sp-print-wide"' : ''}><dt>${escape(header)}</dt><dd>${escape(display(row[column], details.moneyColumns[column]))}</dd></div>`).join('')}</dl></article>`).join('');
  return `${styles}<header class="sp-print-meta"><span class="sp-print-brand">VORA POS</span><h1>Kinerja staf pelaksana</h1><p>Outlet: ${escape(model.outletName)}</p><p>Periode transaksi: ${escape(model.dateFrom)} s.d. ${escape(model.dateUntil)}</p><p>Filter: ${escape(model.filterLabel)}</p><p>Dibuat: ${escape(model.generatedLabel)} (${escape(model.timeZone)})</p></header>${model.notes.map(note => `<p class="sp-print-note">${escape(note)}</p>`).join('')}<h2>Ringkasan per staf</h2>${table}<h2>Seluruh rincian · ${details.rows.length} catatan</h2>${records || '<p>Tidak ada rincian untuk periode dan filter ini.</p>'}`;
}

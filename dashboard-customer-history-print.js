import { customerHistoryExportModel } from '/dashboard-customer-history-model.js';

const h = value => String(value ?? '—').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const display = (value, money) => typeof value === 'number' ? money ? `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 8 })}` : value.toLocaleString('id-ID', { maximumFractionDigits: 8 }) : value;
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
 #vora-full-report-print h3{font-size:10pt;margin:0 0 3mm;break-after:avoid}
 #vora-full-report-print p{margin:2mm 0;white-space:pre-wrap;overflow-wrap:anywhere}
 #vora-full-report-print table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8pt}
 #vora-full-report-print th,#vora-full-report-print td{border:1px solid #cbd9ce;padding:2mm;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}
 #vora-full-report-print th{background:#eff6f1!important}
 #vora-full-report-print thead{display:table-header-group}
 #vora-full-report-print tr{break-inside:avoid}
 #vora-full-report-print .ch-print-number{text-align:right}
 #vora-full-report-print .ch-print-record{border:1px solid #cbd9ce;padding:4mm;margin:0 0 4mm;break-inside:auto}
 #vora-full-report-print dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3mm 5mm;margin:0}
 #vora-full-report-print dl>div{min-width:0;overflow-wrap:anywhere}
 #vora-full-report-print dt{font-size:8pt;color:#52695b;font-weight:600;margin:0 0 1mm}
 #vora-full-report-print dd{font-size:9pt;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
 #vora-full-report-print .ch-print-wide{grid-column:1/-1}
 #vora-full-report-print .ch-print-notes{font-size:8pt;margin-top:5mm}
}
</style>`;

function sectionMarkup(section) {
  if (!section.rows.length) return `<section><h2>${h(section.name)}</h2><p>Tidak ada catatan yang sesuai filter ini.</p></section>`;
  // A service line includes staff, extra and notes. Print the entire record
  // rather than shrinking 18–22 columns into unreadable A4 text.
  if (section.headers.length > 9) return `<section><h2>${h(section.name)} · ${section.rows.length} catatan</h2>${section.rows.map((row, index) => `<article class="ch-print-record"><h3>${h(section.name)} ${index + 1}</h3><dl>${section.headers.map((label, column) => `<div${/Catatan|Keterangan|Ekstra|Alasan/.test(label) ? ' class="ch-print-wide"' : ''}><dt>${h(label)}</dt><dd>${h(display(row[column], section.moneyColumns[column]))}</dd></div>`).join('')}</dl></article>`).join('')}</section>`;
  return `<section><h2>${h(section.name)}</h2><table><thead><tr>${section.headers.map(label => `<th>${h(label)}</th>`).join('')}</tr></thead><tbody>${section.rows.map((row, index) => `<tr>${section.headers.map((_, column) => `<td${typeof row[column] === 'number' ? ' class="ch-print-number"' : ''}>${h(display(row[column], section.moneyColumns[column] || column === 1 && section.moneyRows?.includes(index)))}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
}

/** Escaped, complete print markup; caller mounts #vora-full-report-print and
 * handles print cleanup plus account/outlet/customer lifecycle checks. */
export function createCustomerHistoryPrintMarkup(options = {}) {
  const model = customerHistoryExportModel(options);
  return `${styles}<header><strong>VORA POS</strong><h1>Riwayat layanan pelanggan</h1><p>Outlet: ${h(model.outletName)}</p><p>Pelanggan: ${h(model.customerName)}${model.customerPhone ? ` · ${h(model.customerPhone)}` : ''}</p><p>Filter: ${h(model.filterLabel)}</p><p>Dibuat: ${h(model.generatedLabel)} (${h(model.timeZone)})</p><p>Seluruh ${model.count} catatan kunjungan sesuai filter.</p></header>${model.sections.map(sectionMarkup).join('')}<section class="ch-print-notes">${model.notes.map(note => `<p>${h(note)}</p>`).join('')}</section>`;
}

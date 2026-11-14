import { buildDashboardTaxReport } from '/dashboard-tax-report-model.js';
import { dateLabel, formatRange } from '/dashboard-date-range.js';
export { taxReportExportModel } from '/dashboard-tax-report-model.js';

const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const known = value => typeof value === 'number' && Number.isFinite(value);
const money = value => known(value) ? `Rp ${value.toLocaleString('id-ID')}` : '—';
const number = value => known(value) ? value.toLocaleString('id-ID', { maximumFractionDigits: 8 }) : '—';
function results(model) {
  const headings = ['No. struk / tanggal', 'Nama pajak', 'Tarif', 'Perlakuan harga', 'Dasar pajak awal', 'Pajak awal', 'Koreksi refund', 'Pajak bersih'];
  const rows = model.rows.map(row => `<tr>${[`${h(row.receipt)}<small>${h(dateLabel(row.date, { short: true }))}</small>`, h(row.name), row.rate === null ? '—' : `${h(number(row.rate))}%`, h(row.inclusive), h(money(row.base)), h(money(row.tax)), h(money(row.refundTax)), h(money(row.netTax))].map((value, index) => `<td data-label="${h(headings[index])}">${value}</td>`).join('')}</tr>`).join('');
  return `<div class="sp-metrics">${[['Transaksi sesuai filter', number(model.filteredCount)], ['Pajak awal', money(model.totals.tax)], ['Koreksi refund', money(model.totals.refundTax)], ['Pajak bersih', money(model.totals.net)]].map(([label, value]) => `<div class="sp-metric"><span>${h(label)}</span><strong>${h(value)}</strong><small>Sesuai transaksi tersimpan</small></div>`).join('')}</div><details class="sp-reading"><summary>Cara membaca laporan pajak</summary>${model.warnings.map(warning => `<p>${h(warning)}</p>`).join('')}<p>Dasar pajak awal mengikuti snapshot saat pembayaran, sebelum koreksi refund. Nilai — berarti belum tersedia; bukan nol.</p></details><section class="sp-card"><header class="sp-card-head"><div><h3>Rincian pajak per struk</h3><p>Nilai mengikuti pajak yang tercatat saat pembayaran. Pengaturan pajak sekarang tidak digunakan untuk menghitung ulang.</p></div><span class="sp-count" role="status">${h(number(model.filteredCount))} transaksi</span></header><div class="sp-table-wrap"><table class="sp-summary"><thead><tr>${headings.map(label => `<th scope="col">${h(label)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headings.length}" class="sp-empty">Tidak ada transaksi sesuai periode dan pencarian ini.</td></tr>`}</tbody></table></div><footer class="sp-pagination"><span>${model.filteredCount ? `${number((model.page - 1) * model.pageSize + 1)}–${number(Math.min(model.page * model.pageSize, model.filteredCount))} dari ${number(model.filteredCount)}` : 'Tidak ada catatan'}</span><div><button type="button" class="sp-page" data-tax-page="-1" ${model.page <= 1 ? 'disabled' : ''}>Sebelumnya</button><span>Halaman ${model.page} / ${model.pageCount}</span><button type="button" class="sp-page" data-tax-page="1" ${model.page >= model.pageCount ? 'disabled' : ''}>Berikutnya</button></div></footer></section><p class="sp-note">Excel dan PDF memuat seluruh transaksi sesuai pencarian dan periode, termasuk baris di halaman layar lain.</p>`;
}
export function renderTaxReport(report, { outlet, range = report?.range } = {}) {
  const model = buildDashboardTaxReport(report, { outlet, range });
  return `<section class="reports-surface staff-performance" data-tax-report><nav class="r-tabs" aria-label="Laporan pajak"><a href="#reports">Semua laporan</a><a href="#tax-report" class="active">Pajak penjualan</a></nav><header class="sp-meta"><div><span class="sp-eyebrow">PAJAK PENJUALAN</span><h2>Laporan pajak</h2><p>${h(model.outletName)} · ${h(formatRange(model.range))}</p></div><p>Ringkasan operasional sesuai struk tersimpan.</p></header><div class="sp-filters" role="search"><label>Cari nomor struk atau nama pajak<input type="search" maxlength="200" data-tax-search placeholder="Cari struk atau pajak…" aria-controls="tax-report-results"></label><button type="button" class="sp-reset" data-tax-reset disabled>Reset pencarian</button></div><div id="tax-report-results" data-tax-results>${results(model)}</div></section>`;
}
export function readTaxReportFilters(root) {
  return { search: String(root?.querySelector('[data-tax-search]')?.value || '').slice(0, 200) };
}
export function bindTaxReport(root, api) {
  const host = root?.querySelector('[data-tax-report]');
  if (!host) return () => {};
  const ctrl = new AbortController(); let page = 1;
  const current = () => !ctrl.signal.aborted && !api.signal?.aborted && (typeof api.isCurrent !== 'function' || api.isCurrent());
  const update = () => {
    if (!current()) return;
    const filters = readTaxReportFilters(host), model = buildDashboardTaxReport(api.report, { outlet: api.outlet, range: api.range || api.report.range, ...filters, page });
    page = model.page;
    host.querySelector('[data-tax-results]').innerHTML = results(model);
    host.querySelector('[data-tax-reset]').disabled = !filters.search;
  };
  buildDashboardTaxReport(api.report, { outlet: api.outlet, range: api.range || api.report.range });
  host.addEventListener('input', event => { if (event.target.hasAttribute?.('data-tax-search')) { page = 1; update(); } }, { signal: ctrl.signal });
  host.addEventListener('click', event => {
    const button = event.target.closest?.('[data-tax-page],[data-tax-reset]');
    if (!button || button.disabled || !host.contains(button) || !current()) return;
    event.preventDefault();
    if (button.hasAttribute('data-tax-reset')) { host.querySelector('[data-tax-search]').value = ''; page = 1; update(); host.querySelector('[data-tax-search]').focus(); }
    else { const direction = Number(button.dataset.taxPage); if ([-1, 1].includes(direction)) { page = Math.max(1, page + direction); update(); } }
  }, { signal: ctrl.signal });
  return () => ctrl.abort();
}

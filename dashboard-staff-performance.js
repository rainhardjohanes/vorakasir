import { filterStaffPerformance, validateStaffPerformanceModel } from '/dashboard-staff-performance-model.js';

const h = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const known = value => typeof value === 'number' && Number.isFinite(value);
const number = value => known(value) ? value.toLocaleString('id-ID', { maximumFractionDigits: 8 }) : '—';
const money = value => known(value) ? `Rp ${(value === 0 ? 0 : value).toLocaleString('id-ID', { maximumFractionDigits: 2 })}` : '—';
const commission = (model, value) => model.commissionAvailable ? value : null;
const SUMMARY_PAGE = 50, DETAIL_PAGE = 25;
const identityLabel = row => row.identityLabel || ({ id: 'ID staf pada snapshot', name: 'Nama pada struk', shared: 'Tim pada struk', unassigned: 'Pelaksana belum tercatat' }[row.identityKind] || 'Identitas belum tersedia');
const statusText = model => ({ available: 'Komisi sesuai catatan yang dapat diakses.', upgrade: 'Akses komisi memerlukan paket atau izin yang sesuai. Nilai komisi belum tersedia, bukan nol.', unavailable: 'Data komisi belum tersedia. Nilai komisi ditampilkan sebagai —, bukan nol.', error: 'Data komisi belum berhasil dimuat. Nilai komisi ditampilkan sebagai —, bukan nol.' }[model.commissionStatus] || 'Data komisi belum tersedia, bukan nol.');
const statusNotice = model => `<aside class="${model.commissionAvailable ? 'sp-note' : 'sp-warning'}" role="status">${h(statusText(model))}${model.commissionAvailable ? ' <a href="#commission-report">Buka laporan komisi tercatat</a>.' : ''} Data layanan tetap mengikuti struk tersimpan.</aside>`;
function validate(model) { return validateStaffPerformanceModel(model, { id: model?.outletId }, model?.range); }
function selection(model, filters) {
  validate(model);
  const selected = filters || model.filters || {};
  return filterStaffPerformance(model, selected.staffKey ? { staffKey: selected.staffKey, search: '' } : selected);
}
function sharedParticipations(base, selected) {
  const picked = base.summary.find(row => row.key === selected.filters.staffKey);
  if (picked?.identityKind !== 'id' || !picked.staffId || !selected.summary.some(row => row.key === picked.key)) return [];
  return base.items.filter(item => item.identityKind === 'shared' && Array.isArray(item.staffIds) && item.staffIds.includes(picked.staffId));
}
const headers = ['Staf pelaksana', 'Baris layanan', 'Unit tercatat', 'Transaksi unik', 'Penjualan item', 'Komisi lunas', 'Pengurang refund', 'Komisi bersih'];
function summaryValues(model, row) {
  return [row.staffName, row.lineCount, row.quantity, row.receiptCount, row.amount,
    commission(model, row.commissionEarned), commission(model, row.commissionReversed), commission(model, row.commissionNet)];
}
function pager(kind, count, size, page) {
  const pages = Math.max(1, Math.ceil(count / size)), current = Math.min(page, pages - 1);
  return `<footer class="sp-pagination"><span>${count ? `${number(current * size + 1)}–${number(Math.min(count, (current + 1) * size))} dari ${number(count)} catatan` : 'Tidak ada catatan'}</span><div><button class="sp-page" type="button" data-sp-page="${kind}" data-direction="-1" ${current === 0 ? 'disabled' : ''}>Sebelumnya</button><span>Halaman ${current + 1} / ${pages}</span><button class="sp-page" type="button" data-sp-page="${kind}" data-direction="1" ${current + 1 >= pages ? 'disabled' : ''}>Berikutnya</button></div></footer>`;
}
function serviceCard(item) {
  const fields = [['Staf pelaksana', item.staffName], ['Qty tercatat', number(item.qty)], ['Harga / unit', money(item.price)],
    ['Penjualan item', money(item.total)], ['Qty refund tercatat', number(item.refundedQty)], ['Qty neto tercatat', number(item.remainingQty)]];
  return `<li class="sp-item"><header><div><small>${h(item.receipt || item.saleId)} · ${h(item.date)} · Baris ${h(number(item.index + 1))}</small><h4>${h(item.name || 'Nama layanan belum tersedia')}</h4>${item.category ? `<p>${h(item.category)}</p>` : ''}</div><span class="sp-badge">Layanan / produk</span></header><dl>${fields.map(([label, value]) => `<div><dt>${h(label)}</dt><dd>${h(value || '—')}</dd></div>`).join('')}</dl>${item.note ? `<div class="sp-item-note"><strong>Catatan item</strong>${h(item.note)}</div>` : ''}${item.attributionNote ? `<p class="sp-item-note">${h(item.attributionNote)}</p>` : ''}</li>`;
}
function ledgerCard(row) {
  const earned = row.event_type === 'earned' ? row.amount : 0, reversed = row.source_archive ? null : row.event_type === 'refund' ? -row.amount : 0;
  return `<li class="sp-item"><header><div><small>${h(row.source_invoice_id || row.sale_id || 'Struk belum tersedia')} · ${h(row.sale_date || 'Tanggal belum tersedia')}</small><h4>${h(row.product_name || (row.scope === 'transaction' ? 'Komisi transaksi' : 'Nama produk belum tersedia'))}</h4><p>${h(row.rule_name || 'Grup belum tersedia')}</p></div><span class="sp-badge">${row.source_archive ? 'Arsip komisi' : row.event_type === 'refund' ? 'Pengurang komisi' : 'Komisi lunas'}</span></header><dl>${[['Staf penerima', row.staff_name], ['Jenis komisi', row.scope === 'transaction' ? 'Per transaksi' : 'Per produk'], ['Komisi lunas', money(earned)], ['Pengurang refund', money(reversed)], ['Komisi bersih', money(row.amount)], ['Unit tercatat', number(row.product_quantity)], ['Unit refund tercatat', number(row.refund_quantity)]].map(([label, value]) => `<div><dt>${h(label)}</dt><dd>${h(value || '—')}</dd></div>`).join('')}</dl></li>`;
}
function participationSection(base, selected, page = 0) {
  const items = sharedParticipations(base, selected);
  if (!items.length) return '';
  const picked = base.summary.find(row => row.key === selected.filters.staffKey);
  const current = Math.min(page, Math.max(0, Math.ceil(items.length / DETAIL_PAGE) - 1));
  const cards = items.slice(current * DETAIL_PAGE, (current + 1) * DETAIL_PAGE).map(item => `<li class="sp-item"><header><div><small>${h(item.receipt || item.saleId)} · ${h(item.date)} · Baris ${h(number(item.index + 1))}</small><h4>${h(item.name || 'Nama layanan belum tersedia')}</h4></div><span class="sp-badge">Partisipasi bersama</span></header><dl><div><dt>Staf yang dipilih</dt><dd>${h(picked.staffName)}</dd></div><div class="sp-item-wide"><dt>Tim pada struk</dt><dd>${h(item.staffName || item.servedBy)}</dd></div></dl>${item.note ? `<div class="sp-item-note"><strong>Catatan item</strong>${h(item.note)}</div>` : ''}</li>`).join('');
  return `<section class="sp-card" data-sp-shared><header class="sp-card-head"><div><h3>Layanan bersama</h3><p>Referensi partisipasi ${h(picked.staffName)}. Nilai dan unit layanan tercatat satu kali pada tim.</p></div><span class="sp-count">${number(items.length)} partisipasi</span></header><ol class="sp-items">${cards}</ol>${pager('shared', items.length, DETAIL_PAGE, current)}</section>`;
}
function results(base, model, pages = {}) {
  const summaryPage = Math.min(pages.summary || 0, Math.max(0, Math.ceil(model.summary.length / SUMMARY_PAGE) - 1));
  const itemPage = Math.min(pages.items || 0, Math.max(0, Math.ceil(model.items.length / DETAIL_PAGE) - 1));
  const ledger = model.commissionAvailable ? model.commissionItems : [];
  const ledgerPage = Math.min(pages.ledger || 0, Math.max(0, Math.ceil(ledger.length / DETAIL_PAGE) - 1));
  const metrics = [['Transaksi unik', number(model.totals.receiptCount), 'Transaksi yang terkait dengan staf sesuai filter'], ['Unit tercatat', number(model.totals.quantity), 'Unit pada snapshot layanan, sebelum refund'], ['Penjualan item', money(model.totals.amount), 'Harga item × jumlah pada struk'], ['Komisi bersih tercatat', money(commission(model, model.totals.commissionNet)), 'Komisi tersimpan setelah koreksi refund']];
  const rows = model.summary.slice(summaryPage * SUMMARY_PAGE, (summaryPage + 1) * SUMMARY_PAGE).map(row => {
    const values = summaryValues(model, row);
    return `<tr data-selected="${model.filters.staffKey === row.key}">${values.map((value, index) => `<td data-label="${h(headers[index])}">${index === 0 ? `<button type="button" class="sp-staff" data-sp-staff="${h(row.key)}">${h(row.staffName)}</button><small>${h(identityLabel(row))}</small>${row.sharedParticipationCount > 0 ? `<small>${h(number(row.sharedParticipationCount))} partisipasi layanan bersama</small>` : ''}${row.unknownQuantityCount || row.unknownAmountCount ? '<small>Sebagian rincian belum lengkap</small>' : ''}` : h(index >= 4 ? money(value) : number(value))}</td>`).join('')}</tr>`;
  }).join('');
  const picked = base.summary.find(row => row.key === model.filters.staffKey);
  return `${statusNotice(model)}<div class="sp-metrics">${metrics.map(([label, value, note]) => `<div class="sp-metric"><span>${h(label)}</span><strong>${h(value)}</strong><small>${h(note)}</small></div>`).join('')}</div><p class="sp-note">Penjualan item = harga item × jumlah, sebelum diskon struk dan refund; belum termasuk pajak dan biaya layanan.</p>${model.warnings.length ? `<aside class="sp-warning"><ul>${model.warnings.map(note => `<li>${h(note)}</li>`).join('')}</ul></aside>` : ''}${model.notes.length ? `<details class="sp-reading"><summary>Cara membaca laporan</summary>${model.notes.map(note => `<p>${h(note)}</p>`).join('')}</details>` : ''}<section class="sp-card"><header class="sp-card-head"><div><h3>Ringkasan per staf pelaksana</h3><p>Klik nama staf untuk membuka layanan dan catatan komisinya. Kasir pembayaran tetap merupakan peran terpisah.</p></div><span class="sp-count" role="status">${number(model.summary.length)} staf / tim</span></header><div class="sp-table-wrap"><table class="sp-summary"><thead><tr>${headers.map(header => `<th scope="col">${h(header)}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="sp-empty">Tidak ada staf yang cocok dengan periode dan filter ini.</td></tr>`}</tbody></table></div>${pager('summary', model.summary.length, SUMMARY_PAGE, summaryPage)}</section><section class="sp-card sp-detail-focus" data-sp-details tabindex="-1"><header class="sp-card-head"><div><h3>${picked ? `Rincian ${h(picked.staffName)}` : 'Rincian layanan sesuai filter'}</h3><p>Setiap item berasal dari baris struk tersimpan; nama atau harga yang sama tidak digabungkan.</p></div><span class="sp-count">${number(model.items.length)} baris layanan</span></header>${model.items.length ? `<ol class="sp-items">${model.items.slice(itemPage * DETAIL_PAGE, (itemPage + 1) * DETAIL_PAGE).map(serviceCard).join('')}</ol>` : '<p class="sp-empty">Tidak ada rincian layanan tersimpan untuk pilihan ini.</p>'}${pager('items', model.items.length, DETAIL_PAGE, itemPage)}</section>${participationSection(base, model, pages.shared || 0)}<section class="sp-card"><header class="sp-card-head"><div><h3>Catatan komisi terpisah</h3><p>Komisi lunas dan koreksi refund sesuai catatan tersimpan.</p></div><span class="sp-count">${model.commissionAvailable ? number(ledger.length) : '—'} catatan</span></header>${!model.commissionAvailable ? `<p class="sp-empty">${h(statusText(model))}</p>` : ledger.length ? `<ol class="sp-items">${ledger.slice(ledgerPage * DETAIL_PAGE, (ledgerPage + 1) * DETAIL_PAGE).map(ledgerCard).join('')}</ol>` : '<p class="sp-empty">Tidak ada catatan komisi yang dapat ditautkan ke identitas staf pada pilihan ini.</p>'}${model.commissionAvailable ? pager('ledger', ledger.length, DETAIL_PAGE, ledgerPage) : ''}</section><p class="sp-note">Excel dan PDF memuat seluruh catatan sesuai pencarian, staf dan periode yang dipilih, termasuk catatan di halaman layar lain.</p>`;
}

export function renderStaffPerformance(model, { filters } = {}) {
  const selected = selection(model, filters);
  return `<section class="reports-surface staff-performance" data-staff-performance><nav class="r-tabs" aria-label="Laporan staf"><a href="#reports">Semua laporan</a><a class="active" href="#staff-performance">Kinerja staf</a><a href="#staff-report">Penjualan per kasir</a></nav><header class="sp-meta"><div><span class="sp-eyebrow">STAF PELAKSANA</span><h2>Kinerja staf</h2><p>${h(model.outletName)} · ${h(model.range.start)} – ${h(model.range.end)}</p></div><div><p>Periode mengikuti tanggal transaksi asal.</p><small>Pelaksana layanan dibedakan dari kasir pembayaran.</small></div></header><div class="sp-filters" role="search"><label>Cari staf, layanan atau catatan<input type="search" maxlength="200" data-sp-search value="${h(selected.filters.search)}" placeholder="Ketik nama staf atau layanan…" aria-controls="staff-performance-results"></label><label>Staf / tim<select data-sp-select aria-controls="staff-performance-results"><option value="">Semua staf / tim</option>${model.summary.map(row => `<option value="${h(row.key)}" ${selected.filters.staffKey === row.key ? 'selected' : ''}>${h(row.staffName)} · ${h(identityLabel(row))}</option>`).join('')}</select></label><button class="sp-reset" type="button" data-sp-reset ${selected.filters.search || selected.filters.staffKey ? '' : 'disabled'}>Reset filter</button></div><div id="staff-performance-results" data-sp-results>${results(model, selected)}</div></section>`;
}
export function readStaffPerformanceFilters(root) {
  return { search: String(root?.querySelector('[data-sp-search]')?.value || '').slice(0, 200), staffKey: String(root?.querySelector('[data-sp-select]')?.value || '') };
}
export function bindStaffPerformance(root, api) {
  const host = root?.querySelector('[data-staff-performance]');
  if (!host) return () => {};
  validateStaffPerformanceModel(api.report, api.outlet, api.range || api.report.range);
  const ctrl = new AbortController(), pages = { summary: 0, items: 0, ledger: 0, shared: 0 };
  const current = () => !ctrl.signal.aborted && !api.signal?.aborted && (typeof api.isCurrent !== 'function' || api.isCurrent());
  const update = (reset = true) => {
    if (!current()) return;
    if (reset) Object.assign(pages, { summary: 0, items: 0, ledger: 0, shared: 0 });
    const filters = readStaffPerformanceFilters(host), selected = selection(api.report, filters);
    host.querySelector('[data-sp-results]').innerHTML = results(api.report, selected, pages);
    host.querySelector('[data-sp-reset]').disabled = !filters.search && !filters.staffKey;
  };
  host.addEventListener('input', event => { if (event.target.hasAttribute?.('data-sp-search')) { host.querySelector('[data-sp-select]').value = ''; update(); } }, { signal: ctrl.signal });
  host.addEventListener('change', event => { if (event.target.hasAttribute?.('data-sp-select')) { host.querySelector('[data-sp-search]').value = ''; update(); } }, { signal: ctrl.signal });
  host.addEventListener('click', event => {
    const button = event.target.closest?.('[data-sp-staff],[data-sp-reset],[data-sp-page]');
    if (!button || button.disabled || !host.contains(button) || !current()) return;
    event.preventDefault();
    if (button.hasAttribute('data-sp-staff')) {
      const key = button.dataset.spStaff;
      if (!api.report.summary.some(row => row.key === key)) return;
      host.querySelector('[data-sp-search]').value = '';
      host.querySelector('[data-sp-select]').value = key;
      update(); const details = host.querySelector('[data-sp-details]'); details?.focus({ preventScroll: true }); details?.scrollIntoView?.({ block: 'start' });
    } else if (button.hasAttribute('data-sp-reset')) {
      host.querySelector('[data-sp-search]').value = ''; host.querySelector('[data-sp-select]').value = '';
      update(); host.querySelector('[data-sp-search]').focus();
    } else {
      const kind = button.dataset.spPage, direction = Number(button.dataset.direction);
      if (!Object.hasOwn(pages, kind) || ![-1, 1].includes(direction)) return;
      pages[kind] = Math.max(0, pages[kind] + direction); update(false);
    }
  }, { signal: ctrl.signal });
  return () => ctrl.abort();
}

const detailHeaders = ['Staf pelaksana', 'Identitas staf', 'Jenis catatan', 'No. struk', 'ID transaksi', 'Tanggal transaksi', 'Baris struk', 'Layanan / produk', 'Kategori', 'SKU', 'Satuan', 'Unit tercatat', 'Unit refund tercatat', 'Unit neto tercatat', 'Harga / unit', 'Penjualan item', 'Catatan item', 'Sumber atribusi', 'Jenis komisi', 'Grup komisi', 'Komisi lunas', 'Pengurang refund', 'Komisi bersih', 'ID refund', 'ID catatan komisi'];
function scalar(value) {
  if (value == null) return '—';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('Angka ekspor tidak valid.'); return value; }
  if (typeof value !== 'string' && typeof value !== 'boolean') throw new TypeError('Nilai ekspor tidak didukung.');
  const text = String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
  if (text.length > 32767) throw new TypeError('Teks terlalu panjang untuk satu sel Excel; isi tidak dipotong.');
  return text;
}
/** Shared immutable, full-filter export snapshot for XLSX and PDF. */
export function staffPerformanceExportModel({ model, outlet, filters, generatedAt = new Date().toISOString(), timeZone, range } = {}) {
  if (!outlet?.id) throw new TypeError('Pilih outlet untuk mengekspor laporan.');
  validateStaffPerformanceModel(model, outlet, range || model?.range);
  const selected = selection(model, filters);
  const date = new Date(generatedAt), zone = timeZone || outlet.timezone || outlet.time_zone || 'Asia/Makassar';
  if (!Number.isFinite(date.getTime())) throw new TypeError('Waktu pembuatan laporan tidak valid.');
  let generatedLabel;
  try { generatedLabel = new Intl.DateTimeFormat('id-ID', { timeZone: zone, dateStyle: 'long', timeStyle: 'medium', hourCycle: 'h23' }).format(date); }
  catch { throw new TypeError('Zona waktu laporan tidak valid.'); }
  const ledger = selected.commissionAvailable ? selected.commissionItems : [], shared = sharedParticipations(model, selected);
  if (selected.summary.length > 50000 || selected.items.length + ledger.length + shared.length > 50000) throw new TypeError('Rincian melebihi 50.000 catatan. Pilih periode lebih pendek; ekspor tidak dipotong.');
  const staff = new Map(model.summary.map(row => [row.key, row]));
  const itemRows = selected.items.map(item => [item.staffName, identityLabel(staff.get(item.staffKey) || item), 'Layanan / produk', item.receipt || item.saleId, item.saleId, item.date, item.index + 1, item.name, item.category || null, item.sku || null, item.unit || null, item.qty, item.refundedQty, item.remainingQty, item.price, item.total, item.note || null, item.attributionNote || null, null, null, null, null, null, null, null]);
  const ledgerRows = ledger.map(row => [row.staff_name, identityLabel(staff.get(row.staffKey) || { identityKind: 'id' }), row.source_archive ? 'Arsip komisi' : row.event_type === 'refund' ? 'Pengurang komisi' : 'Komisi lunas', row.source_invoice_id || row.sale_id || null, row.sale_id || null, row.sale_date || null, null, row.product_name || (row.scope === 'transaction' ? 'Seluruh transaksi' : null), null, null, null, row.product_quantity ?? null, row.refund_quantity ?? null, null, null, null, null, 'Identitas pada catatan komisi', row.scope === 'transaction' ? 'Transaksi' : 'Produk', row.rule_name || null, row.event_type === 'earned' ? row.amount : 0, row.source_archive ? null : row.event_type === 'refund' ? -row.amount : 0, row.amount, row.refund_id || null, row.id]);
  const picked = model.summary.find(row => row.key === selected.filters.staffKey);
  const sharedRows = shared.map(item => [picked.staffName, identityLabel(picked), 'Partisipasi layanan bersama', item.receipt || item.saleId, item.saleId, item.date, item.index + 1, item.name, item.category || null, item.sku || null, item.unit || null, null, null, null, null, null, item.note || null, `Tim pada struk: ${item.staffName || item.servedBy}. Nilai dan unit tercatat pada tim.`, null, null, null, null, null, null, null]);
  const filterLabel = [picked ? picked.staffName : 'Semua staf / tim', selected.filters.search ? `Pencarian: ${selected.filters.search}` : ''].filter(Boolean).join(' · ');
  return { outletId: model.outletId, outletName: scalar(model.outletName), dateFrom: model.range.start, dateUntil: model.range.end,
    filters: { ...selected.filters }, filterLabel, generatedAt: date.toISOString(), generatedLabel, timeZone: zone,
    commissionStatus: selected.commissionStatus,
    summary: { headers: [...headers, 'Partisipasi layanan bersama'], rows: selected.summary.map(row => [...summaryValues(selected, row), row.sharedParticipationCount].map(scalar)), moneyColumns: [...headers.map((_, index) => index >= 4), false] },
    details: { headers: [...detailHeaders], rows: [...itemRows, ...sharedRows, ...ledgerRows].map(row => row.map(scalar)), moneyColumns: detailHeaders.map((_, index) => [14, 15, 20, 21, 22].includes(index)) },
    notes: [...new Set([statusText(selected), ...(selected.notes || []), ...(selected.warnings || []), 'Penjualan item = harga item × jumlah, sebelum diskon struk dan refund; belum termasuk pajak dan biaya layanan.', 'Rincian layanan dan catatan komisi tersimpan disajikan terpisah. Data yang belum tersedia ditampilkan sebagai —.', 'Seluruh catatan sesuai filter disertakan. Catatan komisi bukan bukti pembayaran gaji.'])].map(scalar) };
}

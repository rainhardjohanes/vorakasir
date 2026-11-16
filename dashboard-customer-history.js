import { icon, escape } from '/dashboard-icons.js';
import { buildCustomerHistoryModel, filterCustomerHistoryModel } from '/dashboard-customer-history-model.js';
import { createCustomerHistoryWorkbook } from '/dashboard-customer-history-workbook.js';
import { createCustomerHistoryPrintMarkup } from '/dashboard-customer-history-print.js';
import { digitalInvoice } from '/dashboard-reports.js';

const h = value => escape(value ?? '');
const list = value => Array.isArray(value) ? value : [];
const known = value => typeof value === 'number' && Number.isFinite(value);
const money = value => known(value) ? `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 2 })}` : '—';
const count = value => known(value) ? value.toLocaleString('id-ID', { maximumFractionDigits: 8 }) : '—';
const text = value => typeof value === 'string' ? value : '';
const statuses = [['all', 'Semua status'], ['paid', 'Lunas'], ['partial', 'Dibayar sebagian'], ['unpaid', 'Belum dibayar'], ['refunded', 'Ada refund'], ['void', 'VOID / dibatalkan'], ['review', 'Perlu diperiksa']];
const statusClass = status => statuses.some(([value]) => value === status) ? status : 'review';
const operationId = () => crypto.randomUUID();
const option = (value, label, current) => `<option value="${h(value)}" ${value === current ? 'selected' : ''}>${h(label)}</option>`;
export function customerHistoryDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) return '—';
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return '—';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}
const stamp = (value, timeZone = 'Asia/Makassar') => Number.isFinite(Date.parse(value || '')) ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(value)).replace(' pukul ', ' · ').replace(', ', ' · ') : '';
const zoneLabel = value => ({ 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' }[value] || value || 'WITA');
const initial = value => (text(value).trim().match(/\S+/g) || ['P']).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase('id-ID');
const dateCaption = filters => filters.dateFrom || filters.dateUntil ? `${filters.dateFrom ? customerHistoryDate(filters.dateFrom) : 'Awal riwayat'} – ${filters.dateUntil ? customerHistoryDate(filters.dateUntil) : 'Sekarang'}` : 'Semua tanggal';
function warnings(values) {
  const rows = list(values).map(row => typeof row === 'string' ? row : row?.message).filter(Boolean);
  return rows.length ? `<aside class="ch-warning" role="status">${icon('info')}<div>${rows.map(row => `<p>${h(row)}</p>`).join('')}</div></aside>` : '';
}
const pill = row => `<span class="ch-status ch-status-${statusClass(row.status)}">${h(row.statusLabel || 'Perlu diperiksa')}</span>`;
const loading = message => `<div class="ch-loading" role="status"><span class="ch-spinner" aria-hidden="true"></span><strong>${h(message)}</strong><p>Mohon tunggu sebentar.</p></div>`;
function profile(customer, snapshot = {}) {
  const group = snapshot.priceGroup?.name || customer.priceGroupName || customer.price_group_name || '';
  return `<header class="ch-profile"><span class="ch-avatar" aria-hidden="true">${h(initial(customer.name))}</span><div class="ch-profile-main"><span class="ch-eyebrow">PROFIL PELANGGAN</span><h3>${h(customer.name || 'Pelanggan')}</h3><div class="ch-contact">${customer.phone ? `<span>${h(customer.phone)}</span>` : '<span>Nomor HP belum diisi</span>'}${group ? `<span class="ch-price-group">${h(group)}</span>` : ''}${customer.deleted_at ? '<span class="ch-archived">Pelanggan diarsipkan</span>' : ''}</div>${customer.address ? `<p>${h(customer.address)}</p>` : ''}</div></header>`;
}
function metrics(model) {
  const s = model.summary || {};
  const rows = [['Kunjungan', count(s.visitCount), known(s.unknownVisitCount) && s.unknownVisitCount > 0 ? `${count(s.receiptCount)} invoice; jumlah kunjungan belum dapat dipastikan` : 'Pesanan yang sudah memiliki pembayaran'], [s.lastVisitDate ? 'Kunjungan terakhir' : 'Pembayaran terakhir', customerHistoryDate(s.lastVisitDate || s.lastTransactionDate), s.lastVisitDate ? 'Berdasarkan riwayat yang tercatat' : 'Berdasarkan invoice terakhir'], ['Belanja bersih', money(s.net), 'Pembayaran dikurangi refund'], ['Pembayaran tercatat', money(s.paid), 'Termasuk pembayaran sebagian'], ['Refund tercatat', money(s.refund), 'Pengembalian dana pelanggan'], ['Sisa tagihan', money(s.remaining), 'Dari pesanan yang belum lunas']];
  return `<section class="ch-summary" aria-label="Ringkasan seluruh riwayat"><div class="ch-section-label">Ringkasan seluruh riwayat${model.complete === false || s.complete === false ? ' · belum lengkap' : ''}</div><div class="ch-metrics">${rows.map(([label, value, detail], index) => `<div class="ch-metric ${index === 2 ? 'ch-metric-accent' : ''}"><span>${h(label)}</span><strong>${h(value)}</strong><small>${h(detail)}</small></div>`).join('')}</div></section>`;
}
export function renderCustomerHistoryItem(item) {
  const pricing = item.pricing || {}, extras = list(item.extras);
  return `<article class="ch-item"><div class="ch-item-heading"><div><h5>${h(item.name || 'Produk / layanan')}</h5><span>${h(count(item.qty))}${item.unit ? ` ${h(item.unit)}` : ''} × ${h(money(item.price))}</span></div><strong>${h(money(item.total))}</strong></div><dl class="ch-item-meta"><div><dt>${icon('users')} Dilayani oleh</dt><dd>${h(item.servedBy || 'Belum tercatat pada struk')}</dd></div>${extras.length ? `<div><dt>Ekstra</dt><dd>${extras.map(extra => h([extra.group, extra.name].filter(Boolean).join(' · ')) + (known(extra.price) ? ` <span>(${h(money(extra.price))})</span>` : '')).join('<br>')}<small>Sudah termasuk harga item.</small></dd></div>` : ''}${item.note ? `<div><dt>Catatan layanan</dt><dd class="ch-preserve">${h(item.note)}</dd></div>` : ''}${pricing.groupName ? `<div><dt>Grup harga</dt><dd>${h(pricing.groupName)}</dd></div>` : ''}${known(pricing.negotiatedPrice) ? `<div><dt>Harga nego</dt><dd>${h(money(pricing.referencePrice))} → ${h(money(pricing.negotiatedPrice))}</dd></div>` : ''}${known(item.refundedQty) && item.refundedQty > 0 ? `<div><dt>Qty direfund</dt><dd>${h(count(item.refundedQty))}</dd></div>` : ''}</dl></article>`;
}
function invoices(row) {
  return `<div class="ch-invoice-list"><h5>Pembayaran & invoice</h5>${list(row.invoices).length ? list(row.invoices).map(invoice => `<article class="ch-invoice"><div><strong>${h(invoice.reference || invoice.id)}</strong><small>${h(customerHistoryDate(invoice.date))}${invoice.time ? ` · ${h(invoice.time)}` : ''}</small><span>${h(invoice.method || 'Metode belum tercatat')} · ${h(invoice.statusLabel || invoice.status || '')}</span></div><div class="ch-invoice-action"><strong>${h(money(invoice.total))}</strong><button type="button" class="ch-text-button" data-ch-invoice="${h(invoice.id)}">Lihat invoice ${icon('chevron')}</button></div></article>`).join('') : '<p class="ch-muted">Belum ada pembayaran / invoice pada pesanan ini.</p>'}</div>`;
}
function visitEvents(row) {
  const events = list(row.events);
  if (!events.length) return '';
  return `<details class="ch-events"><summary>${icon('clock')} Catatan VOID / refund <span>${events.length}</span>${icon('down')}</summary><div>${events.map(event => `<article><header><strong>${h(event.label || 'Perubahan status')}</strong><span>${h(customerHistoryDate(event.date))}${event.time ? ` · ${h(event.time)}` : ''}</span></header>${known(event.amount) ? `<b>${h(money(event.amount))}</b>` : ''}${event.itemName ? `<p>Produk / layanan: ${h(event.itemName)}</p>` : ''}${event.staffName ? `<p>Dicatat oleh: ${h(event.staffName)}</p>` : ''}${event.reason ? `<p class="ch-preserve">${h(event.reason)}</p>` : ''}</article>`).join('')}</div></details>`;
}
function visit(row, expanded) {
  const amounts = row.amounts || {}, items = list(row.items);
  return `<details class="ch-visit" data-ch-visit="${h(row.id)}" ${expanded.has(row.id) ? 'open' : ''}><summary><span class="ch-visit-date"><span class="ch-date-icon">${icon('calendar')}</span><span><strong>${h(customerHistoryDate(row.date))}</strong><small>${h(row.time || '')}</small></span></span><span class="ch-visit-title"><strong>${h(row.reference || row.id)}</strong><small>${h(items.map(item => item.name).filter(Boolean).slice(0, 3).join(' · ') || 'Rincian layanan belum tersedia')}${items.length > 3 ? ` +${items.length - 3} lainnya` : ''}</small></span><span class="ch-visit-status">${pill(row)}<strong>${h(money(amounts.net))}</strong></span>${icon('down', 'ch-visit-chevron')}</summary><div class="ch-visit-content">${warnings(row.warnings)}<div class="ch-items"><h4>Produk & layanan</h4>${items.map(renderCustomerHistoryItem).join('') || '<p class="ch-muted">Rincian produk / layanan tidak tersimpan pada catatan ini.</p>'}</div>${list(row.orderNotes).length || row.note ? `<div class="ch-order-note"><strong>Catatan pesanan</strong><p>${h(list(row.orderNotes).join('\n') || row.note)}</p></div>` : ''}${invoices(row)}${visitEvents(row)}<dl class="ch-visit-totals">${[['Nilai tagihan', amounts.billed], ['Pembayaran', amounts.paid], ['Refund', amounts.refund], ['Belanja bersih', amounts.net], ['Sisa tagihan', amounts.remaining]].map(([label, value]) => `<div><dt>${h(label)}</dt><dd>${h(money(value))}</dd></div>`).join('')}</dl></div></details>`;
}
function historyResults(model, expanded) {
  return `<div class="ch-results-heading"><div><h4>Riwayat kunjungan</h4><p>${h(count(model.filteredCount))} dari ${h(count(model.totalCount))} catatan sesuai pencarian</p></div><span>Terbaru lebih dahulu</span></div><div class="ch-visits">${list(model.rows).map(row => visit(row, expanded)).join('') || `<div class="ch-empty">${icon('receipt')}<h4>${model.totalCount ? 'Tidak ada riwayat yang cocok' : 'Belum ada riwayat pelanggan'}</h4><p>${model.totalCount ? 'Coba ubah pencarian, tanggal, atau status.' : 'Pilih pelanggan ini saat membuat pesanan di kasir. Riwayat akan muncul setelah transaksi tersinkron.'}</p></div>`}</div><footer class="ch-pagination"><span>Halaman ${h(count(model.page || 1))} dari ${h(count(model.pageCount || 1))}</span><div><button type="button" class="ch-button" data-ch-page="${Math.max(1, (model.page || 1) - 1)}" ${model.page <= 1 ? 'disabled' : ''}>Sebelumnya</button><button type="button" class="ch-button" data-ch-page="${(model.page || 1) + 1}" ${model.page >= model.pageCount ? 'disabled' : ''}>Berikutnya ${icon('chevron')}</button></div></footer>`;
}
function historyPanel(model, filters, state) {
  return `<section role="tabpanel" id="ch-history-panel" aria-labelledby="ch-history-tab"><div class="ch-toolbar"><label class="ch-search"><span class="sr-only">Cari riwayat pelanggan</span>${icon('search')}<input type="search" maxlength="200" data-ch-filter="query" value="${h(filters.query || '')}" placeholder="Cari layanan, staf, nomor invoice…" autocomplete="off"></label><label class="ch-status-filter"><span class="sr-only">Status riwayat</span><select data-ch-filter="status">${statuses.map(([value, label]) => option(value, label, filters.status || 'all')).join('')}</select></label><details class="ch-date-filter"><summary>${icon('calendar')}<span data-ch-date-caption>${h(dateCaption(filters))}</span>${icon('down')}</summary><div><label>Dari tanggal<input type="date" data-ch-filter="dateFrom" value="${h(filters.dateFrom || '')}"></label><label>Sampai tanggal<input type="date" data-ch-filter="dateUntil" value="${h(filters.dateUntil || '')}"></label><p>Periode: <strong data-ch-date-description>${h(dateCaption(filters))}</strong></p><button type="button" class="ch-text-button" data-ch-reset>Reset semua filter</button></div></details></div><div class="ch-error" data-ch-filter-error role="alert" hidden></div><div data-ch-results>${historyResults(model, state.expanded)}</div><p class="ch-footnote">Tanggal, harga, staf, dan catatan mengikuti transaksi tersimpan. Data dari kasir yang belum tersinkron belum muncul di dashboard.</p></section>`;
}
function notesPanel(snapshot, state, canWrite) {
  const notes = list(snapshot.notes).filter(note => !note.deleted_at), editing = notes.find(note => note.id === state.editNote);
  return `<section class="ch-notes" role="tabpanel" id="ch-notes-panel" aria-labelledby="ch-notes-tab"><div class="ch-note-access">${icon('lock')}<div><strong>Catatan umum pelanggan</strong><p>Hanya pemilik outlet yang dapat melihat dan mengelola catatan ini.</p></div></div>${canWrite ? `<form data-ch-note-form><label for="ch-note-body">${editing ? 'Ubah catatan' : 'Tambahkan catatan'}</label><textarea id="ch-note-body" name="body" rows="4" maxlength="4000" required placeholder="Contoh: pelanggan lebih nyaman dilayani pada sore hari.">${h(state.noteDraft || '')}</textarea><div class="ch-note-form-footer"><span><span data-ch-note-count>${(state.noteDraft || '').length}</span>/4.000 karakter</span><div>${editing ? '<button type="button" class="ch-button" data-ch-note-cancel>Batal ubah</button>' : ''}<button type="submit" class="ch-button ch-button-primary">${icon('check')} ${editing ? 'Simpan perubahan' : 'Simpan catatan'}</button></div></div></form>` : '<p class="ch-muted">Anda tidak memiliki akses untuk mengubah catatan pelanggan.</p>'}<div class="ch-note-list">${notes.length ? notes.map(note => `<article class="ch-note-card"><header><div><strong>${h(note.author_name || note.created_by_name || 'Pemilik outlet')}</strong><small>${h(stamp(note.updated_at || note.created_at, state.timeZone))}${Number(note.revision) > 1 ? ' · diubah' : ''}</small></div>${canWrite ? `<div><button type="button" class="ch-text-button" data-ch-note-edit="${h(note.id)}">Ubah</button><button type="button" class="ch-text-button ch-danger" data-ch-note-delete="${h(note.id)}">Hapus</button></div>` : ''}</header><p>${h(note.body || '')}</p>${state.confirmDelete === note.id ? `<div class="ch-confirm" role="alert"><strong>Hapus catatan ini?</strong><p>Catatan akan dikeluarkan dari daftar aktif. Riwayat perubahan tetap disimpan.</p><div><button type="button" class="ch-button" data-ch-note-delete-cancel>Batal</button><button type="button" class="ch-button ch-button-danger" data-ch-note-delete-confirm="${h(note.id)}">Hapus catatan</button></div></div>` : ''}</article>`).join('') : '<div class="ch-empty"><h4>Belum ada catatan pelanggan</h4><p>Catatan yang disimpan akan tampil di sini beserta waktu pencatatannya.</p></div>'}</div></section>`;
}
function legacyRows(state) {
  const result = state.legacyResult || {}, rows = list(result.rows || result.documents || result.records || result.items);
  return `<div class="ch-legacy-results">${state.legacySearched ? `<p class="ch-muted">${rows.length ? `${count(rows.length)} nota ditemukan pada halaman ini` : 'Tidak ada nota tanpa pelanggan yang cocok.'}</p>` : ''}${rows.map(row => `<article class="ch-legacy-row"><div><strong>${h(row.reference || row.receipt_number || row.order_number || row.recordId || row.id)}</strong><small>${h(customerHistoryDate(row.date))}${row.time ? ` · ${h(row.time)}` : ''} · ${h(row.recordType === 'order' || row.record_type === 'order' ? 'Pesanan' : 'Invoice')}</small><span>${h(money(row.total))}${row.statusLabel || row.status ? ` · ${h(row.statusLabel || row.status)}` : ''}</span></div><button type="button" class="ch-button" data-ch-legacy-select="${h(row.recordId || row.record_id || row.id)}">Pilih</button></article>`).join('')}${result.nextCursor || result.hasMore ? '<button type="button" class="ch-button ch-load-more" data-ch-legacy-more>Muat nota berikutnya</button>' : ''}</div>`;
}
function legacyPanel(customer, state) {
  const row = state.selectedLegacy;
  return `<section class="ch-legacy"><button type="button" class="ch-back" data-ch-back>${icon('chevron')} Kembali ke riwayat</button><div class="ch-section-intro"><h3>Hubungkan nota lama</h3><p>Pilih nota outlet ini yang belum memiliki pelanggan. Nota akan ditautkan ke <strong>${h(customer.name)}</strong>; rincian dan nilai transaksi tetap dipertahankan.</p></div>${row ? `<div class="ch-link-confirm"><h4>Konfirmasi nota pelanggan</h4><dl><div><dt>Nomor nota</dt><dd>${h(row.reference || row.receipt_number || row.order_number || row.recordId || row.id)}</dd></div><div><dt>Pelanggan</dt><dd>${h(customer.name)}</dd></div><div><dt>Nilai transaksi</dt><dd>${h(money(row.total))}</dd></div></dl><form data-ch-link-form><label for="ch-link-reason">Alasan menghubungkan nota</label><textarea id="ch-link-reason" name="reason" rows="3" minlength="10" maxlength="1000" required placeholder="Jelaskan dasar pencocokan nota ini, minimal 10 karakter.">${h(state.linkReason || '')}</textarea><div class="ch-link-actions"><button type="button" class="ch-button" data-ch-legacy-cancel>Batal pilih</button><button type="submit" class="ch-button ch-button-primary">${icon('check')} Hubungkan nota</button></div></form></div>` : `<form class="ch-legacy-search" data-ch-legacy-form><label>Cari nomor invoice / pesanan<input type="search" name="search" minlength="3" maxlength="150" value="${h(state.legacySearch || '')}" required placeholder="Contoh: INV/161126/K01/000001"></label><button type="submit" class="ch-button ch-button-primary">${icon('search')} Cari nota</button></form><p class="ch-footnote">Ketik minimal 3 karakter. Pencocokan nama atau nomor HP tidak dilakukan otomatis.</p>${legacyRows(state)}`}</section>`;
}
const directLinks = snapshot => list(snapshot.links).filter(link => link.customer_id === snapshot.customer?.id && !link.source_order_id);
function unlinkPanel(snapshot, model, state) {
  const links = directLinks(snapshot), selected = state.selectedUnlink && !state.selectedUnlink.source_order_id && links.some(link => link.record_type === state.selectedUnlink.record_type && link.record_id === state.selectedUnlink.record_id) ? state.selectedUnlink : null;
  const reference = link => {
    const visit = model.visits.find(row => link.record_type === 'order' ? list(row.orders).some(order => order.id === link.record_id) : list(row.invoices).some(invoice => invoice.id === link.record_id));
    return link.record_type === 'sale' ? visit?.invoices.find(invoice => invoice.id === link.record_id)?.reference || link.record_id : visit?.reference || link.record_id;
  };
  return `<section class="ch-legacy"><button type="button" class="ch-back" data-ch-back>${icon('chevron')} Kembali ke riwayat</button><div class="ch-section-intro"><h3>Kelola tautan nota</h3><p>Perbaiki nota yang keliru ditautkan ke pelanggan ini. Melepas tautan mempertahankan seluruh isi transaksi dan mencatat alasan perubahan.</p></div>${selected ? `<div class="ch-link-confirm"><h4>Lepaskan nota dari pelanggan?</h4><dl><div><dt>Nomor nota</dt><dd>${h(reference(selected))}</dd></div><div><dt>Pelanggan</dt><dd>${h(model.customer.name)}</dd></div></dl><form data-ch-unlink-form><label for="ch-unlink-reason">Alasan melepas tautan</label><textarea id="ch-unlink-reason" name="reason" rows="3" minlength="10" maxlength="1000" required placeholder="Jelaskan koreksi penautan, minimal 10 karakter.">${h(state.unlinkReason || '')}</textarea><div class="ch-link-actions"><button type="button" class="ch-button" data-ch-unlink-cancel>Batal</button><button type="submit" class="ch-button ch-button-danger">Lepaskan tautan</button></div></form></div>` : `<div class="ch-legacy-results">${links.map(link => `<article class="ch-legacy-row"><div><strong>${h(reference(link))}</strong><small>${link.record_type === 'order' ? 'Pesanan' : 'Invoice'} · ditautkan manual</small>${link.reason ? `<span>${h(link.reason)}</span>` : ''}</div><button type="button" class="ch-button" data-ch-unlink-select="${h(link.record_id)}" data-ch-unlink-type="${h(link.record_type)}">Lepaskan</button></article>`).join('') || '<p class="ch-muted">Tidak ada tautan nota manual yang dapat dilepas.</p>'}</div><p class="ch-footnote">Invoice yang mengikuti tautan pesanan dikelola melalui pesanan sumbernya. Pelanggan yang tercatat langsung pada transaksi asli tidak diubah dari halaman ini.</p>`}</section>`;
}
export const renderCustomerHistoryLinkManager = unlinkPanel;

/** Escaped customer view. Financial values are supplied exclusively by the model. */
export function renderCustomerHistory(snapshot, filters = {}, ui = {}, preparedModel) {
  const model = preparedModel || buildCustomerHistoryModel(snapshot, filters), customer = model.customer || snapshot.customer || {};
  const state = { tab: 'history', expanded: new Set(), noteDraft: '', timeZone: model.timeZone, ...ui };
  return `<div class="customer-history" data-customer-history>${profile(customer, snapshot)}${metrics(model)}${list(model.warnings).length ? `<details class="ch-data-notes"><summary>${icon('info')} Informasi riwayat ${icon('down')}</summary>${warnings(model.warnings)}</details>` : ''}<div class="ch-navigation"><div class="ch-tabs" role="tablist" aria-label="Detail pelanggan"><button type="button" role="tab" id="ch-history-tab" aria-selected="${state.tab === 'history'}" aria-controls="ch-history-panel" data-ch-tab="history">${icon('clock')} Riwayat layanan</button><button type="button" role="tab" id="ch-notes-tab" aria-selected="${state.tab === 'notes'}" aria-controls="ch-notes-panel" data-ch-tab="notes">${icon('document')} Catatan pelanggan</button></div><div class="ch-export-actions"><button type="button" class="ch-button" data-ch-export="excel" ${snapshot.complete === false ? 'disabled' : ''}>${icon('download')} Excel</button><button type="button" class="ch-button" data-ch-export="pdf" ${snapshot.complete === false ? 'disabled' : ''}>${icon('document')} PDF</button></div></div><div class="ch-message" data-ch-message role="status" hidden></div>${state.tab === 'notes' ? notesPanel(snapshot, state, ui.canWriteNotes === true) : historyPanel(model, filters, state)}<footer class="ch-footer"><span>${snapshot.loadedAt ? `Dimuat ${h(stamp(snapshot.loadedAt, model.timeZone))} ${h(zoneLabel(model.timeZone))}` : ''}</span><div>${ui.canLinkDocuments ? '<button type="button" class="ch-text-button" data-ch-link-open>Hubungkan nota lama</button>' : ''}${ui.canUnlinkDocuments && directLinks(snapshot).length ? '<button type="button" class="ch-text-button" data-ch-links-open>Kelola tautan nota</button>' : ''}<button type="button" class="ch-text-button" data-ch-reload>Muat ulang</button></div></footer></div>`;
}

/** Owns one customer dialog. Call its cleanup on page/logout/outlet changes. */
export function openCustomerHistory(api, selectedCustomer) {
  if (!selectedCustomer?.id || !api?.outlet?.id || typeof api.loadHistory !== 'function') throw new TypeError('Data pelanggan belum tersedia.');
  const customerId = selectedCustomer.id, outletId = api.outlet.id, userId = api.user?.id;
  const controller = new AbortController(), signal = controller.signal;
  let disposed = false, busy = false, flight = null, request = 0, snapshot = null, baseModel = null, model = null;
  const downloads = new Set();
  const filters = { query: '', status: 'all', dateFrom: '', dateUntil: '', page: 1, pageSize: 10 };
  const state = { tab: 'history', view: 'history', expanded: new Set(), editNote: null, noteDraft: '', confirmDelete: null, legacySearch: '', legacyResult: null, legacySearched: false, selectedLegacy: null, linkReason: '', selectedUnlink: null, unlinkReason: '', invoiceId: null };
  let noteAttempt = null, linkAttempt = null, unlinkAttempt = null;
  const panel = api.modal({ title: 'Riwayat pelanggan', description: 'Riwayat layanan, pembayaran, dan catatan pelanggan pada outlet ini.', content: `<div class="customer-history" data-customer-history>${profile(selectedCustomer)}${loading('Memuat riwayat pelanggan…')}</div>`, footer: '' });
  panel.classList.add('ch-modal');
  const body = panel.querySelector('.modal-body') || panel;
  const current = () => !disposed && !signal.aborted && !api.signal?.aborted && panel.isConnected && api.outlet.id === outletId && api.user?.id === userId && (typeof api.isCurrent !== 'function' || api.isCurrent());
  const guard = () => { if (!current()) throw new DOMException('Halaman pelanggan berubah.', 'AbortError'); };
  const safeMessage = (error, fallback) => error?.code === '42501' ? 'Anda tidak memiliki akses ke data pelanggan ini.' : ['40001', 'PT409'].includes(error?.code) ? 'Data sudah berubah. Muat ulang lalu periksa kembali sebelum menyimpan.' : error?.code === '23505' ? 'Nota ini sudah memiliki pelanggan. Muat ulang daftar nota.' : typeof api.safeError === 'function' ? api.safeError(error) : fallback;
  function message(value, failed = false) {
    if (!current()) return;
    let box = body.querySelector('[data-ch-message]');
    if (!box) { box = document.createElement('div'); box.dataset.chMessage = ''; body.querySelector('.customer-history')?.prepend(box); }
    box.className = `ch-message ${failed ? 'ch-message-error' : ''}`; box.setAttribute('role', failed ? 'alert' : 'status'); box.hidden = false; box.textContent = value;
  }
  function setBusy(value) {
    busy = value;
    if (!current()) return;
    panel.setAttribute('aria-busy', String(value));
    body.querySelectorAll('button,input,select,textarea').forEach(field => { if (value) { field.dataset.chWasDisabled = String(field.disabled); field.disabled = true; } else if (field.dataset.chWasDisabled !== undefined) { field.disabled = field.dataset.chWasDisabled === 'true'; delete field.dataset.chWasDisabled; } });
  }
  function paint() {
    guard(); if (!snapshot) return;
    model = filterCustomerHistoryModel(baseModel, filters);
    if (state.view === 'link') body.innerHTML = `<div class="customer-history" data-customer-history>${legacyPanel(model.customer || selectedCustomer, state)}<div data-ch-message class="ch-message" role="status" hidden></div></div>`;
    else if (state.view === 'links') body.innerHTML = `<div class="customer-history" data-customer-history>${unlinkPanel(snapshot, model, state)}<div data-ch-message class="ch-message" role="status" hidden></div></div>`;
    else if (state.view === 'invoice') {
      const invoice = list(model.visits || model.filteredVisits || model.rows).flatMap(row => list(row.invoices)).find(row => row.id === state.invoiceId);
      if (!invoice?.record) { state.view = 'history'; return paint(); }
      const report = { ...snapshot, ...(snapshot.report || {}), outletId, logs: list(snapshot.logs), sales: list(snapshot.sales) };
      // Reuse the existing invoice renderer with this model's authoritative
      // refund/VOID presentation, retaining the original invoice amounts.
      report.historicalCompatibility = { ...(report.historicalCompatibility || {}), saleStates: [{ id: invoice.id, statusLabel: invoice.statusLabel, refund: invoice.refund, net: invoice.net }] };
      const markup = (api.renderInvoice || digitalInvoice)(invoice.record, report, api.outlet);
      const manuallyLinked = list(snapshot.links).some(link => (link.record_id || link.recordId) === invoice.id);
      body.innerHTML = `<div class="customer-history ch-invoice-view" data-customer-history><div class="ch-invoice-toolbar"><button type="button" class="ch-back" data-ch-back>${icon('chevron')} Kembali ke riwayat</button><button type="button" class="ch-button ch-button-primary" data-ch-print-invoice>${icon('document')} Cetak / Simpan PDF</button></div>${manuallyLinked ? '<p class="ch-invoice-association">Nota ditautkan ke profil pelanggan ini. Identitas pada invoice asli tetap dipertahankan.</p>' : ''}${markup}<div data-ch-message class="ch-message" role="status" hidden></div></div>`;
    } else body.innerHTML = renderCustomerHistory(snapshot, filters, { ...state, canWriteNotes: typeof api.saveNote === 'function', canLinkDocuments: typeof api.linkDocument === 'function' && typeof api.loadUnassigned === 'function', canUnlinkDocuments: typeof api.unlinkDocument === 'function' }, model);
    if (busy) { busy = false; setBusy(true); }
  }
  async function reload({ preserveDraft = false } = {}) {
    if (!current() || busy) return;
    if (state.noteDraft.trim() && !preserveDraft) { message('Simpan atau batalkan isian catatan sebelum memuat ulang data.'); return; }
    const seq = ++request; flight?.abort(); flight = new AbortController(); const local = flight;
    const abort = () => local.abort(); signal.addEventListener('abort', abort, { once: true });
    if (!snapshot) body.innerHTML = `<div class="customer-history" data-customer-history>${profile(selectedCustomer)}${loading('Memuat seluruh riwayat pelanggan…')}</div>`;
    panel.setAttribute('aria-busy', 'true');
    try {
      const loaded = await api.loadHistory(customerId, { signal: local.signal });
      guard(); if (seq !== request || local.signal.aborted) return;
      if (loaded?.outletId !== outletId || loaded?.customer?.id !== customerId) throw new TypeError('Data pelanggan tidak sesuai outlet.');
      baseModel = buildCustomerHistoryModel(loaded); snapshot = loaded; paint(); return true;
    } catch (error) {
      if (!current() || seq !== request || local.signal.aborted || error?.name === 'AbortError') return;
      if (!snapshot) body.innerHTML = `<div class="customer-history" data-customer-history>${profile(selectedCustomer)}<div class="ch-empty"><h3>Riwayat belum dapat dimuat</h3><p>${h(safeMessage(error, 'Periksa koneksi internet lalu coba kembali.'))}</p><button type="button" class="ch-button ch-button-primary" data-ch-reload>Coba lagi</button></div></div>`;
      else message(safeMessage(error, 'Riwayat belum dapat diperbarui. Data sebelumnya tetap ditampilkan.'), true);
      return false;
    } finally { signal.removeEventListener('abort', abort); if (current() && seq === request) panel.setAttribute('aria-busy', 'false'); }
  }
  function paintResults() {
    if (!current() || !snapshot || state.view !== 'history' || state.tab !== 'history') return;
    const box = body.querySelector('[data-ch-filter-error]');
    if (filters.dateFrom && filters.dateUntil && filters.dateFrom > filters.dateUntil) { box.hidden = false; box.textContent = 'Tanggal awal harus sama atau sebelum tanggal akhir.'; return; }
    box.hidden = true; model = filterCustomerHistoryModel(baseModel, filters);
    body.querySelector('[data-ch-results]').innerHTML = historyResults(model, state.expanded);
    body.querySelector('[data-ch-date-caption]').textContent = dateCaption(filters);
    body.querySelector('[data-ch-date-description]').textContent = dateCaption(filters);
  }
  async function mutation(job, success, after) {
    if (!current() || busy) return;
    setBusy(true); let saved = false;
    try { guard(); await job(); saved = true; guard(); after?.(); setBusy(false); const refreshed = await reload({ preserveDraft: true }); guard(); message(refreshed ? success : 'Perubahan sudah tersimpan. Muat ulang untuk melihat data terbaru.', !refreshed); api.toast?.(success); }
    catch (error) { if (!current() || error?.name === 'AbortError') return; message(saved ? 'Perubahan sudah tersimpan. Muat ulang untuk melihat data terbaru.' : safeMessage(error, 'Perubahan belum dapat disimpan. Periksa koneksi lalu coba kembali.'), true); }
    finally { if (current()) setBusy(false); }
  }
  async function exportHistory(kind) {
    if (!current() || busy || !model || snapshot.complete === false) return;
    const fixedModel = filterCustomerHistoryModel(baseModel, filters), options = { model: fixedModel, outlet: api.outlet, generatedAt: new Date().toISOString(), timeZone: fixedModel.timeZone };
    if (kind === 'pdf') {
      try { guard(); if (api.exportPdf) return api.exportPdf(options); const markup = createCustomerHistoryPrintMarkup(options); guard(); document.querySelector('#vora-full-report-print')?.remove(); const host = document.createElement('section'); host.id = 'vora-full-report-print'; host.innerHTML = markup; document.body.append(host); window.print(); }
      catch (error) { document.querySelector('#vora-full-report-print')?.remove(); message(safeMessage(error, 'PDF belum dapat disiapkan. Periksa data dan coba kembali.'), true); }
      return;
    }
    setBusy(true);
    try {
      const bytes = await createCustomerHistoryWorkbook(options); guard();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); downloads.add(url);
      setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60000);
      const link = document.createElement('a'); link.href = url; link.download = `Riwayat-Pelanggan-${customerId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 60)}.xlsx`; link.hidden = true; panel.append(link); guard(); link.click(); link.remove(); message('File Excel memuat seluruh riwayat sesuai filter, termasuk halaman layar lainnya.');
    } catch (error) { if (current() && error?.name !== 'AbortError') message(safeMessage(error, 'Excel belum dapat disiapkan. Periksa data dan coba kembali.'), true); }
    finally { if (current()) setBusy(false); }
  }
  async function searchLegacy(more = false) {
    if (!current() || busy) return;
    const search = state.legacySearch.trim(); if (search.length < 3) return message('Ketik minimal 3 karakter nomor invoice atau pesanan.', true);
    setBusy(true);
    try { const result = await api.loadUnassigned({ search, cursor: more ? state.legacyResult?.nextCursor : null, signal }); guard(); state.legacyResult = result; state.legacySearched = true; paint(); }
    catch (error) { if (current() && error?.name !== 'AbortError') message(safeMessage(error, 'Daftar nota belum dapat dimuat. Coba kembali.'), true); }
    finally { if (current()) setBusy(false); }
  }
  function noteDraft(form) {
    const bodyValue = String(new FormData(form).get('body') || '').trim();
    if (!bodyValue || bodyValue.length > 4000) throw new TypeError('Tuliskan catatan, maksimal 4.000 karakter.');
    const editing = list(snapshot.notes).find(note => note.id === state.editNote);
    const key = JSON.stringify([editing?.id || null, bodyValue, editing?.revision || null]);
    if (!noteAttempt || noteAttempt.key !== key) noteAttempt = { key, draft: { ...(editing ? { id: editing.id, revision: editing.revision } : {}), body: bodyValue, operationId: operationId() } };
    return noteAttempt.draft;
  }
  panel.addEventListener('input', event => {
    if (!current() || busy) return;
    if (event.target.matches('[data-ch-filter="query"]')) { filters.query = event.target.value; filters.page = 1; paintResults(); }
    if (event.target.matches('#ch-note-body')) { state.noteDraft = event.target.value; body.querySelector('[data-ch-note-count]').textContent = String(event.target.value.length); }
    if (event.target.matches('[data-ch-legacy-form] input')) state.legacySearch = event.target.value;
    if (event.target.matches('#ch-link-reason')) state.linkReason = event.target.value;
    if (event.target.matches('#ch-unlink-reason')) state.unlinkReason = event.target.value;
  }, { signal });
  panel.addEventListener('change', event => { if (!current() || busy) return; const key = event.target.dataset?.chFilter; if (['status', 'dateFrom', 'dateUntil'].includes(key)) { filters[key] = event.target.value; filters.page = 1; paintResults(); } }, { signal });
  panel.addEventListener('toggle', event => { const el = event.target; if (!current() || !el.matches?.('[data-ch-visit]')) return; if (el.open) state.expanded.add(el.dataset.chVisit); else state.expanded.delete(el.dataset.chVisit); }, { signal, capture: true });
  panel.addEventListener('submit', event => {
    if (!current() || busy) return;
    const form = event.target;
    if (!form.matches('[data-ch-note-form],[data-ch-legacy-form],[data-ch-link-form],[data-ch-unlink-form]')) return;
    event.preventDefault(); if (!form.reportValidity()) return;
    if (form.matches('[data-ch-legacy-form]')) { void searchLegacy(); return; }
    if (form.matches('[data-ch-note-form]')) { let draft; try { draft = noteDraft(form); } catch (error) { return message(error.message, true); } void mutation(() => api.saveNote(customerId, draft, signal), 'Catatan pelanggan tersimpan.', () => { state.noteDraft = ''; state.editNote = null; noteAttempt = null; }); return; }
    if (form.matches('[data-ch-unlink-form]')) {
      const row = state.selectedUnlink, reason = String(new FormData(form).get('reason') || '').trim();
      if (!row || row.source_order_id || !directLinks(snapshot).some(link => link.record_type === row.record_type && link.record_id === row.record_id) || reason.length < 10) return message('Pilih tautan manual dan tuliskan alasan minimal 10 karakter.', true);
      const draft = { recordType: row.record_type, recordId: row.record_id, reason }, key = JSON.stringify(draft);
      if (!unlinkAttempt || unlinkAttempt.key !== key) unlinkAttempt = { key, draft: { ...draft, operationId: operationId() } };
      void mutation(() => api.unlinkDocument(customerId, unlinkAttempt.draft, signal), 'Tautan nota berhasil dilepas. Isi transaksi tetap dipertahankan.', () => { state.view = 'history'; state.selectedUnlink = null; state.unlinkReason = ''; unlinkAttempt = null; }); return;
    }
    const row = state.selectedLegacy, reason = String(new FormData(form).get('reason') || '').trim(); if (!row || reason.length < 10) return message('Tuliskan alasan pencocokan nota, minimal 10 karakter.', true);
    const draft = { recordType: row.recordType || row.record_type, recordId: row.recordId || row.record_id || row.id, reason };
    const key = JSON.stringify(draft); if (!linkAttempt || linkAttempt.key !== key) linkAttempt = { key, draft: { ...draft, operationId: operationId() } };
    void mutation(() => api.linkDocument(customerId, linkAttempt.draft, signal), 'Nota berhasil ditautkan ke pelanggan.', () => { state.view = 'history'; state.selectedLegacy = null; state.linkReason = ''; linkAttempt = null; });
  }, { signal });
  panel.addEventListener('click', event => {
    const el = event.target.closest?.('button'); if (!el || !panel.contains(el) || !current() || busy || el.disabled) return;
    if (el.hasAttribute('data-ch-reload')) { void reload(); return; }
    if (el.dataset.chTab) { if (state.noteDraft.trim() && el.dataset.chTab !== state.tab) return message('Simpan atau batalkan catatan yang sedang diisi terlebih dahulu.'); state.tab = el.dataset.chTab; state.confirmDelete = null; paint(); return; }
    if (el.dataset.chPage) { filters.page = Number(el.dataset.chPage); paintResults(); body.querySelector('.ch-visit summary')?.focus(); return; }
    if (el.hasAttribute('data-ch-reset')) { Object.assign(filters, { query: '', status: 'all', dateFrom: '', dateUntil: '', page: 1 }); paint(); return; }
    if (el.dataset.chExport) { void exportHistory(el.dataset.chExport); return; }
    if (el.dataset.chInvoice) { state.invoiceId = el.dataset.chInvoice; state.view = 'invoice'; paint(); body.scrollTop = 0; return; }
    if (el.hasAttribute('data-ch-print-invoice')) { if (api.print) api.print(); else window.print(); return; }
    if (el.hasAttribute('data-ch-back')) { state.view = 'history'; state.selectedLegacy = null; paint(); return; }
    if (el.hasAttribute('data-ch-link-open')) { if (state.noteDraft.trim()) return message('Simpan atau batalkan isian catatan terlebih dahulu.'); state.view = 'link'; state.legacySearched = false; state.legacyResult = null; paint(); return; }
    if (el.hasAttribute('data-ch-links-open')) { if (state.noteDraft.trim()) return message('Simpan atau batalkan isian catatan terlebih dahulu.'); state.view = 'links'; state.selectedUnlink = null; state.unlinkReason = ''; paint(); return; }
    if (el.dataset.chUnlinkSelect) { state.selectedUnlink = directLinks(snapshot).find(link => link.record_type === el.dataset.chUnlinkType && link.record_id === el.dataset.chUnlinkSelect) || null; state.unlinkReason = ''; paint(); return; }
    if (el.hasAttribute('data-ch-unlink-cancel')) { state.selectedUnlink = null; state.unlinkReason = ''; paint(); return; }
    if (el.hasAttribute('data-ch-legacy-more')) { void searchLegacy(true); return; }
    if (el.dataset.chLegacySelect) { const rows = state.legacyResult || {}; state.selectedLegacy = list(rows.rows || rows.documents || rows.records || rows.items).find(row => (row.recordId || row.record_id || row.id) === el.dataset.chLegacySelect); state.linkReason = ''; paint(); return; }
    if (el.hasAttribute('data-ch-legacy-cancel')) { state.selectedLegacy = null; state.linkReason = ''; paint(); return; }
    if (el.dataset.chNoteEdit) { if (state.noteDraft.trim() && state.editNote !== el.dataset.chNoteEdit) return message('Simpan atau batalkan isian catatan terlebih dahulu.'); const note = list(snapshot.notes).find(row => row.id === el.dataset.chNoteEdit); if (note) { state.editNote = note.id; state.noteDraft = note.body || ''; state.confirmDelete = null; paint(); body.querySelector('#ch-note-body')?.focus(); } return; }
    if (el.hasAttribute('data-ch-note-cancel')) { state.editNote = null; state.noteDraft = ''; noteAttempt = null; paint(); return; }
    if (el.dataset.chNoteDelete) { state.confirmDelete = el.dataset.chNoteDelete; paint(); return; }
    if (el.hasAttribute('data-ch-note-delete-cancel')) { state.confirmDelete = null; paint(); return; }
    if (el.dataset.chNoteDeleteConfirm) { const note = list(snapshot.notes).find(row => row.id === el.dataset.chNoteDeleteConfirm); if (!note) return; const key = `delete:${note.id}:${note.revision}`; if (!noteAttempt || noteAttempt.key !== key) noteAttempt = { key, draft: { id: note.id, body: note.body, revision: note.revision, operationId: operationId(), deleted: true } }; void mutation(() => api.saveNote(customerId, noteAttempt.draft, signal), 'Catatan pelanggan dihapus dari daftar aktif.', () => { state.confirmDelete = null; if (state.editNote === note.id) { state.editNote = null; state.noteDraft = ''; } noteAttempt = null; }); }
  }, { signal });
  const cleanupPrint = () => document.querySelector('#vora-full-report-print')?.remove();
  window.addEventListener('afterprint', cleanupPrint, { signal });
  function cleanup() { if (disposed) return; disposed = true; request++; controller.abort(); flight?.abort(); observer?.disconnect(); for (const url of downloads) URL.revokeObjectURL(url); downloads.clear(); cleanupPrint(); }
  const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { if (!panel.isConnected) cleanup(); }) : null;
  observer?.observe(panel.closest('.modal-layer')?.parentNode || panel.parentNode, { childList: true });
  api.signal?.addEventListener('abort', cleanup, { once: true });
  void reload();
  return cleanup;
}

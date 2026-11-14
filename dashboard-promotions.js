import { loadPromotions, savePromotion, changePromotionState, promotionTargets, isSupportedPromotion, validatePromotionActivation } from '/dashboard-promotions-data.js';
import { escapeHtml as h } from '/dashboard-data.js';
import { dateLabel } from '/dashboard-date-range.js';
const storedDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) ? dateLabel(value,{short:true}) : '—';

const money = value => 'Rp ' + Number(value || 0).toLocaleString('id-ID');
const labels = { cart: 'Seluruh pesanan', category: 'Kategori tertentu', product: 'Produk tertentu' };
const button = (label, action, attrs = '', primary = false) => `<button type="button" class="btn btn-${primary ? 'primary' : 'secondary'}" data-promo-action="${action}" ${attrs}>${label}</button>`;
const syncNote = '<aside class="promo-note"><strong>Perubahan mengikuti sinkronisasi POS</strong><p>Hubungkan perangkat kasir ke internet dan jalankan sinkronisasi untuk mengambil perubahan. Promo dipilih kasir pada transaksi. Transaksi yang sudah disimpan tetap memakai potongan yang tersimpan.</p><p>Minimal belanja memakai subtotal seluruh pesanan sebelum pajak dan layanan. Diskon hanya dihitung dari item dalam target; item pembayaran dikecualikan. Persentase dibulatkan ke Rupiah terdekat dan mengikuti batas potongan. Potongan nominal dibatasi nilai item target. Satu promo dipilih per transaksi.</p></aside>';
export function promotionsShell() {
  return '<section class="promotions" data-promotions><div class="ops-settings-title"><h2>Diskon & promo</h2><p>Kelola penawaran yang tersedia di kasir outlet ini.</p></div><p class="ops-saving" role="status"><span class="ops-loading-spinner"></span>Memuat promo dan katalog outlet…</p></section>';
}
function targetLabel(row, data) {
  if (row.scope === 'cart') return labels.cart;
  const targets = promotionTargets(row);
  return targets.map(target => row.scope === 'product' ? data.products.find(product => product.id === target)?.name || target : target).join(', ') || 'Target belum diisi';
}
export function promotionSelection(data, view = {}) {
  const search = String(view.search || '').trim().toLocaleLowerCase('id-ID'), status = view.status || 'current';
  return data.promos.filter(row => {
    if (status === 'archived' ? !row.deleted_at : row.deleted_at) return false;
    if (status === 'active' && !row.is_active || status === 'inactive' && row.is_active) return false;
    if (view.type && view.type !== 'all' && row.type !== view.type) return false;
    return !search || `${row.name} ${row.code || ''} ${targetLabel(row, data)}`.toLocaleLowerCase('id-ID').includes(search);
  }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'id'));
}
function activationProblem(row, data) {
  try { validatePromotionActivation(row, { id: data.outletId }, data); return ''; }
  catch (error) { return error.message; }
}
export function renderPromotionsContent(data, view = {}) {
  const current = data.promos.filter(row => !row.deleted_at), list = promotionSelection(data, view);
  const pages = Math.max(1, Math.ceil(list.length / 12)), page = Math.min(view.page || 0, pages - 1), visible = list.slice(page * 12, (page + 1) * 12);
  const writable = !view.readOnly;
  const options = (items, selected) => items.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
  const header = `<div class="promo-header"><div class="ops-settings-title"><h2>Diskon & promo</h2><p>Penawaran yang berlaku untuk outlet ini, sesuai aturan kasir VORA.</p></div><div class="promo-actions">${button('Perbarui','reload')}${writable ? button('+ Tambah promo','add','',true) : ''}</div></div>`;
  const summary = `<div class="promo-summary"><span><strong>${current.filter(row => row.is_active).length}</strong> promo aktif</span><span><strong>${current.filter(row => !row.is_active).length}</strong> nonaktif</span><span><strong>${data.promos.filter(row => row.deleted_at).length}</strong> diarsipkan</span></div>`;
  const filters = `<div class="promo-filters"><label class="field promo-search"><span>Cari promo</span><input class="input" type="search" data-promo-search value="${h(view.search || '')}" placeholder="Nama, kode, produk, atau kategori"></label><label class="field"><span>Status</span><select class="input" data-promo-filter="status">${options([['current','Semua tersedia'],['active','Aktif'],['inactive','Nonaktif'],['archived','Arsip']],view.status || 'current')}</select></label><label class="field"><span>Tipe diskon</span><select class="input" data-promo-filter="type">${options([['all','Semua tipe'],['percentage','Persentase (%)'],['fixed','Nominal (Rp)']],view.type || 'all')}</select></label></div>`;
  const cards = visible.map(row => {
    const supported = isSupportedPromotion(row), archived = !!row.deleted_at, attrs = `data-id="${h(row.id)}"`;
    const amount = row.type === 'percentage' ? `${h(row.value)}%` : row.type === 'fixed' ? money(row.value) : h(row.type);
    const invalid = !archived && supported ? activationProblem(row, data) : '';
    const dates = row.start_date || row.end_date ? `<p class="promo-date">Tanggal tersimpan: ${h(storedDate(row.start_date))} s.d. ${h(storedDate(row.end_date))}. POS saat ini belum membatasi promo berdasarkan tanggal; gunakan status aktif/nonaktif.</p>` : '';
    return `<article class="promo-card"><div class="promo-card-head"><div><h3>${h(row.name)}</h3>${row.code ? `<span class="promo-code">${h(row.code)}</span>` : '<small>Tanpa kode</small>'}</div><span class="promo-badge ${archived || !row.is_active ? 'inactive' : ''}">${archived ? 'Arsip' : row.is_active ? 'Aktif' : 'Nonaktif'}</span></div><p class="promo-value">${amount}<small>${row.type === 'percentage' && Number(row.max_discount) > 0 ? `Maks. ${money(row.max_discount)}` : row.type === 'percentage' ? 'Tanpa batas potongan' : 'Potongan nominal'}</small></p><dl><div><dt>Target</dt><dd>${h(labels[row.scope] || row.scope)}${row.scope !== 'cart' ? `<small>${h(targetLabel(row, data))}</small>` : ''}</dd></div><div><dt>Min. belanja</dt><dd>${Number(row.min_spend) > 0 ? money(row.min_spend) : 'Tanpa minimum'}</dd></div></dl>${dates}${invalid ? `<p class="promo-warning">${h(invalid)}</p>` : ''}${!supported ? '<p class="promo-warning">Format promo lama belum didukung editor. Aturan disimpan utuh; promo dapat dinonaktifkan atau diarsipkan.</p>' : ''}${writable ? `<div class="promo-card-actions">${archived ? button('Pulihkan sebagai nonaktif','restore',attrs) : `${supported ? button('Ubah','edit',`${attrs} aria-label="Ubah ${h(row.name)}"`) : ''}${button(row.is_active ? 'Nonaktifkan' : 'Aktifkan',row.is_active ? 'deactivate' : 'activate',`${attrs}${(!supported || invalid) && !row.is_active ? ' disabled' : ''}`)}${button('Arsipkan','archive',attrs)}`}</div>` : ''}</article>`;
  }).join('');
  const empty = `<div class="promo-empty"><strong>${data.promos.length ? 'Tidak ada promo yang sesuai' : 'Buat penawaran pertama Anda'}</strong><p>${view.status === 'archived' ? 'Promo yang diarsipkan akan muncul di sini dan dapat dipulihkan.' : data.promos.length ? 'Ubah pencarian atau filter status untuk melihat promo lainnya.' : 'Tambahkan diskon persentase atau potongan nominal untuk seluruh pesanan, kategori, atau produk.'}</p>${writable && !data.promos.length ? button('+ Tambah promo','add','',true) : ''}</div>`;
  return `${header}${summary}${view.readOnly ? '<p class="promo-note" role="status">Akses hanya lihat. Pengaturan promo dapat diubah oleh pemilik outlet yang berwenang.</p>' : ''}${filters}<p class="promo-result" role="status">${list.length} promo${view.search ? ' sesuai pencarian' : ''}</p><div class="promo-grid">${cards || empty}</div><div class="promo-pagination"><span>Halaman ${page + 1} / ${pages}</span><div>${button('Sebelumnya','previous',page === 0 ? 'disabled' : '')}${button('Berikutnya','next',page >= pages - 1 ? 'disabled' : '')}</div></div>${syncNote}`;
}
export function lockPromotionsDialog(panel, hostWindow = window) {
  const layer = panel.parentElement;
  const block = event => { if (panel.isConnected && (event.key === 'Escape' || event.target === layer || event.target.closest?.('[data-close-modal]'))) { event.preventDefault(); event.stopImmediatePropagation(); } };
  layer.addEventListener('click', block, true); hostWindow.addEventListener('keydown', block, true);
  return () => { layer.removeEventListener('click', block, true); hostWindow.removeEventListener('keydown', block, true); };
}
export function promotionEditorFields(row = {}) {
  row ||= {};
  return `<div class="promo-form-grid"><label class="field"><span>Nama promo *</span><input class="input" name="name" maxlength="200" value="${h(row.name || '')}" placeholder="Contoh: Hemat akhir pekan" required></label><label class="field"><span>Kode (opsional)</span><input class="input" name="code" maxlength="100" value="${h(row.code || '')}" placeholder="Contoh: HEMAT10"><small>Label promo untuk kasir; promo tetap dipilih pada transaksi.</small></label><label class="field"><span>Tipe diskon</span><select class="input" name="type"><option value="percentage" ${row.type !== 'fixed' ? 'selected' : ''}>Persentase (%)</option><option value="fixed" ${row.type === 'fixed' ? 'selected' : ''}>Nominal (Rp)</option></select></label><label class="field"><span>Nilai diskon *</span><input class="input" name="value" inputmode="decimal" value="${h(row.value ?? '')}" placeholder="Contoh: 10" required><small data-promo-value-note>Persentase 0–100; gunakan titik untuk desimal.</small></label><label class="field"><span>Minimal belanja (Rp)</span><input class="input" name="min_spend" inputmode="decimal" value="${h(row.min_spend ?? 0)}" required><small>0 = tanpa minimum; dihitung dari seluruh pesanan.</small></label><label class="field" data-promo-cap><span>Batas potongan (Rp)</span><input class="input" name="max_discount" inputmode="decimal" value="${h(row.max_discount ?? 0)}" required><small>0 = tanpa batas. Berlaku untuk persentase.</small></label></div><label class="field"><span>Berlaku untuk</span><select class="input" name="scope">${Object.entries(labels).map(([value,label]) => `<option value="${value}" ${value === (row.scope || 'cart') ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div data-promo-targets></div><label class="promo-check"><input type="checkbox" name="is_active" ${row.is_active !== false ? 'checked' : ''}><span><strong>Promo aktif</strong><small>Tersedia untuk dipilih kasir setelah sinkronisasi POS.</small></span></label>${row.start_date || row.end_date ? `<p class="promo-warning">Tanggal tersimpan tetap dipertahankan (${h(storedDate(row.start_date))} s.d. ${h(storedDate(row.end_date))}). POS saat ini belum menerapkan batas tanggal. Gunakan status untuk mengaktifkan atau menonaktifkan promo.</p>` : ''}`;
}
export function mountPromotions(host, api) {
  const controller = new AbortController(), signal = controller.signal;
  let data = null, busy = false, request = 0, modalController;
  const view = { search: '', status: 'current', type: 'all', page: 0, readOnly: api.readOnly === true || api.canWrite === false };
  const current = () => !signal.aborted && !api.signal?.aborted && api.isCurrent() && host.isConnected;
  const stop = () => { request++; modalController?.abort(); controller.abort(); data = null; };
  api.signal?.addEventListener('abort', stop, { once: true, signal });
  const errorText = error => ['42501','PGRST301','PGRST302'].includes(error?.code) ? 'Akses promo ditolak. Pastikan sesi pemilik dan outlet yang dipilih masih berlaku, lalu masuk kembali.' : ['42P01','42703','PGRST204'].includes(error?.code) ? 'Menu promo belum tersedia lengkap pada server. Hubungi admin VORA untuk pembaruan.' : error?.message || 'Data belum dapat dimuat. Periksa koneksi dan coba lagi.';
  const draw = () => { if (current() && data) host.innerHTML = renderPromotionsContent(data, view); };
  async function load() {
    const attempt = ++request;
    try { const loaded = await loadPromotions(api.client, api.user, api.outlet, signal); if (!current() || attempt !== request) return; data = loaded; draw(); }
    catch (error) { if (!current() || attempt !== request) return; data = null; host.innerHTML = `<div class="ops-settings-title"><h2>Diskon & promo</h2></div><p class="promo-warning" role="alert">${h(errorText(error))}</p>${button('Coba lagi','reload')}`; }
  }
  function editor(title, description, fields, save, submitLabel = 'Simpan', setup) {
    if (!current() || busy || view.readOnly) return;
    modalController?.abort(); modalController = new AbortController();
    const panel = api.modal({ title, description, content: `<form id="promotion-form" class="promo-form">${fields}<p class="promo-error" role="alert" hidden></p><p class="promo-save-status" role="status" aria-live="polite"></p></form>`, footer: `<button class="btn btn-secondary" type="button" data-close-modal>Batal</button><button class="btn btn-primary" type="submit" form="promotion-form">${submitLabel}</button>` });
    const form = panel.querySelector('form'); setup?.(form, modalController.signal);
    form.addEventListener('focusin', event => {
      const field=event.target;
      if(['value','min_spend','max_discount'].includes(field.name)&&field.value==='0'){
        field.dataset.promoZeroFocus='1';field.value='';
      }
    },{signal:modalController.signal});
    form.addEventListener('focusout', event => {
      const field=event.target;
      if(field.dataset?.promoZeroFocus==='1'){
        if(field.value.trim()==='')field.value='0';
        delete field.dataset.promoZeroFocus;
      }
    },{signal:modalController.signal});
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!current() || busy || !form.reportValidity()) return;
      const values = new FormData(form), error = form.querySelector('.promo-error'), status = form.querySelector('.promo-save-status');
      busy = true; error.hidden = true; status.textContent = 'Menyimpan promo…'; panel.setAttribute('aria-busy', 'true');
      const unlock = lockPromotionsDialog(panel), controls = [...panel.querySelectorAll('input,select,button,textarea')], disabled = controls.map(el => el.disabled);
      controls.forEach(el => { el.disabled = true; });
      try { await save(values); if (!current()) return; api.closeModal(); api.toast(submitLabel === 'Pulihkan' ? 'Promo dipulihkan sebagai nonaktif. Aktifkan saat siap lalu sinkronkan POS.' : 'Promo tersimpan. Sinkronkan POS untuk menerima perubahan.'); await load(); }
      catch (cause) { if (current() && panel.isConnected) { error.textContent = errorText(cause); error.hidden = false; status.textContent = ''; } }
      finally { busy = false; panel.removeAttribute('aria-busy'); controls.forEach((el, index) => { el.disabled = disabled[index]; }); unlock(); }
    }, { signal: modalController.signal });
  }
  function edit(existing) {
    const promoId = existing?.id || `PRM-${crypto.randomUUID()}`;
    editor(existing ? 'Ubah promo' : 'Tambah promo', 'Aturan yang sama digunakan kasir pada outlet ini. Masukkan angka tanpa pemisah ribuan.', promotionEditorFields(existing), values => savePromotion(api.client, api.user, api.outlet, { ...Object.fromEntries(values), id: promoId, targets: values.getAll('targets'), is_active: values.has('is_active') }, existing, data, signal), 'Simpan', (form, modalSignal) => {
      let previousScope = existing?.scope || 'cart';
      const chosen = new Map([[previousScope, new Set(promotionTargets(existing))]]), area = form.querySelector('[data-promo-targets]');
      const remember = () => chosen.set(previousScope, new Set([...area.querySelectorAll('input[name="targets"]:checked')].map(input => input.value)));
      const renderTargets = () => {
        const scope = form.elements.scope.value, selected = chosen.get(scope) || new Set(); previousScope = scope;
        if (scope === 'cart') { area.innerHTML = '<p class="promo-help">Potongan dihitung dari subtotal pesanan, tanpa item pembayaran.</p>'; return; }
        const choices = scope === 'product' ? data.products.map(row => [row.id, row.name, row.sku || '']) : data.categories.map(row => [row.name, row.name, '']);
        const known = new Set(choices.map(([value]) => value));
        for (const target of selected) if (!known.has(target)) choices.push([target, target, 'Target lama, tidak ada di katalog aktif']);
        choices.sort((a,b) => a[1].localeCompare(b[1], 'id'));
        area.innerHTML = `<fieldset class="promo-target-field"><legend>Pilih ${scope === 'product' ? 'produk' : 'kategori'} target *</legend><input class="input" type="search" data-promo-target-search aria-label="Cari target promo" placeholder="Cari ${scope === 'product' ? 'produk atau SKU' : 'kategori'}"><div class="promo-target-list">${choices.map(([value,label,detail]) => `<label class="promo-target-option" data-target-label="${h(`${label} ${detail}`.toLowerCase())}"><input type="checkbox" name="targets" value="${h(value)}" ${selected.has(value) ? 'checked' : ''} ${value.includes(',') ? 'disabled' : ''}><span>${h(label)}${detail ? `<small>${h(detail)}</small>` : ''}${value.includes(',') ? '<small>Nama memuat koma; format target POS belum mendukungnya.</small>' : ''}</span></label>`).join('') || '<p class="promo-help">Belum ada target di katalog outlet ini.</p>'}</div><p class="promo-help">Bisa memilih lebih dari satu. Hanya item target yang mendapat potongan.</p></fieldset>`;
      };
      const typeChanged = () => { const percent = form.elements.type.value === 'percentage'; form.querySelector('[data-promo-cap]').hidden = !percent; form.elements.max_discount.disabled = !percent; form.querySelector('[data-promo-value-note]').textContent = percent ? 'Persentase 0–100; gunakan titik untuk desimal.' : 'Nominal Rupiah; dibatasi nilai item target saat transaksi.'; };
      form.addEventListener('change', event => { if (event.target.name === 'scope') { remember(); renderTargets(); } if (event.target.name === 'type') typeChanged(); }, { signal: modalSignal });
      form.addEventListener('input', event => { if (event.target.matches('[data-promo-target-search]')) for (const label of area.querySelectorAll('[data-target-label]')) label.hidden = !label.dataset.targetLabel.includes(event.target.value.trim().toLowerCase()); }, { signal: modalSignal });
      typeChanged(); renderTargets();
    });
  }
  host.addEventListener('click', event => {
    const trigger = event.target.closest('[data-promo-action]'); if (!trigger || trigger.disabled || !current() || busy) return;
    const action = trigger.dataset.promoAction;
    if (action === 'reload') { if(api.requestRefresh){api.requestRefresh();return;} host.innerHTML = promotionsShell(); void load(); return; }
    if (!data) return;
    if (action === 'previous' || action === 'next') { view.page = Math.max(0, view.page + (action === 'next' ? 1 : -1)); draw(); return; }
    if (view.readOnly) return;
    if (action === 'add') { edit(null); return; }
    const existing = data.promos.find(row => row.id === trigger.dataset.id); if (!existing) return;
    if (action === 'edit' && !existing.deleted_at && isSupportedPromotion(existing)) { edit(existing); return; }
    if (!['activate','deactivate','archive','restore'].includes(action)) return;
    if (action === 'activate' && (!isSupportedPromotion(existing) || activationProblem(existing, data))) return;
    const titles = { activate: 'Aktifkan promo', deactivate: 'Nonaktifkan promo', archive: 'Arsipkan promo', restore: 'Pulihkan promo' };
    const descriptions = { activate: 'Promo akan tersedia untuk dipilih kasir setelah sinkronisasi.', deactivate: 'Promo tidak lagi tersedia untuk transaksi baru setelah sinkronisasi.', archive: 'Promo dipindahkan ke Arsip. Riwayat transaksi dan aturan promo tetap tersimpan.', restore: 'Promo kembali ke daftar dalam status nonaktif. Periksa aturannya sebelum mengaktifkan.' };
    editor(titles[action], descriptions[action], `<p class="promo-confirm"><strong>${h(existing.name)}</strong></p>`, () => changePromotionState(api.client, api.user, api.outlet, existing, action, signal), action === 'restore' ? 'Pulihkan' : titles[action].split(' ')[0]);
  }, { signal });
  host.addEventListener('input', event => {
    if (!current() || busy || !event.target.matches('[data-promo-search]')) return;
    const caret = event.target.selectionStart; view.search = event.target.value; view.page = 0; draw();
    const input = host.querySelector('[data-promo-search]'); input?.focus(); if (input && caret != null) { try { input.setSelectionRange(caret, caret); } catch {} }
  }, { signal });
  host.addEventListener('change', event => { if (!current() || busy || !event.target.matches('[data-promo-filter]')) return; view[event.target.dataset.promoFilter] = event.target.value; view.page = 0; draw(); }, { signal });
  void load(); return stop;
}

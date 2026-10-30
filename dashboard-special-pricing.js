import { loadSpecialPricing, savePriceGroup, saveProductGroupPrice, saveCustomerPriceGroup } from '/dashboard-special-pricing-data.js';
import { escapeHtml as h } from '/dashboard-data.js';

const money = value => 'Rp ' + Number(value || 0).toLocaleString('id-ID');
const button = (label, action, extra = '', primary = false) => `<button type="button" class="btn btn-${primary ? 'primary' : 'secondary'}" data-price-action="${action}" ${extra}>${label}</button>`;
// Keep the in-flight mutation visible. This module is deployable independently
// from other dashboard editors; navigation/auth teardown can still close it.
export function lockPricingDialog(panel, hostWindow = window) {
  const layer = panel.parentElement;
  const buttons = [...panel.querySelectorAll('[data-close-modal]')], previous = buttons.map(button => button.disabled);
  buttons.forEach(button => { button.disabled = true; });
  const block = event => {
    if (!panel.isConnected) return;
    if (event.key === 'Escape' || event.target === layer || event.target.closest?.('[data-close-modal]')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  layer.addEventListener('click', block, true); hostWindow.addEventListener('keydown', block, true);
  let released = false;
  return () => {
    if (released) return; released = true;
    layer.removeEventListener('click', block, true); hostWindow.removeEventListener('keydown', block, true);
    buttons.forEach((button, index) => { button.disabled = previous[index]; });
  };
}
export function bindPriceAmount(input, signal) {
  if (!input) return;
  const selectZero = () => { if (input.value === '0') input.select(); };
  input.addEventListener('focus', selectZero, { signal });
  input.addEventListener('click', selectZero, { signal });
  input.addEventListener('input', () => { if (/^0\d+$/.test(input.value)) input.value = input.value.replace(/^0+(?=\d)/, ''); }, { signal });
  if (input.matches(':focus')) selectZero();
}
export function specialPricingShell() {
  return '<div data-special-pricing><div class="ops-settings-title"><h2>Harga spesial</h2><p>Harga yang sesuai untuk setiap kelompok pelanggan.</p></div><p class="ops-saving" role="status"><span class="ops-loading-spinner"></span>Memuat grup harga dan pelanggan…</p></div>';
}
export function renderPricingContent(data, products, view = {}) {
  const section = view.section || 'groups', search = String(view.search || '').toLowerCase();
  const groups = [...data.groups].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const group = groups.find(row => row.id === view.groupId) || groups.find(row => row.is_active) || groups[0];
  const map = new Map(groups.map(row => [row.id, row]));
  const tabs = [['groups','Grup harga'],['products','Harga produk'],['customers','Pelanggan']];
  const head = `<div class="ops-settings-title"><h2>Harga spesial</h2><p>Kelola harga per kelompok pelanggan pada outlet ini. Harga di POS mengikuti pelanggan yang dipilih.</p></div><div class="price-summary"><span><strong>${groups.filter(row => row.is_active).length}</strong> grup aktif</span><span><strong>${data.prices.length}</strong> harga khusus</span><span><strong>${data.memberships.length}</strong> pelanggan bergabung</span></div><div class="price-tabs" role="tablist" aria-label="Pengaturan harga spesial">${tabs.map(([key,label]) => `<button type="button" role="tab" aria-selected="${section === key}" class="${section === key ? 'active' : ''}" data-price-action="section" data-section="${key}">${label}</button>`).join('')}</div>`;
  const note = '<div class="price-note"><strong>Cara kerja di kasir</strong><p>Satu pelanggan masuk satu grup harga. Produk tanpa harga khusus memakai harga normal. Diskon dan promo tetap dihitung dari harga yang berlaku. Ekstra produk tetap memakai harga ekstra. Transaksi yang sudah disimpan tidak diubah.</p><p><strong>Gunakan POS versi 1.0.18 atau lebih baru.</strong> Hubungkan perangkat ke internet untuk mengambil perubahan, lalu pilih pelanggan pada transaksi baru. Pembaruan dapat memerlukan beberapa menit. POS versi lama belum menerapkan grup harga.</p></div>';
  if (section === 'groups') return `${head}<div class="price-toolbar"><p>Buat nama grup sendiri, misalnya Member, Karyawan, Corporate, atau Grup 1.</p>${button('Tambah grup','add-group','',true)}</div><div class="price-group-list"><article class="price-group-card price-normal"><div><h3>Harga normal</h3><p>Harga jual yang tersimpan pada produk. Berlaku untuk pelanggan tanpa grup.</p></div><span class="price-badge">Harga dasar</span></article>${groups.map(item => `<article class="price-group-card"><div><h3>${h(item.name)}</h3><p>${data.prices.filter(row => row.price_group_id === item.id).length} harga produk · ${data.memberships.filter(row => row.price_group_id === item.id).length} pelanggan</p></div><span class="price-badge ${item.is_active ? '' : 'inactive'}">${item.is_active ? 'Aktif' : 'Nonaktif'}</span>${button('Ubah','edit-group',`data-id="${h(item.id)}" aria-label="Ubah grup ${h(item.name)}"`)}</article>`).join('')}</div>${groups.length ? '' : '<div class="price-empty"><strong>Mulai dengan grup pertama</strong><p>Setelah membuat grup, isi harga produk lalu masukkan pelanggan ke grup tersebut.</p></div>'}${note}`;
  if (section === 'products' && !group) return `${head}<div class="price-empty"><strong>Belum ada grup harga</strong><p>Buat grup terlebih dahulu untuk mengatur harga khusus produk.</p>${button('Tambah grup','add-group','',true)}</div>${note}`;
  const list = section === 'products' ? products.filter(row => `${row.name} ${row.sku || ''} ${row.category || ''}`.toLowerCase().includes(search)) : data.customers.filter(row => `${row.name} ${row.phone || ''}`.toLowerCase().includes(search));
  const pages = Math.max(1, Math.ceil(list.length / 25)), page = Math.min(view.page || 0, pages - 1), visible = list.slice(page * 25, (page + 1) * 25);
  const controls = `<div class="price-filters">${section === 'products' ? `<label class="field"><span>Grup harga</span><select class="input" data-price-group>${groups.map(item => `<option value="${h(item.id)}" ${item.id === group.id ? 'selected' : ''}>${h(item.name)}${item.is_active ? '' : ' (nonaktif)'}</option>`).join('')}</select></label>` : ''}<label class="field price-search"><span>Cari ${section === 'products' ? 'produk' : 'pelanggan'}</span><input class="input" type="search" data-price-search placeholder="${section === 'products' ? 'Nama produk, SKU, atau kategori' : 'Nama atau nomor telepon'}" value="${h(view.search || '')}"></label></div>`;
  const rows = visible.map(item => {
    if (section === 'products') {
      const entry = data.prices.find(row => row.product_id === item.id && row.price_group_id === group.id);
      return `<tr><td><strong>${h(item.name)}</strong><small>${h(item.sku || item.category || 'Tanpa SKU')}</small></td><td>${money(item.price)}</td><td><strong>${money(entry ? entry.price : item.price)}</strong><small>${entry ? 'Harga khusus' : 'Mengikuti harga normal'}</small></td><td>${button('Atur harga','edit-price',`data-id="${h(item.id)}" data-group="${h(group.id)}" aria-label="Atur harga ${h(item.name)}"`)}</td></tr>`;
    }
    const membership = data.memberships.find(row => row.customer_id === item.id), assigned = map.get(membership?.price_group_id);
    return `<tr><td><strong>${h(item.name || 'Pelanggan')}</strong><small>${h(item.phone || 'Tanpa nomor telepon')}</small></td><td><span class="price-badge ${assigned && !assigned.is_active ? 'inactive' : ''}">${h(assigned?.name || 'Harga normal')}</span>${assigned && !assigned.is_active ? '<small>Grup nonaktif · memakai harga normal</small>' : ''}</td><td>${button('Atur grup','assign-customer',`data-id="${h(item.id)}" aria-label="Atur grup ${h(item.name || 'pelanggan')}"`)}</td></tr>`;
  }).join('');
  return `${head}${controls}${section === 'products' && !group.is_active ? '<p class="price-warning">Grup ini nonaktif. Harga dapat disiapkan, tetapi POS tetap memakai harga normal sampai grup diaktifkan.</p>' : ''}<div class="price-table-wrap"><table class="price-table price-table-${section}"><thead><tr>${(section === 'products' ? ['Produk','Harga normal',`Harga ${h(group.name)}`,'Tindakan'] : ['Pelanggan','Grup harga','Tindakan']).map(label => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${section === 'products' ? 4 : 3}"><div class="price-empty">${search ? 'Tidak ada hasil yang sesuai.' : section === 'products' ? 'Belum ada produk di outlet ini.' : 'Belum ada pelanggan. Daftarkan pelanggan melalui kasir, lalu atur grupnya di sini.'}</div></td></tr>`}</tbody></table></div><div class="price-pagination"><span>${list.length} ${section === 'products' ? 'produk' : 'pelanggan'} · Halaman ${page + 1} / ${pages}</span><div>${button('Sebelumnya','previous',page === 0 ? 'disabled' : '')}${button('Berikutnya','next',page >= pages - 1 ? 'disabled' : '')}</div></div>${note}`;
}

export function mountSpecialPricing(host, api) {
  const controller = new AbortController(); let data = null, busy = false, request = 0;
  const view = { section: 'groups', search: '', groupId: '', page: 0 };
  const current = () => !controller.signal.aborted && !api.signal?.aborted && api.isCurrent() && host.isConnected;
  const errorText = error => ['PGRST202','42P01'].includes(error?.code) ? 'Harga spesial belum tersedia pada server. Pengaturan lain tetap dapat digunakan. Hubungi admin VORA untuk pembaruan.' : error?.message || 'Data belum dapat dimuat. Periksa koneksi dan coba lagi.';
  const draw = () => { if (current() && data) host.innerHTML = renderPricingContent(data, api.data.products, view); };
  async function load() {
    const attempt = ++request;
    try {
      const result = await loadSpecialPricing(api.client, api.user, api.outlet, api.signal);
      if (!current() || attempt !== request) return;
      data = result; draw();
    } catch (error) {
      if (!current() || attempt !== request) return;
      host.innerHTML = `<div class="ops-settings-title"><h2>Harga spesial</h2></div><p class="price-warning" role="alert">${h(errorText(error))}</p>${button('Coba lagi','reload')}`;
    }
  }
  function editor(title, description, fields, save) {
    if (!current() || busy) return;
    const panel = api.modal({ title, description, content: `<form id="special-price-form" class="price-form">${fields}<p class="price-error" role="alert" hidden></p><p class="price-save-status" role="status" aria-live="polite"></p></form>`, footer: '<button class="btn btn-secondary" type="button" data-close-modal>Batal</button><button class="btn btn-primary" type="submit" form="special-price-form">Simpan</button>' });
    const form = panel.querySelector('form');
    bindPriceAmount(form.querySelector('input[name="price"]'), controller.signal);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!current() || busy || !form.reportValidity()) return;
      const fields = Object.fromEntries(new FormData(form)), error = form.querySelector('.price-error'), status = form.querySelector('.price-save-status');
      busy = true; error.hidden = true; status.textContent = 'Menyimpan pengaturan harga…';
      const unlock = lockPricingDialog(panel), controls = [...panel.querySelectorAll('input,select,button')], previous = controls.map(el => el.disabled);
      controls.forEach(el => el.disabled = true);
      try {
        await save(fields); if (!current()) return;
        api.closeModal(); api.toast('Pengaturan harga tersimpan. Sinkronkan POS untuk menerima perubahan.'); await load();
      } catch (cause) { if (current() && panel.isConnected) { error.hidden = false; error.textContent = errorText(cause); status.textContent = ''; } }
      finally { busy = false; controls.forEach((el, i) => el.disabled = previous[i]); unlock(); }
    }, { signal: controller.signal });
  }
  host.addEventListener('click', event => {
    const trigger = event.target.closest('[data-price-action]'); if (!trigger || !current() || busy) return;
    const action = trigger.dataset.priceAction, id = trigger.dataset.id;
    if (action === 'reload') { host.innerHTML = specialPricingShell(); void load(); return; }
    if (!data) return;
    if (action === 'section') { view.section = trigger.dataset.section; view.search = ''; view.page = 0; draw(); return; }
    if (action === 'previous' || action === 'next') { view.page = Math.max(0, view.page + (action === 'next' ? 1 : -1)); draw(); return; }
    if (action === 'add-group' || action === 'edit-group') {
      const existing = data.groups.find(row => row.id === id), groupId = existing?.id || crypto.randomUUID();
      editor(existing ? 'Ubah grup harga' : 'Tambah grup harga', 'Nama grup dapat disesuaikan dengan jenis pelanggan usaha Anda.', `<label class="field"><span>Nama grup</span><input class="input" name="name" maxlength="60" value="${h(existing?.name || '')}" placeholder="Contoh: Member" required></label><label class="price-check"><input type="checkbox" name="is_active" ${existing?.is_active !== false ? 'checked' : ''}><span><strong>Grup aktif</strong><small>Jika dinonaktifkan, pelanggan grup ini memakai harga normal. Harga dan keanggotaannya tetap disimpan.</small></span></label>`, fields => savePriceGroup(api.client, api.user, api.outlet, { id: groupId, name: fields.name, is_active: fields.is_active === 'on' }, existing, api.signal));
    }
    if (action === 'edit-price') {
      const product = api.data.products.find(row => row.id === id), group = data.groups.find(row => row.id === trigger.dataset.group);
      if (!product || !group) return;
      const existing = data.prices.find(row => row.product_id === product.id && row.price_group_id === group.id);
      editor(`Harga ${group.name}`, product.name, `<div class="price-normal-summary"><span>Harga normal</span><strong>${money(product.price)}</strong></div><label class="field"><span>Harga khusus (Rp)</span><input class="input" name="price" inputmode="numeric" pattern="[0-9]*" maxlength="12" value="${h(existing?.price ?? '')}" placeholder="Kosong = harga normal"><small>Masukkan angka tanpa titik atau koma. Kosongkan untuk mengikuti harga normal. Harga 0 berarti produk gratis untuk grup ini.</small></label>`, fields => saveProductGroupPrice(api.client, api.user, api.outlet, product, group, fields.price, existing, api.signal));
    }
    if (action === 'assign-customer') {
      const customer = data.customers.find(row => row.id === id); if (!customer) return;
      const existing = data.memberships.find(row => row.customer_id === id), assigned = data.groups.find(row => row.id === existing?.price_group_id);
      editor('Atur grup pelanggan', `${customer.name || 'Pelanggan'}${customer.phone ? ` · ${customer.phone}` : ''}`, `<label class="field"><span>Grup harga</span><select class="input" name="group"><option value="">Harga normal (tanpa grup)</option>${data.groups.filter(row => row.is_active || row.id === assigned?.id).map(row => `<option value="${h(row.id)}" ${row.id === assigned?.id ? 'selected' : ''}>${h(row.name)}${row.is_active ? '' : ' (nonaktif)'}</option>`).join('')}</select><small>Satu pelanggan hanya dapat masuk satu grup. Pilih Harga normal untuk mengeluarkan pelanggan dari grup.</small></label>`, fields => {
        if ((fields.group || '') === (existing?.price_group_id || '')) return Promise.resolve();
        return saveCustomerPriceGroup(api.client, api.user, api.outlet, customer, data.groups.find(row => row.id === fields.group) || null, existing, api.signal);
      });
    }
  }, { signal: controller.signal });
  host.addEventListener('input', event => {
    if (!current() || busy || !event.target.matches('[data-price-search]')) return;
    const caret = event.target.selectionStart; view.search = event.target.value; view.page = 0; draw();
    const input = host.querySelector('[data-price-search]'); input?.focus(); if (input && caret !== null) { try { input.setSelectionRange(caret, caret); } catch {} }
  }, { signal: controller.signal });
  host.addEventListener('change', event => { if (current() && !busy && event.target.matches('[data-price-group]')) { view.groupId = event.target.value; view.page = 0; draw(); } }, { signal: controller.signal });
  void load();
  return () => { request++; controller.abort(); data = null; };
}

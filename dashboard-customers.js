import { icon, escape as h } from '/dashboard-icons.js';
import { openCustomerHistory } from '/dashboard-customer-history.js';
import { loadCustomerDirectory, loadCustomerHistory, saveCustomerNote, loadUnassignedDocuments, linkCustomerDocument, unlinkCustomerDocument } from '/dashboard-customer-history-data.js';

export function customerDirectoryShell() {
  return `<section class="customer-directory" aria-label="Pelanggan outlet"><div class="cd-intro"><span class="cd-intro-icon">${icon('users')}</span><div><h2>Kenali setiap pelanggan lebih baik.</h2><p>Pilih pelanggan untuk melihat riwayat layanan, staf pelaksana, pembayaran, dan catatan.</p></div></div><section class="card cd-card"><form class="cd-toolbar" data-customer-search-form role="search"><label class="cd-search">${icon('search')}<span class="sr-only">Cari nama atau nomor HP pelanggan</span><input class="input" data-customer-query type="search" placeholder="Cari nama atau nomor HP pelanggan…" autocomplete="off" maxlength="100"></label><label class="cd-archive"><input type="checkbox" data-customer-archived> Sertakan pelanggan diarsipkan</label><button class="btn btn-secondary" type="submit">Cari</button></form><div data-customer-results aria-live="polite"><div class="cd-empty" role="status"><span class="vora-spinner"></span><h3>Memuat pelanggan…</h3></div></div></section><p class="cd-footnote">Pelanggan yang didaftarkan di aplikasi kasir akan tampil setelah tersinkron. Riwayat dicocokkan berdasarkan ID pelanggan.</p></section>`;
}

export function renderCustomerDirectoryPage(snapshot) {
  const rows = snapshot.customers;
  const total = snapshot.totalCount, page = snapshot.page, pageSize = snapshot.pageSize;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const empty = snapshot.query ? 'Tidak ada pelanggan yang cocok.' : 'Belum ada pelanggan yang terdaftar.';
  return `<div class="cd-results-heading"><strong>${h(total.toLocaleString('id-ID'))} pelanggan</strong><span>Pilih nama untuk melihat riwayat</span></div><div class="cd-table-wrap" role="region" tabindex="0" aria-label="Daftar pelanggan"><table class="cd-table"><thead><tr><th>Pelanggan</th><th>Nomor HP</th><th>Grup harga</th><th>Status</th><th><span class="sr-only">Riwayat</span></th></tr></thead><tbody>${rows.length ? rows.map(customer => `<tr><td data-label="Pelanggan"><button class="cd-name" type="button" data-customer-open="${h(customer.id)}"><span class="cd-avatar" aria-hidden="true">${h((customer.name || 'P').trim().slice(0, 2).toLocaleUpperCase('id-ID'))}</span><span><strong>${h(customer.name || 'Pelanggan tanpa nama')}</strong><small>Lihat riwayat layanan</small></span></button></td><td data-label="Nomor HP">${h(customer.phone || 'Belum dicatat')}</td><td data-label="Grup harga">${h(customer.price_group_name || customer.priceGroupName || 'Harga umum')}</td><td data-label="Status"><span class="cd-status ${customer.deleted_at ? 'cd-status-archived' : ''}">${customer.deleted_at ? 'Diarsipkan' : 'Aktif'}</span></td><td data-label="Riwayat"><button type="button" class="cd-open" data-customer-open="${h(customer.id)}" aria-label="Riwayat ${h(customer.name || 'pelanggan')}">Lihat riwayat ${icon('chevron')}</button></td></tr>`).join('') : `<tr><td colspan="5"><div class="cd-empty">${icon('users')}<h3>${empty}</h3><p>${snapshot.query ? 'Coba nama atau nomor HP lain, atau sertakan pelanggan yang diarsipkan.' : 'Daftarkan pelanggan melalui aplikasi kasir agar layanan berikutnya tercatat atas nama pelanggan tersebut.'}</p></div></td></tr>`}</tbody></table></div><footer class="cd-pagination"><span>Halaman ${h(page)} dari ${h(pages)}</span><div><button type="button" class="btn btn-secondary" data-customer-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Sebelumnya</button><button type="button" class="btn btn-secondary" data-customer-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Berikutnya</button></div></footer>`;
}

export function bindCustomers(container, api) {
  const controller = new AbortController(), signal = controller.signal;
  let request, generation = 0, snapshot, historyCleanup, debounce;
  const filters = { query: '', page: 1, pageSize: 50, includeArchived: false };
  const current = () => !signal.aborted && !api.signal?.aborted && api.isCurrent();
  const results = container.querySelector('[data-customer-results]');
  const context = () => [api.client, api.user, api.outlet];
  const cancel = () => { generation++; request?.abort(); clearTimeout(debounce); historyCleanup?.(); historyCleanup = null; };
  api.signal?.addEventListener('abort', cancel, { once: true });
  async function load() {
    if (!current()) return;
    const version = ++generation;
    request?.abort(); request = new AbortController();
    results.setAttribute('aria-busy', 'true');
    results.innerHTML = '<div class="cd-empty" role="status"><span class="vora-spinner"></span><h3>Memuat pelanggan…</h3></div>';
    try {
      const value = await loadCustomerDirectory(...context(), { ...filters, signal: request.signal });
      if (!current() || version !== generation || request.signal.aborted) return;
      if (value.outletId !== api.outlet.id || !Array.isArray(value.customers) || value.customers.some(row => row.outlet_id !== api.outlet.id || typeof row.id !== 'string') || !Number.isSafeInteger(value.totalCount) || value.totalCount < 0 || !Number.isSafeInteger(value.page) || value.page < 1 || value.pageSize !== filters.pageSize) throw new Error('Data pelanggan tidak sesuai outlet.');
      snapshot = { ...value, query: filters.query };
      if (filters.page > Math.max(1, Math.ceil(value.totalCount / filters.pageSize))) { filters.page = Math.max(1, Math.ceil(value.totalCount / filters.pageSize)); return load(); }
      results.innerHTML = renderCustomerDirectoryPage(snapshot);
    } catch (error) {
      if (!current() || version !== generation || error?.name === 'AbortError') return;
      snapshot = null;
      results.innerHTML = '<div class="cd-empty" role="alert"><h3>Daftar pelanggan belum dapat dimuat.</h3><p>Periksa koneksi dan sesi akun Anda, lalu coba lagi.</p><button type="button" class="btn btn-primary" data-customer-retry>Coba lagi</button></div>';
    } finally { if (current() && version === generation) results.removeAttribute('aria-busy'); }
  }
  const search = () => { if (!current()) return; clearTimeout(debounce); filters.query = container.querySelector('[data-customer-query]').value.trim(); filters.includeArchived = container.querySelector('[data-customer-archived]').checked; filters.page = 1; void load(); };
  container.addEventListener('submit', event => { if (event.target.matches('[data-customer-search-form]')) { event.preventDefault(); search(); } }, { signal });
  container.addEventListener('input', event => { if (event.target.matches('[data-customer-query]')) { clearTimeout(debounce); debounce = setTimeout(search, 350); } }, { signal });
  container.addEventListener('change', event => { if (event.target.matches('[data-customer-archived]')) search(); }, { signal });
  container.addEventListener('click', event => {
    if (!current()) return;
    if (event.target.closest('[data-customer-retry]')) { void load(); return; }
    const paging = event.target.closest('[data-customer-page]');
    if (paging && !paging.disabled) { const page = Number(paging.dataset.customerPage); if (Number.isSafeInteger(page) && page > 0) { filters.page = page; void load(); } return; }
    const target = event.target.closest('[data-customer-open]');
    if (!target || !snapshot) return;
    const customer = snapshot.customers.find(row => row.id === target.dataset.customerOpen && row.outlet_id === api.outlet.id);
    if (!customer) return;
    historyCleanup?.();
    historyCleanup = openCustomerHistory({ ...api,
      loadHistory: (id, options) => loadCustomerHistory(...context(), id, options),
      saveNote: (id, draft, scopeSignal) => saveCustomerNote(...context(), id, draft, scopeSignal),
      loadUnassigned: options => loadUnassignedDocuments(...context(), options),
      linkDocument: (id, draft, scopeSignal) => linkCustomerDocument(...context(), id, draft, scopeSignal),
      unlinkDocument: (id, draft, scopeSignal) => unlinkCustomerDocument(...context(), id, draft, scopeSignal),
    }, customer);
  }, { signal });
  void load();
  return () => { controller.abort(); cancel(); api.signal?.removeEventListener('abort', cancel); };
}

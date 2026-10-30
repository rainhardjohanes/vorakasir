import { verifyOwner } from '/dashboard-operations-data.js';

const GROUP_FIELDS = 'id,outlet_id,name,is_active,created_at,updated_at';
const PRICE_FIELDS = 'outlet_id,product_id,price_group_id,price,created_at,updated_at';
const MEMBER_FIELDS = 'outlet_id,customer_id,price_group_id,created_at,updated_at';
const abort = signal => { if (signal?.aborted) throw new DOMException('Permintaan dibatalkan.', 'AbortError'); };
async function result(query, signal) {
  abort(signal); const response = await (signal ? query.abortSignal(signal) : query); abort(signal);
  if (response.error) throw response.error;
  return response.data;
}
function own(row, outlet) { if (!row || row.outlet_id !== outlet.id) throw new Error('Data lintas outlet ditolak.'); return row; }
function identifier(value) { if (typeof value !== 'string' || !value.trim()) throw new Error('Referensi harga tidak valid.'); return value; }
function version(query, existing) {
  if (!existing?.updated_at) throw new Error('Versi data tidak tersedia. Muat ulang pengaturan.');
  return query.eq('updated_at', existing.updated_at);
}
export function priceValue(value) {
  if (value === '' || value == null) return null;
  const source = typeof value === 'string' ? value.trim() : String(value);
  if (!/^\d+$/.test(source) || !Number.isSafeInteger(Number(source)) || Number(source) > 999999999999) throw new Error('Harga harus berupa Rupiah bulat 0–999.999.999.999, tanpa titik atau koma.');
  return Number(source);
}
export function groupDraft(draft, outletId) {
  const name = String(draft.name || '').trim();
  if (!name || name.length > 60 || /[\x00-\x1f]/.test(name)) throw new Error('Nama grup wajib diisi, maksimal 60 karakter.');
  return { id: identifier(draft.id), outlet_id: outletId, name, is_active: draft.is_active !== false };
}
export function validatePriceCatalog(data, outlet) {
  if (!data || data.outlet_id !== outlet.id || !['groups','prices','memberships'].every(key => Array.isArray(data[key]))) throw new Error('Data harga spesial belum dapat dibaca lengkap atau lingkup outlet tidak sesuai.');
  for (const key of ['groups','prices','memberships']) for (const row of data[key]) own(row, outlet);
  const groups = new Set(data.groups.map(row => row.id));
  if (groups.size !== data.groups.length || data.groups.some(row => !row.id)) throw new Error('Daftar grup harga berisi duplikat atau referensi tidak valid.');
  const priceKeys = new Set(), customerIds = new Set();
  for (const row of data.prices) {
    const key = JSON.stringify([row.product_id, row.price_group_id]);
    if (!row.product_id || priceKeys.has(key)) throw new Error('Harga produk berisi duplikat atau referensi tidak valid.');
    priceKeys.add(key);
  }
  for (const row of data.memberships) {
    if (!row.customer_id || customerIds.has(row.customer_id)) throw new Error('Pelanggan memiliki keanggotaan grup ganda atau referensi tidak valid.');
    customerIds.add(row.customer_id);
  }
  for (const row of [...data.prices, ...data.memberships]) if (!groups.has(row.price_group_id)) throw new Error('Referensi grup harga tidak lengkap. Muat ulang pengaturan.');
  for (const row of data.prices) if (priceValue(row.price) === null) throw new Error('Harga tersimpan tidak valid.');
  return data;
}
export async function loadSpecialPricing(client, user, outlet, signal) {
  await verifyOwner(client, user, outlet, signal);
  const catalog = validatePriceCatalog(await result(client.rpc('vora_price_catalog', { p_outlet_id: outlet.id }), signal), outlet);
  const customers = []; let cursor; const seen = new Set();
  for (;;) {
    let query = client.from('customers').select('id,outlet_id,name,phone,deleted_at').eq('outlet_id', outlet.id).is('deleted_at', null).order('id', { ascending: true }).limit(500);
    if (cursor) query = query.gt('id', cursor);
    const page = await result(query, signal);
    if (!Array.isArray(page)) throw new Error('Data pelanggan tidak valid.');
    if (!page.length) break;
    for (const row of page) { own(row, outlet); if (!row.id || seen.has(row.id)) throw new Error('Daftar pelanggan berubah saat dimuat. Muat ulang.'); seen.add(row.id); customers.push(row); }
    if (customers.length > 20000) throw new Error('Jumlah pelanggan melebihi batas tampilan. Hubungi dukungan; data tidak dipotong.');
    cursor = page.at(-1).id;
  }
  return { ...catalog, customers, outletId: outlet.id };
}
function conflict() { return new Error('Data berubah di perangkat lain atau penyimpanan sebelumnya sudah berhasil. Tutup formulir dan muat ulang sebelum mengubahnya lagi.'); }
export async function savePriceGroup(client, user, outlet, draft, existing, signal) {
  await verifyOwner(client, user, outlet, signal);
  const payload = groupDraft(draft, outlet.id);
  if (existing) { own(existing, outlet); if (existing.id !== payload.id) throw new Error('Grup tidak sesuai.'); }
  const query = existing
    ? version(client.from('price_groups').update({ name: payload.name, is_active: payload.is_active }).eq('outlet_id', outlet.id).eq('id', payload.id), existing)
    : client.from('price_groups').insert(payload);
  try {
    const saved = await result(query.select(GROUP_FIELDS).maybeSingle(), signal);
    if (!saved) throw conflict();
    return own(saved, outlet);
  } catch (error) {
    if (!existing && error.code === '23505') throw new Error('Nama grup sudah digunakan atau grup sudah tersimpan. Muat ulang daftar grup.');
    throw error;
  }
}
export async function saveProductGroupPrice(client, user, outlet, product, group, value, existing, signal) {
  await verifyOwner(client, user, outlet, signal); own(product, outlet); own(group, outlet);
  const price = priceValue(value), keys = { outlet_id: outlet.id, product_id: identifier(product.id), price_group_id: identifier(group.id) };
  if (existing) { own(existing, outlet); if (existing.product_id !== product.id || existing.price_group_id !== group.id) throw new Error('Referensi harga tidak sesuai.'); }
  if (price === null && !existing) return null;
  let query = client.from('product_group_prices');
  query = existing ? version((price === null ? query.delete() : query.update({ price })).eq('outlet_id', outlet.id).eq('product_id', product.id).eq('price_group_id', group.id), existing) : query.insert({ ...keys, price });
  try {
    const row = await result(query.select(PRICE_FIELDS).maybeSingle(), signal);
    if (!row) throw conflict();
    own(row, outlet); return price === null ? null : row;
  } catch (error) { if (error.code === '23505') throw conflict(); throw error; }
}
export async function saveCustomerPriceGroup(client, user, outlet, customer, group, existing, signal) {
  await verifyOwner(client, user, outlet, signal); own(customer, outlet);
  if (group) { own(group, outlet); if (!group.is_active) throw new Error('Pilih grup harga yang aktif.'); }
  if (existing) { own(existing, outlet); if (existing.customer_id !== customer.id) throw new Error('Pelanggan tidak sesuai.'); }
  if (!group && !existing) return null;
  let query = client.from('customer_price_groups');
  query = existing ? version((group ? query.update({ price_group_id: group.id }) : query.delete()).eq('outlet_id', outlet.id).eq('customer_id', customer.id), existing)
    : query.insert({ outlet_id: outlet.id, customer_id: identifier(customer.id), price_group_id: group.id });
  try {
    const row = await result(query.select(MEMBER_FIELDS).maybeSingle(), signal);
    if (!row) throw conflict();
    own(row, outlet); return group ? row : null;
  } catch (error) { if (error.code === '23505') throw conflict(); throw error; }
}

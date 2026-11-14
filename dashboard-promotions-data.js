import { verifyOwner } from '/dashboard-operations-data.js';

export const PROMOTION_FIELDS = 'id,outlet_id,code,name,type,value,scope,target_id,min_spend,max_discount,start_date,end_date,is_active,updated_at,deleted_at';
const pendingCreates = new Map();
const editable = ['code','name','type','value','scope','target_id','min_spend','max_discount','is_active'];
const abort = signal => { if (signal?.aborted) throw new DOMException('Permintaan dibatalkan.', 'AbortError'); };
async function result(query, signal) {
  abort(signal); const response = await (signal ? query.abortSignal(signal) : query); abort(signal);
  if (response.error) throw response.error;
  return response.data;
}
function own(row, outlet) { if (!row || row.outlet_id !== outlet.id) throw new Error('Data lintas outlet ditolak.'); return row; }
function id(value) { if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Referensi promo tidak valid.'); return value; }
function text(value, label, max, optional = false) {
  const valueText = String(value ?? '').trim();
  if ((!optional && !valueText) || valueText.length > max || /[\x00-\x1f]/.test(valueText)) throw new Error(`${label} ${optional ? '' : 'wajib diisi dan '}maksimal ${max} karakter.`);
  return valueText;
}
export function promotionNumber(value, label, max = 999999999999) {
  const source = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(source) || !Number.isFinite(Number(source)) || Number(source) > max) throw new Error(`${label} harus berupa angka 0–${max}, tanpa pemisah ribuan (contoh: 10000 atau 12.5).`);
  return Number(source);
}
export function promotionTargets(row) { return row?.target_id ? String(row.target_id).split(',') : []; }
export function isSupportedPromotion(row) { return ['percentage','fixed'].includes(row?.type) && ['cart','category','product'].includes(row?.scope); }
export function promotionDraft(draft, outlet, catalog, existing = null) {
  if (!catalog || catalog.outletId !== outlet.id || !Array.isArray(catalog.products) || !Array.isArray(catalog.categories)) throw new Error('Katalog outlet belum tersedia. Muat ulang daftar promo.');
  if (existing) { own(existing, outlet); if (existing.id !== draft.id || existing.deleted_at) throw new Error('Promo tidak sesuai atau sudah diarsipkan.'); }
  if (!isSupportedPromotion(draft)) throw new Error('Pilih tipe dan ruang lingkup promo yang didukung POS.');
  const scope = draft.scope, targets = Array.isArray(draft.targets) ? draft.targets : promotionTargets(draft);
  const unique = [...new Set(targets.map(target => String(target)))];
  if (unique.some(target => !target || target.includes(',') || /[\x00-\x1f]/.test(target))) throw new Error('Target promo tidak dapat memuat koma atau karakter kontrol.');
  if (scope !== 'cart') {
    if (!unique.length) throw new Error('Pilih minimal satu produk atau kategori target.');
    const allowed = new Set(scope === 'product' ? catalog.products.map(row => { own(row, outlet); return row.id; }) : catalog.categories.map(row => { own(row, outlet); return row.name; }));
    // Keep retired references visible and unchanged when editing an old promo.
    if (existing?.scope === scope) for (const target of promotionTargets(existing)) allowed.add(target);
    if (unique.some(target => !allowed.has(target))) throw new Error('Target tidak tersedia pada outlet ini. Muat ulang katalog.');
  }
  return { id: id(draft.id), outlet_id: outlet.id, code: text(draft.code, 'Kode promo', 100, true).toUpperCase(), name: text(draft.name, 'Nama promo', 200),
    type: draft.type, value: promotionNumber(draft.value, 'Nilai diskon', draft.type === 'percentage' ? 100 : 999999999999), scope,
    target_id: scope === 'cart' ? null : unique.join(','), min_spend: promotionNumber(draft.min_spend ?? 0, 'Minimal belanja'),
    max_discount: draft.type === 'percentage' ? promotionNumber(draft.max_discount ?? 0, 'Batas potongan') : 0, is_active: draft.is_active === true };
}
export function validatePromotionActivation(row, outlet, catalog) {
  own(row, outlet);
  if (row.deleted_at) throw conflict();
  try {
    // Activation must use current targets; retired targets are only grandfathered
    // by the editor to avoid silently changing a stored inactive rule.
    return promotionDraft({ ...row, is_active: true }, outlet, catalog);
  } catch (cause) {
    const error = new Error(`Aturan promo belum valid untuk diaktifkan. Ubah promo terlebih dahulu. ${cause.message}`);
    error.code = 'PROMOTION_INVALID'; error.cause = cause; throw error;
  }
}
async function activationCatalog(client, outlet, signal) {
  const [products, categories] = await Promise.all([
    rows(client, 'products', 'id,outlet_id,name,sku,category,price,deleted_at', outlet, signal, 'id', true),
    rows(client, 'categories', 'name,outlet_id,deleted_at', outlet, signal, 'name', true),
  ]);
  return { outletId: outlet.id, products, categories };
}
async function rows(client, table, fields, outlet, signal, key = 'id', activeOnly = false) {
  const all = [], seen = new Set(); let cursor;
  for (;;) {
    let query = client.from(table).select(fields).eq('outlet_id', outlet.id).order(key, { ascending: true }).limit(500);
    if (activeOnly) query = query.is('deleted_at', null);
    if (cursor !== undefined) query = query.gt(key, cursor);
    const page = await result(query, signal);
    if (!Array.isArray(page)) throw new Error('Respons data promo tidak valid.');
    if (!page.length) return all;
    for (const row of page) { own(row, outlet); if (typeof row[key] !== 'string' || seen.has(row[key])) throw new Error('Data berubah saat dimuat. Muat ulang daftar promo.'); seen.add(row[key]); all.push(row); }
    if (all.length > 20000) throw new Error('Katalog terlalu besar. Hubungi dukungan; data tidak dipotong.');
    cursor = page.at(-1)[key];
  }
}
export async function loadPromotions(client, user, outlet, signal) {
  await verifyOwner(client, user, outlet, signal);
  const [promos, products, categories] = await Promise.all([
    rows(client, 'promos', PROMOTION_FIELDS, outlet, signal),
    rows(client, 'products', 'id,outlet_id,name,sku,category,price,deleted_at', outlet, signal, 'id', true),
    rows(client, 'categories', 'name,outlet_id,deleted_at', outlet, signal, 'name', true),
  ]);
  return { outletId: outlet.id, promos, products, categories };
}
function version(query, existing) {
  if (typeof existing?.updated_at !== 'string' || !existing.updated_at) throw new Error('Versi promo belum tersedia. Muat ulang sebelum menyimpan.');
  return query.eq('updated_at', existing.updated_at);
}
function conflict() { const error = new Error('Promo berubah di perangkat lain. Tutup formulir dan muat ulang sebelum mengubahnya lagi.'); error.code = 'PROMOTION_CONFLICT'; return error; }
function unknown(cause) { const error = new Error('Hasil penyimpanan belum dapat dipastikan. Periksa koneksi, lalu coba Simpan lagi pada formulir yang sama. Jangan membuat promo baru sebelum memuat ulang daftar.'); error.code = 'PROMOTION_UNKNOWN'; error.cause = cause; return error; }
function equivalent(row, payload) {
  return Object.entries(payload).every(([key, value]) => {
    if (row[key] === value) return true;
    if (['value','min_spend','max_discount'].includes(key) && value != null && row[key] != null) return Number.isFinite(Number(value)) && Number(row[key]) === Number(value);
    if (key === 'deleted_at' && typeof value === 'string' && typeof row[key] === 'string') return Number.isFinite(Date.parse(value)) && Date.parse(row[key]) === Date.parse(value);
    return false;
  });
}
function expectedPromotion(existing, patch) {
  const baseline = Object.fromEntries(PROMOTION_FIELDS.split(',').filter(field => field !== 'updated_at').map(field => [field, existing[field]]));
  return { ...baseline, ...patch };
}
async function readPromo(client, outlet, promoId, signal) {
  const row = await result(client.from('promos').select(PROMOTION_FIELDS).eq('outlet_id', outlet.id).eq('id', promoId).maybeSingle(), signal);
  return row ? own(row, outlet) : null;
}
function uncertain(error) { return !error?.code || ['NETWORK_ERROR','FETCH_ERROR','PGRST000','PGRST001','57014'].includes(error.code) || String(error.code).startsWith('08') || error.status >= 500; }
export async function savePromotion(client, user, outlet, draft, existing, catalog, signal) {
  await verifyOwner(client, user, outlet, signal);
  const payload = promotionDraft(draft, outlet, catalog, existing), key = `${outlet.merchant_id}:${outlet.id}:${payload.id}`;
  if (!existing) {
    const pending = pendingCreates.get(key);
    if (pending && !equivalent(pending, payload)) throw new Error('Percobaan sebelumnya belum terkonfirmasi. Kembalikan isian sebelumnya atau tutup formulir dan muat ulang daftar sebelum mengubahnya.');
    pendingCreates.set(key, payload);
  }
  const patch = Object.fromEntries(editable.map(field => [field, payload[field]]));
  const query = existing ? version(client.from('promos').update(patch).eq('outlet_id', outlet.id).eq('id', payload.id).is('deleted_at', null), existing) : client.from('promos').insert(payload);
  try {
    const saved = await result(query.select(PROMOTION_FIELDS).maybeSingle(), signal);
    if (!saved) throw conflict();
    own(saved, outlet); pendingCreates.delete(key); return saved;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if ((!existing && error.code === '23505') || uncertain(error)) {
      try {
        const saved = await readPromo(client, outlet, payload.id, signal);
        if (saved && !saved.deleted_at && equivalent(saved, existing ? expectedPromotion(existing, patch) : payload)) { pendingCreates.delete(key); return saved; }
        if (!existing && saved) { pendingCreates.delete(key); throw conflict(); }
      } catch (readError) { if (readError?.name === 'AbortError' || readError?.code === 'PROMOTION_CONFLICT') throw readError; }
      if (error.code === '23505') { pendingCreates.delete(key); throw conflict(); }
      throw unknown(error);
    }
    if (!existing) pendingCreates.delete(key);
    throw error;
  }
}
export async function changePromotionState(client, user, outlet, existing, action, signal) {
  await verifyOwner(client, user, outlet, signal); own(existing, outlet); id(existing.id);
  if (!['activate','deactivate','archive','restore'].includes(action)) throw new Error('Tindakan promo tidak valid.');
  if (action === 'restore' ? !existing.deleted_at : !!existing.deleted_at) throw conflict();
  if (action === 'activate') validatePromotionActivation(existing, outlet, await activationCatalog(client, outlet, signal));
  const patch = action === 'archive' ? { deleted_at: new Date().toISOString() } : action === 'restore' ? { deleted_at: null, is_active: false } : { is_active: action === 'activate' };
  let query = version(client.from('promos').update(patch).eq('outlet_id', outlet.id).eq('id', existing.id), existing);
  query = existing.deleted_at ? query.eq('deleted_at', existing.deleted_at) : query.is('deleted_at', null);
  try {
    const saved = await result(query.select(PROMOTION_FIELDS).maybeSingle(), signal);
    if (!saved) throw conflict();
    return own(saved, outlet);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if (uncertain(error)) {
      try { const saved = await readPromo(client, outlet, existing.id, signal); if (saved && equivalent(saved, expectedPromotion(existing, patch))) return saved; }
      catch (readError) { if (readError?.name === 'AbortError') throw readError; }
      throw unknown(error);
    }
    throw error;
  }
}

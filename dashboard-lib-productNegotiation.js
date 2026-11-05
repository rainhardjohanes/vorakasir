/** Negotiation changes only the effective base price, never extra prices or HPP. */
export const PRODUCT_NOTE_MAX_LENGTH = 250;
const MAX_MONEY = 1000000000000;
const money = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_MONEY;
const fail = message => { throw new Error(message); };

export function normalizeProductNote(value = '') {
  if (value == null) return '';
  if (typeof value !== 'string') fail('Catatan produk belum valid.');
  const note = value.normalize('NFC').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim();
  if (note.length > PRODUCT_NOTE_MAX_LENGTH) fail(`Catatan produk maksimal ${PRODUCT_NOTE_MAX_LENGTH} karakter.`);
  return note;
}

/** Persist defaults explicitly. Invalid enabled rules must fail closed. */
export function negotiationConfig(product = {}) {
  product ||= {};
  const enabled = (product.negotiationEnabled ?? product.negotiation_enabled) === true;
  const raw = product.maxNegotiationPercent ?? product.max_negotiation_percent ?? 0;
  const maxPercent = Number(raw);
  const valid = Number.isFinite(maxPercent) && maxPercent >= 0 && maxPercent <= 100
    && Math.abs(maxPercent * 100 - Math.round(maxPercent * 100)) < 0.0000001;
  return { enabled, maxPercent: valid ? maxPercent : 0, valid };
}

export function minimumNegotiatedPrice(product, referencePrice) {
  if (!money(referencePrice)) fail('Harga dasar produk belum valid.');
  const config = negotiationConfig(product);
  if (!config.enabled) return referencePrice;
  if (!config.valid) fail('Batas harga nego belum valid. Minta owner memperbarui produk.');
  // Integer Rupiah: round UP so a fractional floor never allows an extra reduction.
  const n = BigInt(referencePrice) * BigInt(10000 - Math.round(config.maxPercent * 100));
  return Number((n + 9999n) / 10000n);
}

export function prepareProductLineOptions(product, referencePrice, options = {}) {
  if (!money(referencePrice)) fail('Harga dasar produk belum valid.');
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('Pilihan produk belum valid.');
  const note = normalizeProductNote(options.note);
  const config = negotiationConfig(product);
  if (config.enabled && (typeof product?.id !== 'string' || !product.id || product.id.length > 250)) fail('Identitas produk harga nego belum valid.');
  const specified = options.negotiatedPrice !== undefined && options.negotiatedPrice !== null && options.negotiatedPrice !== '';
  if (specified && !['number', 'string'].includes(typeof options.negotiatedPrice)) fail('Harga nego belum valid.');
  if (specified && typeof options.negotiatedPrice === 'string' && !/^\d+$/.test(options.negotiatedPrice.trim())) fail('Harga nego harus berupa Rupiah bulat, tanpa titik atau koma.');
  const basePrice = specified ? Number(options.negotiatedPrice) : referencePrice;
  if (!money(basePrice)) fail('Harga nego harus berupa Rupiah bulat, tanpa nilai negatif.');
  if (specified && !config.enabled && basePrice !== referencePrice) fail('Harga produk ini tidak dapat dinego.');
  const minimumPrice = minimumNegotiatedPrice(product, referencePrice);
  if (basePrice < minimumPrice || basePrice > referencePrice) fail(`Harga nego harus di antara Rp${minimumPrice.toLocaleString('id-ID')} dan Rp${referencePrice.toLocaleString('id-ID')}.`);
  const negotiation = config.enabled && basePrice !== referencePrice ? {
    version: 1, productId: String(product.id), referencePrice, minimumPrice,
    maxPercent: config.maxPercent, negotiatedPrice: basePrice,
  } : null;
  return { note, basePrice, negotiation };
}

/** The existing cart key already covers price/extras/staff; include note + rule snapshot. */
/** @param {string} [note] @param {any} [negotiation] */
export function productLineIdentitySuffix(note = '', negotiation = null) {
  return JSON.stringify([normalizeProductNote(note), negotiation ? [negotiation.version, negotiation.productId,
    negotiation.referencePrice, negotiation.minimumPrice, negotiation.maxPercent, negotiation.negotiatedPrice] : null]);
}

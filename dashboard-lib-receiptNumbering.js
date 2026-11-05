// Display numbers never replace the transaction's UUID or its idempotency key.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const cartOf = sale => sale?.cart_data ?? sale?.cartData;
const validDate = value => typeof value === 'string' && ISO_DATE.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const validInstant = value => typeof value === 'string' && ISO_INSTANT.test(value)
  && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const tagOf = date => date.slice(8, 10) + date.slice(5, 7) + date.slice(2, 4);

/** Pure display formatter. No local/shared counter is invented on a device. */
export function formatDailyReceiptNumber(businessDate, sequence) {
  const number = typeof sequence === 'string' && /^\d+$/.test(sequence) ? Number(sequence) : sequence;
  if (!validDate(businessDate) || !Number.isSafeInteger(number) || number < 1) {
    throw new TypeError('Nomor urut struk tidak valid.');
  }
  return `INV/${tagOf(businessDate)}/${String(number).padStart(6, '0')}`;
}

export function readReceiptNumberRequest(sale) {
  const cart = cartOf(sale), marker = Array.isArray(cart) ? cart[0]?._voraReceipt : null;
  if (cart?.[0] && Object.prototype.hasOwnProperty.call(cart[0], '_voraMigration')) return null;
  if (!marker || marker.version !== 1 || !validInstant(marker.created_at)) return null;
  return { version: 1, created_at: marker.created_at };
}

/**
 * Safe on the previous server too: the request lives in an existing JSON column.
 * Call once for each newly created sale, before durable enqueue; a retry must
 * retain the already stored marker and UUID instead of creating another sale.
 */
export function stampFirstCartItem(items, createdAt = new Date().toISOString()) {
  if (!Array.isArray(items) || !items.length || !items[0] || typeof items[0] !== 'object'
    || Array.isArray(items[0]) || !validInstant(createdAt)) {
    throw new TypeError('Data permintaan nomor struk tidak valid.');
  }
  if (Object.prototype.hasOwnProperty.call(items[0], '_voraMigration')) {
    throw new TypeError('Riwayat impor tidak dapat diberi nomor struk baru.');
  }
  return [{ ...items[0], _voraReceipt: { version: 1, created_at: createdAt } }, ...items.slice(1)];
}

/** Accept all four mutually consistent server fields, never a bare forged label. */
export function receiptNumberFields(sale) {
  const request = readReceiptNumberRequest(sale);
  if (!request || !validInstant(sale?.receipt_created_at) || !validDate(sale?.receipt_business_date)
    || Date.parse(request.created_at) !== Date.parse(sale.receipt_created_at)) return null;
  let number;
  try { number = formatDailyReceiptNumber(sale.receipt_business_date, sale.receipt_sequence); }
  catch { return null; }
  if (sale.receipt_number !== number) return null;
  return { receipt_number: number, receipt_business_date: sale.receipt_business_date,
    receipt_sequence: Number(sale.receipt_sequence), receipt_created_at: sale.receipt_created_at };
}

export const isPendingReceiptNumber = sale => !!readReceiptNumberRequest(sale) && !receiptNumberFields(sale);

export function nativeReceiptIdentity(sale) {
  const official = receiptNumberFields(sale);
  if (official) return official.receipt_number;
  const request = readReceiptNumberRequest(sale);
  if (!request) return sale?.id || '-';
  // Keep the full UUID. A short random suffix could collide across offline tills.
  const id = String(sale?.id || '').replace(/^INV-/, '');
  const safeId = /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : 'BELUM-TERSIMPAN';
  const date = validDate(sale?.date) ? sale.date : request.created_at.slice(0, 10);
  return `TMP/${tagOf(date)}/${safeId}`;
}

/** Merge only the official identity after sync; never overwrite receipt amounts. */
export function mergeReceiptNumberFields(localSale, remoteSale) {
  if (!localSale?.id || remoteSale?.id !== localSale.id || !localSale.outlet_id
    || remoteSale.outlet_id !== localSale.outlet_id) return localSale;
  const candidate = { ...localSale, receipt_number: remoteSale.receipt_number,
    receipt_business_date: remoteSale.receipt_business_date, receipt_sequence: remoteSale.receipt_sequence,
    receipt_created_at: remoteSale.receipt_created_at };
  const fields = receiptNumberFields(candidate);
  return fields ? { ...localSale, ...fields } : localSale;
}

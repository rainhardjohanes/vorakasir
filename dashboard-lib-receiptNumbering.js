// Display numbers never replace the transaction's UUID or its idempotency key.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const cartOf = sale => sale?.cart_data ?? sale?.cartData;
const hasTerminalRequest = sale => {
  const item = cartOf(sale)?.[0];
  return item && !Object.prototype.hasOwnProperty.call(item, '_voraMigration') && item._voraReceipt?.version === 2;
};
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

export function formatTerminalReceiptNumber(businessDate, terminalCode, sequence) {
  if (typeof terminalCode !== 'string' || !/^K\d{2,16}$/.test(terminalCode)) throw new TypeError('Kode kasir struk tidak valid.');
  return formatDailyReceiptNumber(businessDate, sequence).replace(/\/(\d+)$/, `/${terminalCode}/$1`);
}

export function readReceiptNumberRequest(sale) {
  const cart = cartOf(sale), marker = Array.isArray(cart) ? cart[0]?._voraReceipt : null;
  if (cart?.[0] && Object.prototype.hasOwnProperty.call(cart[0], '_voraMigration')) return null;
  if (!marker || ![1, 2].includes(marker.version) || !validInstant(marker.created_at)) return null;
  return marker.version === 1 ? { version: 1, created_at: marker.created_at } : { ...marker };
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

// The terminal sequence is allocated only inside the durable sale/outbox write.
export function stampTerminalReceiptRequest(items, createdAt = new Date().toISOString(), profileId) {
  const stamped = stampFirstCartItem(items, createdAt);
  stamped[0]._voraReceipt = { version: 2, created_at: createdAt, ...(profileId ? { profile_id: profileId } : {}) };
  return stamped;
}

/** Accept all four mutually consistent server fields, never a bare forged label. */
export function receiptNumberFields(sale) {
  const request = readReceiptNumberRequest(sale);
  if (!request || !validInstant(sale?.receipt_created_at) || !validDate(sale?.receipt_business_date)
    || Date.parse(request.created_at) !== Date.parse(sale.receipt_created_at)) return null;
  let number;
  try {
    if (request.version === 2) {
      if (typeof request.profile_id !== 'string' || !request.profile_id || typeof request.device_id !== 'string' || !request.device_id ||
          request.business_date !== sale.receipt_business_date || request.sequence !== Number(sale.receipt_sequence) ||
          request.device_id !== sale.receipt_device_id || request.terminal_code !== sale.receipt_terminal_code) return null;
      number = formatTerminalReceiptNumber(sale.receipt_business_date, request.terminal_code, sale.receipt_sequence);
    } else number = formatDailyReceiptNumber(sale.receipt_business_date, sale.receipt_sequence);
  }
  catch { return null; }
  if (sale.receipt_number !== number) return null;
  return { receipt_number: number, receipt_business_date: sale.receipt_business_date,
    receipt_sequence: Number(sale.receipt_sequence), receipt_created_at: sale.receipt_created_at,
    ...(request.version === 2 ? { receipt_terminal_code: request.terminal_code, receipt_device_id: request.device_id } : {}) };
}

export const isPendingReceiptNumber = sale => (!!readReceiptNumberRequest(sale) || hasTerminalRequest(sale)) && !receiptNumberFields(sale);

export function nativeReceiptIdentity(sale) {
  const official = receiptNumberFields(sale);
  if (official) return official.receipt_number;
  const request = readReceiptNumberRequest(sale);
  if (hasTerminalRequest(sale)) return 'Nomor struk belum tersedia';
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
  const localRequest = readReceiptNumberRequest(localSale), remoteRequest = readReceiptNumberRequest(remoteSale);
  let items = cartOf(localSale);
  // Copy only a verified committed identity back to the pre-commit print object.
  // All quantities, prices, discounts, status and other financial fields stay local.
  if (localRequest?.version === 2 && !localRequest.sequence && remoteRequest?.version === 2 &&
      (!localRequest.profile_id || localRequest.profile_id === remoteRequest.profile_id) &&
      Date.parse(localRequest.created_at) === Date.parse(remoteRequest.created_at) && receiptNumberFields(remoteSale)) {
    items = items.map((item, index) => index === 0 ? { ...item, _voraReceipt: { ...remoteRequest } } : item);
  }
  const candidate = { ...localSale, ...(items !== cartOf(localSale) ? { [localSale.cart_data ? 'cart_data' : 'cartData']: items } : {}), receipt_number: remoteSale.receipt_number,
    receipt_business_date: remoteSale.receipt_business_date, receipt_sequence: remoteSale.receipt_sequence,
    receipt_created_at: remoteSale.receipt_created_at, receipt_terminal_code: remoteSale.receipt_terminal_code, receipt_device_id: remoteSale.receipt_device_id };
  const fields = receiptNumberFields(candidate);
  return fields ? { ...candidate, ...fields } : localSale;
}

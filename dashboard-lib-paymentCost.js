// Cost allocation metadata lives in existing receipt/order JSON. Older clients
// ignore it; missing legacy allocations stay unknown rather than being guessed.
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const signature = items => JSON.stringify(items.map(i => [i.id, i.qty, i.price, i.buyPrice ?? null, !!i.isPayment]));

export function cartCost(items) {
  let total = 0;
  for (const item of items.filter(i => !i.isPayment)) {
    if (!number(item.buyPrice) || Number(item.buyPrice) < 0 || !Number.isInteger(Number(item.qty)) || Number(item.qty) <= 0) return null;
    total += Math.round(Number(item.buyPrice) * Number(item.qty));
  }
  return Number.isSafeInteger(total) ? total : null;
}

export function paidCartCost(items) {
  let total = 0;
  for (const marker of items.filter(i => i.isPayment && Number(i.price) < 0)) {
    const saved = marker._voraPaidCost;
    if (saved?.version !== 1 || !Number.isSafeInteger(saved.amount) || saved.amount < 0 || saved.principal !== -Number(marker.price) * Number(marker.qty)) return null;
    total += saved.amount;
  }
  return Number.isSafeInteger(total) ? total : null;
}

export function remainingCartCost(items) {
  const gross = cartCost(items), paid = paidCartCost(items);
  // A later authorised item void can reduce total cost below cost recognised in
  // prior payments. The final allocation then reverses that excess (negative HPP).
  return gross === null || paid === null ? null : gross - paid;
}

export function allocatePaymentCost(items, principal, outstanding) {
  const remaining = remainingCartCost(items), paid = paidCartCost(items);
  if (remaining === null || paid === null) return { amount: null, cumulative: null };
  if (!number(principal) || !number(outstanding) || principal <= 0 || outstanding <= 0 || principal > outstanding) throw new Error('Alokasi HPP pembayaran tidak valid.');
  const amount = principal === outstanding ? remaining : Math.round(remaining * principal / outstanding);
  return { amount, cumulative: paid + amount };
}

export function stampReceiptCost(items, amount) {
  const clean = items.map(({ _voraReceiptCost: _old, ...item }) => item);
  if (!clean.length || amount === null || !Number.isSafeInteger(amount)) return clean;
  clean[0]._voraReceiptCost = { version: 1, amount, signature: signature(clean) };
  return clean;
}

export function readReceiptCost(items) {
  const saved = items?.[0]?._voraReceiptCost;
  if (!saved) return { kind: 'legacy', amount: null };
  if (saved.version !== 1 || !Number.isSafeInteger(saved.amount) || saved.signature !== signature(items)) return { kind: 'invalid', amount: null };
  return { kind: 'snapshot', amount: saved.amount };
}

export function readCostReturn(items, quantities = {}) {
  let returned = 0;
  for (const [key, value] of Object.entries(quantities)) {
    if (!/^(0|[1-9]\d*)$/.test(key) || !Number.isInteger(Number(value)) || Number(value) < 0) return null;
    const item = items[Number(key)];
    if (!item || item.isPayment || !number(item.buyPrice) || Number(item.buyPrice) < 0 || !Number.isInteger(Number(item.qty)) || Number(item.qty) <= 0 || Number(value) > Number(item.qty)) return null;
    returned += Math.round(Math.round(Number(item.buyPrice) * Number(item.qty)) * Number(value) / Number(item.qty));
  }
  return Number.isSafeInteger(returned) ? returned : null;
}

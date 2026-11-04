// Shared read-only adapter for tagged historical receipts. Native receipts are
// left untouched. An invalid/unsupported import marker must never enable edits.
const cart = sale => sale?.cart_data ?? sale?.cartData ?? [];
const owns = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && !!value.trim();
const money = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const isImportedHistory = sale => Array.isArray(cart(sale)) && owns(cart(sale)[0], '_voraMigration');

export function readImportedHistory(sale) {
  if (!isImportedHistory(sale)) return null;
  const m = cart(sale)[0]._voraMigration;
  return m && m.version === 1 && m.sourceSystem === 'majoo' && text(m.sourceAccount)
    && text(m.sourceOutlet) && text(m.billId) && digest(m.sourceKey)
    && sale.id === 'MIG-MJ-' + m.sourceKey ? m : null;
}

export function historicalTenderSnapshot(sale) {
  if (!isImportedHistory(sale)) return { kind: 'native', tenders: null, issue: null };
  const m = readImportedHistory(sale), invalid = issue => ({ kind: 'invalid', tenders: null, issue });
  if (!m) return invalid('Identitas riwayat impor belum dapat diverifikasi.');
  if (!Array.isArray(m.tenders) || !m.tenders.length) return invalid('Alokasi pembayaran riwayat impor belum lengkap.');
  const ordinals = new Set(), tenders = [];
  for (const t of m.tenders) {
    if (!Number.isSafeInteger(t?.ordinal) || t.ordinal < 1 || ordinals.has(t.ordinal)
      || !money(t.appliedAmount) || !money(t.visibleAmount) || t.appliedAmount > t.visibleAmount
      || !text(t.method) || (t.provider !== null && typeof t.provider !== 'string')) {
      return invalid('Alokasi pembayaran riwayat impor belum lengkap.');
    }
    ordinals.add(t.ordinal);
    tenders.push({ ordinal: t.ordinal, name: t.method === 'Tunai' ? 'TUNAI' : t.provider?.trim() || t.method.trim(), principal: t.appliedAmount });
  }
  if (sale.total == null || !money(Number(sale.total)) || tenders.reduce((sum, t) => sum + t.principal, 0) !== Number(sale.total)) {
    return invalid('Alokasi pembayaran riwayat impor tidak sama dengan nilai struk.');
  }
  return { kind: 'imported', tenders, issue: null };
}

// The first adapter version accepts separately verified absence of refunds.
// It deliberately does not infer zero from SUCCESS, an empty native ledger,
// or a future/unsupported historical refund state.
export function importedRefundAmount(sale) {
  if (!isImportedHistory(sale)) return undefined;
  const m = readImportedHistory(sale);
  return m && historicalTenderSnapshot(sale).kind === 'imported' && sale.refund_requires_review === false
    && m.sourceRefundState === 'no_refunds_or_voids' && Array.isArray(m.sourceRefunds) && !m.sourceRefunds.length
    && sale.refund_revision === 0 && sale.refunded_amount === 0 ? 0 : null;
}

export const receiptIdentity = sale => readImportedHistory(sale)?.billId || sale?.id || '-';

export function receiptLineTotal(sale, item) {
  if (!isImportedHistory(sale)) return Number(item.price) * Number(item.qty);
  if (!readImportedHistory(sale) || !money(item?._voraMigrationLine?.sourceLineTotal)) return null;
  return item._voraMigrationLine.sourceLineTotal;
}

export function assertMutableReceipt(sale) {
  if (isImportedHistory(sale)) throw new Error('Riwayat impor hanya dapat dilihat. Refund atau koreksi riwayat harus direkonsiliasi oleh admin.');
}

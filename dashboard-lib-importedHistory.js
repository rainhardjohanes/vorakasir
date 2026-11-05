import { nativeReceiptIdentity } from '/dashboard-lib-receiptNumbering.js';
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

const businessDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
  && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
// Validate the timestamp with millisecond precision understood by both Hermes
// and browsers. Preserve the source proof string (and its hash) untouched.
const reviewTimeValid = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
  && businessDate(value.slice(0, 10))
  && Number.isFinite(Date.parse(value.replace(/\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/,
    (_, fraction) => '.' + fraction.slice(0, 3).padEnd(3, '0'))));

function verifiedRefundsWithVoidsExcluded(sale, m) {
  const refund = m.evidence?.refundEvidence, exclusion = m.evidence?.voidExclusion;
  return m.sourceVoidDisposition === 'excluded_by_user'
    && refund && digest(refund.sha256) && text(refund.locator)
    && refund.refundCount === 0 && refund.refundAmount === 0
    && businessDate(refund.period?.start) && businessDate(refund.period?.end)
    && refund.period.start <= refund.period.end && businessDate(sale.date)
    && sale.date >= refund.period.start && sale.date <= refund.period.end
    && exclusion && exclusion.disposition === 'excluded_by_user'
    && exclusion.decision === 'void tidak perlu dimigrasikan, lanjut saja yang lain'
    && exclusion.reviewedBy === 'root' && reviewTimeValid(exclusion.reviewedAt)
    && digest(exclusion.reviewSha256) && digest(exclusion.sourceReportSha256)
    && exclusion.locator === 'history-void-exclusion-review.json';
}

// A zero cash refund needs separately verified evidence. Excluding source void
// records is a distinct user choice, never a claim that no voids occurred.
// SUCCESS, an empty native ledger, or an unsupported state cannot imply zero.
export function importedRefundAmount(sale) {
  if (!isImportedHistory(sale)) return undefined;
  const m = readImportedHistory(sale);
  return m && historicalTenderSnapshot(sale).kind === 'imported' && sale.refund_requires_review === false
    && (m.sourceRefundState === 'no_refunds_or_voids'
      || (m.sourceRefundState === 'no_refunds_voids_excluded' && verifiedRefundsWithVoidsExcluded(sale, m)))
    && Array.isArray(m.sourceRefunds) && !m.sourceRefunds.length
    && sale.refund_revision === 0 && sale.refunded_amount === 0 ? 0 : null;
}

export const receiptIdentity = sale => readImportedHistory(sale)?.billId
  || (isImportedHistory(sale) ? sale?.id || '-' : nativeReceiptIdentity(sale));

export function receiptLineTotal(sale, item) {
  if (!isImportedHistory(sale)) return Number(item.price) * Number(item.qty);
  if (!readImportedHistory(sale) || !money(item?._voraMigrationLine?.sourceLineTotal)) return null;
  return item._voraMigrationLine.sourceLineTotal;
}

export function assertMutableReceipt(sale) {
  if (isImportedHistory(sale)) throw new Error('Riwayat impor hanya dapat dilihat. Refund atau koreksi riwayat harus direkonsiliasi oleh admin.');
}

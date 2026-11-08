import { normalizeReceiptDetails } from '/dashboard-receipt-details.js';
import { isImportedHistory, readImportedHistory, receiptIdentity } from '/dashboard-lib-importedHistory.js';
import { validateCommissionReport } from '/dashboard-commissions-data.js';
import { validateRange } from '/dashboard-data.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 250;
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const clone = value => structuredClone(value);
const assert = (condition, message) => { if (!condition) throw new TypeError(message); };
const statuses = ['available', 'upgrade', 'unavailable', 'error'];
export const STAFF_PERFORMANCE_LIMIT = 50000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const within = (value, range) => validDate(value) && value >= range.start && value <= range.end;
const quantityKeys = [['quantity', 'qty'], ['refundedQuantity', 'refundedQty'], ['remainingQuantity', 'remainingQty']];
const sumKnown = (rows, key) => rows.some(row => !numeric(row[key])) ? null : rows.reduce((sum, row) => sum + row[key], 0);

function lineStaffIds(sale, item, index, ledgerNames) {
  if (isImportedHistory(sale)) {
    if (!readImportedHistory(sale)) return [];
    const people = item._voraMigrationLine?.servedBy;
    if (!Array.isArray(people) || !people.length || people.some(person => !id(person?.id) || !text(person.name).trim())) return [];
    const ids = people.map(person => person.id);
    return new Set(ids).size === ids.length ? ids : [];
  }
  // Product assignment IDs belong to the saved line, not the current rule or
  // transaction-level commission recipient. The native writer saves servedBy
  // from these same product selections. A loose staff-ID array is insufficient.
  const envelope = (sale.cart_data ?? sale.cartData)?.[0]?._voraCommission;
  if (!text(item.servedBy).trim() || !object(envelope) || envelope.version !== 1 || envelope.outlet_id !== sale.outlet_id
      || !Array.isArray(envelope.lines) || !Array.isArray(envelope.rules)) return [];
  const lineId = item._voraCommissionLineId || item.cartItemId;
  const matches = envelope.lines.filter(line => id(lineId) && line?.line_id === lineId);
  if (matches.length !== 1) return [];
  const line = matches[0];
  if (line.product_id !== item.id || !numeric(line.qty) || Number(item.qty) > line.qty || !Array.isArray(line.groups) || !line.groups.length) return [];
  const ids = [];
  for (const group of line.groups) {
    const rules = envelope.rules.filter(rule => rule?.id === group?.rule_id && rule.version === group.rule_version);
    if (rules.length !== 1 || rules[0].outlet_id !== sale.outlet_id || rules[0].scope !== 'product'
        || !Array.isArray(rules[0].staff_ids) || !Array.isArray(group.staff_ids) || !group.staff_ids.length
        || group.staff_ids.some(staffId => !id(staffId) || !rules[0].staff_ids.includes(staffId))
        || new Set(group.staff_ids).size !== group.staff_ids.length) return [];
    ids.push(...group.staff_ids);
  }
  const groupKey = groups => JSON.stringify(groups.map(group => [group?.rule_id, group?.rule_version,
    Array.isArray(group?.staff_ids) ? [...group.staff_ids].sort() : null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  if (!Array.isArray(item._voraCommissionGroups) || groupKey(item._voraCommissionGroups) !== groupKey(line.groups)) return [];
  const coverage = envelope.payment?.paid_lines;
  if (Array.isArray(coverage) && envelope.payment.mode !== 'nominal'
      && !coverage.some(row => row.receipt_index === index && row.line_id === lineId && row.qty === Number(item.qty))) return [];
  // A commission recipient is not automatically the person who performed the
  // service. Native name-only snapshots remain name-only unless a saved name/ID
  // mapping independently agrees with the exact serving label.
  const selected = [...new Set(ids)];
  if (selected.length > 500) return [];
  const names = Array.isArray(envelope.staff) ? selected.map(staffId => {
    const people = envelope.staff.filter(person => person?.id === staffId);
    return people.length === 1 && text(people[0].name).trim() ? people[0].name : null;
  }) : selected.map(staffId => {
    const saved = ledgerNames.get(JSON.stringify([sale.id, staffId]));
    return saved?.size === 1 ? [...saved][0] : null;
  });
  if (names.some(name => name === null) || names.join(', ') !== item.servedBy) return [];
  return selected;
}

function identity(label, ids) {
  if (ids.length === 1) return { key: 'id:' + ids[0], staffId: ids[0], staffIds: ids, staffName: label,
    identityKind: 'id', identityLabel: 'ID pada snapshot', attributionNote: 'Identitas mengikuti pelaksana pada snapshot baris struk.' };
  if (ids.length > 1) return { key: 'shared:' + JSON.stringify([...ids].sort()), staffId: null, staffIds: [...ids].sort(), staffName: label,
    identityKind: 'shared', identityLabel: 'Layanan bersama', attributionNote: 'Nilai dan unit dihitung satu kali untuk tim; tidak dibagi rata atau diulang pada setiap staf.' };
  if (label.trim()) return { key: 'name:' + label, staffId: null, staffIds: [], staffName: label,
    identityKind: 'name', identityLabel: 'Nama pada struk', attributionNote: 'Label nama disalin utuh dari struk; tidak dihubungkan ke ID atau ledger komisi berdasarkan kesamaan nama.' };
  return { key: 'unassigned', staffId: null, staffIds: [], staffName: 'Pelaksana belum tersimpan',
    identityKind: 'unassigned', identityLabel: 'Belum tercatat', attributionNote: 'Kasir tidak digunakan sebagai pengganti pelaksana.' };
}

function emptySummary(value, outletId, available) {
  return { ...value, outletId, receiptCount: 0, lineCount: 0, quantity: 0, refundedQuantity: 0,
    remainingQuantity: 0, amount: 0, sharedParticipationCount: 0, unknownQuantityCount: 0, unknownAmountCount: 0,
    unknownRefundQuantityCount: 0, commissionEarned: available && value.identityKind === 'id' ? 0 : null,
    commissionReversed: available && value.identityKind === 'id' ? 0 : null,
    commissionNet: available && value.identityKind === 'id' ? 0 : null };
}

function totals(summary, items, ledger, available, scopedUnknown = false) {
  const commissionKnown = available && !scopedUnknown;
  return { receiptCount: new Set(items.map(item => item.saleId)).size, lineCount: items.length,
    ...Object.fromEntries(quantityKeys.map(([out, key]) => [out, sumKnown(items, key)])), amount: sumKnown(items, 'total'),
    unknownQuantityCount: items.filter(item => !numeric(item.qty)).length,
    unknownAmountCount: items.filter(item => !numeric(item.total)).length,
    unknownRefundQuantityCount: items.filter(item => !numeric(item.refundedQty)).length,
    sharedParticipationCount: summary.reduce((sum, row) => sum + row.sharedParticipationCount, 0),
    commissionEarned: commissionKnown ? ledger.filter(row => row.event_type === 'earned').reduce((sum, row) => sum + row.amount, 0) : null,
    commissionReversed: commissionKnown ? -ledger.filter(row => row.event_type === 'refund').reduce((sum, row) => sum + row.amount, 0) : null,
    commissionNet: commissionKnown ? ledger.reduce((sum, row) => sum + row.amount, 0) : null };
}

/** Saved service attribution plus independently recorded commission amounts.
 * No staff/customer/catalog lookup and no commission rate calculation occurs.
 */
export function staffPerformanceModel({ report, commissionReport = null, commissionStatus = 'unavailable', outlet, range = report?.range } = {}) {
  try { validateRange(range); } catch { throw new TypeError('Periode kinerja staf tidak valid.'); }
  assert(id(outlet?.id) && report?.outletId === outlet.id && report.range?.start === range.start && report.range?.end === range.end, 'Kinerja staf tidak sesuai outlet atau periode terpilih.');
  assert(Array.isArray(report.sales) && statuses.includes(commissionStatus), 'Data atau status komisi kinerja staf tidak valid.');
  assert(report.sales.length <= STAFF_PERFORMANCE_LIMIT && report.sales.reduce((sum, sale) => sum + (Array.isArray(sale?.cart_data ?? sale?.cartData) ? (sale.cart_data ?? sale.cartData).length : 0), 0) <= STAFF_PERFORMANCE_LIMIT, 'Kinerja staf melebihi 50.000 baris. Pilih periode lebih pendek; data tidak dipotong.');
  const saleIds = new Set();
  for (const sale of report.sales) {
    assert(id(sale?.id) && !saleIds.has(sale.id) && sale.outlet_id === outlet.id && within(sale.date, range), 'Struk ganda, lintas outlet, atau di luar periode ditolak.');
    saleIds.add(sale.id);
  }
  const available = commissionStatus === 'available';
  if (available) {
    assert(Array.isArray(commissionReport?.items) && commissionReport.items.length <= STAFF_PERFORMANCE_LIMIT, 'Ledger kinerja melebihi 50.000 baris atau belum lengkap; data tidak dipotong.');
    validateCommissionReport(commissionReport, outlet, range);
    assert(commissionReport.items.every(row => within(row.sale_date, range)), 'Tanggal transaksi ledger komisi di luar periode ditolak.');
  }
  const ledger = available ? commissionReport.items.map(row => ({ ...clone(row), staffKey: 'id:' + row.staff_id })) : [];
  const ledgerNames = new Map();
  for (const row of ledger) if (row.event_type === 'earned' && text(row.staff_name).trim()) {
    const key = JSON.stringify([row.sale_id, row.staff_id]);
    if (!ledgerNames.has(key)) ledgerNames.set(key, new Set());
    ledgerNames.get(key).add(row.staff_name);
  }
  const summary = new Map(), buckets = new Map(), ledgerBuckets = new Map(), items = [], participations = [];
  const ensure = value => {
    if (!summary.has(value.key)) {
      assert(summary.size < STAFF_PERFORMANCE_LIMIT, 'Ringkasan kinerja melebihi 50.000 baris; data tidak dipotong.');
      summary.set(value.key, emptySummary(value, outlet.id, available)); buckets.set(value.key, []); ledgerBuckets.set(value.key, []);
    }
    const row = summary.get(value.key);
    if (!row.staffName && value.staffName) row.staffName = value.staffName;
    return row;
  };
  for (const sale of report.sales) {
    // Only the fields needed for item metadata are passed to the adapter.
    // Customer information is neither read nor retained by this model.
    const source = { id: sale.id, outlet_id: sale.outlet_id, status: sale.status, total: sale.total, cart_data: sale.cart_data ?? sale.cartData,
      refund_revision: sale.refund_revision, refunded_amount: sale.refunded_amount, refund_requires_review: sale.refund_requires_review,
      refunded_quantities: sale.refunded_quantities, refunded_stock_quantities: sale.refunded_stock_quantities };
    const detail = normalizeReceiptDetails(source), cart = source.cart_data;
    for (const line of detail.items) {
      const attribution = identity(line.servedBy, lineStaffIds(source, cart[line.index], line.index, ledgerNames));
      ensure(attribution);
      const item = { ...line, key: sale.id + ':' + line.index, outletId: outlet.id, staffKey: attribution.key,
        staffName: attribution.staffName, staffIds: [...attribution.staffIds], identityKind: attribution.identityKind,
        saleId: sale.id, receipt: receiptIdentity(sale), date: sale.date, attributionNote: attribution.attributionNote };
      items.push(item); buckets.get(attribution.key).push(item);
      if (attribution.identityKind === 'shared') for (const staffId of attribution.staffIds) participations.push({ staffId, lineKey: sale.id + ':' + line.index });
    }
  }
  for (const entry of ledger) {
    ensure({ key: entry.staffKey, staffId: entry.staff_id, staffIds: [entry.staff_id], staffName: entry.staff_name,
      identityKind: 'id', identityLabel: 'ID pada ledger komisi', attributionNote: 'Komisi mengikuti catatan ledger, bukan perkiraan dari layanan atau aturan saat ini.' });
    ledgerBuckets.get(entry.staffKey).push(entry);
  }
  for (const participant of participations) {
    const row = ensure({ key: 'id:' + participant.staffId, staffId: participant.staffId, staffIds: [participant.staffId], staffName: '',
      identityKind: 'id', identityLabel: 'ID pada snapshot', attributionNote: 'Partisipasi layanan bersama tidak mengulang nilai atau unit tim.' });
    row.sharedParticipationCount++;
  }
  for (const row of summary.values()) {
    const own = buckets.get(row.key), entries = ledgerBuckets.get(row.key);
    if (!row.staffName) row.staffName = 'Staf ID ' + row.staffId;
    row.receiptCount = new Set(own.map(item => item.saleId)).size; row.lineCount = own.length;
    for (const [out, key] of quantityKeys) row[out] = sumKnown(own, key);
    row.amount = sumKnown(own, 'total');
    row.unknownQuantityCount = own.filter(item => !numeric(item.qty)).length;
    row.unknownAmountCount = own.filter(item => !numeric(item.total)).length;
    row.unknownRefundQuantityCount = own.filter(item => !numeric(item.refundedQty)).length;
    if (available && row.identityKind === 'id') {
      row.commissionEarned = entries.filter(entry => entry.event_type === 'earned').reduce((sum, entry) => sum + entry.amount, 0);
      row.commissionReversed = -entries.filter(entry => entry.event_type === 'refund').reduce((sum, entry) => sum + entry.amount, 0);
      row.commissionNet = entries.reduce((sum, entry) => sum + entry.amount, 0);
    }
  }
  const rows = [...summary.values()].sort((a, b) => a.staffName.localeCompare(b.staffName, 'id') || a.key.localeCompare(b.key));
  const model = { version: 1, outletId: outlet.id, outletName: text(outlet.businessName) || text(outlet.name) || 'Outlet', range: { ...range },
    commissionStatus, commissionAvailable: available, summary: rows, items, commissionItems: ledger,
    totals: totals(rows, items, ledger, available), filters: { search: '', staffKey: '' },
    notes: ['Pelaksana mengikuti snapshot layanan/produk, bukan kasir pembuat struk.',
      'Nilai layanan adalah jumlah nilai item tersimpan sebelum diskon, pajak, dan refund tingkat struk; bukan penjualan bersih atau laba.',
      'Label nama pada struk digabung hanya sebagai label tersimpan. Label tersebut tidak dipakai untuk mencocokkan identitas atau komisi.',
      'Layanan bersama dihitung satu kali pada tim. Partisipasi pribadi tidak menambah nilai atau unit layanan.',
      'Komisi berasal dari ledger yang tersimpan setelah koreksi refund; aturan komisi saat ini tidak dihitung ulang.'],
    warnings: [ ...(!available ? ['Komisi belum tersedia; nilai yang tidak diketahui ditampilkan sebagai —, bukan nol.'] : []),
      ...(items.some(item => !numeric(item.refundedQty)) ? ['Sebagian kuantitas refund belum dapat dipastikan dari snapshot.'] : []),
      ...(rows.some(row => row.identityKind === 'name') ? ['Ada nama tanpa identitas staf yang dapat dicocokkan. Komisi tidak dipasangkan berdasarkan kesamaan nama.'] : []) ] };
  return validateStaffPerformanceModel(model, outlet, range);
}

export function validateStaffPerformanceModel(model, outlet, range = model?.range) {
  try { validateRange(range); } catch { throw new TypeError('Periode kinerja staf tidak valid.'); }
  assert(model?.version === 1 && id(outlet?.id) && model.outletId === outlet.id && model.range?.start === range.start && model.range?.end === range.end, 'Kinerja staf tidak sesuai outlet atau periode terpilih.');
  assert(statuses.includes(model.commissionStatus) && model.commissionAvailable === (model.commissionStatus === 'available')
    && Array.isArray(model.summary) && Array.isArray(model.items) && Array.isArray(model.commissionItems), 'Model kinerja staf tidak lengkap.');
  assert([model.summary, model.items, model.commissionItems].every(rows => rows.length <= STAFF_PERFORMANCE_LIMIT), 'Kinerja staf melebihi 50.000 baris; data tidak dipotong.');
  const keys = new Set(), itemKeys = new Set(), ledgerKeys = new Set();
  for (const row of model.summary) {
    assert(id(row.key) || typeof row.key === 'string' && row.key.length > 0, 'Identitas ringkasan tidak valid.');
    assert(!keys.has(row.key) && row.outletId === outlet.id && ['id', 'name', 'shared', 'unassigned'].includes(row.identityKind), 'Ringkasan kinerja ganda atau lintas outlet ditolak.'); keys.add(row.key);
    assert(typeof row.staffName === 'string' && Array.isArray(row.staffIds), 'Identitas staf tidak lengkap.');
    for (const key of ['quantity', 'refundedQuantity', 'remainingQuantity', 'amount', 'commissionEarned', 'commissionReversed', 'commissionNet']) assert(row[key] === null || numeric(row[key]), 'Angka ringkasan kinerja tidak valid.');
  }
  for (const item of model.items) {
    assert(!itemKeys.has(item.key) && item.outletId === outlet.id && keys.has(item.staffKey) && within(item.date, range)
      && id(item.saleId) && Number.isSafeInteger(item.index) && item.index >= 0, 'Rincian kinerja ganda atau di luar cakupan ditolak.'); itemKeys.add(item.key);
    for (const key of ['qty', 'refundedQty', 'remainingQty', 'price', 'total']) assert(item[key] === null || numeric(item[key]), 'Angka rincian kinerja tidak valid.');
  }
  for (const entry of model.commissionItems) {
    assert(model.commissionAvailable && !ledgerKeys.has(entry.id) && entry.outlet_id === outlet.id && within(entry.sale_date, range)
      && entry.staffKey === 'id:' + entry.staff_id && keys.has(entry.staffKey) && Number.isSafeInteger(entry.amount), 'Ledger kinerja ganda atau di luar cakupan ditolak.'); ledgerKeys.add(entry.id);
  }
  return model;
}

export function filterStaffPerformance(model, filters = {}) {
  validateStaffPerformanceModel(model, { id: model?.outletId }, model?.range);
  const search = text(filters.search).trim().slice(0, 200), staffKey = text(filters.staffKey);
  assert(!staffKey || model.summary.some(row => row.key === staffKey), 'Staf terpilih tidak ada pada laporan ini.');
  const query = search.toLocaleLowerCase('id-ID');
  const terms = new Map(model.summary.map(row => [row.key, [row.staffName, row.identityLabel]]));
  for (const item of model.items) terms.get(item.staffKey).push(item.name, item.category, item.note, item.receipt, item.servedBy);
  for (const entry of model.commissionItems) terms.get(entry.staffKey).push(entry.product_name, entry.rule_name);
  const summary = model.summary.filter(row => (!staffKey || row.key === staffKey) && (!query || terms.get(row.key).join('\n').toLocaleLowerCase('id-ID').includes(query)));
  const keys = new Set(summary.map(row => row.key)), items = model.items.filter(item => keys.has(item.staffKey)), ledger = model.commissionItems.filter(entry => keys.has(entry.staffKey));
  const scopedUnknown = !!(search || staffKey) && summary.length > 0 && !summary.some(row => row.identityKind === 'id');
  return clone({ ...model, summary, items, commissionItems: ledger, totals: totals(summary, items, ledger, model.commissionAvailable, scopedUnknown), filters: { search, staffKey } });
}

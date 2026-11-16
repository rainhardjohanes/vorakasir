import { normalizeReceiptDetails } from '/dashboard-receipt-details.js';
import { normalizeUnpaidOrder } from '/dashboard-unpaid-orders-model.js';
import { receiptIdentity, isImportedHistory } from '/dashboard-lib-importedHistory.js';
import { refundAmount, netSaleAmount } from '/dashboard-lib-refundReports.js';

// Read-only customer presentation. Amounts come from saved receipts and the
// existing refund helpers; this module never prices a service or changes a sale.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
const validId = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 250;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const amount = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e12 ? Number(value) : null;
const sumKnown = values => {
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
  const result = values.reduce((sum, value) => sum + value, 0);
  return Math.abs(result) <= Number.MAX_SAFE_INTEGER ? result : null;
};
const unique = values => [...new Set(values.filter(Boolean))];
const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('id-ID');
const voidStatuses = new Set(['VOID', 'VOIDED', 'CANCELLED', 'CANCELED', 'DELETED']);
const paidStatuses = new Set(['SUCCESS', 'PARTIAL_REFUND', 'REFUNDED']);
const statusText = { paid: 'Lunas', partial: 'Dibayar sebagian', unpaid: 'Belum dibayar', refunded: 'Dengan refund', void: 'VOID / dibatalkan', review: 'Perlu diperiksa' };
export const CUSTOMER_HISTORY_STATUSES = Object.freeze(['all', 'paid', 'partial', 'unpaid', 'refunded', 'void', 'review']);
export const CUSTOMER_HISTORY_EXPORT_LIMIT = 50000;

export function customerHistoryDateLabel(value) {
  if (!date(value)) return '—';
  const [year, month, day] = value.split('-');
  return `${Number(day)} ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][Number(month) - 1]} ${year}`;
}

function orderNumber(record) {
  const marker = record?.cart_data?.[0]?._voraOrder;
  if (object(marker) && marker.version === 1 && date(marker.business_date)
      && /^K\d{2,16}$/.test(marker.terminal_code || '') && Number.isSafeInteger(marker.sequence) && marker.sequence >= 1) {
    const [year, month, day] = marker.business_date.split('-');
    const expected = `ORD/${day}${month}${year.slice(-2)}/${marker.terminal_code}/${String(marker.sequence).padStart(5, '0')}`;
    if (marker.order_number === expected) return expected;
  }
  const display = record?._voraDisplayReference;
  if (!object(display) || display.version !== 1 || display.outlet_id !== record.outlet_id || display.order_id !== record.id
      || !date(display.business_date) || !Number.isSafeInteger(display.sequence) || display.sequence < 1 || display.sequence > 999999999) return '';
  const [year, month, day] = display.business_date.split('-');
  const expected = `ORD/${day}${month}${year.slice(-2)}/${String(display.sequence).padStart(5, '0')}`;
  return display.order_number === expected ? expected : '';
}

function scope(snapshot) {
  if (!object(snapshot) || !validId(snapshot.outletId) || !validId(snapshot.customer?.id)
      || snapshot.customer.outlet_id !== snapshot.outletId) throw new TypeError('Pelanggan tidak sesuai outlet terpilih.');
  if (snapshot.outlet && snapshot.outlet.id !== snapshot.outletId) throw new TypeError('Outlet riwayat berubah. Muat ulang pelanggan.');
  for (const key of ['sales', 'orders', 'logs', 'refunds', 'links', 'notes']) {
    if (snapshot[key] !== undefined && !Array.isArray(snapshot[key])) throw new TypeError('Data riwayat belum lengkap. Muat ulang pelanggan.');
    if ((snapshot[key] || []).some(record => !object(record) || record.outlet_id !== snapshot.outletId)) throw new TypeError('Data lintas outlet ditolak.');
  }
  if ((snapshot.notes || []).some(note => note.customer_id !== snapshot.customer.id)) throw new TypeError('Catatan tidak sesuai pelanggan terpilih.');
  for (const key of ['sales', 'orders']) {
    const seen = new Set();
    for (const record of snapshot[key] || []) {
      if (!validId(record.id) || seen.has(record.id)) throw new TypeError('Catatan riwayat berulang. Muat ulang pelanggan.');
      seen.add(record.id);
    }
  }
}

function matchingRecords(snapshot) {
  const customerId = snapshot.customer.id, linked = new Map();
  for (const link of snapshot.links || []) {
    if (!['sale', 'order'].includes(link.record_type) || !validId(link.record_id) || !validId(link.customer_id)) throw new TypeError('Tautan riwayat tidak valid.');
    const key = `${link.record_type}:${link.record_id}`;
    if (linked.has(key) && linked.get(key) !== link.customer_id) throw new TypeError('Tautan pelanggan berulang. Muat ulang riwayat.');
    linked.set(key, link.customer_id);
  }
  const select = (record, type) => {
    const original = validId(record.customer?.id) ? record.customer.id : null;
    const associated = linked.get(`${type}:${record.id}`);
    if (original && associated && original !== associated) throw new TypeError('Tautan tidak boleh mengganti pelanggan yang tercatat pada transaksi.');
    return original === customerId || !original && associated === customerId;
  };
  return {
    sales: (snapshot.sales || []).filter(record => select(record, 'sale')),
    orders: (snapshot.orders || []).filter(record => select(record, 'order')),
  };
}

function commissionKey(record, details) {
  const core = record.cart_data?.[0]?._voraCommission;
  if (!object(core) || core.version !== 1 || core.outlet_id !== record.outlet_id || !validId(core.checkout_id)
      || !Array.isArray(core.lines) || !Array.isArray(core.rules) || !Array.isArray(core.transaction_groups)) return '';
  if (core.payment && !details.payment) return '';
  return core.checkout_id;
}

function normalizeInvoice(record, logs, customerId) {
  const details = normalizeReceiptDetails(record), total = amount(record.total), sourceStatus = text(record.status).toUpperCase();
  const voided = voidStatuses.has(sourceStatus), eligible = paidStatuses.has(sourceStatus);
  const refund = voided ? 0 : eligible && total !== null ? refundAmount(record, logs) : null;
  const net = voided ? 0 : eligible && total !== null ? netSaleAmount(record, logs) : null;
  const warnings = [];
  if (!voided && (!eligible || total === null)) warnings.push('Status atau nilai pembayaran belum dapat diverifikasi.');
  if (refund === null) warnings.push('Nilai refund belum dapat dipastikan; penerimaan bersih ditampilkan sebagai —.');
  if (!date(record.date)) warnings.push('Tanggal transaksi belum lengkap.');
  if (!Array.isArray(record.cart_data) || !record.cart_data.length) warnings.push('Rincian layanan pada invoice belum tercatat.');
  let status = voided ? 'void' : !eligible || total === null || refund === null ? 'review' : refund > 0 ? 'refunded' : 'paid';
  const statusLabel = status === 'refunded' ? net === 0 ? 'Refund penuh' : 'Refund sebagian' : statusText[status];
  return { id: record.id, outletId: record.outlet_id, customerId, reference: receiptIdentity(record), date: date(record.date) ? record.date : null,
    dateLabel: customerHistoryDateLabel(record.date), time: text(record.time), status, statusLabel, sourceStatus, total,
    paid: voided ? 0 : eligible ? total : null, refund, net, method: text(record.method), cashier: text(record.cashier), details,
    subtotal: amount(record.subtotal), discount: amount(record.discount), tax: amount(record.tax), service: amount(record.service),
    surcharge: amount(record.payment_surcharge), mdr: amount(record.mdr_fee), warnings, record };
}

function eventDate(record, timeZone) {
  if (date(record.date)) return { date: record.date, time: text(record.time) };
  if (typeof record.created_at !== 'string' || !Number.isFinite(Date.parse(record.created_at))) return { date: null, time: '' };
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(record.created_at));
  const value = key => parts.find(part => part.type === key)?.value;
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}.${value('minute')}` };
}

function groupEvents(snapshot, records, timeZone) {
  const ids = new Set(records.map(row => row.id)), events = [], seen = new Set();
  for (const record of snapshot.refunds || []) {
    if (!ids.has(record.sale_id)) continue;
    const key = `refund:${record.id}`;
    if (seen.has(key)) continue; seen.add(key);
    // The refund writer uses this exact log ID for the same operation. Merge
    // its explanation rather than showing one refund twice in the timeline.
    const log = (snapshot.logs || []).find(log => log.id === `VOID-RF-${record.id}` && log.sale_id === record.sale_id);
    if (log) seen.add(`log:${log.id}`);
    events.push({ id: key, type: 'refund', label: 'Refund', ...eventDate(log || record, timeZone), amount: amount(record.amount),
      reason: text(log?.reason || record.reason), staffName: text(log?.authorizer_name || log?.cashier_name || record.authorizer_name || record.cashier_name), saleId: record.sale_id,
      returnStock: record.return_stock === true, lines: Array.isArray(record.lines) ? structuredClone(record.lines) : [] });
  }
  for (const record of snapshot.logs || []) {
    if (!ids.has(record.sale_id) && !ids.has(record.order_id)) continue;
    const key = `log:${record.id}`;
    if (seen.has(key)) continue; seen.add(key);
    events.push({ id: key, type: 'log', label: 'Catatan VOID / refund', ...eventDate(record, timeZone), amount: amount(record.total_amount),
      reason: text(record.reason), staffName: text(record.authorizer_name || record.cashier_name), saleId: text(record.sale_id), itemName: text(record.item_name) });
  }
  return events.sort((a, b) => `${b.date || ''} ${b.time} ${b.id}`.localeCompare(`${a.date || ''} ${a.time} ${a.id}`));
}

function summaries(visits, complete) {
  const known = Object.fromEntries(['billed', 'paid', 'refund', 'net', 'remaining'].map(key => [key, sumKnown(visits.map(visit => visit.amounts[key]))]));
  const completed = visits.filter(visit => visit.invoices.some(invoice => paidStatuses.has(invoice.sourceStatus)) || visit.orders.some(order => text(order.status).toLowerCase() === 'paid'));
  const unknownVisitCount = completed.filter(visit => !visit.groupingVerified).length;
  const knownLastVisitDate = completed.filter(visit => visit.groupingVerified).map(visit => visit.date).filter(date).sort().at(-1) || null;
  const lastTransactionDate = visits.flatMap(visit => visit.invoices.filter(invoice => paidStatuses.has(invoice.sourceStatus)).map(invoice => invoice.date)).filter(date).sort().at(-1) || null;
  return { ...known, ...(complete ? {} : Object.fromEntries(Object.keys(known).map(key => [key, null]))), known,
    visitCount: !complete || unknownVisitCount ? null : completed.length, knownVisitCount: completed.filter(visit => visit.groupingVerified).length,
    unknownVisitCount, lastVisitDate: complete && !unknownVisitCount ? knownLastVisitDate : null, knownLastVisitDate,
    lastTransactionDate: complete ? lastTransactionDate : null, receiptCount: visits.reduce((sum, visit) => sum + visit.invoices.length, 0),
    pendingCount: visits.filter(visit => ['unpaid', 'partial'].includes(visit.status)).length, voidCount: visits.filter(visit => visit.status === 'void').length,
    complete, visitCountNote: unknownVisitCount ? 'Sebagian invoice tidak memiliki identitas order atau kunjungan yang lengkap. Jumlah dan tanggal kunjungan fisik belum dapat dipastikan; jumlah invoice serta nilai pembayaran tetap mengikuti catatan yang tersimpan.' : 'Satu order atau checkout yang teridentifikasi dihitung satu kunjungan; beberapa invoice pembayaran pada order yang sama tidak dihitung berulang.' };
}

/** A complete customer-ID scoped snapshot; no current product/staff data needed. */
export function buildCustomerHistoryModel(input, filters = {}) {
  scope(input);
  const snapshot = structuredClone(input), { sales, orders } = matchingRecords(snapshot), customerId = snapshot.customer.id;
  const timeZone = snapshot.timeZone || snapshot.outlet?.timezone || snapshot.outlet?.time_zone || 'Asia/Makassar';
  try { new Intl.DateTimeFormat('id-ID', { timeZone }).format(new Date()); } catch { throw new TypeError('Zona waktu riwayat pelanggan tidak valid.'); }
  const entries = [...sales.map(record => ({ key: `sale:${record.id}`, type: 'sale', record })), ...orders.map(record => ({ key: `order:${record.id}`, type: 'order', record }))];
  const parents = new Map(entries.map(entry => [entry.key, entry.key])), anchors = new Map(), details = new Map();
  const root = key => { let next = key; while (parents.get(next) !== next) next = parents.get(next); return next; };
  const join = (a, b) => { const one = root(a), two = root(b); if (one !== two) parents.set(two, one); };
  const anchor = (name, key) => { if (anchors.has(name)) join(anchors.get(name), key); else anchors.set(name, key); };
  const references = new Map();
  for (const entry of entries) {
    const detail = normalizeReceiptDetails(entry.record); details.set(entry.key, detail);
    const reference = orderNumber(entry.record);
    if (reference) { const group = references.get(reference) || []; group.push(entry); references.set(reference, group); }
    if (entry.type === 'order') anchor(`order:${entry.record.id}`, entry.key);
    const orderId = detail.payment?.orderId || (validId(entry.record.order_id) ? entry.record.order_id : validId(entry.record.orderId) ? entry.record.orderId : null);
    if (orderId) anchor(`order:${orderId}`, entry.key);
    const checkoutId = commissionKey(entry.record, detail); if (checkoutId) anchor(`checkout:${checkoutId}`, entry.key);
  }
  for (const group of references.values()) if (group.filter(entry => entry.type === 'order').length <= 1) for (const entry of group.slice(1)) join(group[0].key, entry.key);
  for (const entry of entries) for (const previous of details.get(entry.key).payment?.previousSaleIds || []) if (parents.has(`sale:${previous}`)) join(entry.key, `sale:${previous}`);
  const grouped = new Map();
  for (const entry of entries) { const key = root(entry.key), group = grouped.get(key) || []; group.push(entry); grouped.set(key, group); }
  const visits = [...grouped.values()].map(group => {
    const source = group.map(entry => entry.record), groupOrders = group.filter(entry => entry.type === 'order').map(entry => entry.record);
    const invoices = group.filter(entry => entry.type === 'sale').map(entry => normalizeInvoice(entry.record, snapshot.logs || [], customerId));
    invoices.sort((a, b) => `${a.date || ''} ${a.time} ${a.id}`.localeCompare(`${b.date || ''} ${b.time} ${b.id}`));
    const warnings = invoices.flatMap(invoice => invoice.warnings), archived = groupOrders.filter(order => order._voraHistoryArchived === true),
      pending = groupOrders.filter(order => order._voraHistoryArchived !== true && text(order.status).toLowerCase() === 'unpaid');
    const unpaid = pending.map(order => normalizeUnpaidOrder(order, snapshot.outletId));
    warnings.push(...unpaid.flatMap(order => order.warnings));
    if (pending.length > 1) warnings.push('Beberapa order aktif memiliki hubungan yang sama. Periksa rincian sebelum menyimpulkan sisa tagihan.');
    const invoiceIds = new Set(invoices.map(invoice => invoice.id));
    let groupingVerified = groupOrders.length > 0 || group.some(entry => !!orderNumber(entry.record)
      || !!commissionKey(entry.record, details.get(entry.key)) || !!details.get(entry.key).payment?.orderId
      || validId(entry.record.order_id) || validId(entry.record.orderId));
    for (const entry of group) {
      const detail = details.get(entry.key), core = entry.record.cart_data?.[0]?._voraCommission;
      if (entry.type === 'sale' && detail.adjustments.length && !detail.items.length && !detail.payment?.orderId && !orderNumber(entry.record) && !validId(entry.record.order_id)) groupingVerified = false;
      for (const previous of detail.payment?.previousSaleIds || []) if (!invoiceIds.has(previous)) groupingVerified = false;
      if (core?.progress?.sale_ids?.some?.(id => !invoiceIds.has(id))) groupingVerified = false;
      if (core && !commissionKey(entry.record, detail)) warnings.push('Identitas hubungan pembayaran komisi belum lengkap.');
    }
    if (!groupingVerified) warnings.push('Identitas kunjungan/order pada catatan ini belum lengkap. Struk tidak digabung berdasarkan nama, nomor telepon, atau waktu; jumlah kunjungan fisik tidak disimpulkan dari jumlah invoice.');
    let paid = sumKnown(invoices.map(invoice => invoice.paid)), refund = sumKnown(invoices.map(invoice => invoice.refund)), net = sumKnown(invoices.map(invoice => invoice.net));
    let remaining = pending.length > 1 ? null : unpaid.length ? unpaid[0].remainingTotal : 0;
    if (unpaid.some(order => order.referencedReceiptIds.some(id => !invoiceIds.has(id)))) {
      paid = null; refund = null; net = null; warnings.push('Ada pembayaran order yang belum tersedia pada riwayat pelanggan ini.');
    }
    if (!invoices.length && groupOrders.some(order => text(order.status).toLowerCase() === 'paid')) {
      paid = null; refund = null; net = null; warnings.push('Order ditandai lunas, tetapi invoice pembayarannya belum tersedia. Nilai pembayaran tidak diperkirakan.');
    }
    const voidOnly = !pending.length && invoices.every(invoice => invoice.status === 'void') && groupOrders.every(order => order._voraHistoryArchived === true || voidStatuses.has(text(order.status).toUpperCase()));
    const unknownInvoice = invoices.some(invoice => invoice.status === 'review');
    let status = voidOnly ? 'void' : pending.length ? invoices.length || unpaid.some(order => order.paidPrincipal > 0 || order.paymentState === 'partial') ? 'partial' : 'unpaid'
      : invoices.some(invoice => invoice.status === 'refunded') ? 'refunded' : invoices.length ? 'paid' : 'review';
    if (unknownInvoice || remaining === null || paid === null || !invoices.length && !pending.length && !voidOnly) status = 'review';
    if (archived.length) warnings.push('Snapshot pesanan diambil sebelum penghapusan. Penghapusan pesanan tidak membuktikan pembayaran atau membatalkan invoice yang sudah tercatat.');
    if (archived.length && invoices.some(invoice => invoice.status !== 'void') && !pending.length) status = 'review';
    const openItems = unpaid.flatMap(order => order.items.map(item => ({ ...item, sourceType: 'order', sourceId: order.id, sourceReference: order.reference, remainingOrder: true })));
    let items = invoices.flatMap(invoice => invoice.details.items.map(item => ({ ...item, sourceType: 'sale', sourceId: invoice.id, sourceReference: invoice.reference, remainingOrder: false })));
    if (openItems.length) items.push(...openItems);
    if (!items.length && groupOrders.length) {
      const original = groupOrders.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      items = normalizeReceiptDetails(original).items.map(item => ({ ...item, sourceType: 'order', sourceId: original.id, sourceReference: orderNumber(original) || original.id, remainingOrder: false }));
    }
    const adjustments = invoices.flatMap(invoice => invoice.details.adjustments.map(item => ({ ...item, sourceType: 'sale', sourceId: invoice.id, sourceReference: invoice.reference })));
    const dates = source.map(record => record.date).filter(date).sort(), events = groupEvents(snapshot, source, timeZone);
    const reference = groupOrders.map(orderNumber).find(Boolean) || source.map(orderNumber).find(Boolean)
      || (groupOrders.length ? 'Nomor pesanan belum tersedia' : invoices[0]?.reference || source[0].id);
    const key = groupOrders[0] ? `order:${groupOrders[0].id}` : `sale:${invoices[0]?.id || source[0].id}`;
    const activities = [
      ...source.map(record => ({ date: date(record.date) ? record.date : null, time: text(record.time) })),
      ...source.map(record => eventDate({ created_at: record.updated_at || record.created_at || record.receipt_created_at }, timeZone)),
      ...events, ...archived.map(order => eventDate({ created_at: order._voraHistoryArchivedAt }, timeZone)),
    ].filter(activity => date(activity.date)).sort((a, b) => `${a.date} ${a.time.replace(':', '.')}`.localeCompare(`${b.date} ${b.time.replace(':', '.')}`));
    const lastActivityDate = activities.at(-1)?.date || null, lastActivityTime = activities.at(-1)?.time || '';
    const verifiedVoid = archived.some(order => order._voraHistoryVoidVerified === true) || groupOrders.some(order => voidStatuses.has(text(order.status).toUpperCase()));
    return { id: key, outletId: snapshot.outletId, customerId, reference, date: dates[0] || null, dateLabel: customerHistoryDateLabel(dates[0]),
      time: invoices[0]?.time || '', lastActivityDate, lastActivityTime, status, statusLabel: archived.length && !verifiedVoid ? invoices.some(invoice => invoice.status !== 'void') ? 'Pesanan dihapus · pembayaran tercatat' : 'Pesanan dihapus' : status === 'refunded' && net === 0 ? 'Refund penuh' : statusText[status],
      invoices, orders: groupOrders, items, adjustments, events, groupingVerified,
      archived: archived.length > 0, archivedQuotedRemaining: sumKnown(archived.map(order => amount(order.total))),
      amounts: { billed: sumKnown([paid, remaining]), paid, refund, net, remaining },
      servedBy: unique(items.map(item => item.servedBy)).join('; '), methods: unique(invoices.map(invoice => invoice.method)),
      orderNotes: unique(source.map(record => normalizeReceiptDetails(record).orderNote)), warnings: unique(warnings) };
  }).sort((a, b) => `${b.lastActivityDate || ''} ${b.lastActivityTime.replace(':', '.')} ${b.id}`.localeCompare(`${a.lastActivityDate || ''} ${a.lastActivityTime.replace(':', '.')} ${a.id}`));
  const complete = snapshot.complete === true;
  const warnings = unique([...(snapshot.warnings || []).filter(value => typeof value === 'string'), ...visits.flatMap(visit => visit.warnings),
    ...(!complete ? ['Riwayat belum selesai dimuat. Ringkasan seluruh riwayat belum dapat ditampilkan.'] : [])]);
  const model = { outletId: snapshot.outletId, customerId, customer: { ...snapshot.customer, archived: !!snapshot.customer.deleted_at,
    priceGroupName: text(snapshot.priceGroup?.name || snapshot.customer.priceGroupName || snapshot.customer.price_group_name) },
    priceGroup: snapshot.priceGroup || null, loadedAt: text(snapshot.loadedAt), timeZone, complete, warnings, visits,
    summary: summaries(visits, complete), report: { outletId: snapshot.outletId, logs: snapshot.logs || [], sales },
    notes: Array.isArray(snapshot.notes) ? snapshot.notes : [] };
  return filterCustomerHistoryModel(model, filters);
}

export function filterCustomerHistoryModel(model, { query = '', search, status = 'all', dateFrom = '', dateUntil = '', page = 1, pageSize = 10 } = {}) {
  if (!validId(model?.outletId) || !validId(model?.customerId) || !Array.isArray(model.visits)) throw new TypeError('Riwayat pelanggan tidak valid.');
  if (!CUSTOMER_HISTORY_STATUSES.includes(status) || dateFrom && !date(dateFrom) || dateUntil && !date(dateUntil) || dateFrom && dateUntil && dateFrom > dateUntil) throw new TypeError('Pilih filter riwayat yang valid.');
  const needle = normalize(search ?? query).trim();
  const statusMatches = visit => status === 'all' || visit.status === status
    || status === 'refunded' && visit.invoices.some(invoice => invoice.status === 'refunded' || ['PARTIAL_REFUND', 'REFUNDED'].includes(invoice.sourceStatus))
    || status === 'void' && (visit.archived || visit.invoices.some(invoice => invoice.status === 'void'));
  const filteredVisits = model.visits.filter(visit => statusMatches(visit)
    && (!dateFrom || visit.date && visit.date >= dateFrom) && (!dateUntil || visit.date && visit.date <= dateUntil)
    && (!needle || normalize([visit.reference, visit.date, visit.dateLabel, visit.statusLabel, visit.servedBy, ...visit.methods, ...visit.orderNotes,
      ...visit.invoices.flatMap(invoice => [invoice.reference, invoice.cashier]), ...visit.items.flatMap(item => [item.name, item.note, item.servedBy, ...item.extras.map(extra => extra.name)])].join(' ')).includes(needle)));
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 10;
  const pageCount = Math.max(1, Math.ceil(filteredVisits.length / size)), currentPage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, pageCount) : 1;
  return { ...model, filteredVisits, rows: filteredVisits.slice((currentPage - 1) * size, currentPage * size), filteredCount: filteredVisits.length,
    totalCount: model.visits.length, page: currentPage, pageSize: size, pageCount, query: String(search ?? query), status, dateFrom, dateUntil,
    filteredSummary: summaries(filteredVisits, model.complete) };
}

const exportScalar = value => {
  if (value == null) return '—';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('Angka ekspor riwayat tidak valid.'); return value; }
  if (!['string', 'boolean'].includes(typeof value)) throw new TypeError('Nilai ekspor riwayat tidak valid.');
  const result = String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
  if (result.length > 32767) throw new TypeError('Teks catatan terlalu panjang untuk satu sel Excel. Isi tidak dipotong.');
  return result;
};
const section = (key, name, headers, rows, money = []) => ({ key, name, headers, rows: rows.map(row => row.map(exportScalar)), moneyColumns: headers.map((_, index) => money.includes(index)) });

/** Scalar capture before asynchronous XLSX engine loading. Notes tab is private
 * and is intentionally not included in the ordinary purchase-history export. */
export function customerHistoryExportModel({ model, outlet, generatedAt = new Date().toISOString(), timeZone = model?.timeZone } = {}) {
  if (!model?.complete || !outlet?.id || model.outletId !== outlet.id || model.customer?.outlet_id !== outlet.id || model.customer?.id !== model.customerId
      || !Array.isArray(model.filteredVisits)) throw new TypeError('Muat seluruh riwayat pelanggan sebelum mengekspor.');
  const visits = model.filteredVisits;
  if (visits.some(visit => visit.outletId !== outlet.id || visit.customerId !== model.customerId || visit.invoices.some(invoice => invoice.outletId !== outlet.id || invoice.customerId !== model.customerId || invoice.record?.outlet_id !== outlet.id)
      || visit.orders.some(order => order.outlet_id !== outlet.id))) throw new TypeError('Data ekspor tidak sesuai pelanggan dan outlet.');
  if (visits.length > CUSTOMER_HISTORY_EXPORT_LIMIT) throw new TypeError('Riwayat melebihi 50.000 kunjungan. Gunakan filter tanggal; ekspor tidak dipotong.');
  const generated = new Date(generatedAt); if (!Number.isFinite(generated.getTime())) throw new TypeError('Waktu pembuatan ekspor tidak valid.');
  let generatedLabel;
  try {
    const local = eventDate({ created_at: generated.toISOString() }, timeZone);
    generatedLabel = `${customerHistoryDateLabel(local.date)} · ${new Intl.DateTimeFormat('id-ID', { timeZone, timeStyle: 'medium', hourCycle: 'h23' }).format(generated)}`;
  }
  catch { throw new TypeError('Zona waktu ekspor tidak valid.'); }
  const summary = model.filteredSummary, customer = model.customer;
  const visitRows = visits.map(visit => [visit.reference, customerHistoryDateLabel(visit.date), visit.time, visit.statusLabel, visit.invoices.length, visit.servedBy, visit.methods.join(', '),
    visit.amounts.billed, visit.amounts.paid, visit.amounts.refund, visit.amounts.net, visit.amounts.remaining, visit.orderNotes.join('\n'), visit.warnings.join('\n')]);
  const invoices = visits.flatMap(visit => visit.invoices.map(invoice => [visit.reference, invoice.reference, invoice.id, invoice.dateLabel, invoice.time, invoice.statusLabel, invoice.method, invoice.cashier,
    invoice.subtotal, invoice.discount, invoice.tax, invoice.service, invoice.surcharge, invoice.total, invoice.refund, invoice.net, invoice.details.orderNote, invoice.warnings.join('\n')]));
  const items = visits.flatMap(visit => [...visit.items.map(item => ({ ...item, kind: 'Produk / layanan' })), ...visit.adjustments.map(item => ({ ...item, kind: 'Pembayaran / penyesuaian' }))].map(item => [visit.reference,
    item.sourceReference, item.sourceId, item.kind, item.index + 1, item.name, item.category || '', item.sku || '', item.unit || '', item.qty,
    item.refundedQty, item.remainingQty, item.price, item.total, item.servedBy || '', item.note || '',
    item.extras?.map(extra => `${extra.group ? `${extra.group}: ` : ''}${extra.name}${extra.price === null ? '' : ` (Rp ${extra.price})`}`).join('\n') || '',
    item.pricing?.groupName || '', item.pricing?.normalPrice, item.pricing?.referencePrice, item.pricing?.negotiatedPrice ?? item.pricing?.negotiated,
    item.remainingOrder ? 'Layanan pada order yang belum lunas' : 'Snapshot tersimpan']));
  const events = visits.flatMap(visit => visit.events.map(event => [visit.reference, event.label, customerHistoryDateLabel(event.date), event.time, event.saleId, event.amount, event.reason, event.staffName, event.itemName || '']));
  if ([invoices, items, events].some(rows => rows.length > CUSTOMER_HISTORY_EXPORT_LIMIT)) throw new TypeError('Rincian riwayat melebihi 50.000 baris. Gunakan filter tanggal; ekspor tidak dipotong.');
  const sections = [
    section('summary', 'Ringkasan', ['Informasi', 'Nilai'], [['Nama pelanggan', customer.name], ['Nomor HP', customer.phone], ['ID pelanggan', customer.id], ['Grup harga', customer.priceGroupName], ['Kunjungan teridentifikasi', summary.visitCount],
      ['Kunjungan terakhir', customerHistoryDateLabel(summary.lastVisitDate)], ['Jumlah invoice', summary.receiptCount], ['Nilai tagihan tercatat', summary.billed], ['Sudah dibayar', summary.paid], ['Refund', summary.refund], ['Belanja bersih', summary.net], ['Sisa tagihan', summary.remaining], ['Invoice terakhir', customerHistoryDateLabel(summary.lastTransactionDate)]], [1]),
    section('visits', 'Kunjungan', ['No. order / referensi','Tanggal kunjungan','Waktu','Status','Jumlah invoice','Staf pelaksana','Metode pembayaran','Tagihan tercatat','Sudah dibayar','Refund','Belanja bersih','Sisa tagihan','Catatan pesanan','Keterangan'], visitRows, [7,8,9,10,11]),
    section('invoices', 'Invoice', ['No. order / referensi','No. invoice','ID transaksi','Tanggal invoice','Waktu','Status','Metode pembayaran','Kasir','Subtotal','Diskon','Pajak','Layanan','Biaya pembayaran pelanggan','Total invoice','Refund','Penerimaan bersih','Catatan pesanan','Keterangan'], invoices, [8,9,10,11,12,13,14,15]),
    section('items', 'Layanan dan produk', ['No. order / referensi','Struk / order sumber','ID sumber','Jenis baris','Baris sumber','Produk / layanan','Kategori','SKU','Satuan','Qty tersimpan','Qty refund','Qty tersisa','Harga / item','Nilai item','Staf pelaksana','Catatan item','Ekstra tercatat','Grup harga','Harga normal tercatat','Harga referensi nego','Harga nego tercatat','Asal rincian'], items, [12,13,18,19,20]),
    section('events', 'Refund dan VOID', ['No. order / referensi','Jenis catatan','Tanggal catatan','Waktu','Struk / order asal','Nominal tercatat','Alasan / catatan','Staf tercatat','Produk terkait'], events, [5]),
  ];
  // Counts remain numeric counts; only these summary rows are rupiah values.
  sections[0].moneyColumns = [false, false]; sections[0].moneyRows = [7, 8, 9, 10, 11];
  return { title: 'Riwayat layanan pelanggan', outletId: outlet.id, outletName: text(outlet.businessName || outlet.name), customerId: customer.id,
    customerName: text(customer.name), customerPhone: text(customer.phone), timeZone, generatedAt: generated.toISOString(), generatedLabel,
    filterLabel: [model.dateFrom ? `Dari ${customerHistoryDateLabel(model.dateFrom)}` : 'Sejak awal', model.dateUntil ? `Sampai ${customerHistoryDateLabel(model.dateUntil)}` : 'Hingga terbaru',
      model.status === 'all' ? 'Semua status' : statusText[model.status], model.query ? `Pencarian: ${model.query}` : ''].filter(Boolean).join(' · '),
    count: visits.length, sections, notes: ['Seluruh riwayat sesuai filter disertakan; halaman layar tidak membatasi ekspor.', 'Data dashboard mencakup transaksi yang sudah diterima server. Transaksi offline akan tampil setelah tersinkron.',
      'Nilai belanja mengikuti pembayaran invoice dikurangi refund. Order belum dibayar tidak menambah penerimaan. VOID tidak menambah belanja.',
      'Harga item sudah termasuk ekstra. Nilai item dan penyesuaian pembayaran bukan tambahan penerimaan.',
      'Catatan pelanggan umum tidak disertakan dalam ekspor riwayat pembelian ini.', summary.visitCountNote,
      '— berarti data tidak tersedia atau tidak berlaku; bukan angka nol.', ...model.warnings] };
}

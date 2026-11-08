import { isImportedHistory, readImportedHistory, receiptLineTotal, importedRefundAmount } from '/dashboard-lib-importedHistory.js';
import { remainingLineQty } from '/dashboard-lib-refundReports.js';

// Presentation only. Every field comes from this saved receipt, never today's
// product catalog, staff roster, commission assignments or an original order.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
const firstText = (...values) => values.find(value => typeof value === 'string' && value.trim()) || '';
const number = value => (typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const money = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e12;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 250;

function savedPayment(sale, cart) {
  const envelope = cart[0]?._voraCommission, payment = envelope?.payment;
  if (!object(envelope) || envelope.version !== 1 || !id(sale.outlet_id) || envelope.outlet_id !== sale.outlet_id
      || !object(payment) || !['full', 'item', 'nominal'].includes(payment.mode)
      || payment.order_id !== null && !id(payment.order_id)
      || !money(payment.principal) || !money(payment.order_total) || payment.principal > payment.order_total
      || !Array.isArray(payment.previous_sale_ids) || !payment.previous_sale_ids.every(id)
      || new Set(payment.previous_sale_ids).size !== payment.previous_sale_ids.length
      || payment.previous_sale_ids.includes(sale.id)) return null;
  return { mode: payment.mode, orderId: payment.order_id, principal: payment.principal,
    orderTotal: payment.order_total, previousSaleIds: [...payment.previous_sale_ids] };
}

function savedPricing(item) {
  const group = item._voraPrice, negotiation = item._voraNegotiation;
  const validGroup = object(group) && group.version === 1 && money(group.normalPrice)
    && (group.priceGroupName == null || typeof group.priceGroupName === 'string')
    && (group.priceGroupId == null || typeof group.priceGroupId === 'string');
  const validNegotiation = object(negotiation) && negotiation.version === 1
    && id(item.id) && negotiation.productId === item.id
    && [negotiation.referencePrice, negotiation.minimumPrice, negotiation.negotiatedPrice].every(money)
    && typeof negotiation.maxPercent === 'number' && Number.isFinite(negotiation.maxPercent)
    && negotiation.maxPercent >= 0 && negotiation.maxPercent <= 100
    && negotiation.minimumPrice <= negotiation.negotiatedPrice && negotiation.negotiatedPrice <= negotiation.referencePrice
    && (item.basePrice == null || number(item.basePrice) === negotiation.negotiatedPrice);
  return { groupName: validGroup ? text(group.priceGroupName) : '', normalPrice: validGroup ? group.normalPrice : null,
    negotiated: validNegotiation ? negotiation.negotiatedPrice : null,
    negotiatedPrice: validNegotiation ? negotiation.negotiatedPrice : null,
    referencePrice: validNegotiation ? negotiation.referencePrice : null,
    minimumPrice: validNegotiation ? negotiation.minimumPrice : null,
    maxPercent: validNegotiation ? negotiation.maxPercent : null };
}

export function normalizeReceiptDetails(value) {
  const sale = object(value) ? value : {};
  const rawCart = sale.cart_data ?? sale.cartData;
  const cart = Array.isArray(rawCart) ? rawCart : [];
  const imported = isImportedHistory(sale), validImport = !!readImportedHistory(sale);
  const structuredRefund = Number(sale.refund_revision) > 0 && object(sale.refunded_quantities);
  const refundSignal = ['PARTIAL_REFUND', 'REFUNDED'].includes(sale.status)
    || Number(sale.refunded_amount) > 0 || sale.refund_requires_review === true;
  const refundQuantitiesKnown = imported ? importedRefundAmount(sale) === 0
    : structuredRefund || sale.status === 'REFUNDED' && !Number(sale.refund_revision)
      || !refundSignal;
  const payment = savedPayment(sale, cart), items = [], adjustments = [];
  cart.forEach((item, index) => {
    if (!object(item)) return;
    const qty = number(item.qty), price = number(item.price);
    const remaining = refundQuantitiesKnown && qty !== null && qty >= 0 ? number(remainingLineQty(sale, index)) : null;
    const remainingQty = remaining !== null && remaining >= 0 && remaining <= qty ? remaining : null;
    const servedBy = imported
      ? validImport && Array.isArray(item._voraMigrationLine?.servedBy)
        ? item._voraMigrationLine.servedBy.map(person => text(person?.name)).filter(name => name.trim()).join(', ') : ''
      : text(item.servedBy);
    const total = imported ? receiptLineTotal(sale, item)
      : qty === null || price === null ? null : number(receiptLineTotal(sale, item));
    const line = { index, key: `${index}:${firstText(item._voraCommissionLineId, item.cartItemId) || 'line'}`,
      name: text(item.name), category: text(item.category), sku: text(item.sku),
      unit: validImport ? firstText(item._voraMigrationLine?.unit, item.unit) : text(item.unit),
      qty, price, total, servedBy, note: firstText(item.note, item.notes),
      extras: (Array.isArray(item.selectedExtrasList) ? item.selectedExtrasList : []).filter(object)
        .map(extra => ({ name: text(extra.name), group: text(extra.group), price: number(extra.price) })),
      pricing: savedPricing(item), remainingQty, refundedQty: remainingQty === null ? null : qty - remainingQty };
    (item.isPayment === true ? adjustments : items).push(line);
  });
  const customer = object(sale.customer) ? sale.customer : {};
  return { orderNote: firstText(sale.note, sale.notes, sale.order_note),
    orderReference: firstText(sale.order_id, sale.orderId, payment?.orderId),
    requester: firstText(sale.server, sale.server_name),
    customer: { name: text(customer.name), phone: text(customer.phone), address: text(customer.address) },
    items, adjustments, payment, servedBy: [...new Set(items.map(item => item.servedBy).filter(name => name.trim()))].join('; ') };
}

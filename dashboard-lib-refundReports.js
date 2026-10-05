/** Refund reporting follows the date of the original sale (net-sales basis).
 * Structured aggregates are authoritative, including while queued offline.
 * Legacy partials use all distinct logs; missing legacy amounts stay unknown.
 */
export function refundAmount(sale, logs = []) {
  const total = Math.max(0, Number(sale.total) || 0);
  if (Number(sale.refund_revision) > 0) return Math.min(total, Math.max(0, Number(sale.refunded_amount) || 0));
  if (sale.status === 'REFUNDED') return total;
  if (sale.refund_requires_review) return null;
  if (sale.status !== 'PARTIAL_REFUND') return 0;
  const unique = new Map(logs.filter(log => log.sale_id === sale.id).map(log => [log.id, log]));
  if (!unique.size) return null;
  return Math.min(total, [...unique.values()].reduce((sum, log) => sum + Math.max(0, Number(log.total_amount) || 0), 0));
}
export function netSaleAmount(sale, logs = []) {
  const refund = refundAmount(sale, logs);
  return refund === null ? null : Math.max(0, Number(sale.total) - refund);
}
export function remainingLineQty(sale, index, stockOnly = false) {
  const item = (sale.cart_data ?? sale.cartData ?? [])[index];
  if (!item) return 0;
  const quantities = stockOnly ? sale.refunded_stock_quantities : sale.refunded_quantities;
  const legacyFull = !Number(sale.refund_revision) && sale.status === 'REFUNDED';
  return legacyFull ? 0 : Math.max(0, Number(item.qty) - Number(quantities?.[index] ?? 0));
}

// Refunds with a cash-flow entry leave that entry's shift, not the sale's shift.
// Add back only the already-recorded cash refund to avoid subtracting it twice.
export function shiftSaleReceipts(sale, logs = []) {
  const net = netSaleAmount(sale, logs);
  return net === null ? null : net + (sale.method === 'TUNAI' ? Number(sale.refund_cash_flow_amount || 0) : 0);
}

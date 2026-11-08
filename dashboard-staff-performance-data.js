import { loadReport, validateRange } from '/dashboard-data.js';
import { loadCommissionReport } from '/dashboard-commissions-data.js';
import { staffPerformanceModel } from '/dashboard-staff-performance-model.js';

// Use the existing owner-scoped, paginated readers. A failed commission read
// must not turn into a zero commission or hide the saved service work.
export async function loadStaffPerformance(client, user, outlet, range, features, signal) {
  const selectedRange = { ...validateRange(range) };
  const access = features?.pilot_enabled === true && features?.staff_commissions === true
    ? 'allowed' : features?.tier === 'starter' ? 'upgrade' : 'unavailable';
  const commission = access === 'allowed'
    ? loadCommissionReport(client, user, outlet, selectedRange, signal)
      .then(report => ({ report, status: 'available' }))
      .catch(error => {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        return { report: null, status: 'error' };
      })
    : Promise.resolve({ report: null, status: access === 'upgrade' ? 'upgrade' : 'unavailable' });
  const [report, ledger] = await Promise.all([
    loadReport(client, user?.id, outlet, selectedRange, signal), commission,
  ]);
  if (signal?.aborted) throw new DOMException('Dibatalkan', 'AbortError');
  return staffPerformanceModel({ report, commissionReport: ledger.report,
    commissionStatus: ledger.status, outlet, range: selectedRange });
}

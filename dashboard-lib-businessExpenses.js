export const EXPENSE_CATEGORIES = [
  { id: 'salary', label: 'Gaji & tunjangan' }, { id: 'rent', label: 'Sewa tempat' },
  { id: 'utilities', label: 'Listrik & air' }, { id: 'internet', label: 'Internet & telepon' },
  { id: 'transport', label: 'Transportasi' }, { id: 'maintenance', label: 'Perawatan & kebersihan' },
  { id: 'marketing', label: 'Pemasaran' }, { id: 'other', label: 'Biaya usaha lainnya' },
];
export const EXPENSE_SOURCES = [
  { id: 'drawer', label: 'Kas laci' }, { id: 'bank', label: 'Rekening usaha' }, { id: 'owner', label: 'Dana pribadi owner' },
];
const prefix = /^\[VORA-BIAYA:v1:(\d{4}-\d{2}-\d{2}):([a-z]+)\] (.+)$/s;
export function encodeExpense(category, date, description) {
  if (!EXPENSE_CATEGORIES.some(c => c.id === category) || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !description.trim() || description.trim().length > 300) throw new Error('Lengkapi kategori dan keterangan biaya (maksimal 300 karakter).');
  return `[VORA-BIAYA:v1:${date}:${category}] ${description.trim()}`;
}
export function readExpense(row) {
  if (row.funding_source) {
    const category = EXPENSE_CATEGORIES.find(c => c.id === row.category);
    const source = EXPENSE_SOURCES.find(s => s.id === row.funding_source);
    if (!category || !source || !/^\d{4}-\d{2}-\d{2}$/.test(row.business_date)
      || !Number.isSafeInteger(Number(row.amount)) || Number(row.amount) <= 0) return null;
    return { id: row.id, date: row.business_date, category: category.id, label: category.label,
      description: row.description, amount: Number(row.amount) * (row.reverses_id ? -1 : 1),
      staff: row.staff_name, source: source.label, reversal: !!row.reverses_id, record: row };
  }
  if (row.type !== 'OUT' || row.refund_id || !Number.isSafeInteger(Number(row.amount)) || Number(row.amount) <= 0) return null;
  const match = String(row.description || '').match(prefix);
  const category = match && EXPENSE_CATEGORIES.find(c => c.id === match[2]);
  return category ? { id: row.id, date: match[1], category: category.id, label: category.label,
    description: match[3], amount: Number(row.amount), staff: row.staff_name, source: 'Kas laci', legacy: true } : null;
}
export function cashFlowDescription(row) {
  const expense = readExpense(row);
  return expense ? `${expense.label} · ${expense.description}` : row.description;
}
export function summarizeExpenses(rows, outletId, range) {
  const reversed = new Set(rows.filter(row => row.outlet_id === outletId).map(row => row.reverses_id).filter(Boolean));
  const expenses = [...new Map(rows.filter(row => row.outlet_id === outletId).map(row => [row.id, row])).values()]
    .map(readExpense).filter(row => row && row.date >= range.start && row.date <= range.end)
    .map(row => ({...row, reversed: reversed.has(row.id)}))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return { expenses, total: expenses.reduce((sum, row) => sum + row.amount, 0),
    categories: EXPENSE_CATEGORIES.map(c => ({ ...c, amount: expenses.filter(e => e.category === c.id).reduce((sum, e) => sum + e.amount, 0) })) };
}

export async function fetchExpenseLedger(client, outletId, range, cancelled = () => false) {
  if (!outletId) throw new Error('Outlet belum tersedia.');
  const rows = []; let cursor;
  while (!cancelled()) {
    let q = client.from('vora_operating_expenses').select('*').eq('outlet_id', outletId)
      .gte('business_date', range.start).lte('business_date', range.end).order('id').limit(500);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (cancelled()) throw new Error('Laporan dibatalkan.');
    if (error) throw error;
    if (!Array.isArray(data) || data.some(row => row.outlet_id !== outletId)) throw new Error('Data biaya tidak sesuai outlet.');
    rows.push(...data);
    if (data.length < 500) return rows;
    const next = data[data.length - 1].id;
    if (!next || next === cursor) throw new Error('Halaman biaya tidak dapat dilanjutkan.');
    cursor = next;
  }
  throw new Error('Laporan dibatalkan.');
}

export async function fetchReportExpenses(client, outletId, range, cancelled = () => false) {
  if (!outletId) throw new Error('Outlet belum tersedia.');
  // Envelope covers every UTC offset; the stored business date determines inclusion.
  const start = new Date(Date.parse(`${range.start}T00:00:00Z`) - 14 * 3600000).toISOString();
  const end = new Date(Date.parse(`${range.end}T00:00:00Z`) + 38 * 3600000).toISOString();
  const rows = []; let cursor;
  while (!cancelled()) {
    let q = client.from('cash_flows').select('*').eq('outlet_id', outletId).eq('type', 'OUT')
      .gte('created_at', start).lt('created_at', end).order('id').limit(500);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (cancelled()) throw new Error('Laporan dibatalkan.');
    if (error) throw error;
    if (!Array.isArray(data) || data.some(row => row.outlet_id !== outletId)) throw new Error('Data biaya tidak sesuai outlet.');
    rows.push(...data);
    if (data.length < 500) return rows;
    const next = data[data.length - 1].id;
    if (!next || next === cursor) throw new Error('Halaman biaya tidak dapat dilanjutkan.');
    cursor = next;
  }
  throw new Error('Laporan dibatalkan.');
}

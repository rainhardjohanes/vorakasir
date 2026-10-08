export const STATUS = {
  unverified: 'Belum verifikasi',
  onboarding: 'Belum buat outlet',
  trial: 'Masa trial',
  expired: 'Sudah berakhir',
  active: 'Berlangganan'
};
export const OUTCOME = {
  contacted: 'Sudah dihubungi',
  interested: 'Tertarik',
  no_response: 'Belum merespons',
  declined: 'Belum berminat',
  paid: 'Sudah membayar'
};
export const ROLES = {
  viewer: 'Lihat pengguna',
  renewal: 'Perpanjangan saja',
  sales: 'Pengguna & follow-up',
  manager: 'Pengguna, follow-up & perpanjangan',
  owner: 'Pemilik'
};
export const ROLE_HELP = {
  viewer: 'Melihat data dan detail pengguna.',
  renewal: 'Melihat daftar outlet terbatas dan memperpanjang langganan. Tanpa kontak pengguna.',
  sales: 'Melihat data pengguna dan mencatat follow-up.',
  manager: 'Melihat data pengguna, mencatat follow-up, dan memperpanjang langganan.'
};
export const PLANS = {
  1: 99000,
  12: 799000,
  24: 1499000
};
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[char]);
export const money = value => new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
}).format(Number(value) || 0);
export function date(value, time = false) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(+d) ? '—' : new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(time ? {
      hour: '2-digit',
      minute: '2-digit'
    } : {})
  }).format(d);
}
export function remaining(value, status) {
  if (status === 'unverified') return 'Belum dimulai';
  if (status === 'onboarding') return 'Belum ada outlet';
  if (value === null || value === undefined) return '—';
  const days = Math.max(0, Math.ceil(Number(value)));
  return days > 0 ? `${days} hari lagi` : 'Berakhir';
}
// Directory days_remaining is based on outlet access, which can differ from
// the original seven-day trial entitlement after migration or extension.
export function customerExpiry(customer) {
  const outlets = Array.isArray(customer.outlets) ? customer.outlets : [];
  if (!(Number(customer.outlet_count) > 0 || outlets.length)) return customer.trial_end_date || null;
  if (customer.subscription_end_date) return customer.subscription_end_date;
  return outlets.reduce((latest, outlet) => {
    const expiry = outlet.subscription_end_date;
    if (!expiry || !Number.isFinite(+new Date(expiry))) return latest;
    return !latest || +new Date(expiry) > +new Date(latest) ? expiry : latest;
  }, null);
}
export function whatsapp(phone) {
  let p = String(phone ?? '').replace(/[^0-9]/g, '');
  if (p.startsWith('0')) p = '62' + p.slice(1);
  if (p.length < 8 || p.length > 15) return null;
  return `https://wa.me/${p}`;
}
export function addCalendarMonths(start, months) {
  const d = new Date(start);
  if (Number.isNaN(+d) || ![1, 12, 24].includes(Number(months))) return null;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, end));
  return d.toISOString();
}
export function renewalPreview(outlet, months, serverNow) {
  const now = new Date(serverNow || Date.now());
  const old = new Date(outlet.subscription_end_date || 0);
  return addCalendarMonths(+old > +now ? old : now, Number(months));
}
export function renewalPayload(values, operationId) {
  const months = Number(values.months),
    amount = Number(values.amount);
  if (![1, 12, 24].includes(months)) throw new Error('Pilih durasi perpanjangan.');
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 999999999999) throw new Error('Nominal harus berupa Rupiah bulat lebih dari nol.');
  const reference = String(values.reference || '').trim(),
    note = String(values.note || '').trim();
  if (!reference || reference.length > 160) throw new Error('Isi referensi pembayaran, maksimal 160 karakter.');
  if (note.length > 2000) throw new Error('Catatan maksimal 2.000 karakter.');
  return {
    p_operation_id: operationId,
    p_outlet_id: values.outlet,
    p_months: months,
    p_amount_idr: amount,
    p_payment_reference: reference,
    p_note: note
  };
}
export function allowedPages(permissions) {
  return ['overview', ...(permissions.read_customers ? ['users', 'followups'] : []), ...(permissions.renew ? ['renewals'] : []), ...(permissions.manage_members ? ['team'] : []), ...(permissions.read_audit ? ['audit'] : [])];
}
export function humanError(error) {
  const code = error?.code;
  if (['42501', 'PGRST301', 'PGRST302'].includes(code)) return 'Akses CRM tidak tersedia untuk akun ini. Hubungi pemilik CRM atau masuk kembali.';
  if (code === 'invalid_credentials') return 'Email atau kata sandi belum sesuai.';
  if (code === 'email_not_confirmed') return 'Verifikasi email Anda terlebih dahulu.';
  if (code === 'over_email_send_rate_limit') return 'Tunggu sebentar sebelum meminta kode email lagi.';
  if (code === '23505') return 'Data tersebut sudah tersimpan. Muat ulang untuk memeriksa hasilnya.';
  if (code === 'PGRST202' || code === '42883') return 'Layanan CRM belum siap. Hubungi pemilik CRM.';
  if (error instanceof TypeError || /fetch|network|abort/i.test(error?.message || '')) return 'Koneksi terputus. Periksa internet Anda, lalu coba kembali.';
  return error?.message || 'Terjadi kendala. Silakan coba kembali.';
}

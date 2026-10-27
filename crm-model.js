export const STATUS = {
  unverified: 'Belum verifikasi',
  onboarding: 'Belum buat outlet',
  trial: 'Masa trial',
  expired: 'Sudah berakhir',
  active: 'Berlangganan'
};
export const USAGE_STAGES = {
  regular: 'Rutin bertransaksi',
  active: 'Aktif 1–2 hari / 7 hari',
  cooling: 'Tidak transaksi 7 hari',
  dormant: 'Tidak transaksi 30 hari',
  setup: 'Produk siap, belum transaksi',
  empty: 'Belum produk & transaksi'
};
export const USAGE_HELP = {
  regular: 'Bertransaksi pada setidaknya 3 hari berbeda dalam 7 hari terakhir.',
  active: 'Ada transaksi dalam 7 hari terakhir, pada kurang dari 3 hari berbeda.',
  cooling: 'Pernah bertransaksi dalam 30 hari terakhir, tetapi tidak dalam 7 hari terakhir.',
  dormant: 'Pernah bertransaksi, tetapi tidak dalam 30 hari terakhir.',
  setup: 'Sudah memiliki produk, belum ada transaksi tercatat.',
  empty: 'Belum memiliki produk maupun transaksi tercatat.'
};
export const USAGE_SORTS = {
  recent: 'Transaksi terbaru',
  transactions: 'Transaksi 30 hari terbanyak',
  products: 'Produk terbanyak'
};
// Missing usage is not a zero: an older or unavailable backend must never
// make an active customer appear unused. Raw dates are POS local sale dates.
export function usageCount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? new Intl.NumberFormat('id-ID').format(n) : '—';
}
export function saleDate(value, time = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '—';
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value) return '—';
  const formatted = new Intl.DateTimeFormat('id-ID', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).format(d);
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(time || '')) ? String(time).slice(0, 5) : '';
  return formatted + (clock ? ' · ' + clock.replace(':', '.') : '');
}
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
  admin: 'Admin CRM',
  owner: 'Pemilik'
};
export const ROLE_HELP = {
  viewer: 'Melihat data dan detail pengguna.',
  renewal: 'Melihat daftar outlet terbatas dan memperpanjang langganan. Tanpa kontak pengguna.',
  sales: 'Melihat data pengguna dan mencatat follow-up.',
  manager: 'Melihat data pengguna, mencatat follow-up, dan memperpanjang langganan.',
  admin: 'Melihat pengguna, follow-up, memperpanjang langganan dan membuat akun demo. Tidak mengelola akses tim.'
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
export function isRenewalConflict(error) {
  // PT409 gives PostgREST an explicit HTTP conflict without its automatic
  // serialization-failure retries. Keep 40001 for older CRM deployments.
  return error?.code === 'PT409' || error?.code === '40001';
}
export function allowedPages(permissions) {
  return ['overview', ...(permissions.read_customers ? ['users', 'followups'] : []), ...(permissions.renew ? ['renewals'] : []), ...(permissions.create_demo ? ['demos'] : []), ...(permissions.manage_members ? ['team'] : []), ...(permissions.read_audit ? ['audit'] : [])];
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


export const DEMO_CATEGORIES = ['Resto', 'Cafe', 'Barber', 'Retail', 'Laundry'];
export const DEMO_STATUS = {pending: 'Sedang disiapkan', ready: 'Siap digunakan', failed: 'Perlu dilanjutkan'};
const OPERATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function demoAccountPayload(values, operationId) {
  const localPart = String(values.local_part || '').trim().toLowerCase();
  const password = String(values.password || '');
  const outletName = String(values.outlet_name || '').trim() || 'Demo ' + localPart;
  if (!/^[a-z0-9][a-z0-9._-]{1,46}[a-z0-9]$/.test(localPart) || localPart.includes('..')) throw new Error('Nama email harus 3-48 karakter: huruf, angka, titik, garis bawah atau tanda hubung. Awali dan akhiri dengan huruf/angka.');
  if (password.length < 12 || password.length > 72 || !/[a-z]/i.test(password) || !/[0-9]/.test(password) || /[\x00-\x1f\x7f]/.test(password)) throw new Error('Kata sandi harus 12-72 karakter, berisi huruf dan angka, tanpa karakter kontrol.');
  if (new TextEncoder().encode(password).byteLength > 72) throw new Error('Kata sandi terlalu panjang. Gunakan kata sandi yang lebih singkat.');
  if (outletName.length > 80 || /[\x00-\x1f\x7f]/.test(outletName)) throw new Error('Nama outlet maksimal 80 karakter, tanpa karakter kontrol.');
  if (!OPERATION_UUID.test(String(operationId))) throw new Error('Identitas permintaan tidak valid. Muat ulang halaman.');
  return {action: 'create', operation_id: operationId, local_part: localPart, password, outlet_name: outletName};
}
// Only a random request ID is persisted, bound to the signed-in CRM actor.
// Passwords, email, outlet name and provisioning results are never written here.
export function demoRecovery(storage, userId, operationId = undefined) {
  if (!userId) return null;
  const key = 'vora-crm-demo-operation:' + encodeURIComponent(userId);
  try {
    if (operationId === null) { storage.removeItem(key); return null; }
    if (operationId !== undefined) {
      if (!OPERATION_UUID.test(String(operationId))) return null;
      storage.setItem(key, operationId); return operationId;
    }
    const saved = storage.getItem(key);
    return OPERATION_UUID.test(String(saved)) ? saved : null;
  } catch { return null; }
}
export function demoError(error) {
  const messages = {
    EMAIL_EXISTS: 'Email sudah digunakan. Akun lama tidak diubah. Pilih nama email lain.',
    email_exists: 'Email sudah digunakan. Akun lama tidak diubah. Pilih nama email lain.',
    VALIDATION_ERROR: 'Periksa nama email, kata sandi dan nama outlet sebelum mencoba lagi.',
    validation_error: 'Periksa nama email, kata sandi dan nama outlet sebelum mencoba lagi.',
    FORBIDDEN: 'Hanya pemilik dan Admin CRM yang dapat membuat akun demo.',
    forbidden: 'Hanya pemilik dan Admin CRM yang dapat membuat akun demo.',
    NOT_FOUND: 'Permintaan belum ditemukan. Periksa lagi, atau kirim ulang dengan identitas permintaan yang sama.',
    not_found: 'Permintaan belum ditemukan. Periksa lagi, atau kirim ulang dengan identitas permintaan yang sama.',
    SERVICE_UNAVAILABLE: 'Layanan akun demo belum siap. Hubungi pemilik CRM; jangan membuat permintaan baru untuk email yang sama.',
    service_unavailable: 'Layanan akun demo belum siap. Hubungi pemilik CRM; jangan membuat permintaan baru untuk email yang sama.',
    RATE_LIMITED: 'Terlalu banyak permintaan. Tunggu sebentar, lalu periksa hasil permintaan ini.',
    OPERATION_CONFLICT: 'Identitas permintaan sudah dipakai untuk data berbeda. Periksa permintaan yang tersimpan.',
    CONFLICT: 'Data permintaan berbeda dari yang sudah tersimpan. Periksa hasil permintaan ini.',
    PASSWORD_REQUIRED: 'Kata sandi belum diterima untuk membuat akun. Isi kembali, lalu lanjutkan permintaan yang sama.',
    IN_PROGRESS: 'Permintaan sedang dikerjakan server. Tunggu sebentar, lalu periksa status.',
    PHOTO_UNAVAILABLE: 'Foto produk belum dapat disalin. Periksa status lagi untuk melanjutkan penyiapan akun.',
  };
  if (['42501', 'PGRST301', 'PGRST302'].includes(error?.code)) return messages.FORBIDDEN;
  if (['PGRST202', '42883'].includes(error?.code)) return messages.SERVICE_UNAVAILABLE;
  return messages[error?.code] || 'Hasil pembuatan belum dapat dipastikan. Periksa status permintaan ini sebelum mencoba lagi. Kata sandi perlu diisi ulang jika diminta.';
}

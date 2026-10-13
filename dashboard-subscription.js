import { escape as h, icon } from '/dashboard-icons.js';

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.vorapos.app';
const ADMIN_WHATSAPP = 'https://wa.me/6289636974140';

export function subscriptionSummary(outlet, now = Date.now()) {
  const value = outlet?.subscription_end_date;
  const trial = /^free trial$/i.test(String(outlet?.subscription_plan || '').trim());
  const unknown = { state: 'unknown', trial, expiresAt: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) || !Number.isFinite(now)) return unknown;
  const date = value.slice(0, 10), calendarDay = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(calendarDay) || new Date(calendarDay).toISOString().slice(0, 10) !== date) return unknown;
  const expiresAt = Date.parse(value);
  if (!Number.isFinite(expiresAt)) return unknown;
  return { state: expiresAt > now ? 'active' : 'expired', trial, expiresAt };
}

export function renewalContactUrl(outlet) {
  // Only the selected business and its identifier are needed for manual renewal.
  // Never include an Auth session, PIN, password or the complete outlet record.
  const name = String(outlet?.businessName || outlet?.name || '').trim().slice(0, 160);
  const id = String(outlet?.id || '').slice(0, 100);
  const message = ['Halo Admin VORA, saya ingin berlangganan / memperpanjang VORA POS.',
    name ? `Nama usaha: ${name}` : '', id ? `ID outlet: ${id}` : '',
    'Mohon informasi paket dan cara pembayarannya.'].filter(Boolean).join('\n');
  return `${ADMIN_WHATSAPP}?text=${encodeURIComponent(message)}`;
}

export function renderSubscriptionCard(outlet, userId, { page = 'overview', loading = false, now = Date.now() } = {}) {
  if (!userId || !outlet?.id || outlet.merchant_id !== userId || outlet.is_deleted !== false) return '';
  const summary = subscriptionSummary(outlet, now);
  if (summary.state === 'active' && page !== 'overview' && page !== 'settings') return '';
  const title = summary.state === 'unknown' ? 'Periksa masa aktif usaha Anda' :
    `${summary.trial ? 'Trial' : 'Langganan'} Anda ${summary.state === 'active' ? 'aktif' : 'telah berakhir'}`;
  const date = summary.expiresAt === null ? '' : new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(summary.expiresAt));
  const detail = summary.state === 'unknown' ? 'Tanggal masa aktif belum tersedia. Periksa status atau hubungi admin untuk mendapatkan bantuan.' :
    `${summary.state === 'active' ? 'Aktif sampai' : 'Masa aktif berakhir pada'} ${date}. ${summary.state === 'active' ? 'Anda dapat menghubungi admin sekarang untuk perpanjangan.' : 'Hubungi admin untuk melanjutkan penggunaan kasir.'}`;
  return `<section class="subscription-card subscription-${summary.state}" aria-labelledby="subscription-title"><div class="subscription-copy"><span class="subscription-label">LANGGANAN VORA POS</span><h2 id="subscription-title">${h(title)}</h2><p>${h(detail)}</p><p class="subscription-note">Pembayaran dilakukan melalui WhatsApp admin. Masa aktif diperbarui setelah pembayaran dikonfirmasi admin.</p></div><div class="subscription-actions"><a class="btn btn-primary" data-subscription-contact href="${h(renewalContactUrl(outlet))}" target="_blank" rel="noopener noreferrer">${icon('help')} Hubungi admin untuk ${summary.trial || summary.state === 'unknown' ? 'berlangganan' : 'perpanjangan'}</a><a class="btn btn-secondary" href="${PLAY_STORE_URL}" target="_blank" rel="noopener noreferrer">${icon('download')} Download di Play Store</a><button class="subscription-refresh" data-action="subscription-refresh" ${loading ? 'disabled aria-busy="true"' : ''}>${loading ? 'Memeriksa status…' : 'Sudah dikonfirmasi admin? Periksa status'}</button></div></section>`;
}

import { config } from './auth-config.js';

export const RESET_EMAIL_NOTICE = 'Jika email terdaftar, tautan untuk membuat password baru akan dikirim. Periksa inbox dan folder spam Anda.';
const RECOVERY_URL = 'https://vorakasir.com/reset-password.html';

export class ForgotPasswordError extends Error {
  constructor(code, message) { super(message); this.name = 'ForgotPasswordError'; this.code = code; }
}

export function normalizeResetEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ForgotPasswordError('email', 'Masukkan alamat email yang valid.');
  return email;
}

// This page never reads a dashboard session and never sends an email on load.
export function createForgotPasswordFlow({ supabaseUrl, supabaseKey, authRecoveryUrl = RECOVERY_URL, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 20000 }) {
  const base = new URL(supabaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || authRecoveryUrl !== RECOVERY_URL) throw new Error('Konfigurasi pemulihan tidak valid.');
  let busy = false;
  let availableAt = 0;
  let controller = null;
  let disposed = false;
  const remainingSeconds = () => Math.max(0, Math.ceil((availableAt - now()) / 1000));
  const clear = () => { disposed = true; controller?.abort(); };

  async function request(value) {
    if (disposed) throw new ForgotPasswordError('cancelled', 'Permintaan dibatalkan.');
    if (busy) throw new ForgotPasswordError('busy', 'Permintaan masih diproses.');
    const email = normalizeResetEmail(value);
    if (remainingSeconds() > 0) throw new ForgotPasswordError('cooldown', 'Tunggu sebentar sebelum meminta tautan baru.');
    busy = true;
    availableAt = now() + 60000;
    controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(), timeoutMs);
    try {
      const url = new URL(base.origin + '/auth/v1/recover');
      url.searchParams.set('redirect_to', authRecoveryUrl);
      const response = await fetchImpl(url.href, {
        method: 'POST', headers: { apikey: supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (disposed) throw new ForgotPasswordError('cancelled', 'Permintaan dibatalkan.');
      if (!response.ok) {
        const code = data.code || data.error_code;
        if (code === 'user_not_found') return RESET_EMAIL_NOTICE;
        if (response.status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') throw new ForgotPasswordError('rate_limit', 'Permintaan terlalu sering. Tunggu beberapa menit sebelum mencoba lagi.');
        throw new ForgotPasswordError('service', 'Permintaan belum berhasil. Periksa koneksi atau coba kembali beberapa saat lagi.');
      }
      return RESET_EMAIL_NOTICE;
    } catch (error) {
      if (error instanceof ForgotPasswordError) throw error;
      throw new ForgotPasswordError('network', 'Pengiriman belum dapat dipastikan karena koneksi terganggu. Periksa email Anda sebelum meminta tautan baru.');
    } finally { clearTimeout(timer); controller = null; busy = false; }
  }
  return { request, remainingSeconds, clear };
}

export function mountForgotPasswordPage(document, settings = config) {
  const byId = id => document.getElementById(id);
  const form = byId('forgot-form');
  const input = byId('email');
  const button = byId('send-reset');
  const feedback = byId('feedback');
  let mounted = true;
  let sending = false;
  let interval;
  let flow;
  function message(text, kind = '') { feedback.textContent = text; feedback.className = kind; feedback.hidden = false; }
  try { flow = createForgotPasswordFlow(settings); }
  catch { button.disabled = true; message('Halaman pemulihan belum tersedia. Silakan coba kembali nanti.', 'error'); return () => {}; }

  function updateButton() {
    if (!mounted || sending) return;
    const remaining = flow.remainingSeconds();
    button.disabled = remaining > 0;
    button.setAttribute('aria-busy', 'false');
    button.textContent = remaining > 0 ? `Kirim ulang dalam ${remaining} dtk` : 'Kirim tautan reset';
    if (!remaining && interval) { clearInterval(interval); interval = undefined; }
  }
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!mounted || sending || button.disabled) return;
    sending = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Mengirim tautan…';
    const spinner = document.createElement('span'); spinner.className = 'spinner'; spinner.setAttribute('aria-hidden', 'true'); button.prepend(spinner);
    input.disabled = true;
    feedback.hidden = true;
    try { const notice = await flow.request(input.value); if (mounted) message(notice, 'success'); }
    catch (error) {
      if (mounted) {
        message(error.message || 'Permintaan belum berhasil. Silakan coba kembali.', 'error');
        if (error.code === 'email') input.setAttribute('aria-invalid', 'true');
      }
    } finally {
      sending = false;
      if (mounted) {
        input.disabled = false;
        updateButton();
        if (flow.remainingSeconds() > 0 && !interval) interval = setInterval(updateButton, 1000);
        if (input.getAttribute('aria-invalid') === 'true') input.focus(); else feedback.focus();
      }
    }
  });
  return () => { mounted = false; clearInterval(interval); input.value = ''; flow.clear(); };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const dispose = mountForgotPasswordPage(document);
  window.addEventListener('pagehide', dispose, { once: true });
}

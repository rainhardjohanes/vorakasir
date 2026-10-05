import { config } from './auth-config.js';

const TYPES = new Set(['email', 'signup', 'email_change']);
const HASH_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const INVALID_LINK = 'Tautan tidak valid atau sudah kedaluwarsa. Gunakan tautan terbaru atau minta email konfirmasi baru dari aplikasi VORA POS.';
// Supabase Auth's first secure-email-change confirmation succeeds without a
// session. It still requires the link sent to the other address to complete.
const EMAIL_CHANGE_PENDING = 'Confirmation link accepted. Please proceed to confirm link sent to the other email';

export class ConfirmationError extends Error {
  constructor(code, message) { super(message); this.name = 'ConfirmationError'; this.code = code; }
}

export function captureConfirmationLink(location, history) {
  const fragment = location.hash;
  try { history.replaceState(null, '', location.pathname); }
  catch { return null; }
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  if (params.size !== 2 || params.getAll('token_hash').length !== 1 || params.getAll('type').length !== 1) return null;
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  return typeof tokenHash === 'string' && HASH_PATTERN.test(tokenHash) && TYPES.has(type) ? { tokenHash, type } : null;
}

export function createConfirmationFlow({ tokenHash, type, supabaseUrl, supabaseKey, fetchImpl = globalThis.fetch, timeoutMs = 20000 }) {
  const base = new URL(supabaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || typeof supabaseKey !== 'string' || !supabaseKey) {
    throw new Error('Konfigurasi konfirmasi tidak valid.');
  }
  let hash = typeof tokenHash === 'string' && HASH_PATTERN.test(tokenHash) && TYPES.has(type) ? tokenHash : null;
  let busy = false;
  let generation = 0;
  const pending = new Set();

  function clear() {
    generation += 1;
    hash = null;
    for (const controller of pending) controller.abort();
  }

  async function request(path, { body, accessToken, timeout = timeoutMs, cleanup = false } = {}) {
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(base.origin + '/auth/v1' + path, {
        method: 'POST',
        headers: { apikey: supabaseKey, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
        ...(cleanup ? { keepalive: true } : {}),
      });
      if (!response.ok) {
        if (response.status === 429) throw new ConfirmationError('rate_limit', 'Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.');
        if (response.status >= 500) throw new ConfirmationError('network', 'Layanan belum dapat dihubungi. Periksa koneksi, lalu coba lagi.');
        throw new ConfirmationError('invalid_link', INVALID_LINK);
      }
      if (cleanup) return null;
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ConfirmationError('uncertain', 'Hasil konfirmasi belum dapat dipastikan. Coba login dari aplikasi atau minta tautan konfirmasi terbaru.');
      return data;
    } catch (error) {
      if (error instanceof ConfirmationError) throw error;
      throw new ConfirmationError('network', 'Koneksi terputus atau terlalu lama. Periksa koneksi, lalu coba lagi. Jika tautan sudah digunakan, coba login melalui aplikasi.');
    } finally { clearTimeout(timer); pending.delete(controller); }
  }

  async function verify() {
    if (busy) throw new ConfirmationError('busy', 'Permintaan masih diproses.');
    if (!hash) throw new ConfirmationError('invalid_link', INVALID_LINK);
    busy = true;
    const current = generation;
    let temporaryToken = null;
    try {
      const data = await request('/verify', { body: { token_hash: hash, type } });
      // Keep only the access token for best-effort revocation; never install a
      // browser session or retain the returned refresh token.
      temporaryToken = typeof data.access_token === 'string' && data.access_token ? data.access_token : null;
      delete data.access_token;
      delete data.refresh_token;
      hash = null;
      if (current !== generation) throw new ConfirmationError('invalid_link', INVALID_LINK);
      if (type === 'email_change' && !temporaryToken && data.code === '200' && data.msg === EMAIL_CHANGE_PENDING) {
        return { status: 'pending_other_email', type };
      }
      if (!temporaryToken || typeof data.user?.id !== 'string' || !data.user.id || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) {
        throw new ConfirmationError('uncertain', 'Hasil konfirmasi belum dapat dipastikan. Coba login dari aplikasi atau minta tautan konfirmasi terbaru.');
      }
      return { status: 'confirmed', type };
    } catch (error) {
      if (error.code === 'invalid_link' || error.code === 'uncertain') clear();
      throw error;
    } finally {
      if (temporaryToken) {
        // scope=local revokes only the newly issued session, preserving other
        // devices. Confirmation itself stays successful if logout is offline.
        try { await request('/logout?scope=local', { accessToken: temporaryToken, timeout: 5000, cleanup: true }); } catch { /* Best effort; no session is persisted. */ }
        temporaryToken = null;
      }
      busy = false;
    }
  }

  return { verify, clear };
}

export function mountConfirmationPage(document, location, history, settings = config) {
  let link = captureConfirmationLink(location, history);
  const byId = id => document.getElementById(id);
  const feedback = byId('feedback');
  const intro = byId('intro');
  const panel = byId('confirm-panel');
  const nextSteps = byId('next-steps');
  const button = byId('continue');
  let mounted = true;
  let flow;

  function message(text, kind) {
    feedback.textContent = text;
    feedback.className = kind;
    feedback.hidden = false;
  }
  function invalid(text = INVALID_LINK) {
    panel.hidden = true;
    nextSteps.hidden = false;
    intro.textContent = 'Tautan konfirmasi belum dapat digunakan.';
    byId('next-help').textContent = 'Kembali ke aplikasi VORA POS. Jika email sudah dikonfirmasi, Anda dapat mencoba login. Jika belum, minta email konfirmasi terbaru.';
    message(text, 'error');
  }
  if (!link) { invalid(); return () => {}; }
  const type = link.type;
  try { flow = createConfirmationFlow({ ...settings, ...link }); }
  catch { link = null; invalid(); return () => {}; }
  link = null;
  intro.textContent = type === 'email_change' ? 'Konfirmasikan permintaan perubahan email akun VORA POS Anda.' : 'Konfirmasikan email yang Anda gunakan untuk akun VORA POS.';
  if (type === 'email_change') byId('confirm-note').textContent = 'Lanjutkan hanya jika Anda meminta perubahan email ini. Anda mungkin perlu mengonfirmasi tautan yang dikirim ke alamat lama dan alamat baru.';
  panel.hidden = false;

  async function continueConfirmation() {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Memverifikasi tautan…';
    feedback.hidden = true;
    try {
      const result = await flow.verify();
      if (!mounted) return;
      panel.hidden = true;
      nextSteps.hidden = false;
      if (result.status === 'pending_other_email') {
        byId('page-title').textContent = 'Satu langkah lagi';
        intro.textContent = 'Tautan ini sudah dikonfirmasi. Perubahan email belum selesai.';
        byId('next-help').textContent = 'Buka email konfirmasi yang dikirim ke alamat lainnya, lalu konfirmasikan tautannya untuk menyelesaikan perubahan email.';
        message('Konfirmasi diterima. Periksa kotak masuk alamat email lama dan baru.', 'success');
      } else {
        byId('page-title').textContent = type === 'email_change' ? 'Email berhasil diubah' : 'Email berhasil dikonfirmasi';
        intro.textContent = 'Konfirmasi email selesai.';
        byId('next-help').textContent = type === 'email_change' ? 'Kembali ke aplikasi VORA POS atau halaman login dashboard. Gunakan email baru dan password akun Anda.' : 'Kembali ke aplikasi VORA POS atau halaman login dashboard, lalu masuk dengan email dan password Anda.';
        message('Anda dapat menutup halaman ini dan kembali ke VORA POS.', 'success');
      }
      feedback.focus();
    } catch (error) {
      if (!mounted) return;
      if (error.code === 'invalid_link' || error.code === 'uncertain') invalid(error.message);
      else message(error instanceof ConfirmationError ? error.message : 'Terjadi kendala. Silakan coba kembali.', 'error');
      feedback.focus();
    } finally {
      if (mounted) {
        button.disabled = false;
        button.setAttribute('aria-busy', 'false');
        button.textContent = 'Lanjutkan';
      }
    }
  }
  button.addEventListener('click', continueConfirmation);
  return () => { mounted = false; flow.clear(); button.removeEventListener('click', continueConfirmation); };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const dispose = mountConfirmationPage(document, window.location, window.history);
  window.addEventListener('pagehide', dispose, { once: true });
}

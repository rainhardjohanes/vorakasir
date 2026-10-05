import { config } from './auth-config.js';

const INVALID_LINK = 'Tautan tidak valid atau sudah kedaluwarsa. Silakan minta tautan reset password yang baru.';

export class RecoveryError extends Error {
  constructor(code, message) { super(message); this.name = 'RecoveryError'; this.code = code; }
}

// Only the email recovery hash is accepted. An existing dashboard login or an
// access token pasted into the address bar must never authorize this page.
export function captureRecoveryLink(location, history) {
  const fragment = location.hash;
  try { history.replaceState(null, '', location.pathname); }
  catch { return null; } // Fail closed if the sensitive URL cannot be scrubbed.
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  if (params.size !== 2 || params.getAll('token_hash').length !== 1 || params.get('type') !== 'recovery') return null;
  const hash = params.get('token_hash');
  return typeof hash === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(hash) ? hash : null;
}

export function validatePassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new RecoveryError('password', 'Password harus terdiri dari 8–128 karakter.');
  }
  if (password !== confirmation) throw new RecoveryError('confirmation', 'Konfirmasi password belum sama. Periksa kembali kedua isian.');
}

export function createRecoveryFlow({ tokenHash, supabaseUrl, supabaseKey, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 20000 }) {
  const base = new URL(supabaseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Konfigurasi pemulihan tidak valid.');
  let hash = tokenHash;
  let session = null;
  let busy = false;
  let generation = 0;
  const pending = new Set();

  function clear() {
    generation += 1;
    hash = null;
    session = null;
    for (const controller of pending) controller.abort();
  }

  async function request(path, { method, body, accessToken, timeout = timeoutMs }) {
    const controller = new AbortController();
    pending.add(controller);
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(base.origin + '/auth/v1' + path, {
        method, headers: { apikey: supabaseKey, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) throw new RecoveryError('rate_limit', 'Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.');
        if (response.status >= 500) throw new RecoveryError('network', 'Layanan belum dapat dihubungi. Periksa koneksi lalu coba lagi.');
        if (data.code === 'weak_password' || data.error_code === 'weak_password') throw new RecoveryError('password', 'Password belum cukup kuat. Gunakan kombinasi huruf, angka, dan simbol.');
        if (data.code === 'same_password' || data.error_code === 'same_password') throw new RecoveryError('password', 'Gunakan password yang berbeda dari password akun saat ini.');
        throw new RecoveryError('invalid_link', INVALID_LINK);
      }
      return data;
    } catch (error) {
      if (error instanceof RecoveryError) throw error;
      throw new RecoveryError('network', 'Koneksi terputus atau terlalu lama. Periksa koneksi, lalu coba lagi.');
    } finally { clearTimeout(timer); pending.delete(controller); }
  }

  async function verify() {
    if (busy) throw new RecoveryError('busy', 'Permintaan masih diproses.');
    if (!hash) throw new RecoveryError('invalid_link', INVALID_LINK);
    busy = true;
    const current = generation;
    try {
      const data = await request('/verify', { method: 'POST', body: { token_hash: hash, type: 'recovery' } });
      if (current !== generation) throw new RecoveryError('invalid_link', INVALID_LINK);
      const seconds = Number(data.expires_in);
      if (typeof data.access_token !== 'string' || !data.access_token || !data.user?.id || !Number.isFinite(seconds) || seconds <= 0) {
        clear();
        throw new RecoveryError('invalid_link', INVALID_LINK);
      }
      session = { accessToken: data.access_token, expiresAt: now() + Math.min(seconds, 3600) * 1000 };
      hash = null;
    } catch (error) {
      if (error.code === 'invalid_link') clear();
      throw error;
    } finally { busy = false; }
  }

  async function changePassword(password, confirmation) {
    if (busy) throw new RecoveryError('busy', 'Permintaan masih diproses.');
    validatePassword(password, confirmation);
    if (!session || now() >= session.expiresAt) {
      clear();
      throw new RecoveryError('invalid_link', INVALID_LINK);
    }
    busy = true;
    const current = generation;
    const accessToken = session.accessToken;
    try {
      const data = await request('/user', { method: 'PUT', body: { password }, accessToken });
      if (current !== generation) throw new RecoveryError('invalid_link', INVALID_LINK);
      if (!data.id) throw new RecoveryError('network', 'Hasil penyimpanan belum dapat dipastikan. Coba login dengan password baru atau minta tautan reset baru.');
      clear();
      // Revoke only this temporary recovery session, not other devices. Never
      // retain the refresh token returned by verify or modify dashboard storage.
      try { await request('/logout?scope=local', { method: 'POST', accessToken, timeout: 5000 }); } catch { /* Password already changed; logout is best effort. */ }
    } catch (error) {
      if (error.code === 'invalid_link') clear();
      if (error.code === 'network') throw new RecoveryError('network', 'Hasil penyimpanan belum dapat dipastikan karena koneksi terganggu. Coba lagi; jika tetap gagal, coba login dengan password baru atau minta tautan reset baru.');
      throw error;
    } finally { busy = false; }
  }

  return { verify, changePassword, clear };
}

export function mountRecoveryPage(document, location, history, settings = config) {
  const tokenHash = captureRecoveryLink(location, history);
  const byId = id => document.getElementById(id);
  const feedback = byId('feedback');
  const intro = byId('intro');
  const confirmPanel = byId('confirm-panel');
  const form = byId('password-form');
  const password = byId('password');
  const confirmation = byId('confirmation');
  const nextSteps = byId('next-steps');
  let flow;
  let mounted = true;

  function message(text, kind = '') {
    feedback.textContent = text;
    feedback.className = kind;
    feedback.hidden = false;
  }
  function invalid() {
    form.hidden = true;
    confirmPanel.hidden = true;
    nextSteps.hidden = false;
    password.value = confirmation.value = '';
    intro.textContent = 'Tautan pemulihan belum dapat digunakan.';
    byId('next-help').textContent = 'Pilih Minta tautan reset password baru, lalu gunakan tautan terbaru yang dikirim ke email Anda. Anda juga dapat meminta ulang dari aplikasi VORA POS.';
    message(INVALID_LINK, 'error');
  }
  function busy(button, working, label) {
    button.disabled = working;
    button.setAttribute('aria-busy', String(working));
    button.textContent = label;
    if (working) { const spinner = document.createElement('span'); spinner.className = 'spinner'; spinner.setAttribute('aria-hidden', 'true'); button.prepend(spinner); }
  }
  function handleError(error) {
    if (error.code === 'invalid_link') invalid();
    else message(error.message || 'Terjadi kendala. Silakan coba kembali.', 'error');
    if (error.code === 'password' || error.code === 'confirmation') {
      const input = error.code === 'confirmation' ? confirmation : password;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    } else feedback.focus();
  }

  if (!tokenHash) { invalid(); return () => {}; }
  try { flow = createRecoveryFlow({ tokenHash, ...settings }); }
  catch { invalid(); return () => {}; }
  intro.textContent = 'Atur ulang password untuk kembali mengakses akun VORA POS Anda.';
  confirmPanel.hidden = false;

  byId('continue').addEventListener('click', async () => {
    const button = byId('continue');
    if (button.disabled) return;
    busy(button, true, 'Memverifikasi tautan…');
    feedback.hidden = true;
    try {
      await flow.verify();
      if (!mounted) return;
      confirmPanel.hidden = true;
      form.hidden = false;
      intro.textContent = 'Tautan terverifikasi. Masukkan password baru untuk akun Anda.';
      password.focus();
    } catch (error) { if (mounted) handleError(error); }
    finally { if (mounted) busy(button, false, 'Lanjutkan'); }
  });
  byId('show-password').addEventListener('click', () => {
    const visible = password.type === 'password';
    password.type = confirmation.type = visible ? 'text' : 'password';
    const button = byId('show-password');
    button.textContent = visible ? 'Tutup' : 'Lihat';
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', visible ? 'Sembunyikan password' : 'Tampilkan password');
  });
  for (const input of [password, confirmation]) input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = byId('save-password');
    if (button.disabled) return;
    busy(button, true, 'Menyimpan password…');
    feedback.hidden = true;
    try {
      await flow.changePassword(password.value, confirmation.value);
      if (!mounted) return;
      password.value = confirmation.value = '';
      form.hidden = true;
      nextSteps.hidden = false;
      byId('page-title').textContent = 'Password berhasil diubah';
      intro.textContent = 'Akun Anda siap digunakan kembali.';
      byId('next-help').textContent = 'Kembali ke aplikasi VORA POS atau halaman login, lalu masuk menggunakan email dan password baru Anda.';
      message('Password baru sudah tersimpan. Silakan login kembali.', 'success');
      feedback.focus();
    } catch (error) { if (mounted) handleError(error); }
    finally { if (mounted) busy(button, false, 'Simpan password baru'); }
  });
  return () => { mounted = false; password.value = confirmation.value = ''; flow.clear(); };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const dispose = mountRecoveryPage(document, window.location, window.history);
  window.addEventListener('pagehide', dispose, { once: true });
}

const ENDPOINT = 'https://pjycdyrwdcjhxmdjzxto.supabase.co/functions/v1/customer-emails';
const TOKEN = /^[a-f0-9]{64}$/;

// Keep this capability out of request URLs, history and persistent storage.
// Loading a page never changes preferences: email scanners must not opt users out.
export function capturePreferenceToken(location, history) {
  const fragment = location.hash;
  try { history.replaceState(null, '', location.pathname); }
  catch { return null; }
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  if (params.size !== 1 || params.getAll('token').length !== 1) return null;
  const token = params.get('token');
  return typeof token === 'string' && TOKEN.test(token) ? token : null;
}

export function createPreferenceFlow({ token, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  let capability = TOKEN.test(token || '') ? token : null;
  let busy = false;
  let completed = false;
  let active = null;
  return {
    async unsubscribe() {
      if (completed) return;
      if (!capability) throw new Error('Tautan tidak valid. Buka kembali tautan pengaturan dari email VORA.');
      if (busy) throw new Error('Permintaan masih diproses.');
      busy = true;
      const controller = new AbortController();
      active = controller;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(ENDPOINT + '?unsubscribe=' + encodeURIComponent(capability), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
          body: new URLSearchParams({ token: capability }).toString(),
          credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal,
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.ok !== true) throw new Error('request_failed');
        capability = null;
        completed = true;
      } catch {
        throw new Error('Preferensi belum dapat dikonfirmasi. Periksa koneksi, lalu tekan Coba lagi. Jika kendala berlanjut, hubungi admin.');
      } finally {
        clearTimeout(timer);
        busy = false;
        active = null;
      }
    },
    clear() { capability = null; active?.abort(); },
  };
}

export function mountPreferencePage(document, location, history, fetchImpl = globalThis.fetch) {
  const token = capturePreferenceToken(location, history);
  const byId = (id) => document.getElementById(id);
  const feedback = byId('feedback');
  const feedbackText = byId('feedback-text');
  const confirmation = byId('confirmation');
  const button = byId('unsubscribe-button');
  const next = byId('next-steps');
  let mounted = true;
  const message = (text, state) => {
    feedbackText.textContent = text;
    feedback.className = 'notice' + (state ? ' ' + state : '');
    feedback.hidden = false;
  };
  if (!token) {
    message('Tautan pengaturan tidak ditemukan atau tidak valid.', 'error');
    byId('next-copy').textContent = 'Silakan buka kembali tautan “Berhenti menerima pengingat ini” dari email VORA. Jika halaman ini tadi dimuat ulang, tautan perlu dibuka kembali dari email Anda.';
    next.hidden = false;
    return () => { mounted = false; };
  }
  const flow = createPreferenceFlow({ token, fetchImpl });
  feedback.hidden = true;
  confirmation.hidden = false;
  button.addEventListener('click', async () => {
    if (!mounted || button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Menyimpan preferensi…';
    feedback.hidden = true;
    try {
      await flow.unsubscribe();
      if (!mounted) return;
      byId('page-title').textContent = 'Pengingat email dihentikan';
      byId('intro').textContent = 'Permintaan Anda telah diproses.';
      confirmation.hidden = true;
      message('Anda tidak akan menerima email informasi langganan dan panduan penggunaan ini lagi. Email keamanan, verifikasi, dan reset kata sandi tetap tersedia.', 'success');
      byId('next-copy').textContent = 'Akun dan langganan VORA Anda tetap seperti sebelumnya. Anda tetap dapat meminta bantuan melalui WhatsApp admin.';
      next.hidden = false;
      feedback.focus();
    } catch (error) {
      if (!mounted) return;
      message(error.message, 'error');
      button.textContent = 'Coba lagi';
      feedback.focus();
    } finally {
      if (mounted) { button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  });
  return () => { mounted = false; flow.clear(); };
}

if (typeof document !== 'undefined') {
  const dispose = mountPreferencePage(document, window.location, window.history);
  window.addEventListener('pagehide', dispose, { once: true });
}

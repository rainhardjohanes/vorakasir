const AUTH_COOLDOWN_MS = 60_000;
const FORGOT_URL = 'https://vorakasir.com/forgot-password.html';
const authDraft = { email: '', resendAt: 0 };
const activeRequests = new WeakMap();
const BUSINESS_TYPES = ['Cafe / Coffee Shop', 'Restoran / Rumah Makan', 'Barbershop / Salon', 'Retail / Toko Kelontong', 'Lainnya'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const normalizePhone = value => String(value || '').replace(/[\s()-]/g, '');
const problem = (code, message) => Object.assign(new Error(message), { code, authUserMessage: true });
const cancelled = () => problem('cancelled', 'Permintaan tidak lagi aktif.');
function emailValue(value) {
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw problem('email', 'Masukkan alamat email yang valid.');
  return email;
}
function phoneValue(value) {
  const phone = normalizePhone(value);
  if (!/^\+?[0-9]{8,15}$/.test(phone)) throw problem('phone', 'Masukkan nomor telepon yang valid, misalnya 081234567890.');
  return phone;
}
export function authErrorMessage(error) {
  if (error?.authUserMessage === true && ['email', 'phone', 'password', 'confirmation', 'otp', 'profile', 'cooldown', 'session', 'onboarding'].includes(error.code)) return error.message;
  const messages = {
    over_email_send_rate_limit: 'Permintaan terlalu sering. Tunggu sebentar sebelum mencoba lagi.',
    over_request_rate_limit: 'Permintaan terlalu sering. Tunggu sebentar sebelum mencoba lagi.',
    otp_expired: 'Kode salah atau sudah kedaluwarsa. Periksa kode terbaru atau kirim ulang.',
    invalid_credentials: 'Email atau password tidak sesuai.',
    weak_password: 'Password terlalu mudah ditebak. Gunakan kombinasi huruf, angka, dan simbol.',
    email_address_invalid: 'Masukkan alamat email yang valid.',
    email_address_not_authorized: 'Email belum dapat dikirim. Silakan hubungi bantuan VORA POS.',
    user_already_exists: 'Pendaftaran belum dapat dilanjutkan. Jika sudah memiliki akun, silakan masuk atau pulihkan password.',
    signup_disabled: 'Pendaftaran belum tersedia. Silakan hubungi bantuan VORA POS.',
  };
  return messages[error?.code] || 'Permintaan belum berhasil. Periksa koneksi internet lalu coba lagi.';
}

// The shell owns the SDK and session persistence. This controller keeps only
// an email/cooldown in memory; passwords and OTPs never enter application state.
export function createAuthFlow({ client, user = null, isCurrent = () => true, onBusy = () => {}, onResult = async () => {}, now = Date.now, draft = authDraft }) {
  let disposed = false;
  let busy = false;
  let identityEpoch = 0;
  let identity = user?.id || null;
  let expectedSignIn = null;
  let rpcController = null;
  const subscription = client.auth.onAuthStateChange((event, session) => {
    const nextUser = session?.user;
    const nextId = nextUser?.id || null;
    if (event === 'SIGNED_OUT') {
      identityEpoch++;
      rpcController?.abort();
      draft.email = '';
      draft.resendAt = 0;
    } else if (nextId !== identity) {
      // The SDK emits our own SIGNED_IN before resolving signIn/verifyOtp.
      // Permit that one expected transition, but never A→B→A or a logout.
      if (expectedSignIn && !expectedSignIn.adoptedId && identity === expectedSignIn.startId && normalizeEmail(nextUser?.email) === expectedSignIn.email) {
        expectedSignIn.adoptedId = nextId;
      } else {
        identityEpoch++;
        rpcController?.abort();
      }
    }
    identity = nextId;
  }).data.subscription;
  const assertCurrent = epoch => {
    if (disposed || !isCurrent() || identityEpoch !== epoch) throw cancelled();
  };
  const assertSession = async (id, epoch) => {
    assertCurrent(epoch);
    const { data, error } = await client.auth.getSession();
    assertCurrent(epoch);
    if (error || (data?.session?.user?.id || null) !== id || identity !== id) throw problem('session', 'Sesi akun berubah. Silakan masuk kembali.');
    return data.session;
  };
  const remainingSeconds = () => Math.max(0, Math.ceil((draft.resendAt - now()) / 1000));
  async function run(kind, email, action) {
    if (disposed || !isCurrent()) throw cancelled();
    if (busy || activeRequests.has(client)) throw problem('busy', 'Permintaan sedang diproses.');
    busy = true;
    const requestId = Symbol(kind);
    activeRequests.set(client, requestId);
    const epoch = identityEpoch;
    expectedSignIn = ['login', 'signup', 'verify'].includes(kind) ? { email, startId: identity, adoptedId: null } : null;
    onBusy(true);
    try {
      const result = await action(epoch);
      assertCurrent(epoch);
      await onResult(result);
      return result;
    } catch (error) {
      assertCurrent(epoch);
      throw error;
    } finally {
      expectedSignIn = null;
      if (activeRequests.get(client) === requestId) activeRequests.delete(client);
      busy = false;
      onBusy(false);
    }
  }
  const authenticated = async (data, email, epoch) => {
    const session = data?.session;
    const account = data?.user || session?.user;
    if (!session?.access_token || !account?.id || !account.email_confirmed_at || session.user?.id !== account.id || normalizeEmail(account.email) !== email) throw problem('session', 'Sesi masuk belum dapat dikonfirmasi. Silakan coba masuk kembali.');
    await assertSession(account.id, epoch);
    draft.email = '';
    draft.resendAt = 0;
    return { kind: 'authenticated', session };
  };
  return {
    remainingSeconds,
    login({ email: input, password }) {
      const email = emailValue(input);
      if (typeof password !== 'string' || !password || password.length > 512) throw problem('password', 'Password wajib diisi.');
      return run('login', email, async epoch => {
        await assertSession(null, epoch);
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        assertCurrent(epoch);
        if (error?.code === 'email_not_confirmed' || /email not confirmed/i.test(error?.message || '')) {
          draft.email = email;
          return { kind: 'verify', sent: false };
        }
        if (error) throw error;
        return authenticated(data, email, epoch);
      });
    },
    signup({ email: input, phone: inputPhone, password, confirmation }) {
      const email = emailValue(input);
      const phone = phoneValue(inputPhone);
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw problem('password', 'Gunakan password minimal 8 karakter.');
      if (password !== confirmation) throw problem('confirmation', 'Konfirmasi password belum sama.');
      if (remainingSeconds()) throw problem('cooldown', `Tunggu ${remainingSeconds()} detik sebelum meminta email lagi.`);
      return run('signup', email, async epoch => {
        await assertSession(null, epoch);
        draft.resendAt = now() + AUTH_COOLDOWN_MS;
        const { data, error } = await client.auth.signUp({ email, password, options: { data: { phone } } });
        assertCurrent(epoch);
        if (error) throw error;
        if (data?.session) return authenticated(data, email, epoch);
        if (!data?.user) throw problem('session', 'Pendaftaran belum dapat dikonfirmasi. Silakan coba lagi.');
        draft.email = email;
        return { kind: 'verify', sent: true };
      });
    },
    verify({ email: input, token: inputToken }) {
      const email = emailValue(input || draft.email);
      const token = String(inputToken || '').replace(/\s/g, '');
      if (!/^[0-9]{8}$/.test(token)) throw problem('otp', 'Masukkan kode verifikasi 8 digit dari email Anda.');
      return run('verify', email, async epoch => {
        await assertSession(null, epoch);
        const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
        assertCurrent(epoch);
        if (error) throw error;
        return authenticated(data, email, epoch);
      });
    },
    resend({ email: input }) {
      const email = emailValue(input || draft.email);
      if (remainingSeconds()) throw problem('cooldown', `Tunggu ${remainingSeconds()} detik sebelum meminta kode lagi.`);
      return run('resend', email, async epoch => {
        await assertSession(null, epoch);
        draft.resendAt = now() + AUTH_COOLDOWN_MS;
        const { error } = await client.auth.resend({ type: 'signup', email });
        assertCurrent(epoch);
        if (error) throw error;
        draft.email = email;
        return { kind: 'resent' };
      });
    },
    completeBusiness({ businessName, ownerName, phone: inputPhone, address, businessType }) {
      const payload = {
        p_business_name: String(businessName || '').trim(), p_owner_name: String(ownerName || '').trim(),
        p_phone: phoneValue(inputPhone), p_address: String(address || '').trim(), p_business_type: businessType,
      };
      if (!payload.p_business_name || payload.p_business_name.length > 160 || !payload.p_owner_name || payload.p_owner_name.length > 120 || !payload.p_address || payload.p_address.length > 1000 || !BUSINESS_TYPES.includes(businessType)) throw problem('profile', 'Lengkapi nama bisnis, nama owner, alamat, dan jenis usaha.');
      return run('business', '', async epoch => {
        if (!user?.id) throw problem('session', 'Verifikasi email dan masuk kembali sebelum menyiapkan bisnis.');
        await assertSession(user.id, epoch);
        const { data: accountData, error: accountError } = await client.auth.getUser();
        assertCurrent(epoch);
        if (accountError || accountData?.user?.id !== user.id || !accountData.user.email_confirmed_at) throw problem('session', 'Verifikasi email dan masuk kembali sebelum menyiapkan bisnis.');
        await assertSession(user.id, epoch);
        const controller = new AbortController();
        rpcController = controller;
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
          const { data, error } = await client.rpc('vora_complete_onboarding', payload).abortSignal(controller.signal);
          assertCurrent(epoch);
          if (error) throw problem('onboarding', error.code === '42501' ? 'Akun ini belum dapat menyiapkan bisnis. Verifikasi email atau hubungi bantuan VORA POS.' : 'Profil belum dapat dikonfirmasi. Periksa koneksi lalu coba simpan lagi; data yang sudah tersimpan tidak dibuat ganda.');
          if (!data || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.outlet_id || '') || typeof data.created !== 'boolean') throw problem('onboarding', 'Profil belum dapat dikonfirmasi. Silakan coba simpan kembali.');
          await assertSession(user.id, epoch);
          return { kind: 'onboarded', userId: user.id, outletId: data.outlet_id, created: data.created, trialEndDate: data.trial_end_date || null };
        } finally { clearTimeout(timer); if (rpcController === controller) rpcController = null; }
      });
    },
    dispose() {
      disposed = true;
      identityEpoch++;
      rpcController?.abort();
      subscription.unsubscribe();
      if (busy) onBusy(false);
    },
  };
}

const icons = {
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>', back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>', check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  shop: '<path d="M4 11v9h16v-9M3 9l2-6h14l2 6c0 3-4 3-4 0 0 3-5 3-5 0 0 3-5 3-5 0-1 3-4 3-4 0ZM9 20v-6h6v6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
};
const icon = name => `<svg class="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
const route = (view, text, classes = 'auth-link') => `<a class="${classes}" href="#${view}" data-route="${view}">${text}</a>`;
const logo = () => '<span class="auth-logo"><img src="/dashboard-assets-vora-logo-transparent.png" alt="VORA POS"></span>';
const field = (id, label, attributes = '', hint = '', classes = 'auth-input') => `<div class="auth-field"><label for="${id}">${label}</label><input class="${classes}" id="${id}" ${attributes}${hint ? ` aria-describedby="${id}-hint"` : ''}>${hint ? `<p class="auth-field-hint" id="${id}-hint">${hint}</p>` : ''}</div>`;
const password = (id, label = 'Password', signup = false) => `<div class="auth-field"><label for="${id}">${label}</label><div class="auth-password"><input class="auth-input" id="${id}" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" ${signup ? 'minlength="8"' : ''} maxlength="${signup ? 128 : 512}" required placeholder="${signup ? 'Minimal 8 karakter' : 'Masukkan password Anda'}"><button type="button" class="auth-reveal" data-auth-reveal="${id}" aria-label="Tampilkan ${label.toLowerCase()}" aria-pressed="false">${icon('eye')}</button></div></div>`;
const submit = text => `<button type="submit" class="auth-button auth-button-primary" data-auth-submit><span>${text}</span>${icon('arrow')}</button>`;
const feedback = '<p class="auth-error" data-auth-error role="alert" hidden></p><p class="auth-status" data-auth-status role="status" hidden></p>';
const emailField = (value = '') => field('auth-email', 'Alamat email', `type="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${escape(value)}" placeholder="nama@bisnis.com" required maxlength="254"`);
function steps(active) { return `<ol class="auth-steps" aria-label="Langkah pendaftaran">${['Akun', 'Verifikasi', 'Usaha'].map((label, index) => `<li class="${index < active ? 'is-complete' : ''} ${index === active ? 'is-current' : ''}"${index === active ? ' aria-current="step"' : ''}><span>${index < active ? icon('check') : index + 1}</span><b>${label}</b></li>`).join('')}</ol>`; }
function story() {
  return `<aside class="auth-story" aria-label="VORA POS untuk usaha Anda"><div class="auth-story-top">${route('login', logo(), 'auth-brand-link')}<span class="auth-product-tag">BACKOFFICE</span></div><div class="auth-story-content"><p class="auth-eyebrow">RUANG UNTUK USAHA ANDA</p><h2>Usaha berjalan.<br>Anda pegang<br><em>kendalinya.</em></h2><p class="auth-story-description">Dari transaksi pertama sampai keputusan berikutnya. Lihat usaha Anda lebih utuh, dalam satu tempat.</p><div class="auth-insight-card auth-welcome-card"><span class="auth-insight-symbol">${icon('shop')}</span><h3>Terhubung dengan usaha Anda.</h3><p>Gunakan akun VORA POS yang sama dengan aplikasi kasir untuk membuka backoffice.</p><div class="auth-story-points"><span>${icon('check')} Laporan transaksi tersinkron</span><span>${icon('check')} Produk, stok, dan operasional usaha</span><span>${icon('check')} Akses sesuai akun dan outlet Anda</span></div></div></div><div class="auth-story-footer"><span>Dirancang untuk langkah usaha Anda.</span><span>VORA POS © 2026</span></div></aside>`;
}
function login() {
  return `<div class="auth-heading"><span class="auth-kicker">SELAMAT DATANG KEMBALI</span><h1 id="auth-title">Ruang usaha Anda,<br>siap dibuka.</h1><p>Masuk dengan akun VORA POS Anda.</p></div><form class="auth-form" data-auth-form="login" novalidate>${emailField()}${password('auth-password')}<div class="auth-form-meta"><span>${icon('shield')} Akun VORA POS</span><a class="auth-link" href="${FORGOT_URL}">Lupa password?</a></div>${feedback}${submit('Masuk')}</form><div class="auth-signup-panel"><p>Belum punya akun?</p>${route('signup', `Daftar akun${icon('arrow')}`, 'auth-button auth-button-secondary auth-signup-button')}</div><p class="auth-switch">Sudah menerima kode? ${route('verify', 'Verifikasi email')}</p>`;
}
function signup() {
  return `${steps(0)}<div class="auth-heading"><span class="auth-trial-tag">${icon('spark')} Mulai bersama VORA</span><h1 id="auth-title">Awal yang baik<br>untuk usaha Anda.</h1><p>Daftar, verifikasi email, lalu lengkapi profil usaha Anda.</p></div><form class="auth-form" data-auth-form="signup" novalidate>${emailField()}${field('auth-phone', 'Nomor handphone', 'type="tel" autocomplete="tel" inputmode="tel" placeholder="081234567890" required maxlength="24"', 'Kode verifikasi dikirim ke email, bukan ke nomor telepon.')}<div class="auth-field-pair">${password('auth-password', 'Password', true)}${password('auth-password-confirm', 'Ulangi password', true)}</div>${feedback}${submit('Daftar akun')}</form><p class="auth-demo-helper">Masa trial dihitung oleh sistem sejak email pertama kali terverifikasi.</p><p class="auth-switch">Sudah punya akun? ${route('login', 'Masuk')}</p>`;
}
function verify() {
  return `${steps(1)}<div class="auth-heading"><span class="auth-state-icon">${icon('mail')}</span><h1 id="auth-title">Satu langkah lagi.<br>Verifikasi email Anda.</h1><p>Masukkan kode 8 digit dari email pendaftaran. Periksa juga folder spam.</p></div><form class="auth-form" data-auth-form="verify" novalidate>${emailField(authDraft.email)}${field('auth-code', 'Kode verifikasi 8 digit', 'type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" maxlength="8" minlength="8" placeholder="00000000" required', '', 'auth-input auth-code')}${feedback}${submit('Verifikasi & lanjutkan')}</form><p class="auth-demo-helper">Belum menerima kode? <button class="auth-text-button" type="button" data-auth-resend>Kirim ulang kode</button></p><p class="auth-switch">${route('login', `${icon('back')} Kembali ke login`, 'auth-link auth-back-link')}</p>`;
}
function business(context) {
  const phone = normalizePhone(context.user?.user_metadata?.phone || '');
  return `${steps(2)}<div class="auth-heading"><span class="auth-kicker">KENALAN DENGAN USAHA ANDA</span><h1 id="auth-title">Beri usaha Anda<br>ruang untuk tumbuh.</h1><p>Lengkapi profil bisnis Anda. Masa trial mengikuti tanggal verifikasi pertama, bukan tanggal pengisian profil.</p></div><form class="auth-form" data-auth-form="business" novalidate><div class="auth-field-pair">${field('auth-owner-name', 'Nama owner', 'type="text" autocomplete="name" placeholder="Nama lengkap Anda" required maxlength="120"')}${field('auth-business-phone', 'Nomor telepon bisnis', `type="tel" autocomplete="tel" inputmode="tel" value="${escape(phone)}" placeholder="081234567890" required maxlength="24"`)}</div>${field('auth-business-name', 'Nama bisnis', 'type="text" autocomplete="organization" placeholder="Nama usaha Anda" required maxlength="160"')}<div class="auth-field"><label for="auth-business-type">Jenis usaha</label><select class="auth-input" id="auth-business-type" required><option value="">Pilih jenis usaha</option>${BUSINESS_TYPES.map(type => `<option>${escape(type)}</option>`).join('')}</select></div>${field('auth-business-address', 'Alamat bisnis', 'type="text" autocomplete="street-address" placeholder="Nama jalan dan nomor" required maxlength="1000"')}${feedback}${submit('Simpan profil & lanjutkan')}</form><p class="auth-demo-helper">Untuk bisnis baru, akses owner dibuat dengan PIN awal 123456. Ganti PIN melalui Pengaturan di aplikasi kasir.</p>`;
}
function recovery() {
  return `<div class="auth-top-back">${route('login', `${icon('back')} Kembali ke login`, 'auth-link auth-back-link')}</div><div class="auth-heading"><span class="auth-state-icon">${icon('shield')}</span><h1 id="auth-title">Pulihkan akses<br>akun Anda.</h1><p>Pemulihan password tersedia di halaman resmi VORA POS. Buka tautan dari email pemulihan untuk mengatur password baru.</p></div><a class="auth-button auth-button-primary" href="${FORGOT_URL}">Buka pemulihan password${icon('arrow')}</a>`;
}
export function renderAuth(view = 'login', context = {}) {
  const views = { login, signup, verify, business, forgot: recovery, reset: recovery };
  const current = Object.hasOwn(views, view) ? view : 'login';
  return `<div class="auth-app auth-production" data-auth-view="${current}"><div class="auth-layout">${story()}<section class="auth-main" id="main" tabindex="-1" aria-labelledby="auth-title"><div class="auth-mobile-brand">${route('login', logo(), 'auth-brand-link')}<span>VORA BACKOFFICE</span></div><div class="auth-form-wrap auth-view-${current}">${views[current](context)}</div><p class="auth-bottom-note">VORA POS <span>·</span> Lebih dekat dengan usaha Anda.</p></section></div></div>`;
}

export function bindAuth(container, api) {
  const events = new AbortController();
  let mounted = true;
  let busy = false;
  let released = false;
  const find = selector => container.querySelector(selector);
  const releaseRootBusy = () => { if (!released) { released = true; api.setAuthBusy?.(false); } };
  const current = () => mounted && (!api.isCurrent || api.isCurrent());
  const value = id => find('#' + id)?.value || '';
  const clearSecrets = () => container.querySelectorAll('#auth-password,#auth-password-confirm,#auth-code').forEach(input => { input.value = ''; });
  const show = (message, success = false) => {
    if (!current()) return;
    const box = find(success ? '[data-auth-status]' : '[data-auth-error]');
    if (box) { box.textContent = message; box.hidden = false; }
  };
  const refreshCooldown = () => {
    if (!current()) return;
    const button = find('[data-auth-resend]');
    if (!button) return;
    const seconds = flow.remainingSeconds();
    button.textContent = seconds ? `Kirim ulang dalam ${seconds} dtk` : 'Kirim ulang kode';
    button.disabled = busy || seconds > 0;
  };
  const flow = createAuthFlow({
    client: api.client, user: api.user, isCurrent: current,
    onBusy(active) {
      busy = active;
      // Release exactly once even when adopting a session unmounts this view.
      if (active) { released = false; api.setAuthBusy?.(true); }
      else releaseRootBusy();
      if (!current()) return;
      container.querySelectorAll('input,select,button').forEach(control => { control.disabled = active; });
      container.querySelectorAll('form').forEach(form => form.setAttribute('aria-busy', String(active)));
      const button = find('[data-auth-submit]');
      if (button) {
        const text = button.querySelector('span');
        if (active) { button.dataset.authLabel = text.textContent; text.textContent = 'Memproses…'; }
        else text.textContent = button.dataset.authLabel || text.textContent;
      }
      refreshCooldown();
    },
    async onResult(result) {
      if (!current()) return;
      if (result.kind === 'verify') {
        clearSecrets();
        api.toast?.(result.sent ? 'Jika akun memerlukan verifikasi, kode dikirim ke email Anda. Periksa inbox dan spam.' : 'Email belum terverifikasi. Masukkan kode pendaftaran atau kirim ulang kode.');
        releaseRootBusy();
        api.navigate('verify');
      } else if (result.kind === 'resent') {
        const code = find('#auth-code'); if (code) code.value = '';
        show('Jika akun masih memerlukan verifikasi, kode terbaru akan dikirim. Periksa inbox dan spam.', true);
      } else if (result.kind === 'authenticated') {
        clearSecrets();
        if (api.onAuthenticated) await api.onAuthenticated(result.session);
        else await api.refreshSession?.();
      } else if (result.kind === 'onboarded') {
        api.toast?.(result.created ? 'Profil tersimpan. PIN awal owner: 123456. Ganti PIN di Pengaturan aplikasi kasir.' : 'Profil bisnis sudah tersimpan.');
        await api.refreshSession?.({ outletId: result.outletId, userId: result.userId });
      }
    },
  });
  async function perform(kind) {
    if (busy || !current()) return;
    for (const selector of ['[data-auth-error]', '[data-auth-status]']) { const box = find(selector); if (box) box.hidden = true; }
    try {
      if (kind === 'login') await flow.login({ email: value('auth-email'), password: value('auth-password') });
      else if (kind === 'signup') await flow.signup({ email: value('auth-email'), phone: value('auth-phone'), password: value('auth-password'), confirmation: value('auth-password-confirm') });
      else if (kind === 'verify') await flow.verify({ email: value('auth-email'), token: value('auth-code') });
      else if (kind === 'resend') await flow.resend({ email: value('auth-email') });
      else if (kind === 'business') await flow.completeBusiness({ businessName: value('auth-business-name'), ownerName: value('auth-owner-name'), phone: value('auth-business-phone'), address: value('auth-business-address'), businessType: value('auth-business-type') });
    } catch (error) {
      if (error?.code !== 'cancelled' && error?.code !== 'busy') show(authErrorMessage(error));
    }
  }
  container.addEventListener('submit', event => {
    const form = event.target.closest('[data-auth-form]');
    if (!form) return;
    event.preventDefault();
    void perform(form.dataset.authForm);
  }, { signal: events.signal });
  container.addEventListener('click', event => {
    if (busy && event.target.closest('a,button')) { event.preventDefault(); event.stopPropagation(); return; }
    const reveal = event.target.closest('[data-auth-reveal]');
    if (reveal) {
      const input = find('#' + reveal.dataset.authReveal);
      if (!input) return;
      const shown = input.type === 'password';
      input.type = shown ? 'text' : 'password';
      reveal.setAttribute('aria-pressed', String(shown));
      reveal.setAttribute('aria-label', shown ? 'Sembunyikan password' : 'Tampilkan password');
    }
    if (event.target.closest('[data-auth-resend]')) void perform('resend');
  }, { signal: events.signal, capture: true });
  container.addEventListener('input', event => {
    if (event.target.id === 'auth-code') event.target.value = event.target.value.replace(/\D/g, '').slice(0, 8);
    for (const selector of ['[data-auth-error]', '[data-auth-status]']) { const box = find(selector); if (box) box.hidden = true; }
  }, { signal: events.signal });
  const timer = setInterval(refreshCooldown, 1000);
  refreshCooldown();
  return () => { mounted = false; events.abort(); clearInterval(timer); clearSecrets(); flow.dispose(); };
}

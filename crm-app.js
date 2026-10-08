import { createAuth } from '/crm-auth.js';
import { createApi } from '/crm-data.js';
import { STATUS, OUTCOME, ROLES, ROLE_HELP, PLANS, esc, money, date, remaining, customerExpiry, whatsapp, renewalPreview, renewalPayload, isRenewalConflict, allowedPages, humanError } from '/crm-model.js';
const app = document.querySelector('#app'),
  modalRoot = document.querySelector('#modal-root');
const paths = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z',
  clock: 'M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11 M9 12l2 2 4-4',
  audit: 'M9 3h6v4H9z M9 5H5v16h14V5h-4 M8 12h8 M8 16h5',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 11.5-2L20 8 M4 16l2.5 3A7 7 0 0 0 18 17',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  close: 'M6 6l12 12 M18 6 6 18',
  search: 'M21 21l-5-5 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  plus: 'M12 5v14 M5 12h14',
  check: 'M20 6 9 17l-5-5',
  store: 'M3 10h18l-2-7H5z M5 10v11h14V10 M9 21v-7h6v7',
  mail: 'M3 5h18v14H3z M3 5l9 7 9-7',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',
  chevron: 'M9 5l7 7-7 7',
  calendar: 'M8 2v4 M16 2v4 M3 10h18 M3 4h18v18H3z',
  spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
const nav = {
  overview: ['Ringkasan', 'grid'],
  users: ['Pengguna', 'users'],
  followups: ['Follow-up', 'chat'],
  renewals: ['Perpanjangan', 'clock'],
  team: ['Tim & akses', 'shield'],
  audit: ['Log aktivitas', 'audit']
};
const state = {
  userId: null,
  session: null,
  page: 'overview',
  data: null,
  loading: false,
  error: '',
  search: '',
  status: 'all',
  offset: 0,
  menu: false,
  epoch: 0,
  loadId: 0,
  modal: null,
  authMode: 'login',
  authEmail: '',
  authError: '',
  authBusy: false,
  authMessage: ''
};
let auth,
  api,
  authEpoch = 0,
  authorizeUser = null,
  searchTimer,
  modalReturnFocus,
  logoutPromise;
const uuid = () => crypto.randomUUID();
const initials = value => String(value || 'V').split(/[\s@]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const badge = (status, labels = STATUS) => `<span class="status ${esc(status)}">${esc(labels[status] || status || 'Belum dihubungi')}</span>`;
const can = permission => Boolean(state.session?.permissions?.[permission]);
function denyAccess(error) {
  if (!['42501', 'PGRST301', 'PGRST302'].includes(error?.code)) return false;
  clearPrivate();
  state.authError = humanError(error);
  renderDenied();
  return true;
}
const customerName = item => item.owner_name || item.email || item.outlets?.[0]?.name || 'Akun pengguna';
const empty = (title, subtitle = '', symbol = 'users') => `<div class="empty">${icon(symbol)}<h3>${esc(title)}</h3><p>${esc(subtitle)}</p></div>`;
const loading = () => '<div class="loading"><span class="spinner"></span>Memuat data…</div>';
function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.querySelector('#toasts').append(node);
  setTimeout(() => node.remove(), 5500);
}
function clearPrivate() {
  state.epoch++;
  state.loadId++;
  api?.cancel();
  state.userId = null;
  state.session = null;
  state.data = null;
  state.error = '';
  state.loading = false;
  state.search = '';
  state.status = 'all';
  state.offset = 0;
  state.page = 'overview';
  state.menu = false;
  authorizeUser = null;
  clearTimeout(searchTimer);
  closeModal();
  document.querySelector('#toasts').replaceChildren();
}
function bootAuth() {
  const epoch = ++authEpoch;
  auth = createAuth((event, session) => {
    if (epoch !== authEpoch || auth.isRetired()) return;
    if (event === 'SIGNED_OUT') {
      void signOut(false);
      return;
    }
    if (session?.user) {
      if (session.user.id !== state.userId) void authorize(session);else if (event === 'TOKEN_REFRESHED' && state.session) void loadPage();
    } else if (event === 'INITIAL_SESSION' && !state.userId) {
      renderAuth();
    }
  });
  api = createApi(auth.client);
}
async function authorize(session) {
  if (authorizeUser === session.user.id) return;
  clearPrivate();
  state.userId = session.user.id;
  authorizeUser = session.user.id;
  const epoch = state.epoch;
  app.innerHTML = `<main class="boot" id="main"><img src="/crm-assets-vora-logo-transparent.png" alt="VORA">${loading()}</main>`;
  try {
    const result = await api.session();
    if (epoch !== state.epoch) return;
    if (!result?.member?.active) throw new Error('Email ini belum mendapat akses CRM. Minta pemilik menambahkan email Anda di Tim & akses.');
    state.session = result;
    state.page = can('read_customers') ? 'overview' : can('renew') ? 'renewals' : 'overview';
    state.authBusy = false;
    render();
    await loadPage();
  } catch (error) {
    if (epoch !== state.epoch) return;
    state.session = null;
    state.authBusy = false;
    state.authError = humanError(error);
    renderDenied();
  } finally {
    if (epoch === state.epoch) authorizeUser = null;
  }
}
async function signOut(broadcast = true) {
  if (logoutPromise) return logoutPromise;
  const old = auth;
  ++authEpoch;
  clearPrivate();
  state.authMode = 'login';
  state.authError = '';
  state.authBusy = true;
  state.authMessage = '';
  state.authEmail = '';
  renderAuth();
  logoutPromise = (async () => {
    let storageError;
    try {
      const result = await old.logout(broadcast);
      storageError = result?.storageError;
    } catch {
      storageError = true;
    }
    if (storageError) {
      state.authError = 'Penyimpanan sesi belum dapat dibersihkan. Tutup tab ini sebelum memakai perangkat bersama.';
      state.authBusy = true;
    } else {
      bootAuth();
      state.authBusy = false;
    }
    renderAuth();
  })();
  try {
    await logoutPromise;
  } finally {
    logoutPromise = null;
  }
}
function authLayout(content) {
  app.innerHTML = `<main id="main" class="auth-page"><section class="auth-story"><div class="brand"><img src="/crm-assets-vora-logo-transparent.png" alt="VORA"><span>CRM</span></div><div class="auth-story-content"><div class="eyebrow">Ruang kerja internal</div><h1>Kenali pengguna.<br>Bangun <em>hubungan.</em></h1><p>Satu tempat untuk memahami perjalanan pengguna, menindaklanjuti trial, dan menjaga bisnis mereka terus berjalan.</p></div><div class="story-foot">VORA · Customer relationship management</div></section><section class="auth-form-side">${content}<div class="auth-privacy">${icon('shield')}<span>Akses khusus tim yang diberi izin oleh pemilik. Data pengguna hanya tersedia setelah akun Anda diverifikasi.</span></div></section></main>`;
}
function renderAuth() {
  let body = '';
  if (state.authMode === 'verify') {
    body = `<div class="eyebrow">Aktivasi akun tim</div><h2>Periksa email Anda.</h2><p class="intro muted">Masukkan kode verifikasi yang dikirim ke <strong>${esc(state.authEmail)}</strong>.</p><form id="verify-form"><label class="field">Kode verifikasi<input name="token" type="text" inputmode="numeric" pattern="[0-9]{8}" minlength="8" maxlength="8" autocomplete="one-time-code" required placeholder="8 digit kode"></label><div class="error" role="alert">${esc(state.authError)}</div><button class="button primary full" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Memverifikasi…' : 'Verifikasi & masuk'}</button></form><div class="auth-footer"><button class="link-button" data-action="auth-mode" data-mode="login">Kembali ke masuk</button></div>`;
  } else if (state.authMode === 'signup') {
    body = `<div class="eyebrow">Akses tim</div><h2>Aktifkan akun tim.</h2><p class="intro muted">Gunakan email yang sudah diberi akses oleh pemilik CRM.</p><form id="signup-form"><label class="field">Email tim<input type="email" name="email" autocomplete="email" value="${esc(state.authEmail)}" required placeholder="nama@contoh.com"></label><label class="field">Kata sandi<input type="password" name="password" minlength="8" autocomplete="new-password" required placeholder="Minimal 8 karakter"></label><label class="field">Ulangi kata sandi<input type="password" name="confirm" minlength="8" autocomplete="new-password" required placeholder="Masukkan kembali kata sandi"></label><div class="notice">Akun ini juga menjadi akun VORA Anda. Jika sudah memiliki akun VORA, gunakan email dan kata sandi yang sama untuk masuk.</div><div class="error" role="alert">${esc(state.authError)}</div><button class="button primary full" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Mengirim kode…' : 'Kirim kode verifikasi'} ${icon('arrow')}</button></form><div class="auth-footer">Sudah punya akun? <button class="link-button" data-action="auth-mode" data-mode="login">Masuk</button></div>`;
  } else {
    body = `<div class="eyebrow">VORA CRM</div><h2>Selamat datang kembali.</h2><p class="intro muted">Masuk untuk melanjutkan hubungan baik dengan pengguna VORA.</p><form id="login-form"><label class="field">Email<input type="email" name="email" autocomplete="username" required value="${esc(state.authEmail)}" placeholder="nama@contoh.com"></label><label class="field">Kata sandi<input type="password" name="password" autocomplete="current-password" required placeholder="Masukkan kata sandi"></label><div class="row between"><span class="helper">Gunakan akun VORA Anda.</span><a class="small" href="https://vorakasir.com/forgot-password.html" target="_blank" rel="noopener noreferrer">Lupa kata sandi?</a></div><div class="error" role="alert">${esc(state.authError)}</div>${state.authMessage ? `<div class="notice">${esc(state.authMessage)}</div>` : ''}<button class="button primary full" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Memeriksa akses…' : 'Masuk ke CRM'} ${icon('arrow')}</button></form><div class="auth-footer">Anggota tim baru? <button class="link-button" data-action="auth-mode" data-mode="signup">Aktifkan akun tim</button></div>`;
  }
  authLayout(body);
}
function renderDenied() {
  authLayout(`<div class="account-lock">${icon('lock')}</div><h2>Akses belum tersedia.</h2><p class="intro muted">Hanya akun yang diberi izin oleh pemilik dapat membuka CRM.</p><div class="error" role="alert">${esc(state.authError)}</div><div class="stack"><p class="helper">Jika baru mendapat akses, coba periksa kembali. Pastikan email akun Anda sudah terverifikasi.</p><button class="button primary full" data-action="recheck-access">Periksa akses lagi</button><button class="button full" data-action="logout">Keluar & gunakan akun lain</button></div>`);
}
function render() {
  if (!state.session) return;
  const member = state.session.member;
  const pages = allowedPages(state.session.permissions);
  app.innerHTML = `<div class="app-shell ${state.menu ? 'menu-open' : ''}"><button class="mobile-overlay" aria-label="Tutup navigasi" data-action="menu-close"></button><aside class="sidebar"><div class="brand"><img src="/crm-assets-vora-logo-transparent.png" alt="VORA"><span>CRM</span></div><div class="nav-label">WORKSPACE</div><nav class="nav-list" aria-label="Navigasi CRM">${pages.filter(p => !['team', 'audit'].includes(p)).map(p => navButton(p)).join('')}</nav>${pages.some(p => ['team', 'audit'].includes(p)) ? `<div class="nav-label">PENGELOLAAN</div><nav class="nav-list" aria-label="Pengelolaan CRM">${pages.filter(p => ['team', 'audit'].includes(p)).map(p => navButton(p)).join('')}</nav>` : ''}<div class="sidebar-bottom"><div class="row"><div class="member-avatar">${esc(initials(member.email))}</div><div class="member-copy"><strong>${esc(member.email?.split('@')[0] || 'Tim VORA')}</strong><small>${esc(ROLES[member.role] || member.role)}</small></div><button class="logout-button" data-action="logout" aria-label="Keluar" title="Keluar">${icon('logout')}</button></div><p class="sidebar-note">Ruang kerja internal VORA.<br>Akses sesuai peran Anda.</p></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <strong>${nav[state.page][0]}</strong></div><div class="mobile-brand"><button class="icon-button mobile-menu" data-action="menu" aria-label="Buka navigasi" aria-expanded="${state.menu}">${icon('menu')}</button><img src="/crm-assets-vora-logo-transparent.png" alt="VORA"><small>CRM</small></div><div class="topbar-right"><span class="today">${esc(date(new Date()))}</span><span class="private-label">${icon('lock')} INTERNAL ONLY</span></div></header><main id="main" class="main-content" tabindex="-1">${pageHeading()}${state.error ? `<div class="error page-error" role="alert">${esc(state.error)} <button class="link-button" data-action="refresh">Coba lagi</button></div>` : ''}<div id="page-content" ${state.loading ? 'aria-busy="true"' : ''}>${state.loading && !state.data ? loading() : pageContent()}</div></main></div></div>`;
}
function navButton(page) {
  return `<button class="nav-item ${state.page === page ? 'active' : ''}" data-action="nav" data-page="${page}" ${state.page === page ? 'aria-current="page"' : ''}>${icon(nav[page][1])}${nav[page][0]}</button>`;
}
function pageHeading() {
  const titles = {
    overview: ['GAMBARAN HARI INI', 'Hubungan yang bertumbuh.', 'Pantau perjalanan pengguna, dari trial hingga pelanggan setia.'],
    users: ['DIREKTORI PENGGUNA', 'Kenali pengguna Anda.', 'Data pendaftaran, kontak, outlet, dan status langganan dalam satu tempat.'],
    followups: ['HUBUNGAN PELANGGAN', 'Percakapan berikutnya.', 'Catat hasil komunikasi dan jadwalkan tindak lanjut yang tepat.'],
    renewals: ['LANGGANAN', 'Bantu bisnis terus berjalan.', 'Perpanjang outlet setelah pembayaran pengguna Anda verifikasi.'],
    team: ['PENGELOLAAN AKSES', 'Tim yang tepat, akses yang tepat.', 'Tentukan siapa yang dapat melihat data dan membantu pelanggan.'],
    audit: ['JEJAK AKTIVITAS', 'Setiap tindakan, tercatat.', 'Lihat perubahan akses, follow-up, dan perpanjangan oleh tim.']
  };
  const t = titles[state.page];
  return `<div class="page-heading"><div><div class="eyebrow">${t[0]}</div><h1>${t[1]}</h1><p>${t[2]}</p></div>${state.page === 'team' ? `<button class="button primary" data-action="add-member">${icon('plus')} Tambah tim</button>` : `<button class="button" data-action="refresh" aria-label="Perbarui" ${state.loading ? 'disabled' : ''}>${icon('refresh')} <span class="refresh-text">Perbarui</span></button>`}</div>`;
}
async function loadPage() {
  if (!state.session) return;
  const epoch = state.epoch,
    id = ++state.loadId,
    page = state.page;
  state.loading = true;
  state.error = '';
  render();
  try {
    const session = await api.session();
    if (epoch !== state.epoch || id !== state.loadId) return;
    if (!session?.member?.active) throw Object.assign(new Error('Akses akun sudah dinonaktifkan.'), {
      code: '42501'
    });
    if (JSON.stringify(state.session.permissions) !== JSON.stringify(session.permissions)) {
      state.epoch++;
      api.cancel();
      closeModal();
      state.data = null;
      state.session = session;
      state.loading = false;
      if (!allowedPages(session.permissions).includes(page)) state.page = session.permissions.renew ? 'renewals' : 'overview';
      return loadPage();
    }
    state.session = session;
    if (!allowedPages(session.permissions).includes(page)) {
      state.data = null;
      state.page = can('renew') ? 'renewals' : 'overview';
      state.loading = false;
      render();
      return loadPage();
    }
    let data;
    if (page === 'team') data = await api.members();else if (page === 'audit') data = await api.audit({
      p_limit: 25,
      p_offset: state.offset
    });else if (page === 'overview' && can('read_customers')) {
      const [all, trial] = await Promise.all([api.list({
        p_limit: 6
      }), api.list({
        p_status: 'trial',
        p_limit: 100
      })]);
      data = {
        ...all,
        trialItems: trial.items || []
      };
    } else data = await api.list({
      p_search: state.search,
      p_status: state.status,
      p_limit: 25,
      p_offset: state.offset
    });
    if (epoch !== state.epoch || id !== state.loadId) return;
    state.data = data;
  } catch (error) {
    if (epoch !== state.epoch || id !== state.loadId) return;
    if (denyAccess(error)) return;
    state.error = humanError(error);
  } finally {
    if (epoch === state.epoch && id === state.loadId) {
      state.loading = false;
      render();
    }
  }
}
function pageContent() {
  if (!state.data) return state.error ? empty('Data belum dapat dimuat', 'Gunakan tombol coba lagi untuk menghubungkan ulang.', 'refresh') : loading();
  if (state.page === 'overview') return overview();
  if (state.page === 'team') return team();
  if (state.page === 'audit') return audit();
  if (state.page === 'renewals') return renewals();
  return directory();
}
function kpi(label, value, hint, symbol, featured = false) {
  return `<article class="kpi ${featured ? 'featured' : ''}"><div class="label">${esc(label)}${icon(symbol)}</div><div class="value">${esc(value ?? 0)}</div><div class="hint">${esc(hint)}</div></article>`;
}
function overview() {
  const d = state.data,
    s = d.summary || {},
    ending = (d.trialItems || []).filter(c => Number(c.days_remaining) <= 3).sort((a, b) => a.days_remaining - b.days_remaining).slice(0, 5);
  if (!can('read_customers')) return empty('Ruang kerja Anda siap', 'Gunakan menu yang tersedia sesuai akses yang diberikan pemilik.', 'shield');
  return `<section class="kpis" aria-label="Ringkasan pengguna">${kpi('Total pengguna', s.total, 'Akun yang telah mendaftar', 'users', true)}${kpi('Sedang trial', s.trial, 'Kesempatan membangun kepercayaan', 'clock')}${kpi('Berlangganan aktif', s.active, 'Pengguna dengan langganan aktif', 'check')}${kpi('Perlu follow-up', s.followup_due, 'Jadwal tindak lanjut telah tiba', 'chat')}</section><div class="callout"><div class="callout-icon">${icon('spark')}</div><div><h3>Percakapan kecil, hubungan yang berarti.</h3><p>${Number(s.expired) > 0 ? `${esc(s.expired)} pengguna telah melewati masa aktif. Hubungi mereka untuk memahami kebutuhan dan membantu melanjutkan langganan.` : 'Mulai dari pengguna yang mendekati akhir trial. Tanyakan pengalaman mereka dan bantu kendala yang dihadapi.'}</p></div><button class="button" data-action="nav" data-page="followups">Buka follow-up ${icon('arrow')}</button></div><div class="overview-grid"><section class="panel"><header class="panel-header"><div><h2>Pengguna terbaru</h2><p>Awal perjalanan mereka bersama VORA.</p></div><button class="button tiny" data-action="nav" data-page="users">Lihat semua ${icon('arrow')}</button></header>${customerTable(d.items || [], true)}<footer class="panel-footer">Data pendaftaran tersimpan langsung dari akun VORA.</footer></section><div class="stack"><section class="panel"><header class="panel-header"><div><h2>Trial segera berakhir</h2><p>Pengguna dengan sisa trial 3 hari atau kurang.</p></div><span class="badge-count">${ending.length}</span></header>${ending.length ? `<div class="list">${ending.map(c => `<div class="list-item"><div class="initials">${esc(initials(customerName(c)))}</div><div><button class="link-button" data-action="detail" data-id="${esc(c.merchant_id)}">${esc(customerName(c))}</button><div class="subtitle">${esc(c.outlets?.[0]?.name || 'Belum ada outlet')}</div></div><div class="right"><span class="status trial">${esc(remaining(c.days_remaining, 'trial'))}</span></div></div>`).join('')}</div>` : empty('Semua masih punya waktu', 'Belum ada trial yang segera berakhir dalam daftar ini.', 'clock')}<footer class="panel-footer">Dari maksimal 100 pengguna trial terbaru.</footer></section><section class="panel"><div class="panel-body"><h3>Perjalanan pengguna</h3><div class="stat-row"><span class="muted">Menunggu verifikasi email</span><span class="value">${esc(s.unverified || 0)}</span></div><div class="stat-row"><span class="muted">Belum membuat outlet</span><span class="value">${esc(s.onboarding || 0)}</span></div><div class="stat-row"><span class="muted">Masa aktif berakhir</span><span class="value">${esc(s.expired || 0)}</span></div></div></section></div></div>`;
}
function toolbar() {
  return `<form id="search-form" class="toolbar"><label class="search">${icon('search')}<input name="search" id="customer-search" aria-label="Cari pengguna" placeholder="${can('read_customers') ? 'Cari nama, email, nomor HP, atau outlet…' : 'Cari nama outlet…'}" maxlength="100" value="${esc(state.search)}"></label><select name="status" id="status-filter" class="filter" aria-label="Filter status"><option value="all">Semua status</option>${state.page === 'followups' ? `<option value="followup_due" ${state.status === 'followup_due' ? 'selected' : ''}>Follow-up jatuh tempo</option>` : ''}${Object.entries(STATUS).map(([key, value]) => `<option value="${key}" ${state.status === key ? 'selected' : ''}>${value}</option>`).join('')}</select><button class="button" type="submit">Cari</button></form>`;
}
function pagination() {
  const d = state.data,
    total = Number(d.total || 0),
    count = (d.items || []).length;
  return `<div class="pagination"><span>${total ? `${state.offset + 1}–${Math.min(state.offset + count, total)} dari ${total}` : '0'} ${state.page === 'audit' ? 'aktivitas' : 'data'}</span><span class="spacer"></span><button class="button" data-action="previous" ${state.offset <= 0 ? 'disabled' : ''}>Sebelumnya</button><button class="button" data-action="next" ${state.offset + 25 >= total ? 'disabled' : ''}>Berikutnya</button></div>`;
}
function customerTable(items, compact = false) {
  if (!items.length) return empty('Belum ada pengguna', 'Data akan muncul ketika pengguna mendaftar, atau coba ubah pencarian Anda.');
  return `<div class="table-scroll"><table><thead><tr><th>Pengguna</th>${!compact ? '<th>Kontak</th>' : ''}<th>Status</th><th>${compact ? 'Terdaftar' : 'Masa aktif'}</th>${!compact ? '<th>Outlet</th>' : ''}<th><span class="muted">Detail</span></th></tr></thead><tbody>${items.map(c => `<tr><td><div class="table-name"><span class="initials">${esc(initials(customerName(c)))}</span><div><strong>${esc(customerName(c))}</strong><small>${esc(c.outlets?.[0]?.name || c.email || 'Belum ada outlet')}</small></div></div></td>${!compact ? `<td>${esc(c.phone || 'Belum diisi')}<span class="cell-secondary">${esc(c.email || '—')}</span></td>` : ''}<td>${badge(c.status)}</td><td>${compact ? esc(date(c.created_at)) : `${esc(remaining(c.days_remaining, c.status))}<span class="cell-secondary">${esc(date(customerExpiry(c)))}</span>`}</td>${!compact ? `<td>${esc(c.outlet_count || c.outlets?.length || 0)} outlet</td>` : ''}<td><button class="table-action" data-action="detail" data-id="${esc(c.merchant_id)}">Buka ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`;
}
function directory() {
  const items = state.data.items || [];
  if (state.page === 'users') return `<section class="panel">${toolbar()}${customerTable(items)}${pagination()}</section>`;
  return `<section class="panel">${toolbar()}${items.length ? `<div class="table-scroll"><table><thead><tr><th>Pengguna</th><th>Status akun</th><th>Follow-up terakhir</th><th>Jadwal berikutnya</th><th>Tindakan</th></tr></thead><tbody>${items.map(c => {
    const f = c.last_followup;
    const due = c.next_followup_at && new Date(c.next_followup_at) <= new Date(state.data.server_now || Date.now());
    return `<tr><td><div class="table-name"><span class="initials">${esc(initials(customerName(c)))}</span><div><strong>${esc(customerName(c))}</strong><small>${esc(c.phone || c.email || 'Kontak belum diisi')}</small></div></div></td><td>${badge(c.status)}</td><td>${f ? badge(f.outcome, OUTCOME) : '<span class="muted">Belum dihubungi</span>'}${f ? `<span class="cell-secondary">${esc(date(f.created_at))}</span>` : ''}</td><td>${c.next_followup_at ? `${due ? '<span class="status trial">Perlu ditindaklanjuti</span>' : ''}<span class="cell-secondary">${esc(date(c.next_followup_at, true))}</span>` : '<span class="muted">Belum dijadwalkan</span>'}</td><td><button class="table-action" data-action="detail" data-id="${esc(c.merchant_id)}">${can('followup') ? 'Tindak lanjuti' : 'Lihat catatan'} ${icon('arrow')}</button></td></tr>`;
  }).join('')}</tbody></table></div>` : empty('Belum ada pengguna untuk dihubungi', 'Coba ubah pencarian atau filter status.', 'chat')}${pagination()}</section>`;
}
function renewals() {
  const items = state.data.items || [],
    outlets = items.flatMap(c => (c.outlets || []).map(o => ({
      ...o,
      merchant_id: c.merchant_id,
      owner_name: c.owner_name
    })));
  return `<div class="notice warning page-error">Perpanjangan dilakukan manual setelah Anda memverifikasi pembayaran di luar CRM. Sistem mencatat perpanjangan; sistem tidak memeriksa transfer bank secara otomatis.</div><section class="panel">${toolbar()}${outlets.length ? `<div class="table-scroll"><table><thead><tr><th>Outlet</th><th>Status</th><th>Paket sekarang</th><th>Masa aktif hingga</th><th>Tindakan</th></tr></thead><tbody>${outlets.map(o => `<tr><td><div class="table-name"><span class="initials">${icon('store')}</span><div><strong>${esc(o.name || 'Outlet')}</strong>${o.owner_name ? `<small>${esc(o.owner_name)}</small>` : ''}</div></div></td><td>${badge(o.status)}</td><td>${esc(planName(o.subscription_plan))}</td><td>${esc(date(o.subscription_end_date))}<span class="cell-secondary">${esc(remaining(o.days_remaining, o.status))}</span></td><td><button class="button tiny primary" data-action="renew" data-id="${esc(o.id)}">Perpanjang ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada outlet dalam daftar', 'Pengguna perlu membuat outlet sebelum langganannya dapat diperpanjang.', 'store')}${pagination()}</section>`;
}
const planName = value => ({
  trial: 'Trial',
  'free trial': 'Trial',
  monthly: 'Bulanan',
  yearly: 'Tahunan',
  annual: 'Tahunan',
  biannual: '2 tahun',
  biennial: '2 tahun',
  free: 'Gratis'
})[String(value || '').toLowerCase()] || value || '—';
function team() {
  const items = state.data.items || [];
  return `<div class="notice page-error">Tambahkan email tim dan tentukan perannya. Anggota baru dapat memilih <strong>Aktifkan akun tim</strong> di halaman masuk CRM, lalu memverifikasi emailnya. Pemilik tetap menjadi satu-satunya pihak yang mengelola akses.</div><section class="panel"><header class="panel-header"><div><h2>Anggota CRM</h2><p>Izin hanya berlaku untuk ruang kerja CRM.</p></div><span class="badge-count">${items.length} anggota</span></header>${items.length ? `<div class="table-scroll"><table><thead><tr><th>Anggota</th><th>Akses</th><th>Status</th><th>Akun</th><th>Kelola</th></tr></thead><tbody>${items.map(m => `<tr><td><div class="table-name"><span class="initials">${esc(initials(m.email))}</span><div><strong>${esc(m.email)}</strong><small>Ditambahkan ${esc(date(m.created_at))}</small></div></div></td><td>${esc(ROLES[m.role] || m.role)}</td><td>${badge(m.active ? 'active' : 'expired', {
    active: 'Aktif',
    expired: 'Dinonaktifkan'
  })}</td><td>${m.auth_user_id ? '<span class="muted">Terhubung</span>' : '<span class="status trial">Menunggu aktivasi</span>'}</td><td>${m.role === 'owner' ? '<span class="muted">Pemilik</span>' : `<button class="table-action" data-action="edit-member" data-id="${esc(m.id)}">Ubah akses ${icon('arrow')}</button>`}</td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada anggota tim', 'Tambahkan akses melalui tombol Tambah tim.', 'shield')}<footer class="panel-footer">Bagikan tautan masuk secara manual: crm.vorakasir.com</footer></section>`;
}
function audit() {
  const labels = {
    'followup.created': 'Follow-up dicatat',
    'renewal.created': 'Langganan diperpanjang',
    'member.created': 'Akses tim ditambahkan',
    'member.updated': 'Akses tim diubah',
    'member.bound': 'Akun tim diaktifkan'
  };
  return `<section class="panel"><header class="panel-header"><div><h2>Aktivitas tim</h2><p>Catatan waktu dan pelaku setiap perubahan.</p></div></header>${state.data.items?.length ? `<div class="table-scroll"><table><thead><tr><th>Waktu</th><th>Aktivitas</th><th>Oleh</th><th>Detail</th></tr></thead><tbody>${state.data.items.map(a => `<tr><td>${esc(date(a.created_at, true))}</td><td>${esc(labels[a.action] || a.action)}</td><td>${esc(a.actor_email || 'Sistem')}</td><td class="audit-details">${esc(auditSummary(a.details))}</td></tr>`).join('')}</tbody></table></div>` : empty('Belum ada aktivitas', 'Perubahan yang dilakukan tim akan tercatat di sini.', 'audit')}${pagination()}</section>`;
}
function auditSummary(d) {
  if (!d) return '—';
  const r = d.renewal || d.followup || d.member || d;
  return [r.email, r.outlet_name, r.months ? `${r.months} bulan` : null, r.amount_idr ? money(r.amount_idr) : null, r.payment_reference, r.outcome ? OUTCOME[r.outcome] : null, r.role ? ROLES[r.role] : null, r.note].filter(Boolean).join(' · ') || JSON.stringify(d);
}
function setModal(value) {
  if (!state.modal) modalReturnFocus = document.activeElement;
  state.modal = value;
  renderModal();
}
function closeModal() {
  state.modal = null;
  modalRoot.replaceChildren();
  document.body.classList.remove('has-modal');
  modalReturnFocus?.focus?.();
  modalReturnFocus = null;
}
function modalFrame(title, subtitle, body, footer = '', drawer = false) {
  const m = state.modal;
  return `<div class="overlay ${drawer ? 'drawer-overlay' : ''}"><section class="modal ${drawer ? 'drawer' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><header class="modal-header"><div><div class="eyebrow">${drawer ? 'PROFIL PENGGUNA' : 'VORA CRM'}</div><h2 id="modal-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="Tutup" ${m?.busy ? 'disabled' : ''}>${icon('close')}</button></header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}</section></div>`;
}
function renderModal() {
  const m = state.modal;
  if (!m) {
    closeModal();
    return;
  }
  document.body.classList.add('has-modal');
  if (m.type === 'detail') modalRoot.innerHTML = detailModal(m);
  if (m.type === 'renew') modalRoot.innerHTML = renewModal(m);
  if (m.type === 'followup') modalRoot.innerHTML = followupModal(m);
  if (m.type === 'member') modalRoot.innerHTML = memberModal(m);
  if (m.type === 'receipt') modalRoot.innerHTML = receiptModal(m);
  requestAnimationFrame(() => {
    if (!modalRoot.contains(document.activeElement)) modalRoot.querySelector('[role="dialog"]')?.focus();
  });
}
async function openDetail(id) {
  if (!can('read_customers')) return;
  const m = {
    type: 'detail',
    id,
    busy: true,
    detail: null,
    error: ''
  };
  setModal(m);
  const epoch = state.epoch;
  try {
    const detail = await api.detail(id);
    if (state.modal !== m || epoch !== state.epoch) return;
    m.detail = detail;
  } catch (error) {
    if (state.modal !== m || epoch !== state.epoch) return;
    if (denyAccess(error)) return;
    m.error = humanError(error);
  } finally {
    if (state.modal === m && epoch === state.epoch) {
      m.busy = false;
      renderModal();
    }
  }
}
function datum(label, value) {
  return `<div class="datum"><dt>${esc(label)}</dt><dd>${esc(value || '—')}</dd></div>`;
}
function detailModal(m) {
  if (!m.detail) return modalFrame('Detail pengguna', '', m.error ? `<div class="error">${esc(m.error)}</div><button class="button" data-action="retry-detail">Coba lagi</button>` : loading(), ' ', true);
  const c = m.detail.customer,
    url = whatsapp(c.phone);
  return modalFrame(customerName(c), c.email || '', `<div class="row wrap">${badge(c.status)}<span class="small muted">${esc(remaining(c.days_remaining, c.status))}</span><span class="spacer"></span>${url ? `<a class="button tiny" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('chat')} WhatsApp</a>` : ''}</div><dl class="detail-grid">${datum('Nomor HP', c.phone)}${datum('Terdaftar', date(c.created_at, true))}${datum('Terakhir masuk', date(c.last_sign_in_at, true))}${datum('ID pengguna', c.merchant_id)}${datum('Email diverifikasi', date(c.email_confirmed_at, true))}${datum('Trial dimulai', date(c.first_confirmed_at, true))}${datum('Trial awal berakhir', date(c.trial_end_date, true))}${datum('Masa aktif hingga', date(customerExpiry(c), true))}${datum('Jumlah outlet', `${c.outlet_count || c.outlets?.length || 0} outlet`)}</dl><section class="detail-section"><div class="row between"><h3>Outlet & langganan</h3></div>${c.outlets?.length ? c.outlets.map(o => `<article class="outlet-card"><div class="row"><div><strong>${esc(o.name || 'Outlet')}</strong><p>${esc(planName(o.subscription_plan))} · ${esc(remaining(o.days_remaining, o.status))}</p></div>${can('renew') ? `<button class="button tiny primary" data-action="renew" data-id="${esc(o.id)}">Perpanjang</button>` : ''}</div><p>Aktif hingga ${esc(date(o.subscription_end_date, true))}</p>${o.address ? `<p>${esc(o.address)}</p>` : ''}${o.type ? `<p>${esc(o.type)}</p>` : ''}${o.email ? `<p>Email outlet: ${esc(o.email)}</p>` : ''}${o.phone ? `<p>Kontak outlet: ${esc(o.phone)}</p>` : ''}</article>`).join('') : empty('Belum ada outlet', 'Pengguna belum menyelesaikan pembuatan outlet.', 'store')}</section><section class="detail-section"><div class="row between"><h3>Catatan follow-up</h3>${can('followup') ? '<button class="button tiny" data-action="followup">+ Catat follow-up</button>' : ''}</div>${m.detail.followups?.length ? `<div class="timeline">${m.detail.followups.map(f => `<div class="timeline-item">${badge(f.outcome, OUTCOME)}<p>${esc(f.note)}</p><small>${esc(date(f.created_at, true))} · ${esc(f.actor_email || 'Tim CRM')}</small>${f.next_followup_at ? `<p class="muted">Berikutnya: ${esc(date(f.next_followup_at, true))}</p>` : ''}</div>`).join('')}</div>` : empty('Belum ada percakapan tercatat', 'Catat hasil komunikasi agar tindak lanjut tetap terarah.', 'chat')}${m.detail.followups_total > 100 ? '<p class="helper">Menampilkan 100 catatan terbaru.</p>' : ''}</section><section class="detail-section"><h3>Riwayat perpanjangan</h3>${m.detail.renewals?.length ? `<div class="timeline">${m.detail.renewals.map(r => `<div class="timeline-item"><strong>${esc(r.outlet_name || 'Outlet')} · ${esc(r.months)} bulan</strong><p>${esc(money(r.amount_idr))} · ${esc(r.payment_reference)}</p><small>Aktif hingga ${esc(date(r.new_subscription_end_date))}<br>${esc(date(r.created_at, true))} · ${esc(r.actor_email || 'Tim CRM')}</small></div>`).join('')}</div>` : empty('Belum ada perpanjangan', 'Perpanjangan manual yang dicatat di CRM akan tampil di sini.', 'clock')}${m.detail.renewals_total > 50 ? '<p class="helper">Menampilkan 50 perpanjangan terbaru.</p>' : ''}</section>`, can('followup') ? '<button class="button primary" data-action="followup">Catat follow-up</button>' : '<button class="button" data-action="close-modal">Tutup</button>', true);
}
function findOutlet(id) {
  let customers = state.data?.items || [];
  if (state.modal?.detail?.customer) customers = [state.modal.detail.customer, ...customers];
  return customers.flatMap(c => (c.outlets || []).map(o => ({
    ...o,
    merchant_id: c.merchant_id,
    owner_name: c.owner_name
  }))).find(o => o.id === id);
}
function openRenew(id) {
  if (!can('renew')) return;
  const outlet = findOutlet(id);
  if (!outlet) return toast('Muat ulang daftar outlet terlebih dahulu.');
  setModal({
    type: 'renew',
    outlet: {
      ...outlet
    },
    phase: 'form',
    values: {
      months: 1,
      amount: PLANS[1],
      reference: '',
      note: ''
    },
    operationId: uuid(),
    busy: false,
    error: '',
    uncertain: false,
    serverNow: state.modal?.detail?.server_now || state.data?.server_now || state.session.server_now
  });
}
function renewModal(m) {
  const o = m.outlet;
  if (m.phase === 'confirm') return modalFrame('Konfirmasi perpanjangan', o.name, `<div class="stack"><div class="preview-card"><strong>${esc(o.name)}</strong><p class="helper">${esc(m.payload.p_months)} bulan · ${esc(money(m.payload.p_amount_idr))}</p><div class="dates"><div><small>Aktif sebelumnya</small><strong>${esc(date(o.subscription_end_date))}</strong></div>${icon('arrow')}<div><small>Perkiraan aktif hingga</small><strong>${esc(date(renewalPreview(o, m.payload.p_months, m.serverNow)))}</strong></div></div></div><div class="notice">Tanggal akhir dihitung ulang oleh server dari masa aktif saat ini atau waktu perpanjangan, mana yang lebih akhir. Tanggal pasti akan tampil pada bukti perpanjangan.</div><dl class="detail-grid">${datum('Referensi pembayaran', m.payload.p_payment_reference)}${datum('Catatan', m.payload.p_note)}</dl><div class="notice warning">Pastikan pembayaran ${esc(money(m.payload.p_amount_idr))} sudah Anda terima. Tindakan ini menambah masa aktif outlet.</div>${m.error ? `<div class="error" role="alert">${esc(m.error)}</div>` : ''}${m.uncertain ? '<div class="notice warning">Hasil transaksi belum dapat dipastikan. Klik Periksa & lanjutkan untuk mengirim ulang transaksi yang sama tanpa menambah perpanjangan kedua. Jangan membuat perpanjangan baru.</div>' : ''}</div>`, `${!m.uncertain && !m.conflict ? `<button class="button" data-action="renew-back" ${m.busy ? 'disabled' : ''}>Kembali</button>` : ''}${m.conflict ? '<button class="button primary" data-action="renew-reload">Muat ulang outlet</button>' : `<button class="button primary" data-action="save-renewal" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Memproses…' : m.uncertain ? 'Periksa & lanjutkan' : 'Konfirmasi perpanjangan'}</button>`}`);
  return modalFrame('Perpanjang langganan', o.name, `<form id="renew-form" class="stack"><div class="preview-card"><strong>${esc(o.name)}</strong><p class="helper">${esc(planName(o.subscription_plan))} · Aktif hingga ${esc(date(o.subscription_end_date))}</p></div><div class="form-row"><label class="field">Durasi<select name="months" id="renew-months">${[1, 12, 24].map(month => `<option value="${month}" ${Number(m.values.months) === month ? 'selected' : ''}>${month === 1 ? '1 bulan' : month === 12 ? '1 tahun' : '2 tahun'}</option>`).join('')}</select></label><label class="field">Pembayaran diterima (Rp)<input name="amount" id="renew-amount" type="number" min="1" max="999999999999" step="1" value="${esc(m.values.amount)}" required></label></div><label class="field">Referensi pembayaran<input name="reference" maxlength="160" value="${esc(m.values.reference)}" required placeholder="Contoh: TRF-081026-001"><small>Nomor transaksi atau referensi internal untuk penelusuran.</small></label><label class="field">Catatan (opsional)<textarea name="note" maxlength="2000" placeholder="Detail pembayaran atau informasi tambahan">${esc(m.values.note)}</textarea></label><label class="check-line"><input type="checkbox" name="verified" required><span>Saya sudah memeriksa dan menerima pembayaran untuk outlet ini.</span></label><div class="error" role="alert">${esc(m.error)}</div></form>`, `<button class="button" data-action="close-modal">Batal</button><button class="button primary" type="submit" form="renew-form">Tinjau perpanjangan ${icon('arrow')}</button>`);
}
async function saveRenewal() {
  const m = state.modal;
  if (!m || m.type !== 'renew' || m.busy || !m.payload || m.conflict) return;
  const epoch = state.epoch;
  m.busy = true;
  m.error = '';
  renderModal();
  try {
    const result = await api.renew(m.payload);
    if (epoch !== state.epoch || state.modal !== m) return;
    if (!result?.renewal) throw new TypeError('Respons server belum dapat dipastikan.');
    setModal({
      type: 'receipt',
      renewal: result.renewal,
      replayed: result.replayed
    });
    void loadPage();
  } catch (error) {
    if (epoch !== state.epoch || state.modal !== m) return;
    if (denyAccess(error)) return;
    m.error = humanError(error);
    m.conflict = isRenewalConflict(error);
    m.uncertain = !m.conflict && !definiteError(error);
    m.busy = false;
    renderModal();
  } finally {
    if (epoch === state.epoch && state.modal === m) {
      m.busy = false;
      renderModal();
    }
  }
}
function definiteError(error) {
  return Boolean(error?.code) && !String(error.code).startsWith('PGRST00') && !String(error.code).startsWith('5') && !/fetch|network|abort/i.test(error.message || '');
}
function receiptModal(m) {
  const r = m.renewal;
  return modalFrame('Perpanjangan berhasil', '', `<div class="receipt"><div class="receipt-icon">${icon('check')}</div><h2>Bisnis siap berlanjut.</h2><p>${m.replayed ? 'Transaksi ini sudah tercatat sebelumnya. Tidak ada perpanjangan tambahan.' : 'Langganan outlet berhasil diperpanjang dan tersimpan.'}</p><div class="receipt-details"><div class="row"><span class="muted">Outlet</span><strong>${esc(r.outlet_name || 'Outlet')}</strong></div><div class="row"><span class="muted">Durasi</span><strong>${esc(r.months)} bulan</strong></div><div class="row"><span class="muted">Pembayaran</span><strong>${esc(money(r.amount_idr))}</strong></div><div class="row"><span class="muted">Aktif hingga</span><strong>${esc(date(r.new_subscription_end_date, true))}</strong></div><div class="row"><span class="muted">Referensi</span><strong class="word-break">${esc(r.payment_reference)}</strong></div><div class="row"><span class="muted">Dicatat oleh</span><strong class="word-break">${esc(r.actor_email || 'Tim CRM')}</strong></div></div></div>`, `${can('read_customers') ? `<button class="button" data-action="receipt-detail" data-id="${esc(r.merchant_id)}">Lihat riwayat</button>` : ''}<button class="button primary" data-action="close-modal">Selesai</button>`);
}
function openFollowup() {
  const c = state.modal?.detail?.customer;
  if (!c || !can('followup')) return;
  setModal({
    type: 'followup',
    customer: c,
    operationId: uuid(),
    busy: false,
    error: '',
    values: {
      outcome: 'contacted',
      note: '',
      next: ''
    }
  });
}
function followupModal(m) {
  return modalFrame('Catat follow-up', customerName(m.customer), `<form id="followup-form" class="stack"><label class="field">Hasil komunikasi<select name="outcome" ${m.uncertain || m.busy ? 'disabled' : ''}>${Object.entries(OUTCOME).map(([key, label]) => `<option value="${key}" ${key === m.values.outcome ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">Catatan<textarea name="note" maxlength="4000" required placeholder="Kebutuhan pengguna, kendala, atau hasil pembicaraan…" ${m.uncertain || m.busy ? 'readonly' : ''}>${esc(m.values.note)}</textarea></label><label class="field">Jadwal follow-up berikutnya (opsional)<input name="next" type="datetime-local" value="${esc(m.values.next)}" ${m.uncertain || m.busy ? 'readonly' : ''}><small>Waktu mengikuti zona waktu perangkat Anda. Jadwal ditampilkan di CRM; tidak mengirim pesan otomatis.</small></label><div class="error" role="alert">${esc(m.error)}</div>${m.uncertain ? '<div class="notice warning">Hasil penyimpanan belum pasti. Coba kembali untuk memeriksa catatan yang sama tanpa menggandakannya.</div>' : ''}</form>`, `<button class="button" data-action="close-modal" ${m.busy ? 'disabled' : ''}>Batal</button><button class="button primary" type="submit" form="followup-form" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Menyimpan…' : m.uncertain ? 'Periksa & simpan' : 'Simpan catatan'}</button>`);
}
async function saveFollowup(form) {
  const m = state.modal;
  if (!m || m.busy) return;
  if (!m.uncertain) {
    const values = Object.fromEntries(new FormData(form));
    m.values = values;
    if (!values.note?.trim()) {
      m.error = 'Catatan wajib diisi.';
      renderModal();
      return;
    }
    m.payload = {
      p_operation_id: m.operationId,
      p_merchant_id: m.customer.merchant_id,
      p_outcome: values.outcome,
      p_note: values.note.trim(),
      p_next_followup_at: values.next ? new Date(values.next).toISOString() : null
    };
  }
  const epoch = state.epoch;
  m.busy = true;
  m.error = '';
  renderModal();
  try {
    await api.followup(m.payload);
    if (epoch !== state.epoch || state.modal !== m) return;
    toast('Follow-up berhasil dicatat.');
    void openDetail(m.customer.merchant_id);
    void loadPage();
  } catch (error) {
    if (epoch !== state.epoch || state.modal !== m) return;
    if (denyAccess(error)) return;
    m.error = humanError(error);
    m.uncertain = !definiteError(error);
    if (!m.uncertain) m.operationId = uuid();
  } finally {
    if (epoch === state.epoch && state.modal === m) {
      m.busy = false;
      renderModal();
    }
  }
}
function memberModal(m) {
  const v = m.member || {
    email: '',
    role: 'viewer',
    active: true
  };
  return modalFrame(m.editing ? 'Ubah akses anggota' : 'Tambahkan anggota tim', 'Berikan akses sesuai tanggung jawabnya.', `<form id="member-form" class="stack"><label class="field">Email anggota<input name="email" type="email" value="${esc(v.email)}" required ${m.editing ? 'readonly' : ''} autocomplete="off" placeholder="nama@contoh.com"></label><label class="field">Peran<select name="role" id="member-role">${Object.entries(ROLE_HELP).map(([key]) => `<option value="${key}" ${v.role === key ? 'selected' : ''}>${esc(ROLES[key])}</option>`).join('')}</select><span class="role-description" id="role-description">${esc(ROLE_HELP[v.role])}</span></label>${m.editing ? `<label class="check-line"><input name="active" type="checkbox" ${v.active ? 'checked' : ''}><span>Akses CRM aktif untuk anggota ini.</span></label>` : ''}<div class="notice">Anggota yang sudah punya akun VORA dapat langsung masuk. Anggota baru perlu mengaktifkan akun dan memverifikasi email melalui halaman masuk CRM.</div><div class="error" role="alert">${esc(m.error)}</div></form>`, `<button class="button" data-action="close-modal" ${m.busy ? 'disabled' : ''}>Batal</button><button class="button primary" type="submit" form="member-form" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Menyimpan…' : 'Simpan akses'}</button>`);
}
async function saveMember(form) {
  const m = state.modal;
  if (!m || m.busy) return;
  const values = Object.fromEntries(new FormData(form)),
    epoch = state.epoch;
  m.member = {
    email: values.email,
    role: values.role,
    active: m.editing ? values.active === 'on' : true
  };
  m.busy = true;
  m.error = '';
  renderModal();
  try {
    await api.saveMember({
      p_email: values.email.trim(),
      p_role: values.role,
      p_active: m.member.active
    });
    if (epoch !== state.epoch || state.modal !== m) return;
    closeModal();
    toast('Akses anggota berhasil disimpan.');
    void loadPage();
  } catch (error) {
    if (epoch !== state.epoch || state.modal !== m) return;
    if (denyAccess(error)) return;
    m.error = humanError(error);
  } finally {
    if (epoch === state.epoch && state.modal === m) {
      m.busy = false;
      renderModal();
    }
  }
}
async function handleAuth(form, type) {
  if (state.authBusy) return;
  const values = Object.fromEntries(new FormData(form));
  state.authEmail = (values.email || state.authEmail).trim();
  state.authError = '';
  if (type === 'signup' && values.password !== values.confirm) {
    state.authError = 'Kata sandi dan konfirmasi belum sama.';
    renderAuth();
    return;
  }
  state.authBusy = true;
  renderAuth();
  const thisAuth = auth,
    epoch = authEpoch;
  try {
    let result;
    if (type === 'login') result = await thisAuth.client.auth.signInWithPassword({
      email: state.authEmail,
      password: values.password
    });
    if (type === 'signup') result = await thisAuth.client.auth.signUp({
      email: state.authEmail,
      password: values.password
    });
    if (type === 'verify') result = await thisAuth.client.auth.verifyOtp({
      email: state.authEmail,
      token: values.token,
      type: 'email'
    });
    if (epoch !== authEpoch) return;
    if (result.error) throw result.error;
    if (result.data?.session) {
      state.authBusy = false;
      await authorize(result.data.session);
    } else if (type === 'signup') {
      state.authMode = 'verify';
      state.authBusy = false;
      renderAuth();
    } else throw new Error('Sesi belum tersedia. Silakan masuk kembali.');
  } catch (error) {
    if (epoch !== authEpoch) return;
    state.authError = humanError(error);
    state.authBusy = false;
    renderAuth();
  }
}
function navigate(page) {
  if (!allowedPages(state.session?.permissions || {}).includes(page)) return;
  state.page = page;
  state.menu = false;
  state.data = null;
  state.search = '';
  state.status = 'all';
  state.offset = 0;
  state.error = '';
  void loadPage();
}
async function action(button) {
  const a = button.dataset.action;
  if (a === 'logout') return signOut();
  if (a === 'auth-mode') {
    state.authMode = button.dataset.mode;
    state.authError = '';
    state.authMessage = '';
    renderAuth();
    return;
  }
  if (a === 'recheck-access') {
    button.disabled = true;
    const thisAuth = auth, epoch = authEpoch;
    try {
      const {data} = await thisAuth.client.auth.getSession();
      if (epoch !== authEpoch || thisAuth !== auth) return;
      if (data.session) await authorize(data.session);else renderAuth();
    } catch (error) {
      if (epoch !== authEpoch || thisAuth !== auth) return;
      state.authError = humanError(error);
      renderDenied();
    } finally {
      if (epoch === authEpoch && thisAuth === auth) button.disabled = false;
    }
    return;
  }
  if (!state.session) return;
  if (a === 'nav') return navigate(button.dataset.page);
  if (a === 'menu') {
    state.menu = true;
    render();
    return;
  }
  if (a === 'menu-close') {
    state.menu = false;
    render();
    return;
  }
  if (a === 'refresh') return loadPage();
  if (a === 'previous' || a === 'next') {
    state.offset = Math.max(0, state.offset + (a === 'next' ? 25 : -25));
    return loadPage();
  }
  if (a === 'detail' || a === 'receipt-detail') return openDetail(button.dataset.id);
  if (a === 'retry-detail') return openDetail(state.modal.id);
  if (a === 'close-modal') {
    if (state.modal?.busy) return;
    if (state.modal?.uncertain) return toast('Periksa hasil transaksi dengan tombol coba kembali sebelum menutup.');
    closeModal();
    return;
  }
  if (a === 'renew') return openRenew(button.dataset.id);
  if (a === 'followup') return openFollowup();
  if (a === 'save-renewal') return saveRenewal();
  if (a === 'renew-back') {
    state.modal.phase = 'form';
    state.modal.error = '';
    state.modal.operationId = uuid();
    state.modal.payload = null;
    renderModal();
    return;
  }
  if (a === 'renew-reload') {
    closeModal();
    return loadPage();
  }
  if (a === 'add-member') {
    if (can('manage_members')) setModal({
      type: 'member',
      member: null,
      editing: false,
      busy: false,
      error: ''
    });
    return;
  }
  if (a === 'edit-member') {
    const member = state.data?.items?.find(m => m.id === button.dataset.id);
    if (can('manage_members') && member && member.role !== 'owner') setModal({
      type: 'member',
      member: {
        ...member
      },
      editing: true,
      busy: false,
      error: ''
    });
  }
}
function onClick(event) {
  const button = event.target.closest('[data-action]');
  if (button && !button.disabled) void action(button);
}
app.addEventListener('click', onClick);
modalRoot.addEventListener('click', onClick);
document.addEventListener('submit', event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'login-form') return void handleAuth(form, 'login');
  if (form.id === 'signup-form') return void handleAuth(form, 'signup');
  if (form.id === 'verify-form') return void handleAuth(form, 'verify');
  if (form.id === 'search-form') {
    const values = Object.fromEntries(new FormData(form));
    state.search = values.search.trim();
    state.status = values.status;
    state.offset = 0;
    return void loadPage();
  }
  if (form.id === 'renew-form') {
    const m = state.modal;
    try {
      m.values = Object.fromEntries(new FormData(form));
      m.payload = renewalPayload({
        ...m.values,
        outlet: m.outlet.id
      }, m.operationId);
      m.payload.p_expected_end_date = m.outlet.subscription_end_date || null;
      m.payload.p_expected_plan = m.outlet.subscription_plan || null;
      m.phase = 'confirm';
      m.error = '';
    } catch (error) {
      if (denyAccess(error)) return;
      m.error = humanError(error);
    }
    renderModal();
    return;
  }
  if (form.id === 'followup-form') return void saveFollowup(form);
  if (form.id === 'member-form') return void saveMember(form);
});
document.addEventListener('change', event => {
  if (event.target.id === 'status-filter') {
    const form = event.target.form;
    state.search = form.elements.search.value.trim();
    state.status = event.target.value;
    state.offset = 0;
    void loadPage();
  }
  if (event.target.id === 'renew-months') {
    document.querySelector('#renew-amount').value = PLANS[event.target.value];
  }
  if (event.target.id === 'member-role') {
    document.querySelector('#role-description').textContent = ROLE_HELP[event.target.value] || '';
  }
});
document.addEventListener('keydown', event => {
  if (!state.modal) return;
  if (event.key === 'Escape' && !state.modal.busy && !state.modal.uncertain) {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...modalRoot.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(el => el.getClientRects().length);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0],
    last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
});
window.addEventListener('pageshow', event => {
  if (event.persisted && state.session) void loadPage();
});
bootAuth();

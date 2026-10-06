import { config } from '/dashboard-config.js';
import { loadOutlets, loadReport, requestScope, makeCsv } from '/dashboard-data.js';
import { identityGuard, validatePublicConfig, boundedFetch } from '/dashboard-session.js';
import { icon, escape as h } from '/dashboard-icons.js';
import { renderAuth, bindAuth } from '/dashboard-auth.js';
import { renderReport, bindReport, reportExportRows } from '/dashboard-reports.js';
import { loadOperations, renderOperations, bindOperations, downloadCsvFile } from '/dashboard-operations.js';
import { formatRange, mountDateRange } from '/dashboard-date-range.js';

validatePublicConfig(config);
let storage;
try { sessionStorage.setItem('vora-storage-check','1'); sessionStorage.removeItem('vora-storage-check'); storage = sessionStorage; } catch {}
const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
  global: { fetch: boundedFetch },
  auth: { storage, storageKey: 'vora-backoffice-auth', persistSession: !!storage, autoRefreshToken: true, detectSessionInUrl: false },
});
const app = document.querySelector('#app'), modalRoot = document.querySelector('#modal-root');
const identity = identityGuard(), outletsScope = requestScope(), pageScope = requestScope();
const authRoutes = new Set(['login','signup','verify','business','forgot','reset']);
const operationRoutes = new Set(['products','settings']);
const titles = {
  overview:['Ringkasan bisnis','Perkembangan bisnis dan transaksi outlet Anda.'],
  reports:['Pusat laporan','Laporan operasional dari transaksi yang sudah tersinkron.'],
  sales:['Laporan penjualan','Telusuri transaksi dan penerimaan penjualan.'],
  profit:['Laba & rugi','Pendapatan, HPP, dan biaya usaha dalam satu laporan.'],
  'product-report':['Penjualan per produk','Kenali produk yang paling banyak dipilih pelanggan.'],
  payments:['Metode pembayaran','Penerimaan tunai dan nontunai outlet Anda.'],
  'staff-report':['Kinerja kasir','Ringkasan transaksi berdasarkan nama kasir pada struk.'],
  refunds:['Refund & pembatalan','Pengembalian dana pada periode penjualan terpilih.'],
  expenses:['Biaya usaha','Biaya operasional yang tercatat dari aplikasi kasir.'],
  products:['Produk & kategori','Kelola katalog dan impor atau ekspor data produk.'],
  settings:['Pengaturan','Atur profil bisnis, pajak, pembayaran, struk, dan staf.'],
};
const day = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function rangePreset(value) { const end=new Date(),start=new Date(end); if(value==='month')start.setDate(1);if(value==='week')start.setDate(start.getDate()-6); return { start:day(start),end:day(end) }; }
const state = { user:null,outlets:[],outletId:'',ready:false,loading:true,error:'',report:null,data:null,range:rangePreset('month') };
let cleanupPage, renderSequence=0, authBusy=false, logoutBusy=false, toastTimer, modalCleanup, focusBeforeModal;
let restoringSession=true, restoredUserId=null, sessionDuringLogout=false, pendingAuthUserId=null;
const mobile = window.matchMedia('(max-width:800px)');
const outlet = () => state.outlets.find(o=>o.id===state.outletId);
const route = () => { const name=location.hash.slice(1).split('?')[0]; return name==='data'?'products':titles[name]||authRoutes.has(name)?name:'overview'; };
function syncMenuAccess() { const sidebar=document.querySelector('.sidebar'); if(sidebar)sidebar.inert=mobile.matches&&!document.body.classList.contains('menu-open'); }
mobile.addEventListener('change',syncMenuAccess);
function toast(message) { const stack=document.querySelector('#toast-stack');stack.innerHTML=`<div class="toast">${icon('info')}<span>${h(message)}</span></div>`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>stack.replaceChildren(),6000); }
function closeModal() { modalCleanup?.abort();modalCleanup=null;modalRoot.replaceChildren();document.body.classList.remove('modal-open');document.querySelector('.main-shell')?.removeAttribute('inert');document.querySelector('.sidebar')?.removeAttribute('inert');syncMenuAccess();if(focusBeforeModal?.isConnected)focusBeforeModal.focus(); }
function modal({title,description='',content,footer=''}) {
  if(!modalRoot.childElementCount)focusBeforeModal=document.activeElement;
  modalCleanup?.abort();modalCleanup=new AbortController();
  modalRoot.innerHTML=`<div class="modal-layer"><section class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-head"><div><h2 id="dialog-title">${h(title)}</h2><p>${h(description)}</p></div><button class="icon-btn" data-close-modal aria-label="Tutup dialog">${icon('cross')}</button></header><div class="modal-body">${content}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</section></div>`;
  document.body.classList.add('modal-open');document.querySelector('.main-shell')?.setAttribute('inert','');document.querySelector('.sidebar')?.setAttribute('inert','');
  const panel=modalRoot.querySelector('.modal-panel');panel.querySelector('input,select,button,a')?.focus();return panel;
}
function safeError(error) {
  if (!navigator.onLine) return 'Pasang koneksi internet untuk membuka atau menyimpan data dashboard.';
  if (error?.status===401 || error?.code==='PGRST301') return 'Sesi akun berakhir. Keluar lalu masuk kembali.';
  const message=String(error?.message||'');
  if (/^(Pilih |Data tidak sesuai|Data lintas|Data periode|Halaman laporan|Riwayat refund|Outlet tidak tersedia)/.test(message)) return message;
  return 'Data belum dapat dimuat lengkap. Periksa koneksi lalu coba lagi. Jika berulang, hubungi dukungan VORA.';
}
function navigate(target) {
  if(authBusy){toast('Proses akun sedang berlangsung. Mohon tunggu sebentar.');return;}
  if(!titles[target.split('?')[0]]&&!authRoutes.has(target.split('?')[0]))target='overview';
  if(location.hash===`#${target}`)void render();else location.hash=target;
}
function picker(isMobile=false) {
  const selected=outlet();return `<div class="outlet-picker ${isMobile?'outlet-picker-mobile':'outlet-picker-sidebar'}"><span class="outlet-picker-label">PILIH OUTLET</span><button class="outlet-picker-button" data-action="outlet" aria-haspopup="dialog">${icon('store')}<span><strong>${h(selected?.name||'Memuat outlet…')}</strong><small>${h(selected?.address||'Outlet bisnis Anda')}</small></span>${icon('down')}</button></div>`;
}
function brand() { return '<a href="#overview" data-route="overview" class="brand" aria-label="VORA POS — beranda"><img class="brand-logo" src="/dashboard-assets-vora-logo-transparent.png" alt="VORA POS"><span class="brand-subtitle">BACKOFFICE</span></a>'; }
function initials() { return h((state.user?.email||'V').slice(0,2).toUpperCase()); }
function sidebar(current) {
  const link=(key,label,glyph)=>`<a class="nav-item ${current===key||(key==='reports'&&!['overview','products','settings'].includes(current))?'active':''}" href="#${key}" data-route="${key}">${icon(glyph)}<span>${label}</span></a>`;
  return `<button class="mobile-scrim" data-action="close-menu" aria-label="Tutup menu"></button><aside class="sidebar" aria-label="Navigasi dashboard">${brand()}${picker()}<p class="nav-label">WORKSPACE</p><nav class="side-nav">${link('overview','Ringkasan','grid')}${link('reports','Laporan bisnis','chart')}${link('products','Produk & kategori','box')}</nav><p class="nav-label">KELOLA BISNIS</p><nav class="side-nav">${link('settings','Pengaturan','settings')}</nav><div class="side-bottom"><div class="help-card">${icon('help')}<h3>Butuh bantuan?</h3><p>Tim VORA siap membantu operasional bisnis Anda.</p><a class="text-link" href="https://wa.me/6289636974140" target="_blank" rel="noopener noreferrer">Hubungi VORA ${icon('arrow')}</a></div><button class="profile-button" data-action="profile"><span class="avatar">${initials()}</span><span><strong>Akun pemilik</strong><small>${h(state.user?.email||'')}</small></span>${icon('down')}</button></div></aside>`;
}
function shell(current,content) {
  const [title,description]=titles[current];
  return `${sidebar(current)}<div class="main-shell"><header class="topbar"><button class="icon-btn menu-toggle" data-action="menu" aria-label="Buka menu navigasi" aria-expanded="false">${icon('menu')}</button>${picker(true)}<div class="breadcrumb"><span>${h(outlet()?.name||'Bisnis Anda')}</span>${icon('chevron')}<strong>${title}</strong></div><div class="top-actions"><button class="icon-btn" data-action="refresh" aria-label="Muat ulang data" ${state.loading?'disabled':''}>${icon('clock')}</button><button class="icon-btn search-button" data-action="search" aria-label="Cari menu">${icon('search')}</button><button class="avatar" data-action="profile" aria-label="Akun dan keluar">${initials()}</button></div></header><main class="dashboard-main" id="main" tabindex="-1"><section class="page-heading"><div><h1>${title}</h1><p>${description}</p></div>${!operationRoutes.has(current)?`<div class="page-heading-actions"><button class="btn btn-secondary period-select" data-action="period" aria-haspopup="dialog">${icon('calendar')}<span>${h(formatRange(state.range))}</span>${icon('down')}</button><button class="btn btn-primary" data-action="export" ${!state.report||state.loading?'disabled':''}>${icon('download')} Ekspor laporan</button></div>`:''}</section><div id="page-content">${content}</div><footer class="page-footer"><span>© VORA POS · ${h(outlet()?.name||'')}</span><span>Data tersinkron dari aplikasi kasir</span></footer></main></div>`;
}
function loading(message='Memuat data outlet…') { return `<div class="loading-state" role="status"><span class="vora-spinner" aria-hidden="true"></span><strong>${h(message)}</strong><p>Mohon tunggu sebentar.</p></div>`; }
function errorView(message) { return `<div class="card error-state" role="alert"><h2>Data belum tersedia</h2><p>${h(message)}</p><button class="btn btn-primary" data-action="refresh">Coba lagi</button><button class="btn btn-secondary" data-action="logout">Keluar akun</button></div>`; }
function resetData() { outletsScope.cancel();pageScope.cancel();state.outlets=[];state.outletId='';state.report=null;state.data=null;state.ready=false;state.error='';cleanupPage?.();cleanupPage=null;closeModal(); }
async function adoptSession(session, preferredOutlet) {
  const user=session?.user||null;
  if(identity.id!==user?.id){identity.set(user?.id||null);resetData();}
  state.user=user;
  if(!user){state.loading=false;state.ready=true;await render();return;}
  const scope=outletsScope.begin(), validIdentity=identity.capture();state.loading=true;state.ready=false;state.error='';await render();
  try{
    const list=await loadOutlets(client,user.id,scope.signal);
    if(!scope.current()||!validIdentity())return;
    state.outlets=list;state.outletId=list.some(o=>o.id===preferredOutlet)?preferredOutlet:list.some(o=>o.id===state.outletId)?state.outletId:list[0]?.id||'';
    state.ready=true;state.loading=false;
    if(list.length&&authRoutes.has(route()))location.hash='overview';
    else if(!list.length&&route()!=='business')location.hash='business';
    await render();
  }catch(error){if(!scope.current()||!validIdentity())return;state.error=safeError(error);state.ready=true;state.loading=false;await render();}
}
async function refreshSession(options={}) {
  const validIdentity=identity.capture();
  const {data,error}=await client.auth.getUser();
  if(error||!data.user){if(validIdentity())await logout();return;}
  if(!validIdentity()||(options.userId&&options.userId!==data.user.id))return;
  if(data.user.id!==state.user?.id){await logout();return;}
  await adoptSession({user:data.user},options.outletId||state.outletId);
}
function setAuthBusy(value) {
  authBusy=!!value;
  if(authBusy)return;
  const pendingId=pendingAuthUserId;pendingAuthUserId=null;
  if(!pendingId||pendingId===state.user?.id||logoutBusy)return;
  const version=authEvent;
  // The form may reject a stale/malformed result after the SDK already saved it.
  // Only the guarded onAuthenticated callback is allowed to adopt that identity.
  queueMicrotask(()=>{if(version===authEvent&&!authBusy&&!logoutBusy&&pendingId!==state.user?.id)void logout();});
}
function commonApi(sequence,signal) {
  const validIdentity=identity.capture();
  return {client,user:state.user,outlet:outlet(),data:state.data,report:state.report,range:{...state.range},signal,
    isCurrent:()=>sequence===renderSequence&&validIdentity()&&!signal?.aborted,
    navigate,toast,modal,closeModal,refresh:()=>render(),refreshSession,
    setAuthBusy,
    onAuthenticated:session=>sequence===renderSequence&&validIdentity()?adoptSession(session):Promise.resolve(),print:()=>window.print()};
}
async function render() {
  const sequence=++renderSequence;cleanupPage?.();cleanupPage=null;pageScope.cancel();closeModal();
  let current=route();document.body.classList.remove('menu-open');
  if(!state.user){
    current=authRoutes.has(current)&&current!=='business'?current:'login';document.body.classList.add('auth-mode');
    app.innerHTML=state.loading?loading('VORA menyiapkan sesi Anda…'):renderAuth(current,{user:null});
    if(!state.loading)cleanupPage=bindAuth(app,commonApi(sequence));
    document.title='VORA — Akun bisnis';window.scrollTo(0,0);return;
  }
  if(!state.ready){document.body.classList.remove('auth-mode');app.innerHTML=loading('Memuat daftar outlet Anda…');return;}
  if(state.error&&!state.outlets.length){app.innerHTML=errorView(state.error);return;}
  if(!state.outlets.length){document.body.classList.add('auth-mode');app.innerHTML=renderAuth('business',{user:state.user});cleanupPage=bindAuth(app,commonApi(sequence));return;}
  if(authRoutes.has(current))current='overview';
  document.body.classList.remove('auth-mode');document.title=`${titles[current][0]} · VORA Backoffice`;
  const scope=pageScope.begin(),validIdentity=identity.capture(),selected=outlet();state.loading=true;state.report=null;state.data=null;state.error='';
  app.innerHTML=shell(current,loading());syncMenuAccess();window.scrollTo(0,0);
  try{
    const value=operationRoutes.has(current)?await loadOperations(client,state.user,selected,scope.signal):await loadReport(client,state.user.id,selected,state.range,scope.signal);
    if(sequence!==renderSequence||!scope.current()||!validIdentity())return;
    if(operationRoutes.has(current))state.data=value;else state.report=value;
    state.loading=false;
    const tab=new URLSearchParams(location.hash.split('?')[1]||'').get('tab');
    const content=operationRoutes.has(current)?renderOperations(current,{tab,data:state.data,outlet:selected}):renderReport(current,{report:state.report,outlet:selected,range:state.range});
    app.innerHTML=shell(current,content);syncMenuAccess();
    const api=commonApi(sequence,scope.signal);
    cleanupPage=operationRoutes.has(current)?bindOperations(document.querySelector('#page-content'),api):bindReport(document.querySelector('#page-content'),api);
  }catch(error){if(sequence!==renderSequence||!scope.current()||!validIdentity())return;state.loading=false;state.error=safeError(error);app.innerHTML=shell(current,errorView(state.error));syncMenuAccess();}
}
async function logout() {
  restoringSession=false;pendingAuthUserId=null;
  if(logoutBusy)return;logoutBusy=true;sessionDuringLogout=false;identity.set(null,true);state.user=null;resetData();state.loading=true;authBusy=false;location.hash='login';await render();
  try{await client.auth.signOut({scope:'local'});}catch{try{storage?.removeItem('vora-backoffice-auth');}catch{}}
  finally{
    logoutBusy=false;state.loading=false;await render();
    // A login request can resolve while the SDK is finishing local logout.
    if(sessionDuringLogout){sessionDuringLogout=false;queueMicrotask(()=>void logout());}
  }
}
function exportReport() {
  if(!state.report||state.loading||state.error)return;
  const current=route(), report=state.report,selected=outlet();
  const el=modal({title:'Ekspor laporan',description:`${selected.name} · ${state.range.start} – ${state.range.end}`,content:'<p>Unduh seluruh data laporan pada periode ini, atau gunakan Cetak / Simpan PDF pada browser.</p>',footer:'<button class="btn btn-secondary" id="export-print">Cetak / PDF</button><button class="btn btn-primary" id="export-csv">Unduh CSV</button>'});
  el.querySelector('#export-csv').addEventListener('click',()=>{
    const rows=[['VORA POS',selected.name],['Periode',state.range.start,state.range.end],[],...reportExportRows(current,report)];
    downloadCsvFile(makeCsv(rows),`VORA-${current}-${state.range.start}-${state.range.end}.csv`);
    closeModal();toast('Unduhan CSV dimulai. Periksa folder unduhan browser Anda.');
  });
  el.querySelector('#export-print').addEventListener('click',()=>{closeModal();window.print();});
}
function periodDialog() {
  const el=modal({title:'Periode laporan',description:'Pilih tanggal awal dan akhir. Maksimal 93 hari, mengikuti tanggal bisnis pada transaksi.',content:'<div data-range-picker></div>',footer:'<div class="range-summary" data-range-summary aria-live="polite"></div><div class="range-footer-actions"><button class="btn btn-secondary" data-close-modal>Batal</button><button class="btn btn-primary" type="button" data-range-apply>Terapkan</button></div>'});
  el.classList.add('date-range-panel');
  mountDateRange(el,{range:state.range,signal:modalCleanup.signal,onApply:range=>{state.range=range;void render();}});
}
function action(name) {
  if(name==='logout')return void logout();
  if(name==='refresh')return void (state.outlets.length?render():refreshSession());
  if(name==='menu'||name==='close-menu'){const open=name==='menu'&&!document.body.classList.contains('menu-open');document.body.classList.toggle('menu-open',open);syncMenuAccess();document.querySelector('.menu-toggle')?.setAttribute('aria-expanded',String(open));return;}
  if(name==='export')return exportReport();if(name==='period')return periodDialog();
  if(name==='outlet'){
    const el=modal({title:'Pilih outlet',description:'Laporan, produk, dan pengaturan hanya untuk outlet yang dipilih.',content:state.outlets.map(o=>`<button class="outlet-option ${o.id===state.outletId?'selected':''}" data-outlet-id="${h(o.id)}">${icon('store')}<span><strong>${h(o.name)}</strong><small>${h(o.address||'')}</small></span>${o.id===state.outletId?'<span class="badge">Dipilih</span>':''}</button>`).join('')});
    el.querySelectorAll('[data-outlet-id]').forEach(b=>b.addEventListener('click',()=>{if(!state.outlets.some(o=>o.id===b.dataset.outletId))return;state.outletId=b.dataset.outletId;state.data=null;state.report=null;void render();}));return;
  }
  if(name==='profile')return modal({title:'Akun pemilik bisnis',description:state.user?.email||'',content:`<p>Outlet aktif: <strong>${h(outlet()?.name||'')}</strong></p><p>Keluar hanya mengakhiri sesi browser ini. Sesi aplikasi kasir tetap berjalan.</p>`,footer:'<button class="btn btn-secondary" data-close-modal>Tutup</button><button class="btn btn-primary" data-action="logout">Keluar akun</button>'});
  if(name==='search'){
    const el=modal({title:'Cari menu dashboard',content:`<label class="field">Nama menu<input class="input" id="menu-search" placeholder="Cari laporan, produk, pengaturan…"></label><div class="search-results">${Object.entries(titles).map(([key,[title]])=>`<a class="search-result" data-route="${key}" href="#${key}">${h(title)}</a>`).join('')}</div>`});
    el.querySelector('input').addEventListener('input',e=>el.querySelectorAll('.search-result').forEach(a=>a.hidden=!a.textContent.toLowerCase().includes(e.target.value.toLowerCase())));
  }
}
document.addEventListener('click',event=>{
  if(event.target.closest?.('.skip-link')){event.preventDefault();document.querySelector('#main')?.focus();return;}
  const target=event.target.closest?.('[data-route],[data-action],[data-close-modal]');
  if(target?.dataset.route){event.preventDefault();navigate(target.dataset.route);return;}
  if(target?.hasAttribute('data-close-modal')){closeModal();return;}
  if(target?.dataset.action)action(target.dataset.action);
  if(event.target.classList?.contains('modal-layer'))closeModal();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeModal();document.body.classList.remove('menu-open');syncMenuAccess();}
  const dialog=modalRoot.querySelector('.modal-panel');
  if(event.key==='Tab'&&dialog){const items=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(e=>e.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
window.addEventListener('hashchange',()=>{if(!authBusy)void render();});
window.addEventListener('offline',()=>toast('Koneksi terputus. Perubahan dashboard membutuhkan internet.'));
let authEvent=0;
client.auth.onAuthStateChange((event,session)=>{
  const nextId=session?.user?.id||null;
  if(event==='INITIAL_SESSION'&&!restoringSession)return;
  const version=++authEvent;
  if(event==='SIGNED_OUT'){
    restoringSession=false;pendingAuthUserId=null;identity.set(null,true);state.user=null;resetData();state.loading=logoutBusy;
    app.innerHTML=loading('Menutup sesi akun…');queueMicrotask(()=>void render());return;
  }
  // getSession may refresh an expired stored JWT before it resolves. Accept
  // that same restoration identity; an A→B→A sequence must still invalidate it.
  if(restoringSession){
    if(nextId&&restoredUserId&&nextId!==restoredUserId){
      restoringSession=false;identity.set(null,true);state.user=null;resetData();state.loading=true;
      app.innerHTML=loading('Memeriksa sesi akun…');queueMicrotask(()=>void logout());
    }else if(nextId)restoredUserId=nextId;
    return;
  }
  // An authenticated identity change must invalidate even a pending onboarding write.
  if(state.user&&nextId!==state.user.id){
    identity.set(null,true);state.user=null;resetData();state.loading=true;app.innerHTML=loading('Memeriksa sesi akun…');
    queueMicrotask(()=>void logout());return;
  }
  if(logoutBusy){if(nextId)sessionDuringLogout=true;return;}
  // Auth forms explicitly adopt successful results; don't render over their in-flight request.
  if(authBusy){if(nextId!==state.user?.id)pendingAuthUserId=nextId;return;}
  if(nextId===(state.user?.id||null))return;
  // A late SDK response after logout must never re-open private data.
  queueMicrotask(()=>{if(version===authEvent&&!authBusy&&!logoutBusy)void logout();});
});
void render();
const initialIdentity=identity.capture();
client.auth.getSession().then(async({data,error})=>{
  if(!restoringSession||!initialIdentity())return;
  const session=data?.session||null;
  if(restoredUserId&&session?.user?.id!==restoredUserId){await logout();return;}
  restoringSession=false;
  if(error){state.loading=false;await render();return;}
  await adoptSession(session);
}).catch(()=>{
  if(!restoringSession||!initialIdentity())return;
  restoringSession=false;state.loading=false;void render();
});

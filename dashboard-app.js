import { config } from '/dashboard-config.js';
import { loadOutlets, loadReport, requestScope, validateRange, makeCsv, escapeHtml as h } from '/dashboard-data.js';
import { refundAmount, netSaleAmount } from '/dashboard-lib-refundReports.js';

const app = document.querySelector('#app'), detail = document.querySelector('#detail');
const paths = {
 home: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
 product: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7 5.8l10 5.5"/>',
 wallet: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M17 10h4v6h-4a3 3 0 0 1 0-6zM3 7V5a2 2 0 0 1 2-2h12"/>',
 chart: '<path d="M4 3v17h17M8 15v-5M13 15V6M18 15V9"/>',
 people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
 expense: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
 refund: '<path d="m7 3-4 4 4 4M3 7h10a7 7 0 1 1-7 9"/>',
 download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
 refresh: '<path d="M20 7a9 9 0 0 0-15-2L3 7m0-5v5h5M4 17a9 9 0 0 0 15 2l2-2m0 5v-5h-5"/>',
 logout: '<path d="M9 3H4v18h5M8 12h13m-4-4 4 4-4 4"/>',
 menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
 close: '<path d="m6 6 12 12M6 18 18 6"/>',
 arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
 eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
 print: '<path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6z"/>',
 info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.chart}</svg>`;
const brand = () => '<div class="brand"><span class="brand-mark"><img src="/dashboard-assets-vora-logo.png" alt="VORA POS" width="1774" height="887"></span><small>BACKOFFICE</small></div>';
const nav = [ ['overview','Ringkasan','home'], ['transactions','Transaksi','receipt'], ['products','Penjualan produk','product'], ['payments','Pembayaran','wallet'], ['cashiers','Penjualan kasir','people'], ['profit','Laba rugi','chart'], ['expenses','Biaya usaha','expense'], ['refunds','Refund','refund'] ];
const titles = Object.fromEntries(nav.map(([key,name]) => [key,name]));
const descriptions = {
 overview:'Pantau performa outlet dan pahami angka di balik setiap transaksi.',
 transactions:'Telusuri seluruh struk penjualan yang telah tersinkron.',
 products:'Kenali produk yang paling banyak dipilih pelanggan.',
 payments:'Rincian penerimaan berdasarkan metode bayar dan jenis pesanan.',
 cashiers:'Ringkasan struk dan penerimaan untuk setiap nama kasir.',
 profit:'Pendapatan, HPP, dan biaya usaha dalam satu laporan operasional.',
 expenses:'Riwayat biaya usaha dan pembatalan catatan dari aplikasi.',
 refunds:'Pengembalian dana untuk struk pada periode penjualan yang dipilih.',
};
const rp = value => value === null || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value));
const number = value => new Intl.NumberFormat('id-ID',{maximumFractionDigits:2}).format(value || 0);
const dateLabel = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date)) : '—';
const dayString = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
function presetRange(preset) { const end=new Date(), start=new Date(end); if(preset==='month')start.setDate(1);if(preset==='week')start.setDate(start.getDate()-6);if(preset==='yesterday'){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1);}return {start:dayString(start),end:dayString(end)}; }
const state={user:null,outlets:[],outletId:'',outletsReady:false,range:presetRange('month'),preset:'month',route:routeFromHash(),report:null,loading:false,error:'',search:'',status:'all',page:0,menu:false,printAll:false};
const outletScope=requestScope(), reportScope=requestScope();
let authVersion=0, loginBusy=false, logoutBusy=false, toastTimer;
function routeFromHash(){const route=location.hash.slice(1);return nav.some(n=>n[0]===route)?route:'overview';}
function toast(text){const box=document.querySelector('#toast');box.textContent=text;box.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{box.hidden=true;},5000);}
function closeDetail(){if(detail.open)detail.close();detail.replaceChildren();document.body.classList.remove('print-detail');}
function currentOutlet(){return state.outlets.find(outlet=>outlet.id===state.outletId);}
function safeError(error){
 if(!navigator.onLine)return 'Tidak ada koneksi internet. Sambungkan perangkat lalu muat ulang laporan.';
 if(error?.status===401 || error?.code==='PGRST301')return 'Sesi login berakhir. Keluar lalu masuk kembali ke akun Anda.';
 const message=String(error?.message||'');
 if(/^(Pilih |Data tidak sesuai|Data lintas|Data periode|Halaman laporan|Riwayat refund|Outlet tidak tersedia)/.test(message))return message;
 return 'Laporan belum dapat dimuat lengkap. Periksa koneksi dan hak akses akun, lalu coba lagi.';
}
async function boundedFetch(url,options={}){
 const controller=new AbortController(),abort=()=>controller.abort();
 if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,20000);
 try{return await fetch(url,{...options,signal:controller.signal});}
 finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
}
if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.supabaseUrl)||config.supabaseKey.startsWith('sb_secret_'))throw new Error('Konfigurasi public Supabase tidak valid.');
if(!config.supabaseKey.startsWith('sb_publishable_')){let role;try{role=JSON.parse(atob(config.supabaseKey.split('.')[1].replaceAll('-','+').replaceAll('_','/'))).role;}catch{}if(role!=='anon')throw new Error('Hanya anon/public key yang boleh digunakan di browser.');}
let storage;try{sessionStorage.setItem('vora-storage-check','1');sessionStorage.removeItem('vora-storage-check');storage=sessionStorage;}catch{storage=undefined;}
const client=window.supabase.createClient(config.supabaseUrl,config.supabaseKey,{global:{fetch:boundedFetch},auth:{storage,storageKey:'vora-backoffice-auth',persistSession:!!storage,autoRefreshToken:true,detectSessionInUrl:false}});

function loginView(){return `<main class="login" id="main"><section class="login-aside">${brand()}<div><div class="eyebrow">BISNIS ANDA, DALAM SATU PANDANGAN</div><h1>Lebih dekat dengan<br>perkembangan usaha.</h1><p>Dari transaksi pertama hingga laporan akhir hari. Semua angka penting outlet Anda, di satu tempat.</p><div class="login-features"><span>Laporan penjualan</span><span>Analisis produk</span><span>Laba rugi</span></div></div><div class="login-note">VORA POS · Ruang kendali untuk usaha Anda.</div></section><section class="login-main"><form class="login-form" id="login-form">${brand()}<div class="eyebrow">SELAMAT DATANG KEMBALI</div><h2>Masuk ke backoffice</h2><p class="muted">Gunakan akun yang sama dengan aplikasi VORA POS.</p><label for="email">Email akun</label><input id="email" name="email" type="email" autocomplete="username" placeholder="nama@usaha.com" required maxlength="254"><label for="password">Kata sandi</label><div class="password-field"><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Masukkan kata sandi" required maxlength="512"><button type="button" class="password-toggle" data-action="password" aria-label="Tampilkan kata sandi" aria-pressed="false">${icon('eye')}</button></div><div id="login-error" class="notice error" role="alert" hidden></div><button class="btn full" type="submit">Masuk ke dashboard ${icon('arrow')}</button><p class="login-help">Gunakan email dan kata sandi akun pemilik, bukan PIN staf. <a href="${h(config.authForgotPasswordUrl)}">Lupa password?</a></p><div class="notice">Laporan menampilkan transaksi yang sudah tersinkron dari aplikasi kasir.</div></form></section></main>`;}
function render(){
 document.title=`${state.user?titles[state.route]:'Masuk'} · VORA Backoffice`;
 if(!state.user){app.innerHTML=loginView();return;}
 const outlet=currentOutlet(),report=state.report,canExport=!!report&&!state.loading&&!state.error;
 app.innerHTML=`<div class="shell ${state.menu?'menu-open':''}"><button class="mobile-scrim" data-action="menu" aria-label="Tutup navigasi"></button><aside class="sidebar" aria-label="Navigasi laporan">${brand()}<div class="nav-label">RUANG KENDALI</div><nav>${nav.map(([key,name,i])=>`<button class="nav-item ${key===state.route?'active':''}" data-route="${key}" ${key===state.route?'aria-current="page"':''}>${icon(i)}${name}</button>`).join('')}</nav><div class="sidebar-foot"><div class="notice">Satu akun, satu akses.<br>Laporan outlet milik Anda.</div><div class="account"><span class="avatar">${h((state.user.email||'V').slice(0,1).toUpperCase())}</span><div><strong>Akun pemilik</strong><small title="${h(state.user.email)}">${h(state.user.email)}</small></div></div><button class="nav-item" data-action="logout" ${logoutBusy?'disabled':''}>${icon('logout')}Keluar akun</button></div></aside><div class="workspace"><header class="topbar"><button class="btn ghost menu-toggle" data-action="menu" aria-label="Buka navigasi" aria-expanded="${state.menu}">${icon('menu')}</button><div class="breadcrumb">Backoffice <strong>/ ${h(titles[state.route])}</strong></div><div class="top-tools"><span class="top-state"><span class="status-dot"></span>${navigator.onLine?'Terhubung':'Offline'}</span><label class="sr-only" for="outlet">Pilih outlet</label><select id="outlet" class="outlet-picker" ${!state.outlets.length?'disabled':''}>${state.outlets.length?state.outlets.map(o=>`<option value="${h(o.id)}" ${o.id===state.outletId?'selected':''}>${h(o.name)}</option>`).join(''):'<option>Memuat outlet…</option>'}</select></div></header><main id="main" class="main"><div class="page-heading"><div><h1>${h(titles[state.route])}</h1><p>${h(descriptions[state.route])}</p></div><div class="heading-actions"><button class="btn secondary" data-action="print" ${!canExport?'disabled':''}>${icon('print')}Cetak / PDF</button><button class="btn" data-action="export" ${!canExport?'disabled':''}>${icon('download')}Ekspor CSV</button></div></div><div class="filters"><div class="filter-left"><label class="sr-only" for="preset">Periode laporan</label><select id="preset">${[['today','Hari ini'],['yesterday','Kemarin'],['week','7 hari terakhir'],['month','Bulan ini'],['custom','Tanggal khusus']].map(([v,t])=>`<option value="${v}" ${state.preset===v?'selected':''}>${t}</option>`).join('')}</select><div class="date-fields"><label class="sr-only" for="start">Tanggal awal</label><input id="start" type="date" value="${h(state.range.start)}" required><span class="muted">—</span><label class="sr-only" for="end">Tanggal akhir</label><input id="end" type="date" value="${h(state.range.end)}" required><button class="btn secondary" data-action="apply">Terapkan</button></div></div><button class="btn secondary" data-action="refresh" ${state.loading?'disabled':''}>${state.loading?'<span class="spinner"></span>':icon('refresh')}Perbarui</button></div><div class="print-only"><strong>${h(outlet?.name||'VORA POS')}</strong> · ${dateLabel(state.range.start)} – ${dateLabel(state.range.end)}</div><div id="report-body">${reportBody()}</div><footer class="footer"><span>VORA POS · ${h(outlet?.name||'Backoffice')}<br>Data hanya mencakup transaksi yang telah tersinkron. Tanggal mengikuti tanggal usaha pada struk.</span><span>${report?`Diperbarui ${new Date(report.loadedAt).toLocaleString('id-ID')}`:'Belum ada laporan dimuat'}</span></footer></main></div></div>`;
 updateInert();
}
function updateInert(){const mobile=window.innerWidth<=720;const aside=document.querySelector('.sidebar'),workspace=document.querySelector('.workspace');if(aside)aside.inert=mobile&&!state.menu;if(workspace)workspace.inert=mobile&&state.menu;}
window.addEventListener('resize',updateInert);
function empty(title,description,action=''){return `<div class="empty">${icon('chart')}<h2>${h(title)}</h2><p>${h(description)}</p>${action}</div>`;}
function reportBody(){
 if(state.loading)return '<div class="panel"><div class="loading" role="status"><span class="spinner"></span>Memuat data laporan lengkap…</div></div>';
 if(state.error)return `<div class="notice error" role="alert">${h(state.error)} <button class="btn secondary" data-action="refresh">Coba lagi</button></div>`;
 if(!state.outlets.length)return `<div class="panel">${empty('Belum ada outlet yang dapat diakses','Pastikan Anda masuk dengan email pemilik outlet yang sama dengan aplikasi VORA POS.')}</div>`;
 if(!state.report)return `<div class="panel">${empty('Laporan belum dimuat','Pilih periode lalu tekan Perbarui.')}</div>`;
 const r=state.report;
 const warnings=(!navigator.onLine?'<div class="notice warning info-strip">Koneksi terputus. Data di bawah adalah hasil pemuatan terakhir; perubahan baru belum tersedia.</div>':'')+(!r.finance.complete?`<div class="notice warning info-strip">${icon('info')}<div><strong>Laporan sementara — ada data historis yang perlu diperiksa.</strong><br>${h(r.finance.issues.join(' '))} Angka laba dan refund belum dapat dianggap final.</div></div>`:'');
 const content={overview:overview,transactions:transactions,products:products,payments:payments,cashiers:cashiers,profit:profit,expenses:expenses,refunds:refunds}[state.route]();
 return warnings+content;
}
function kpi(label,value,note,i){return `<section class="kpi"><div class="kpi-top"><span>${h(label)}</span><span class="kpi-icon">${icon(i)}</span></div><div class="kpi-value mono">${h(value)}</div><small>${h(note)}</small></section>`;}
function cards(){const r=state.report,f=r.finance;return `<div class="kpis">${kpi('Penjualan bersih',rp(f.revenue),'Tanpa pajak, layanan & surcharge','chart')}${kpi('Jumlah struk',number(f.transactions),'Termasuk struk yang direfund','receipt')}${kpi('Rata-rata penerimaan',rp(f.transactions?f.netReceipts/f.transactions:0),'Penerimaan bersih per struk','wallet')}${kpi('Laba operasional',rp(r.operatingProfit),f.complete?'Setelah HPP, MDR & biaya tercatat':'Sementara · perlu rekonsiliasi','expense')}</div>`;}
function panel(title,subtitle,body,action=''){return `<section class="panel"><div class="panel-head"><div><h2>${h(title)}</h2><p>${h(subtitle)}</p></div>${action}</div>${body}</section>`;}
function chart(){
 const days=state.report.days;if(!state.report.sales.length)return '<div class="chart-empty">Belum ada penjualan pada periode ini.</div>';
 const W=720,H=228,left=57,right=18,top=15,bottom=36,max=Math.max(...days.map(d=>d.net),1)*1.15;
 const x=i=>left+i*(W-left-right)/Math.max(days.length-1,1),y=v=>H-bottom-v/max*(H-top-bottom);
 const pts=days.map((d,i)=>`${x(i).toFixed(2)},${y(d.net).toFixed(2)}`),base=H-bottom;
 const grid=Array.from({length:5},(_,i)=>{const v=max*i/4,yy=y(v);return `<line x1="${left}" y1="${yy}" x2="${W-right}" y2="${yy}" stroke="#edf0f6" stroke-dasharray="4 4"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${h(v>=1e6?`${number(v/1e6)}jt`:v>=1000?`${number(v/1000)}rb`:number(v))}</text>`}).join('');
 const labels=days.map((d,i)=>i===0||i===days.length-1||i%Math.max(1,Math.ceil(days.length/6))===0?`<text x="${x(i)}" y="${H-10}" text-anchor="middle">${h(d.date.slice(8)+'/'+d.date.slice(5,7))}</text>`:'').join('');
 return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Penerimaan bersih per hari; rincian tersedia pada transaksi dan ekspor CSV"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#215cec" stop-opacity=".16"/><stop offset="1" stop-color="#215cec" stop-opacity=".01"/></linearGradient></defs>${grid}<path d="M${left},${base} L${pts.join(' L')} L${x(days.length-1)},${base}Z" fill="url(#area)"/><polyline points="${pts.join(' ')}" fill="none" stroke="#215cec" stroke-width="2.8" stroke-linejoin="round"/>${days.length===1?`<circle cx="${x(0)}" cy="${y(days[0].net)}" r="4" fill="#215cec"/>`:''}${labels}</svg><div class="chart-legend"><span class="legend-dot"></span>Penerimaan setelah refund, termasuk pajak & layanan</div>`;
}
function bars(rows,field='net',currency=true){if(!rows.length)return '<p class="muted">Belum ada data.</p>';const max=Math.max(...rows.map(r=>r[field]),1);return rows.slice(0,6).map(r=>`<div class="bar-row"><div class="bar-label"><span>${h(r.name)}</span><strong>${currency?rp(r[field]):number(r[field])}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(0,Math.min(100,r[field]/max*100))}%"></div></div></div>`).join('');}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map((v,i)=>`<th ${i===headers.length-1?'class="num"':''}>${h(v)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}"><div class="empty">Tidak ada data untuk pilihan ini.</div></td></tr>`}</tbody></table></div>`;}
function saleStatus(s){if(s.status==='REFUNDED')return '<span class="pill refund">Refund penuh</span>';if(s.status==='PARTIAL_REFUND'||Number(s.refunded_amount)>0)return '<span class="pill refund">Refund sebagian</span>';return '<span class="pill success">Selesai</span>';}
function saleRow(s){return `<tr><td><button class="row-link" data-sale="${h(s.id)}">${h(s.id)}</button><small>${dateLabel(s.date)} · ${h(s.time)}</small></td><td>${h(s.cashier)}</td><td>${h(s.method)}</td><td>${saleStatus(s)}</td><td class="num"><strong>${rp(netSaleAmount(s,state.report.logs))}</strong></td></tr>`;}
function overview(){const r=state.report;return cards()+`<div class="grid-main">${panel('Tren penerimaan',`${dateLabel(r.range.start)} – ${dateLabel(r.range.end)}`,`<div class="panel-body">${chart()}</div>`,'<span class="pill">Harian</span>')}${panel('Metode pembayaran','Penerimaan bersih pada periode ini',`<div class="panel-body">${bars(r.methods)}</div>`)}</div><div class="grid-half">${panel('Produk terlaris','Kuantitas setelah refund item',table(['Produk','Terjual','Nilai item'],r.products.slice(0,5).map((p,i)=>`<tr><td><strong>${i+1}. ${h(p.name)}</strong><small>${h(p.category)}</small></td><td>${number(p.qty)}</td><td class="num">${rp(p.amount)}</td></tr>`)),`<button class="btn ghost" data-route="products">Lihat semua ${icon('arrow')}</button>`)}${panel('Jenis pesanan','Penerimaan bersih menurut jenis pesanan',`<div class="panel-body">${bars(r.orderTypes)}</div>`)}</div>${panel('Transaksi terbaru','Tekan nomor struk untuk melihat rinciannya',table(['Nomor struk','Kasir','Pembayaran','Status','Penerimaan bersih'],r.sales.slice(0,5).map(saleRow)),`<button class="btn ghost" data-route="transactions">Lihat semua ${icon('arrow')}</button>`)}`;}
function filtered(rows,match){const q=state.search.trim().toLocaleLowerCase('id-ID');return rows.filter(row=>!q||match(row).toLocaleLowerCase('id-ID').includes(q));}
function paginated(rows,rowRender,headers){const pages=Math.max(1,Math.ceil(rows.length/25));state.page=Math.min(state.page,pages-1);const shown=state.printAll?rows:rows.slice(state.page*25,(state.page+1)*25);return table(headers,shown.map(rowRender))+`<div class="pagination"><span>${rows.length?`${number(state.page*25+1)}–${number(Math.min((state.page+1)*25,rows.length))}`:'0'} dari ${number(rows.length)} baris</span><div><button class="btn secondary" data-page="${state.page-1}" ${state.page===0?'disabled':''}>Sebelumnya</button> <button class="btn secondary" data-page="${state.page+1}" ${state.page>=pages-1?'disabled':''}>Berikutnya</button></div></div>`;}
function searchBar(placeholder,extra=''){return `<div class="table-toolbar"><label class="sr-only" for="search">${h(placeholder)}</label><input id="search" type="search" placeholder="${h(placeholder)}" value="${h(state.search)}" maxlength="150">${extra}</div>`;}
function transactionRows(){return filtered(state.report.sales,s=>`${s.id} ${s.cashier} ${s.method} ${s.customer?.name||''}`).filter(s=>state.status==='all'||(state.status==='refund'?['REFUNDED','PARTIAL_REFUND'].includes(s.status)||Number(s.refunded_amount)>0:!['REFUNDED','PARTIAL_REFUND'].includes(s.status)&&!Number(s.refunded_amount)));}
function transactions(){return panel('Riwayat transaksi','Jumlah dihitung per struk; pembayaran bertahap dapat menghasilkan beberapa struk.',searchBar('Cari nomor struk, kasir, metode, atau pelanggan…',`<select id="status" aria-label="Filter status">${[['all','Semua status'],['success','Selesai'],['refund','Dengan refund']].map(([v,t])=>`<option value="${v}" ${state.status===v?'selected':''}>${t}</option>`).join('')}</select>`)+paginated(transactionRows(),saleRow,['Nomor struk','Kasir','Pembayaran','Status','Penerimaan bersih']));}
function products(){const rows=filtered(state.report.products,p=>`${p.name} ${p.category}`);return panel('Penjualan produk','Snapshot nama & harga pada struk, termasuk ekstra. Tidak memakai katalog saat ini.',searchBar('Cari produk atau kategori…')+paginated(rows,p=>`<tr><td><strong>${h(p.name)}</strong></td><td>${h(p.category)}</td><td>${number(p.qty)}</td><td class="num">${rp(p.amount)}</td></tr>`,['Produk','Kategori','Kuantitas neto','Nilai item'])+'<div class="notes">Nilai item sebelum diskon, pajak, layanan, dan pembulatan. Marker pembayaran nominal tidak dihitung sebagai produk. Produk dengan perubahan nama dapat muncul pada baris terpisah. Rekonsiliasi refund lama juga dapat memengaruhi kuantitas.</div>');}
function groupRows(rows){return table(['Nama','Struk','Sebelum refund','Refund','Penerimaan bersih'],rows.map(r=>`<tr><td><strong>${h(r.name)}</strong></td><td>${number(r.count)}</td><td>${rp(r.gross)}</td><td>${rp(r.refund)}</td><td class="num"><strong>${rp(r.net)}</strong></td></tr>`));}
function payments(){const r=state.report;return `<div class="grid-half">${panel('Komposisi pembayaran','Penerimaan bersih per metode',`<div class="panel-body">${bars(r.methods)}</div>`)}${panel('Jenis pesanan','Dine-in, takeaway, dan jenis lain pada struk',`<div class="panel-body">${bars(r.orderTypes)}</div>`)}</div>${panel('Rincian metode pembayaran','Penerimaan termasuk pajak/layanan. MDR ditampilkan terpisah.',table(['Metode','Struk','Penerimaan bersih','MDR','Setelah MDR'],r.methods.map(r=>`<tr><td><strong>${h(r.name)}</strong></td><td>${number(r.count)}</td><td>${rp(r.net)}</td><td>${rp(r.mdr)}</td><td class="num"><strong>${rp(r.net-r.mdr)}</strong></td></tr>`)))}<br>${panel('Rincian jenis pesanan','Mengikuti jenis pesanan yang tersimpan pada struk.',groupRows(r.orderTypes))}`;}
function cashiers(){return panel('Ringkasan kasir','Dikelompokkan berdasarkan nama pada struk; nama yang sama digabung.',searchBar('Cari nama kasir…')+groupRows(filtered(state.report.cashiers,r=>r.name)));}
function profitLines(){const r=state.report,f=r.finance;return [['Penerimaan sebelum refund',f.receipts,''],['Pengembalian dana',-f.refunds,'sub'],['Penerimaan bersih',f.netReceipts,'total'],['Pajak',-f.tax,'sub'],['Biaya layanan',-f.service,'sub'],['Surcharge pembayaran',-f.surcharge,'sub'],['Pendapatan usaha',f.revenue,'total'],['Harga pokok penjualan (HPP)',-f.cogs,'sub'],['Laba kotor',f.grossProfit,'total'],['Biaya pembayaran (MDR)',-f.mdr,'sub'],['Biaya usaha tercatat',-r.expense.total,'sub'],['Laba operasional',r.operatingProfit,'profit']];}
function profit(){const r=state.report;return `<div class="grid-main">${panel('Laporan laba rugi operasional',`${dateLabel(r.range.start)} – ${dateLabel(r.range.end)}`,`<div class="pl-lines">${profitLines().map(([label,value,type])=>`<div class="pl-line ${type}"><span>${h(label)}</span><span class="value ${value<0?'negative':''}">${rp(value)}</span></div>`).join('')}</div>`, `<span class="pill ${r.finance.complete?'success':'warning'}">${r.finance.complete?'Komponen tersedia':'Sementara'}</span>`)}${panel('Dasar laporan','Baca sebelum menggunakan angka laba',`<div class="notes"><ul><li>Refund mengurangi periode tanggal penjualan asal, termasuk refund yang dilakukan setelah periode tersebut.</li><li>HPP memakai snapshot struk dan alokasi pembayaran bertahap. HPP historis yang hilang tidak diganti harga beli katalog saat ini.</li><li>Pajak, layanan, dan surcharge dipisahkan dari pendapatan usaha, sesuai perhitungan aplikasi.</li><li>Biaya hanya mencakup catatan yang telah disinkron. Penarikan owner dan pembelian persediaan bukan otomatis biaya usaha.</li><li>Belum mencakup akrual, penyusutan, pajak penghasilan, atau biaya yang belum dicatat. Bukan laporan keuangan audit.</li></ul></div>`)}</div>${panel('Biaya per kategori','Termasuk pembatalan pada periode biaya asal.',table(['Kategori','Jumlah'],r.expense.categories.map(c=>`<tr><td>${h(c.label)}</td><td class="num">${rp(c.amount)}</td></tr>`)))}`;}
function expenseRows(){return filtered(state.report.expense.expenses,r=>`${r.description} ${r.label} ${r.staff||''} ${r.source}`);}
function expenses(){return `<div class="kpis">${kpi('Total biaya tercatat',rp(state.report.expense.total),'Setelah pembatalan catatan','expense')}${kpi('Jumlah catatan',number(state.report.expense.expenses.length),'Termasuk catatan pembatalan','receipt')}</div>`+panel('Riwayat biaya usaha','Pencatatan dan koreksi biaya dilakukan melalui aplikasi VORA POS.',searchBar('Cari keterangan, kategori, atau nama staf…')+paginated(expenseRows(),r=>`<tr><td>${dateLabel(r.date)}</td><td><strong>${h(r.label)}</strong><small>${h(r.description)}</small></td><td>${h(r.source)}<small>${h(r.staff||'')}</small></td><td><span class="pill ${r.reversal?'refund':''}">${r.reversal?'Pembatalan':r.reversed?'Dibatalkan':r.legacy?'Catatan lama':'Tercatat'}</span></td><td class="num ${r.amount<0?'positive':''}"><strong>${rp(r.amount)}</strong></td></tr>`,['Tanggal usaha','Biaya & keterangan','Sumber dana','Status','Nominal']));}
function refundRows(){return filtered(state.report.refunds,r=>`${r.id} ${r.cashier} ${r.method}`);}
function refunds(){return panel('Riwayat refund','Berdasarkan tanggal struk asal. Refund mengubah penerimaan bersih periode penjualan tersebut.',searchBar('Cari nomor struk atau kasir…')+paginated(refundRows(),s=>`<tr><td><button class="row-link" data-sale="${h(s.id)}">${h(s.id)}</button><small>${dateLabel(s.date)}</small></td><td>${h(s.cashier)}</td><td>${saleStatus(s)}</td><td>${rp(s.total)}</td><td class="num"><strong>${rp(refundAmount(s,state.report.logs))}</strong></td></tr>`,['Struk asal','Kasir','Status','Total struk','Refund']));}

async function adoptUser(user){
 if(state.user?.id===user?.id && (user || !state.user)){if(!user && !document.querySelector('#login-form'))render();return;}
 outletScope.cancel();reportScope.cancel();closeDetail();
 state.user=user;state.outlets=[];state.outletId='';state.outletsReady=false;state.report=null;state.error='';state.search='';state.page=0;state.loading=!!user;render();
 if(user)await loadOwnedOutlets();
}
async function loadOwnedOutlets(){
 if(!state.user)return;
 const task=outletScope.begin(),uid=state.user.id;state.loading=true;state.error='';state.report=null;render();
 try{const outlets=await loadOutlets(client,uid,task.signal);if(!task.current()||state.user?.id!==uid)return;state.outlets=outlets;state.outletsReady=true;state.outletId=outlets[0]?.id||'';state.loading=false;render();if(state.outletId)await refreshReport();}
 catch(error){if(!task.current()||state.user?.id!==uid)return;state.loading=false;state.error=safeError(error);render();}
}
async function refreshReport(){
 const outlet=currentOutlet();if(!outlet||!state.user)return;
 try{validateRange(state.range);}catch(error){toast(error.message);return;}
 const task=reportScope.begin(),uid=state.user.id;state.report=null;state.loading=true;state.error='';closeDetail();render();
 try{const report=await loadReport(client,uid,outlet,{...state.range},task.signal);if(!task.current()||state.user?.id!==uid||state.outletId!==outlet.id)return;state.report=report;state.loading=false;render();}
 catch(error){if(!task.current()||state.user?.id!==uid)return;reportScope.cancel();state.report=null;state.loading=false;state.error=safeError(error);render();}
}
async function signIn(form){
 if(loginBusy||logoutBusy)return;loginBusy=true;const button=form.querySelector('[type=submit]'),feedback=document.querySelector('#login-error');button.disabled=true;button.innerHTML='<span class="spinner"></span>Memverifikasi akun…';feedback.hidden=true;
 try{const {data,error}=await client.auth.signInWithPassword({email:form.email.value.trim(),password:form.password.value});if(error)throw error;form.password.value='';await adoptUser(data.user);}
 catch{if(document.contains(feedback)){feedback.hidden=false;feedback.textContent=navigator.onLine?'Email atau kata sandi belum sesuai, atau login belum tersedia. Periksa akun dan coba kembali.':'Tidak ada koneksi internet. Sambungkan perangkat lalu coba lagi.';}}
 finally{loginBusy=false;if(document.contains(button)){button.disabled=false;button.innerHTML=`Masuk ke dashboard ${icon('arrow')}`;}}
}
async function signOut(){
 if(logoutBusy)return;logoutBusy=true;authVersion++;outletScope.cancel();reportScope.cancel();await adoptUser(null);
 try{await client.auth.signOut({scope:'local'});}catch{try{storage?.removeItem('vora-backoffice-auth');}catch{}}
 finally{try{storage?.removeItem('vora-backoffice-auth');}catch{}logoutBusy=false;render();location.reload();}
}
function go(route){if(!nav.some(n=>n[0]===route))return;state.route=route;state.menu=false;state.search='';state.status='all';state.page=0;closeDetail();if(location.hash!==`#${route}`)history.replaceState(null,'',`#${route}`);render();}
function showDetail(id){const r=state.report,s=r?.sales.find(s=>s.id===id&&s.outlet_id===state.outletId);if(!s)return;
 detail.innerHTML=`<header class="dialog-head"><div><div class="eyebrow">RINCIAN TRANSAKSI</div><h2 id="detail-title">${h(s.id)}</h2></div><button class="btn ghost" data-action="close-detail" aria-label="Tutup rincian">${icon('close')}</button></header><div class="dialog-body"><div class="detail-grid"><div><small>Outlet</small><strong>${h(currentOutlet()?.name)}</strong></div><div><small>Tanggal & waktu pada struk</small>${dateLabel(s.date)} · ${h(s.time)}</div><div><small>Kasir</small>${h(s.cashier)}</div><div><small>Pembayaran</small>${h(s.method)}</div><div><small>Jenis pesanan</small>${h(s.table_type||'—')}</div><div><small>Pelanggan</small>${h(s.customer?.name||'Umum')}</div></div><div class="table-wrap"><table class="detail-items"><thead><tr><th>Item</th><th>Qty</th><th class="num">Nilai</th></tr></thead><tbody>${(s.cart_data||[]).map(item=>`<tr><td><strong>${h(item.name)}</strong>${item.isPayment?'<small>Penyesuaian pembayaran nominal</small>':''}${(item.selectedExtrasList||[]).map(e=>`<small>+ ${h(e.name)}</small>`).join('')}</td><td>${number(item.qty)}</td><td class="num">${rp(Number(item.price)*Number(item.qty))}</td></tr>`).join('')}</tbody></table></div><div class="pl-lines">${[['Subtotal',s.subtotal],['Diskon',-Number(s.discount||0)],['Pajak',s.tax],['Layanan',s.service],['Surcharge',s.payment_surcharge],['Total struk',s.total],['Refund',refundAmount(s,r.logs)],['Penerimaan bersih',netSaleAmount(s,r.logs)]].map(([label,value])=>`<div class="pl-line"><span>${h(label)}</span><span class="value">${rp(value)}</span></div>`).join('')}</div>${saleStatus(s)}${r.logs.some(l=>l.sale_id===s.id)?`<div class="notes"><strong>Catatan refund</strong>${r.logs.filter(l=>l.sale_id===s.id).map(l=>`<p>${h(l.date||'')} · ${h(l.reason||'Tanpa keterangan')}<br><small>${h(l.item_name||'')} · ${h(l.cashier_name||'')}</small></p>`).join('')}</div>`:''}</div><footer class="dialog-foot"><button class="btn secondary" data-action="close-detail">Tutup</button><button class="btn" data-action="print-detail">${icon('print')}Cetak rincian</button></footer>`;
 detail.showModal();
}
function exportRows(){const r=state.report;
 if(state.route==='products')return [['Produk','Kategori','Kuantitas neto','Nilai item sebelum diskon/pajak'],...filtered(r.products,p=>`${p.name} ${p.category}`).map(p=>[p.name,p.category,p.qty,p.amount])];
 if(state.route==='cashiers'||state.route==='payments')return [['Nama','Struk','Sebelum refund','Refund','Penerimaan bersih','MDR'],...filtered(state.route==='cashiers'?r.cashiers:r.methods,g=>g.name).map(g=>[g.name,g.count,g.gross,g.refund,g.net,g.mdr])];
 if(state.route==='profit')return [['Komponen','Nominal'],...profitLines().map(([name,amount])=>[name,amount])];
 if(state.route==='expenses')return [['Tanggal usaha','Kategori','Keterangan','Sumber dana','Staf','Status','Nominal'],...expenseRows().map(e=>[e.date,e.label,e.description,e.source,e.staff,e.reversal?'Pembatalan':e.reversed?'Dibatalkan':'Tercatat',e.amount])];
 if(state.route==='refunds')return [['Struk asal','Tanggal penjualan','Kasir','Status','Total','Refund'],...refundRows().map(s=>[s.id,s.date,s.cashier,s.status,Number(s.total),refundAmount(s,r.logs)])];
 return [['Nomor struk','Tanggal usaha','Waktu','Kasir','Jenis pesanan','Metode','Status','Subtotal','Diskon','Pajak','Layanan','Surcharge','MDR','Total struk','Refund','Penerimaan bersih'],...(state.route==='transactions'?transactionRows():r.sales).map(s=>[s.id,s.date,s.time,s.cashier,s.table_type,s.method,s.status,Number(s.subtotal),Number(s.discount||0),Number(s.tax||0),Number(s.service||0),Number(s.payment_surcharge||0),Number(s.mdr_fee||0),Number(s.total),refundAmount(s,r.logs),netSaleAmount(s,r.logs)])];
}
function download(){if(!state.report||state.loading||state.error)return;const r=state.report,rows=[['VORA POS',titles[state.route]],['Outlet',currentOutlet().name],['Periode',`${r.range.start} s/d ${r.range.end}`],['Diperbarui',r.loadedAt],['Status',r.finance.complete?'Komponen tersedia; hanya data tersinkron':'Sementara: '+r.finance.issues.join(' ')],[],...exportRows()];const url=URL.createObjectURL(new Blob([makeCsv(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`VORA-${state.route}-${r.range.start}-${r.range.end}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Laporan CSV berhasil disiapkan.');}
function print(detailOnly=false){if(!state.report||state.loading)return;if(detailOnly)document.body.classList.add('print-detail');else{state.printAll=true;render();}requestAnimationFrame(()=>window.print());}
window.addEventListener('afterprint',()=>{state.printAll=false;document.body.classList.remove('print-detail');if(!detail.open)render();});
app.addEventListener('submit',event=>{if(event.target.id==='login-form'){event.preventDefault();void signIn(event.target);}});
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||button.disabled)return;
 if(button.dataset.route){go(button.dataset.route);return;}if(button.dataset.sale){showDetail(button.dataset.sale);return;}
 if(button.dataset.page!==undefined){state.page=Math.max(0,Number(button.dataset.page)||0);render();return;}
 const action=button.dataset.action;
 if(action==='password'){const input=document.querySelector('#password'),show=input.type==='password';input.type=show?'text':'password';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',show?'Sembunyikan kata sandi':'Tampilkan kata sandi');}
 if(action==='logout')void signOut();
 if(action==='menu'){state.menu=!state.menu;render();document.querySelector(state.menu?'.sidebar .nav-item.active':'.menu-toggle')?.focus();}
 if(action==='refresh')void(state.outletsReady?refreshReport():loadOwnedOutlets());
 if(action==='apply'){const range={start:document.querySelector('#start').value,end:document.querySelector('#end').value};try{validateRange(range);state.range=range;state.preset='custom';state.page=0;void refreshReport();}catch(error){toast(error.message);}}
 if(action==='close-detail')closeDetail();
 if(action==='print-detail')print(true);
 if(action==='print')print();
 if(action==='export')download();
});
app.addEventListener('change',event=>{
 if(event.target.id==='outlet'){if(!state.outlets.some(o=>o.id===event.target.value))return;state.outletId=event.target.value;state.page=0;state.search='';state.status='all';void refreshReport();}
 if(event.target.id==='preset'){state.preset=event.target.value;if(state.preset==='custom'){document.querySelector('#start').focus();return;}state.range=presetRange(state.preset);state.page=0;void refreshReport();}
 if(event.target.id==='status'){state.status=event.target.value;state.page=0;render();}
});
app.addEventListener('input',event=>{if(event.target.id==='search'){const pos=event.target.selectionStart;state.search=event.target.value;state.page=0;document.querySelector('#report-body').innerHTML=reportBody();const input=document.querySelector('#search');input.focus();if(pos!==null)input.setSelectionRange(pos,pos);}});
window.addEventListener('hashchange',()=>go(routeFromHash()));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.menu){state.menu=false;render();document.querySelector('.menu-toggle')?.focus();}});
window.addEventListener('online',()=>{if(state.user){toast('Koneksi kembali tersedia. Memperbarui laporan…');void(state.outletsReady?refreshReport():loadOwnedOutlets());}});
window.addEventListener('offline',()=>{if(state.user)render();});
window.addEventListener('pageshow',event=>{if(event.persisted){const version=authVersion;state.report=null;closeDetail();render();void client.auth.getUser().then(({data,error})=>{if(version!==authVersion)return;if(error)void adoptUser(null);else if(data.user?.id===state.user?.id)void refreshReport();else void adoptUser(data.user);});}});
client.auth.onAuthStateChange((event,session)=>{if(event==='INITIAL_SESSION')return;const version=++authVersion;queueMicrotask(()=>{if(version===authVersion)void adoptUser(session?.user||null);});});
const initialAuthVersion=authVersion;
try{const {data,error}=await client.auth.getUser();if(authVersion===initialAuthVersion)await adoptUser(error?null:data.user);}catch{if(authVersion===initialAuthVersion)await adoptUser(null);}
// Expose only the same authenticated, read-only filter workflow to supporting browsers.
if(document.modelContext?.registerTool){
 void Promise.resolve(document.modelContext.registerTool({name:'filter_vora_report',title:'Pilih laporan VORA',description:'Pilih halaman dan rentang tanggal pada laporan outlet yang sedang dibuka. Memerlukan login VORA; tidak mengganti outlet atau mengubah transaksi.',inputSchema:{type:'object',properties:{page:{type:'string',enum:nav.map(n=>n[0])},start:{type:'string'},end:{type:'string'}},required:['page','start','end'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async input=>{if(!state.user||!currentOutlet())throw new Error('Masuk dan pilih outlet terlebih dahulu.');if(!nav.some(n=>n[0]===input?.page))throw new Error('Halaman tidak valid.');const range=validateRange({start:input.start,end:input.end});state.range=range;state.preset='custom';go(input.page);await refreshReport();if(state.error)throw new Error(state.error);return {page:state.route,period:state.range,loadedAt:state.report?.loadedAt};}})).catch(()=>{});
}

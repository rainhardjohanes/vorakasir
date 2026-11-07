import { loadCommissionCatalog, saveCommissionGroup, commissionDraft, commissionError } from '/dashboard-commissions-data.js';
import { escapeHtml as h } from '/dashboard-data.js';
import {commissionReportModel,commissionDetailRows,normalizeCommissionFilters} from '/dashboard-commission-report-model.js';

const money = value => `Rp ${Number(value).toLocaleString('id-ID')}`;
const label = rule => rule.kind === 'percent' ? `${rule.value}%` : `${money(rule.value)}${rule.scope === 'product' ? ' / unit' : ' / transaksi'}`;
const flexibleLabel = cap => cap.kind==='percent'?`${cap.value}%`:money(cap.value);
const select = (name,title,value,options) => `<label class="field ops-field"><span>${title}</span><select class="input" name="${name}">${options.map(([id,text])=>`<option value="${id}" ${value===id?'selected':''}>${text}</option>`).join('')}</select></label>`;
export const commissionShell = () => '<section data-commissions><p role="status">Memuat grup komisi outlet…</p></section>';
export function filterCommissionGroups(rules, filters = {}) {
  const search=String(filters.search||'').trim().toLocaleLowerCase('id-ID');
  const scope=['product','transaction'].includes(filters.scope)?filters.scope:'all';
  const status=['active','draft'].includes(filters.status)?filters.status:'all';
  return rules.filter(rule=>(!search||rule.name.toLocaleLowerCase('id-ID').includes(search))&&
    (scope==='all'||rule.scope===scope)&&(status==='all'||rule.is_active===(status==='active')));
}
const hasGroupFilters = filters => !!String(filters.search||'').trim() || ['product','transaction'].includes(filters.scope) || ['active','draft'].includes(filters.status);
const groupCount = (rules,matches,filters) => hasGroupFilters(filters)?`${matches.length} dari ${rules.length} grup komisi`:`${rules.length} grup komisi`;
function commissionGroupCards(rules,enabled,total) {
  return rules.map(rule=>`<article class="commission-group"><header><div><span class="ops-pill ${rule.is_active?'green':'neutral'}">${rule.is_active?'Aktif':'Draf / nonaktif'}</span><h3>${h(rule.name)}</h3></div>${enabled?`<button class="btn btn-secondary" data-commission-edit="${h(rule.id)}" type="button">Ubah</button>`:''}</header><strong class="commission-rate">${h(rule.flexible?.enabled?`Maks. ${flexibleLabel(rule.flexible.max_total)} / unit`:label(rule))}</strong><p>${rule.scope==='product'?'Komisi produk':'Komisi transaksi'} · ${rule.discount_basis==='before'?'Sebelum diskon':'Setelah diskon'}</p><dl><div><dt>Pemilihan staf</dt><dd>${rule.selection_mode==='single'?'Satu staf':'Beberapa staf'} · ${rule.required?'Wajib':'Opsional'}</dd></div><div><dt>${rule.flexible?.enabled?'Fleksibel':'Pembagian'}</dt><dd>${rule.flexible?.enabled?`${rule.flexible.scenarios.length} skenario${rule.flexible.allow_manual?' · input manual kasir':''}`:rule.multi_staff_mode==='split'?'Dibagi rata':'Penuh per staf'}</dd></div><div><dt>Cakupan</dt><dd>${rule.staff_ids.length} staf${rule.scope==='product'?` · ${rule.product_ids.length} produk`:''}</dd></div></dl><small>Versi ${rule.version} · Riwayat transaksi memakai aturan saat transaksi.</small></article>`).join('')||(total?'<div class="ops-empty">Tidak ada grup yang sesuai.<small>Ubah pencarian atau reset filter untuk melihat grup lainnya.</small></div>':'<div class="ops-empty">Belum ada grup komisi.<small>Mulai dengan grup produk atau transaksi, lalu pilih staf penerimanya.</small></div>');
}
export function commissionSettingsView(catalog, data, filters = {}) {
  const enabled = catalog.commission_enabled;
  const matches=filterCommissionGroups(catalog.rules,filters);
  return `<div class="ops-settings-title"><h2>Komisi staf</h2><p>Atur penerima dan besaran komisi untuk outlet ini.</p></div>${!enabled?'<div class="ops-note">Premium belum aktif. Grup tersimpan dapat dilihat; pengubahan memerlukan Premium aktif. Riwayat komisi tetap tersedia.</div>':''}<div class="ops-settings-toolbar"><span data-commission-count role="status" aria-live="polite">${groupCount(catalog.rules,matches,filters)}</span><div class="commission-actions"><a class="btn btn-secondary" href="#commission-report">Laporan komisi</a>${enabled?'<button class="btn btn-primary" type="button" data-commission-add>Tambah grup</button>':''}</div></div><div class="commission-filters" role="search" aria-label="Filter grup komisi"><label class="field ops-field commission-filter-search"><span>Cari nama grup</span><input class="input" type="search" data-commission-filter="search" value="${h(filters.search||'')}" placeholder="Contoh: Pelayanan" aria-controls="commission-group-results"></label><label class="field ops-field"><span>Jenis komisi</span><select class="input" data-commission-filter="scope" aria-controls="commission-group-results"><option value="all">Semua jenis</option><option value="product" ${filters.scope==='product'?'selected':''}>Per produk</option><option value="transaction" ${filters.scope==='transaction'?'selected':''}>Per transaksi</option></select></label><label class="field ops-field"><span>Status</span><select class="input" data-commission-filter="status" aria-controls="commission-group-results"><option value="all">Semua status</option><option value="active" ${filters.status==='active'?'selected':''}>Aktif</option><option value="draft" ${filters.status==='draft'?'selected':''}>Draf / nonaktif</option></select></label><button class="btn btn-secondary" type="button" data-commission-reset ${hasGroupFilters(filters)?'':'disabled'}>Reset filter</button></div><div class="commission-groups" id="commission-group-results" data-commission-group-list>${commissionGroupCards(matches,enabled,catalog.rules.length)}</div><div class="ops-note">Komisi dicatat setelah pembayaran lunas dan dikurangi saat refund. Harga spesial menjadi dasar harga produk; ekstra, pajak, dan biaya layanan tidak dihitung. Nilai produk yang sudah memberi komisi kepada seorang staf tidak dihitung lagi pada komisi transaksi staf tersebut.</div>`;
}
function checkList(name, rows, selected, caption) {
  const known = new Set(rows.map(row=>row.id));
  const missing = selected.filter(id=>!known.has(id));
  return `<fieldset class="commission-picks"><legend>${caption}</legend><input class="input" type="search" data-commission-search="${name}" placeholder="Cari ${name==='staff_ids'?'staf':'produk'}…" aria-label="Cari ${caption.toLowerCase()}"><div class="commission-pick-list" data-commission-list="${name}">${rows.map(row=>`<label class="commission-check" data-label="${h(row.name.toLowerCase())}"><input type="checkbox" name="${name}" value="${h(row.id)}" ${selected.includes(row.id)?'checked':''}><span>${h(row.name)}${row.category?`<small>${h(row.category)}</small>`:''}</span></label>`).join('')}${missing.map(id=>`<label class="commission-check"><input type="checkbox" name="${name}" value="${h(id)}" checked><span>Referensi nonaktif <small>${h(id)} · Hapus pilihan sebelum mengaktifkan grup.</small></span></label>`).join('')}${!rows.length&&!missing.length?'<p>Belum ada data. Tambahkan dari pengaturan outlet terlebih dahulu.</p>':''}</div></fieldset>`;
}
function scenarioStaffOptions(staff,selected,current='') {
  return `<option value="">Pilih staf grup</option>${staff.filter(row=>selected.includes(row.id)).map(row=>`<option value="${h(row.id)}" ${row.id===current?'selected':''}>${h(row.name)}</option>`).join('')}${current&&!staff.some(row=>row.id===current&&selected.includes(row.id))?`<option value="${h(current)}" selected>${h(staff.find(row=>row.id===current)?.name||current)} — belum dipilih di grup</option>`:''}`;
}
function scenarioRate(rate,staff,selected,kind) {
  return `<div class="commission-scenario-rate" data-commission-rate><label class="field ops-field"><span>Staf penerima</span><select class="input" data-commission-rate-staff>${scenarioStaffOptions(staff,selected,rate.staff_id)}</select></label><label class="field ops-field"><span data-commission-rate-label>${kind==='percent'?'Komisi staf (%)':'Komisi staf (Rp / unit)'}</span><input class="input" data-commission-rate-value type="number" inputmode="numeric" min="0" step="1" max="${kind==='percent'?100:1000000000000}" value="${h(rate.value)}"></label><button class="btn btn-secondary" type="button" data-commission-rate-remove aria-label="Hapus penerima dari skenario">Hapus staf</button></div>`;
}
function scenarioForm(scenario,staff,selected,kind) {
  return `<article class="commission-scenario" data-commission-scenario="${h(scenario.id)}"><header><h4>Skenario komisi</h4><button class="btn btn-secondary" type="button" data-commission-scenario-remove>Hapus skenario</button></header><label class="field ops-field"><span>Nama skenario</span><input class="input" data-commission-scenario-name maxlength="80" value="${h(scenario.name)}" placeholder="Contoh: Dikerjakan bersama"></label><div data-commission-rates>${scenario.rates.map(rate=>scenarioRate(rate,staff,selected,kind)).join('')}</div><div class="commission-scenario-footer"><button class="btn btn-secondary" type="button" data-commission-rate-add>Tambah staf</button><p data-commission-scenario-total role="status" aria-live="polite"></p></div></article>`;
}
export function commissionForm(rule, data) {
  const flexible=rule.flexible?.enabled===true,config=flexible?rule.flexible:{allow_manual:true,max_total:{kind:'percent',value:0},scenarios:[]};
  return `<form id="commission-form" class="commission-form"><div class="ops-form-grid"><label class="field ops-field"><span>Nama grup</span><input class="input" name="name" maxlength="80" required value="${h(rule.name)}" placeholder="Contoh: Komisi pelayanan"></label>${select('is_active','Status',String(rule.is_active),[['false','Draf / nonaktif'],['true','Aktif']])}${select('scope','Jenis komisi',rule.scope,[['product','Per produk'],['transaction','Per transaksi']])}${select('discount_basis','Dasar perhitungan',rule.discount_basis,[['before','Sebelum diskon'],['after','Setelah diskon']])}${select('selection_mode','Jumlah staf yang dipilih',rule.selection_mode,[['single','Satu staf'],['multiple','Beberapa staf']])}${select('required','Wajib memilih staf?',String(rule.required),[['false','Tidak, boleh dilewati'],['true','Ya, wajib dipilih di kasir']])}</div><div data-commission-standard ${flexible?'hidden':''}><div class="ops-form-grid">${select('kind','Besaran',rule.kind,[['percent','Persentase (%)'],['fixed','Nominal Rupiah']])}<label class="field ops-field"><span>Nilai komisi</span><input class="input" name="value" type="number" inputmode="numeric" min="0" step="1" max="${rule.kind==='percent'?100:1000000000000}" value="${h(rule.value)}" required><small data-commission-value-note>${rule.kind==='fixed'?'Nominal produk berlaku untuk setiap unit.':'Persentase 0–100 dari harga produk yang berlaku.'}</small></label>${select('multi_staff_mode','Jika beberapa staf dipilih',rule.multi_staff_mode,[['split','Komisi dibagi rata'],['full','Setiap staf mendapat komisi penuh']])}</div></div>${checkList('staff_ids',data.staff,rule.staff_ids,'Staf penerima')}<div data-commission-products ${rule.scope==='transaction'?'hidden':''}>${checkList('product_ids',data.products,rule.product_ids,'Produk yang berlaku')}</div><fieldset class="commission-picks commission-flexible" data-commission-flexible ${rule.scope==='transaction'?'hidden':''}><legend>Komisi fleksibel per produk</legend>${select('flexible_enabled','Gunakan skenario dan batas total komisi',String(flexible),[['false','Tidak, gunakan komisi biasa'],['true','Ya, aktifkan komisi fleksibel']])}<div data-commission-flexible-fields ${flexible?'':'hidden'}><p class="ops-note"><span data-commission-choice-note>${config.allow_manual?'Kasir wajib memilih skenario atau mengisi komisi setiap staf.':'Kasir wajib memilih salah satu skenario yang disiapkan pemilik.'}</span> Total seluruh staf untuk satu produk tidak boleh melewati batas ini. Satu produk hanya dapat memiliki satu grup komisi aktif saat mode fleksibel digunakan.</p><div class="ops-form-grid">${select('flexible_cap_kind','Satuan komisi dan batas total',config.max_total.kind,[['percent','Persentase (%)'],['fixed','Rupiah per unit']])}<label class="field ops-field"><span>Batas total seluruh staf</span><input class="input" name="flexible_cap_value" type="number" inputmode="numeric" min="0" step="1" max="${config.max_total.kind==='percent'?100:1000000000000}" value="${h(config.max_total.value)}"><small data-commission-cap-note></small></label></div><label class="commission-check"><input type="checkbox" name="flexible_allow_manual" ${config.allow_manual?'checked':''}><span>Izinkan penyesuaian manual oleh kasir<small>Kasir dapat menentukan nilai setiap staf hingga batas total yang Anda tetapkan.</small></span></label><p class="commission-flexible-help">Nilai setiap staf memakai satuan yang sama. Untuk jumlah produk lebih dari satu, batas Rupiah berlaku per unit. Tarif skenario dan input manual menggantikan pembagian komisi biasa.</p><div data-commission-scenarios>${config.scenarios.map(scenario=>scenarioForm(scenario,data.staff,rule.staff_ids,config.max_total.kind)).join('')}</div><button class="btn btn-secondary" type="button" data-commission-scenario-add>Tambah skenario</button><p class="commission-flexible-help" data-commission-manual-note>${config.allow_manual?'Skenario bersifat opsional (maksimal 25). Kasir tetap dapat mengisi komisi manual, termasuk saat belum ada skenario.':'Sediakan minimal satu skenario (maksimal 25). Kasir hanya dapat memakai staf dan nilai yang disimpan dalam skenario.'}</p></div></fieldset><p class="ops-note">Perubahan berlaku untuk transaksi berikutnya. Komisi lama dan nilai pembayaran tidak diubah.</p><p data-commission-error class="ops-inline-error" role="alert" hidden></p></form>`;
}
export function mountCommissions(host, api) {
  const ctrl = new AbortController(); let catalog, modalCtrl, loading = false;
  const filters={search:'',scope:'all',status:'all'};
  const current = () => !ctrl.signal.aborted && !api.signal?.aborted && api.isCurrent();
  api.signal?.addEventListener('abort',()=>ctrl.abort(),{once:true,signal:ctrl.signal});
  async function reload() {
    if (loading || !current()) return; loading = true;
    try { const value = await loadCommissionCatalog(api.client,api.user,api.outlet,ctrl.signal); if(!current())return;catalog=value;host.innerHTML=commissionSettingsView(catalog,api.data,filters); }
    catch(error){if(current())host.innerHTML=`<p role="alert">${h(commissionError(error))}</p><button class="btn btn-secondary" data-commission-reload>Coba lagi</button>`;}
    finally {loading=false;}
  }
  function filterGroups() {
    if(!current()||!catalog)return;
    const matches=filterCommissionGroups(catalog.rules,filters);
    host.querySelector('[data-commission-group-list]').innerHTML=commissionGroupCards(matches,catalog.commission_enabled,catalog.rules.length);
    host.querySelector('[data-commission-count]').textContent=groupCount(catalog.rules,matches,filters);
    host.querySelector('[data-commission-reset]').disabled=!hasGroupFilters(filters);
  }
  function edit(existing) {
    if (!current() || !catalog?.commission_enabled) return;
    modalCtrl?.abort(); modalCtrl=new AbortController();
    const editCtrl=modalCtrl, live=()=>current()&&!editCtrl.signal.aborted&&panel.isConnected;
    const rule=existing?structuredClone(existing):{id:crypto.randomUUID(),name:'',is_active:false,scope:'product',kind:'percent',value:0,discount_basis:'after',required:false,selection_mode:'single',multi_staff_mode:'split',staff_ids:[],product_ids:[]};
    let operationId=crypto.randomUUID(), attempt=null, busy=false, conflict=false;
    const panel=api.modal({title:existing?'Ubah grup komisi':'Tambah grup komisi',description:api.outlet.businessName||api.outlet.name,content:commissionForm(rule,api.data),footer:'<button class="btn btn-secondary" data-close-modal>Batal</button><button class="btn btn-primary" type="submit" form="commission-form">Simpan grup</button>'});
    const form=panel.querySelector('form'), errorBox=panel.querySelector('[data-commission-error]');
    const feedback=message=>{errorBox.hidden=false;errorBox.textContent=message;};
    const selectedStaff=()=>[...form.querySelectorAll('input[name="staff_ids"]:checked')].map(input=>input.value);
    const readFlexible=()=>form.elements.flexible_enabled.value!=='true'?undefined:{version:1,enabled:true,allow_manual:form.elements.flexible_allow_manual.checked,max_total:{kind:form.elements.flexible_cap_kind.value,value:form.elements.flexible_cap_value.value},scenarios:[...form.querySelectorAll('[data-commission-scenario]')].map(scenario=>({id:scenario.dataset.commissionScenario,name:scenario.querySelector('[data-commission-scenario-name]').value,rates:[...scenario.querySelectorAll('[data-commission-rate]')].map(rate=>({staff_id:rate.querySelector('[data-commission-rate-staff]').value,kind:form.elements.flexible_cap_kind.value,value:rate.querySelector('[data-commission-rate-value]').value}))}))};
    function refreshFlexible() {
      const product=form.elements.scope.value==='product';
      if(!product)form.elements.flexible_enabled.value='false';
      const enabled=product&&form.elements.flexible_enabled.value==='true',kind=form.elements.flexible_cap_kind.value,maximum=kind==='percent'?100:1000000000000;
      form.querySelector('[data-commission-products]').hidden=!product;
      form.querySelector('[data-commission-flexible]').hidden=!product;
      form.querySelector('[data-commission-flexible-fields]').hidden=!enabled;
      form.querySelector('[data-commission-standard]').hidden=enabled;
      form.elements.flexible_cap_value.max=String(maximum);
      const manual=form.elements.flexible_allow_manual.checked;
      form.querySelector('[data-commission-choice-note]').textContent=manual?'Kasir wajib memilih skenario atau mengisi komisi setiap staf.':'Kasir wajib memilih salah satu skenario yang disiapkan pemilik.';
      form.querySelector('[data-commission-manual-note]').textContent=manual?'Skenario bersifat opsional (maksimal 25). Kasir tetap dapat mengisi komisi manual, termasuk saat belum ada skenario.':'Sediakan minimal satu skenario (maksimal 25). Kasir hanya dapat memakai staf dan nilai yang disimpan dalam skenario.';
      form.querySelector('[data-commission-cap-note]').textContent=kind==='percent'?`Maksimal 100% dari harga produk ${form.elements.discount_basis.value==='before'?'sebelum':'setelah'} diskon; dijumlahkan untuk seluruh staf.`:'Rupiah bulat per unit produk; dijumlahkan untuk seluruh staf.';
      const staff=selectedStaff(),capText=form.elements.flexible_cap_value.value,cap=Number(capText),validCap=/^\d+$/.test(capText)&&Number.isSafeInteger(cap)&&cap<=maximum,scenarios=[...form.querySelectorAll('[data-commission-scenario]')];
      for(const scenario of scenarios){
        const rates=[...scenario.querySelectorAll('[data-commission-rate]')];let total=0,valid=true;
        for(const rate of rates){
          const input=rate.querySelector('[data-commission-rate-value]'),staffInput=rate.querySelector('[data-commission-rate-staff]');
          input.max=String(maximum);rate.querySelector('[data-commission-rate-label]').textContent=kind==='percent'?'Komisi staf (%)':'Komisi staf (Rp / unit)';
          staffInput.innerHTML=scenarioStaffOptions(api.data.staff,staff,staffInput.value);
          if(!/^\d+$/.test(input.value)||!Number.isSafeInteger(Number(input.value))||Number(input.value)>maximum)valid=false;
          else total+=Number(input.value);
        }
        const summary=scenario.querySelector('[data-commission-scenario-total]'),over=valid&&validCap&&total>cap;
        summary.textContent=!valid?'Isi nilai komisi bulat sesuai satuan.':!validCap?'Isi batas total bulat sesuai satuan.':`Total: ${flexibleLabel({kind,value:total})}${kind==='fixed'?' / unit':''}${over?' — melebihi batas total':` dari batas ${flexibleLabel({kind,value:cap})}`}`;
        summary.classList.toggle('commission-total-invalid',!valid||!validCap||over);
        scenario.querySelector('[data-commission-rate-add]').disabled=rates.length>=500||form.elements.selection_mode.value==='single'&&rates.length>=1;
      }
      form.querySelector('[data-commission-scenario-add]').disabled=scenarios.length>=25;
    }
    refreshFlexible();
    form.addEventListener('input',event=>{
      const search=event.target.dataset.commissionSearch;
      if(search)for(const item of form.querySelectorAll(`[data-commission-list="${search}"] [data-label]`))item.hidden=!item.dataset.label.includes(event.target.value.toLowerCase());
      if(event.target.hasAttribute('data-commission-rate-value')||event.target.name==='flexible_cap_value')refreshFlexible();
    },{signal:editCtrl.signal});
    form.addEventListener('focusin',event=>{if(event.target.type==='number'&&event.target.value==='0')event.target.select();},{signal:editCtrl.signal});
    form.addEventListener('change',()=>{
      refreshFlexible();
      form.elements.value.max=form.elements.kind.value==='percent'?'100':'1000000000000';
      form.querySelector('[data-commission-value-note]').textContent=form.elements.kind.value==='percent'?'Persentase 0–100 dari harga produk yang berlaku.':form.elements.scope.value==='product'?'Nominal Rupiah untuk setiap unit produk.':'Nominal Rupiah untuk setiap transaksi lunas.';
    },{signal:editCtrl.signal});
    form.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||busy||attempt||conflict)return;
      const scenario=button.closest('[data-commission-scenario]'),kind=form.elements.flexible_cap_kind.value;
      if(button.hasAttribute('data-commission-scenario-add')){
        if(form.querySelectorAll('[data-commission-scenario]').length>=25)return;
        form.querySelector('[data-commission-scenarios]').insertAdjacentHTML('beforeend',scenarioForm({id:crypto.randomUUID(),name:'',rates:[{staff_id:'',kind,value:0}]},api.data.staff,selectedStaff(),kind));
        form.querySelector('[data-commission-scenarios]').lastElementChild.querySelector('[data-commission-scenario-name]').focus();
      }
      if(button.hasAttribute('data-commission-scenario-remove'))scenario.remove();
      if(button.hasAttribute('data-commission-rate-add')){
        if(scenario.querySelectorAll('[data-commission-rate]').length>=500||form.elements.selection_mode.value==='single'&&scenario.querySelector('[data-commission-rate]'))return;
        scenario.querySelector('[data-commission-rates]').insertAdjacentHTML('beforeend',scenarioRate({staff_id:'',value:0},api.data.staff,selectedStaff(),kind));
        scenario.querySelector('[data-commission-rates]').lastElementChild.querySelector('select').focus();
      }
      if(button.hasAttribute('data-commission-rate-remove'))button.closest('[data-commission-rate]').remove();
      refreshFlexible();
    },{signal:editCtrl.signal});
    form.addEventListener('submit',async event=>{
      event.preventDefault(); if(busy||conflict||!live())return;
      try {
        if(!attempt){const values=new FormData(form);attempt=commissionDraft({...Object.fromEntries(values),id:rule.id,is_active:values.get('is_active')==='true',required:values.get('required')==='true',staff_ids:values.getAll('staff_ids'),product_ids:values.getAll('product_ids'),flexible:readFlexible()},api.outlet.id,{...api.data,existing,rules:catalog.rules});}
      }catch(error){feedback(commissionError(error));return;}
      busy=true;errorBox.hidden=true;
      const controls=[...panel.querySelectorAll('button,input,select,textarea')];controls.forEach(control=>control.disabled=true);panel.setAttribute('aria-busy','true');
      try {
        await saveCommissionGroup(api.client,api.user,api.outlet,attempt,existing,operationId,{...api.data,rules:catalog.rules},ctrl.signal);
        if(!live())return;api.closeModal();api.toast('Grup komisi tersimpan.');await reload();
      } catch(error) {
        if(!live())return;
        if(error?.code==='PT409'){conflict=true;feedback(commissionError(error));form.querySelectorAll('input,select').forEach(control=>control.disabled=true);}
        else if(['23505','22023','42501','PGRST202'].includes(error?.code)){attempt=null;operationId=crypto.randomUUID();feedback(commissionError(error));}
        else feedback(commissionError(error)+' Formulir dikunci untuk memeriksa ulang permintaan yang sama.');
        // Unknown outcome: preserve operation id and exact payload for a safe retry.
      } finally {
        busy=false;
        if(live()){panel.removeAttribute('aria-busy');panel.querySelectorAll('button').forEach(control=>control.disabled=conflict&&control.type==='submit');if(!attempt){controls.forEach(control=>control.disabled=false);refreshFlexible();}}
      }
    },{signal:editCtrl.signal});
  }
  host.addEventListener('input',event=>{if(event.target.dataset.commissionFilter==='search'){filters.search=event.target.value;filterGroups();}},{signal:ctrl.signal});
  host.addEventListener('change',event=>{const field=event.target.dataset.commissionFilter;if(['scope','status'].includes(field)){filters[field]=event.target.value;filterGroups();}},{signal:ctrl.signal});
  host.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-commission-reset')){Object.assign(filters,{search:'',scope:'all',status:'all'});for(const input of host.querySelectorAll('[data-commission-filter]'))input.value=filters[input.dataset.commissionFilter];filterGroups();}if(button.hasAttribute('data-commission-reload'))void reload();if(button.hasAttribute('data-commission-add'))edit();if(button.dataset.commissionEdit)edit(catalog?.rules.find(rule=>rule.id===button.dataset.commissionEdit));},{signal:ctrl.signal});
  void reload();return()=>{ctrl.abort();modalCtrl?.abort();};
}

export function commissionReportRows(report,options={}) {
  return commissionDetailRows(commissionReportModel(report,options));
}
const reportNumber=value=>value===null?'—':Number(value).toLocaleString('id-ID',{maximumFractionDigits:8});
function commissionReportResults(model){
 const summary=model.summary.map(row=>`<tr><td><strong>${h(row.staff_name)}</strong></td><td>${h(row.outlet_name)}</td><td class="cr-number">${h(reportNumber(row.transaction_count))}</td><td class="cr-number">${h(reportNumber(row.product_quantity))}${row.unknown_product_quantity_count?'<span class="cr-missing" title="Sumber kuantitas historis belum lengkap">Perlu data</span>':''}</td><td class="cr-number cr-net">${h(money(row.net))}</td></tr>`).join('');
 const detail=model.items.slice(0,500).map(row=>`<tr><td><strong>${h(row.staff_name)}</strong></td><td>${h(row.source_invoice_id||row.sale_id||'—')}<small>${h(row.sale_date)}</small></td><td>${h(row.rule_name)}<small>${row.source_archive?'Tarif historis tidak tersedia':'Versi '+h(row.rule_version)} · ${row.scope==='product'?'Produk':'Transaksi'}</small></td><td>${h(row.product_name|| (row.scope==='transaction'?'Seluruh transaksi':'Nama belum tersedia'))}<small>${row.event_type==='refund'?'Unit refund tercatat':'Unit produk'}: ${h(reportNumber(row.event_type==='refund'?(row.refund_quantity??null):(row.product_quantity??null)))}</small></td><td><span class="${row.event_type==='refund'?'cr-refund':'cr-earned'}">${row.source_archive?'Arsip komisi Majoo':row.event_type==='refund'?'Pengurang refund':'Komisi lunas'}</span><small>${row.commission_kind==='percent'?h(row.commission_value)+'%':row.commission_kind==='fixed'?h(money(row.commission_value)):'Tarif belum tersedia'}</small></td><td class="cr-number">${h(money(row.amount))}</td></tr>`).join('');
 return `<div class="cr-total"><div><span>${h(model.totalLabel)}</span><strong>${h(money(model.totals.net))}</strong><small>${model.hasHistorical?'Arsip Majoo + catatan VORA · sesuai filter':'Sudah dikurangi refund · sesuai filter'}</small></div><dl><div><dt>${model.hasHistorical?'Komisi tercatat':'Komisi lunas'}</dt><dd>${h(money(model.totals.earned))}</dd></div><div><dt>${model.hasHistorical?'Koreksi refund VORA':'Pengurang refund'}</dt><dd>${h(money(model.totals.reversed))}</dd></div>${model.hasHistorical?'<div><dt>Termasuk arsip Majoo</dt><dd>'+h(money(model.totals.source))+'</dd></div>':''}<div><dt>Karyawan ditampilkan</dt><dd>${model.summary.length}<small> dari ${model.totalStaff}</small></dd></div></dl></div>${model.warnings.map(message=>`<p class="cr-warning" role="status">${h(message)}</p>`).join('')}<section class="r-card cr-card"><header class="r-card-head"><div><h2>Komisi per karyawan</h2><p>Diurutkan berdasarkan nama karyawan.</p></div><span class="cr-count" role="status" aria-live="polite">${model.summary.length} karyawan</span></header><div class="r-table-wrap"><table class="cr-summary-table"><thead><tr><th>Nama Karyawan</th><th>Cabang</th><th class="cr-number"><span title="Jumlah transaksi unik yang menghasilkan komisi transaksi">Transaksi</span></th><th class="cr-number"><span title="Jumlah unit produk yang menghasilkan komisi produk, sebelum refund">Produk</span></th><th class="cr-number">Komisi</th></tr></thead><tbody>${summary||'<tr><td colspan="5" class="cr-empty">Tidak ada komisi yang cocok dengan periode dan filter ini.</td></tr>'}</tbody><tfoot><tr><th colspan="4">${h(model.totalLabel)}</th><td class="cr-number cr-net">${h(money(model.totals.net))}</td></tr></tfoot></table></div><p class="cr-footnote">${h(model.countNote)}</p></section><details class="r-card cr-detail" open><summary>Rincian catatan komisi <span>${model.items.length} catatan</span></summary><div class="r-table-wrap"><table><thead><tr><th>Karyawan</th><th>Transaksi / tanggal</th><th>Grup</th><th>Produk / unit</th><th>Jenis / tarif</th><th class="cr-number">Komisi</th></tr></thead><tbody>${detail||'<tr><td colspan="6" class="cr-empty">Belum ada catatan.</td></tr>'}</tbody></table></div>${model.items.length>500?'<p class="cr-footnote">Layar dan cetak menampilkan 500 catatan pertama. Ekspor Excel memuat seluruh catatan sesuai filter.</p>':''}</details><p class="cr-footnote">Komisi berdasarkan staf penerima, bukan kasir yang memproses pembayaran. Ini catatan komisi, bukan bukti pembayaran gaji. ${model.hasHistorical?'Periode mengikuti tanggal transaksi sumber. Arsip Majoo bersifat baca saja; tarif dan pengurangan historis yang tidak tersedia tidak diasumsikan.':'Periode mengikuti tanggal transaksi asal; batal atau refund mengoreksi komisi transaksi tersebut. Ekstra, pajak, dan biaya layanan tidak termasuk dasar komisi.'}</p>`;
}
export function renderCommissionReport(report,options={}) {
 const model=commissionReportModel(report,options);
 return `<section class="reports-surface commission-report" data-commission-report data-generated-at="${h(model.generatedAt)}" data-time-zone="${h(model.timeZone)}"><nav class="r-tabs"><a href="#reports">Semua laporan</a><a class="active" href="#commission-report">Komisi staf</a><a href="#settings?tab=commissions">Atur grup komisi</a></nav><div class="cr-report-meta"><div><span class="cr-eyebrow">LAPORAN KOMISI KARYAWAN</span><strong>${h(model.outletName)}</strong><p>${h(model.dateFrom)} – ${h(model.dateUntil)}</p></div><div><span>Data dibuat</span><strong>${h(model.generatedLabel)}</strong><small>${h(model.timeZone)}</small></div></div><div class="cr-filterbar" role="search"><label for="commission-report-search">Cari karyawan atau cabang<input id="commission-report-search" class="input" type="search" maxlength="200" data-commission-report-search value="${h(model.filters.search)}" placeholder="Ketik nama karyawan atau cabang…" aria-controls="commission-report-results"></label><button class="btn btn-secondary" type="button" data-commission-report-reset ${model.filters.search?'':'disabled'}>Reset filter</button><span>Excel mengikuti pencarian dan periode yang dipilih.</span></div><div id="commission-report-results" data-commission-report-results>${commissionReportResults(model)}</div></section>`;
}
export function readCommissionReportFilters(container) {
 return normalizeCommissionFilters({search:container?.querySelector('[data-commission-report-search]')?.value||''});
}
export function bindCommissionReport(container,api){
 const host=container?.querySelector('[data-commission-report]');if(!host)return()=>{};
 const ctrl=new AbortController(),current=()=>!ctrl.signal.aborted&&!api.signal?.aborted&&api.isCurrent();
 const update=()=>{if(!current())return;const filters=readCommissionReportFilters(host);const model=commissionReportModel(api.report,{outlet:api.outlet,filters,generatedAt:host.dataset.generatedAt,timeZone:host.dataset.timeZone});host.querySelector('[data-commission-report-results]').innerHTML=commissionReportResults(model);host.querySelector('[data-commission-report-reset]').disabled=!filters.search;};
 host.addEventListener('input',event=>{if(event.target.hasAttribute('data-commission-report-search'))update();},{signal:ctrl.signal});
 host.addEventListener('click',event=>{if(!event.target.closest('[data-commission-report-reset]'))return;if(!current())return;const input=host.querySelector('[data-commission-report-search]');input.value='';update();input.focus();},{signal:ctrl.signal});
 return()=>ctrl.abort();
}

import { verifyOwner } from '/dashboard-operations-data.js';
import { validateRange, collect } from '/dashboard-data.js';
import {mergeHistoricalCommissionReport,validateHistoricalCommissionRow} from '/dashboard-commission-history.js';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const abort = signal => { if (signal?.aborted) throw new DOMException('Halaman berubah.', 'AbortError'); };
async function rpc(client, name, args, signal) {
  abort(signal); const query = client.rpc(name, args);
  const response = await (signal ? query.abortSignal(signal) : query); abort(signal);
  if (response.error) throw response.error;
  return response.data;
}
export function commissionError(error) {
  if (error?.code === 'PT409') return 'Pengaturan sudah berubah. Muat ulang sebelum mengedit kembali.';
  if (['42501','FEATURE_DISABLED'].includes(error?.code)) return 'Komisi staf memerlukan Premium aktif dan akses pemilik outlet.';
  if (error?.code === 'PGRST202') return 'Fitur komisi belum tersedia pada server ini.';
  if (error?.code === '23505') return 'Ada staf dan produk yang sudah memakai grup komisi aktif lain. Ubah cakupan atau nonaktifkan grup lama dahulu.';
  if (error?.code === '22023') return 'Pengaturan belum valid. Periksa nilai, staf, dan produk yang dipilih.';
  return error instanceof TypeError ? error.message : 'Belum berhasil. Periksa koneksi dan coba kembali dengan formulir yang sama.';
}
export function commissionDraft(draft, outletId, {staff = [], products = [], existing = null} = {}) {
  if (!uuid(draft.id)) throw new TypeError('ID grup komisi tidak valid.');
  const name = String(draft.name || '').trim();
  if (!name || name.length > 80 || /[\x00-\x1f]/.test(name)) throw new TypeError('Nama grup wajib diisi, maksimal 80 karakter.');
  const choices = {scope:['product','transaction'],kind:['percent','fixed'],discount_basis:['before','after'],selection_mode:['single','multiple'],multi_staff_mode:['split','full']};
  for (const [key, values] of Object.entries(choices)) if (!values.includes(draft[key])) throw new TypeError('Pilihan pengaturan komisi tidak valid.');
  const raw = String(draft.value ?? '').trim(), value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 0 || value > (draft.kind === 'percent' ? 100 : 1000000000000)) throw new TypeError(draft.kind === 'percent' ? 'Persentase harus bilangan bulat 0–100.' : 'Nominal harus Rupiah bulat 0–1.000.000.000.000.');
  const ids = (values, catalog, label, retained) => {
    if (!Array.isArray(values) || new Set(values).size !== values.length || values.some(id => typeof id !== 'string' || !catalog.some(row => row.id === id && row.outlet_id === outletId) && !(!draft.is_active && retained?.includes(id)))) throw new TypeError(`${label} tidak sesuai outlet. Muat ulang daftar.`);
    return [...values].sort();
  };
  const staff_ids = ids(draft.staff_ids, staff, 'Staf', existing?.staff_ids);
  const product_ids = draft.scope === 'product' ? ids(draft.product_ids, products, 'Produk', existing?.product_ids) : [];
  if (draft.is_active && (!staff_ids.length || draft.scope === 'product' && !product_ids.length)) throw new TypeError('Grup aktif wajib memiliki staf dan, untuk komisi produk, minimal satu produk.');
  return {id:draft.id,name,is_active:draft.is_active === true,scope:draft.scope,kind:draft.kind,value,discount_basis:draft.discount_basis,required:draft.required === true,selection_mode:draft.selection_mode,multi_staff_mode:draft.multi_staff_mode,staff_ids,product_ids};
}
export function validateCommissionCatalog(data, outlet) {
  if (!data || data.outlet_id !== outlet.id || typeof data.commission_enabled !== 'boolean' || !Array.isArray(data.rules)) throw new TypeError('Katalog komisi tidak lengkap atau outlet tidak sesuai.');
  const seen = new Set();
  for (const row of data.rules) {
    if (!uuid(row.id) || row.outlet_id !== outlet.id || seen.has(row.id) || !Number.isSafeInteger(row.version) || row.version < 1 || !Array.isArray(row.staff_ids) || !Array.isArray(row.product_ids)) throw new TypeError('Versi grup komisi tidak valid. Muat ulang.');
    if(typeof row.name!=='string' || typeof row.is_active!=='boolean' || typeof row.required!=='boolean' || !['product','transaction'].includes(row.scope) || !['percent','fixed'].includes(row.kind) || !['before','after'].includes(row.discount_basis) || !['single','multiple'].includes(row.selection_mode) || !['split','full'].includes(row.multi_staff_mode) || !Number.isSafeInteger(row.value) || row.value<0 || row.value>(row.kind==='percent'?100:1000000000000)) throw new TypeError('Isi grup komisi tidak valid. Muat ulang.');
    seen.add(row.id);
  }
  return data;
}
export async function loadCommissionCatalog(client, user, outlet, signal) {
  await verifyOwner(client, user, outlet, signal);
  return validateCommissionCatalog(await rpc(client,'vora_commission_catalog',{p_outlet_id:outlet.id},signal),outlet);
}
export async function saveCommissionGroup(client,user,outlet,draft,existing,operationId,catalog,signal) {
  await verifyOwner(client,user,outlet,signal);
  if (!uuid(operationId) || existing && (existing.outlet_id !== outlet.id || existing.id !== draft.id || !Number.isSafeInteger(existing.version))) throw new TypeError('Versi atau permintaan komisi tidak valid.');
  const rule = commissionDraft(draft,outlet.id,{...catalog,existing});
  const result = await rpc(client,'vora_save_commission_group',{p_outlet_id:outlet.id,p_operation_id:operationId,p_expected_version:existing?.version || 0,p_rule:rule},signal);
  validateCommissionCatalog({outlet_id:outlet.id,commission_enabled:true,rules:[result?.rule]},outlet);
  if(result.rule.id!==rule.id || result.rule.version!==(existing?.version||0)+1 || typeof result.replayed!=='boolean')throw new TypeError('Konfirmasi penyimpanan belum cocok. Periksa kembali permintaan yang sama.');
  return result;
}
export async function loadCommissionReport(client,user,outlet,range,signal) {
  validateRange(range); await verifyOwner(client,user,outlet,signal);
  const data = await rpc(client,'vora_commission_report',{p_outlet_id:outlet.id,p_date_from:range.start,p_date_until:range.end},signal);
  validateCommissionReport(data,outlet,range);
  const sales=await collect(()=>client.from('sales').select('id,outlet_id,date,cart_data').eq('outlet_id',outlet.id).gte('date',range.start).lte('date',range.end),r=>r.outlet_id===outlet.id&&r.date>=range.start&&r.date<=range.end,signal);
  return validateCommissionReport(mergeHistoricalCommissionReport(data,sales,outlet,range),outlet,range);
}
export function validateCommissionReport(data,outlet,range) {
  if (!data || data.outlet_id !== outlet.id || data.date_from !== range.start || data.date_until !== range.end || !Array.isArray(data.items)) throw new TypeError('Laporan komisi tidak lengkap atau periode tidak sesuai.');
  if(data.report_version!==undefined&&![1,2,3].includes(data.report_version))throw new TypeError('Versi laporan komisi belum didukung. Muat ulang dashboard.');
  const seen=new Set();let earned=0,reversed=0,source=0,sourceRows=0;
  for(const row of data.items){
    if(row.outlet_id!==outlet.id)throw new TypeError('Data lintas outlet ditolak.');
    if(row.source_archive){if(data.report_version!==3)throw new TypeError('Versi arsip komisi tidak sesuai.');validateHistoricalCommissionRow(row);source+=row.amount;sourceRows++;}
    if(!row.id||seen.has(row.id)||typeof row.staff_id!=='string'||!row.staff_id||typeof row.staff_name!=='string'||!['earned','refund'].includes(row.event_type)||!['product','transaction'].includes(row.scope)||!Number.isSafeInteger(row.amount)||(!row.source_archive&&(!Number.isSafeInteger(row.basis)||row.basis<0))||row.event_type==='earned'&&row.amount<0||row.event_type==='refund'&&row.amount>0)throw new TypeError('Catatan komisi tidak lengkap atau ganda.');
    seen.add(row.id);if(row.event_type==='earned')earned+=row.amount;else reversed-=row.amount;
  }
  if(!Number.isSafeInteger(earned)||!Number.isSafeInteger(reversed)||data.totals?.earned!==earned||data.totals?.reversed!==reversed||data.totals?.net!==earned-reversed)throw new TypeError('Total komisi belum sesuai rincian. Muat ulang; laporan tidak dipotong.');
  if(data.report_version===3&&(!Number.isSafeInteger(source)||data.totals.source!==source||data.history?.sourceAmount!==source||data.history.rowCount!==sourceRows||!Number.isSafeInteger(data.history.invoiceCount)||data.history.invoiceCount<1||!Array.isArray(data.history.coverage)||!data.history.coverage.length))throw new TypeError('Rekonsiliasi arsip komisi belum lengkap.');
  if(data.report_version>=2)validateReportMetadata(data);
  return data;
}

const hasText = value => typeof value==='string'&&value.trim().length>0;
const quantity = value => value===null||typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1e12;
const sameQuantity = (a,b) => a===null||b===null?a===b:Math.abs(a-b)<=1e-7;
function validateReportMetadata(data) {
  if(!hasText(data.outlet_name)||!hasText(data.generated_at)||!Number.isFinite(Date.parse(data.generated_at))||!Array.isArray(data.summary))throw new TypeError('Metadata laporan komisi belum lengkap.');
  const groups=new Map();
  for(const row of data.items){
    const archived=!!row.source_archive;
    if((!archived&&!hasText(row.checkout_id))||!hasText(row.sale_id)||row.outlet_name!==data.outlet_name||!(row.product_name===null||hasText(row.product_name))||!['reserved_cart','current_product','missing','not_applicable',...(archived?['source_archive']:[])].includes(row.product_name_source)||!quantity(row.product_quantity)||!quantity(row.refund_quantity)||!['settlement_snapshot','refund_lines','payment_ratio','missing','not_applicable',...(archived?['source_archive']:[])].includes(row.quantity_source))throw new TypeError('Rincian kuantitas atau identitas transaksi komisi belum lengkap.');
    if(![null,'percent','fixed'].includes(row.commission_kind)||!(row.commission_value===null||Number.isSafeInteger(row.commission_value)&&row.commission_value>=0)||!([null,'before','after'].includes(row.discount_basis))||!([null,'split','full'].includes(row.multi_staff_mode))||(row.commission_kind===null)!==(row.commission_value===null)||row.commission_kind==='percent'&&row.commission_value>100)throw new TypeError('Snapshot tarif komisi tidak valid.');
    if(row.product_quantity!==null&&(row.event_type!=='earned'||row.scope!=='product'||row.quantity_source!==(archived?'source_archive':'settlement_snapshot'))||row.refund_quantity!==null&&(row.event_type!=='refund'||row.scope!=='product'||row.quantity_source!=='refund_lines'))throw new TypeError('Sumber kuantitas komisi tidak sesuai jenis catatan.');
    const g=groups.get(row.staff_id)||{earned:0,reversed:0,source:0,transactions:new Set(),product_quantity:0,unknown_product_quantity_count:0};
    if(row.event_type==='earned'){
      g.earned+=row.amount;
      if(archived)g.source+=row.amount;
      if(row.scope==='transaction')g.transactions.add(row.checkout_id);
      else if(row.product_quantity===null)g.unknown_product_quantity_count++;else g.product_quantity+=row.product_quantity;
    }else g.reversed-=row.amount;
    groups.set(row.staff_id,g);
  }
  const seen=new Set();
  for(const row of data.summary){
    const g=groups.get(row.staff_id);
    if(data.report_version===3&&row.source!==g?.source)throw new TypeError('Ringkasan arsip komisi belum sesuai rincian.');
    if(!g||seen.has(row.staff_id)||!hasText(row.staff_name)||row.outlet_id!==data.outlet_id||row.outlet_name!==data.outlet_name||!Number.isSafeInteger(row.transaction_count)||row.transaction_count!==g.transactions.size||!Number.isSafeInteger(row.unknown_product_quantity_count)||row.unknown_product_quantity_count!==g.unknown_product_quantity_count||!quantity(row.product_quantity)||!sameQuantity(row.product_quantity,g.unknown_product_quantity_count?null:g.product_quantity)||row.earned!==g.earned||row.reversed!==g.reversed||row.net!==g.earned-g.reversed)throw new TypeError('Ringkasan komisi belum sesuai rincian. Muat ulang; data tidak dipotong.');
    seen.add(row.staff_id);
  }
  if(seen.size!==groups.size)throw new TypeError('Ringkasan karyawan belum lengkap.');
}

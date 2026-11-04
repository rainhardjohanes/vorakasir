// Immutable historical amounts. This module never calculates commissions from
// current rules and never creates a native settlement/refund ledger entry.
import {isImportedHistory,readImportedHistory} from '/dashboard-lib-importedHistory.js';

const text=x=>typeof x==='string'&&x.trim().length>0;
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const count=x=>Number.isSafeInteger(x)&&x>=0;
const assert=(ok,message)=>{if(!ok)throw new TypeError(message);};
export const HISTORY_COMMISSION_FORMAT='vora-source-commission-archive/v1';

export function readHistoricalCommissionArchive(sale) {
  if(!isImportedHistory(sale))return null;
  const m=readImportedHistory(sale),a=m?.sourceCommissions;
  assert(m&&a?.format===HISTORY_COMMISSION_FORMAT,'Arsip komisi sumber belum lengkap. Laporan tidak ditampilkan sebagai nol.');
  assert(a.sourceSystem===m.sourceSystem&&a.sourceAccount===m.sourceAccount&&a.sourceOutlet===m.sourceOutlet&&a.billId===m.billId&&a.saleSourceKey===m.sourceKey&&a.destinationOutletId===sale.outlet_id,'Identitas arsip komisi tidak sesuai transaksi.');
  const c=a.coverage;
  assert(c?.status==='complete_period'&&/^\d{4}-\d{2}-\d{2}$/.test(c.dateFrom)&&/^\d{4}-\d{2}-\d{2}$/.test(c.dateUntil)&&c.dateFrom<=sale.date&&c.dateUntil>=sale.date&&c.dateFrom<=c.dateUntil&&hash(c.ledgerHash)&&hash(c.salesControlHash)&&['sourceRows','sourceStaff','sourceAmount','sourceProductQuantity','sourceInvoices'].every(k=>count(c[k]))&&c.sourceInvoices>0&&Array.isArray(a.entries),'Cakupan arsip komisi belum terverifikasi.');
  const seen=new Set(),groups=new Map();let amount=0,quantity=0;
  for(const e of a.entries){
    assert(/^MIG-MJC-[a-f0-9]{64}$/.test(e.id)&&!seen.has(e.id)&&e.billId===m.billId&&count(e.sourceOrdinal)&&e.sourceOrdinal>0&&text(e.migrationLocator)&&text(e.staffId)&&text(e.staffName)&&hash(e.sourceStaffKey)&&text(e.productId)&&text(e.productName)&&count(e.quantity)&&e.quantity>0&&count(e.amount)&&e.businessDate===sale.date&&text(e.occurredAt)&&Number.isFinite(Date.parse(e.occurredAt))&&e.sourceTimezone==='Asia/Makassar','Rincian komisi sumber tidak valid atau berulang.');
    assert(e.historicalRuleId===null&&e.historicalRate===null&&e.historicalBasis===null&&e.historicalSplitPolicy===null&&e.calculationBasis==='actual_source_commission_not_recomputed'&&['one_to_one','group_many_to_many_not_arbitrarily_allocated'].includes(e.relationship)&&Array.isArray(e.lineOrdinals)&&e.lineOrdinals.length>0&&new Set(e.lineOrdinals).size===e.lineOrdinals.length,'Komisi sumber tidak boleh memakai perkiraan tarif atau alokasi item.');
    let available=0;
    for(const ordinal of e.lineOrdinals){
      const matches=sale.cart_data.filter(l=>l?._voraMigrationLine?.ordinal===ordinal&&l.id===e.productId&&l.name===e.productName&&l._voraMigrationLine.servedBy?.some(s=>s.id===e.staffId&&s.name===e.staffName));
      assert(count(ordinal)&&ordinal>0&&matches.length===1,'Komisi sumber tidak cocok dengan produk atau staf pada struk.');
      available+=matches[0].qty;
    }
    assert(count(available)&&e.quantity<=available,'Kuantitas komisi melebihi kelompok item sumber.');
    const key=JSON.stringify([e.staffId,e.productId]),group=groups.get(key)||{quantity:0,ordinals:new Set()};group.quantity+=e.quantity;for(const ordinal of e.lineOrdinals)group.ordinals.add(ordinal);groups.set(key,group);
    amount+=e.amount;quantity+=e.quantity;seen.add(e.id);
  }
  for(const group of groups.values())assert(group.quantity===sale.cart_data.filter(l=>group.ordinals.has(l._voraMigrationLine?.ordinal)).reduce((n,l)=>n+l.qty,0),'Jumlah komisi per staf/produk belum sesuai kelompok item sumber.');
  assert(count(amount)&&count(quantity)&&a.amount===amount&&a.productQuantity===quantity&&a.entries.length<=c.sourceRows&&amount<=c.sourceAmount&&quantity<=c.sourceProductQuantity,'Total arsip komisi tidak sesuai rinciannya.');
  return a;
}

function rowFromEntry(e,sale,a,outletName){
  return {id:e.id,outlet_id:sale.outlet_id,outlet_name:outletName,checkout_id:null,sale_id:sale.id,source_invoice_id:a.billId,refund_id:null,event_type:'earned',
    rule_id:null,rule_version:null,rule_name:'Arsip komisi Majoo',scope:'product',line_id:null,product_id:e.productId,product_name:e.productName,product_name_source:'source_archive',
    staff_id:e.staffId,staff_name:e.staffName,basis:null,amount:e.amount,sale_date:e.businessDate,created_at:e.occurredAt,
    product_quantity:e.quantity,refund_quantity:null,quantity_source:'source_archive',commission_kind:null,commission_value:null,discount_basis:null,multi_staff_mode:null,
    source_archive:{format:HISTORY_COMMISSION_FORMAT,sourceSystem:a.sourceSystem,sourceAccount:a.sourceAccount,sourceOutlet:a.sourceOutlet,saleSourceKey:a.saleSourceKey,ledgerHash:a.coverage.ledgerHash,entry:e}};
}

/** Reject invented tariff/basis/line allocations on the report boundary too. */
export function validateHistoricalCommissionRow(row){
  const a=row.source_archive,e=a?.entry;
  assert(a?.format===HISTORY_COMMISSION_FORMAT&&a.sourceSystem==='majoo'&&text(a.sourceAccount)&&text(a.sourceOutlet)&&hash(a.saleSourceKey)&&hash(a.ledgerHash)&&e,'Asal komisi historis tidak valid.');
  const expected=rowFromEntry(e,{id:'MIG-MJ-'+a.saleSourceKey,outlet_id:row.outlet_id},{billId:e.billId,sourceSystem:a.sourceSystem,sourceAccount:a.sourceAccount,sourceOutlet:a.sourceOutlet,saleSourceKey:a.saleSourceKey,coverage:{ledgerHash:a.ledgerHash}},row.outlet_name);
  for(const [key,value] of Object.entries(expected))if(key!=='source_archive')assert(row[key]===value,'Rincian laporan komisi berbeda dari arsip sumber.');
  assert(/^MIG-MJC-[a-f0-9]{64}$/.test(e.id)&&count(e.amount)&&count(e.quantity)&&e.quantity>0&&text(e.staffId)&&text(e.staffName)&&text(e.productId)&&text(e.productName)&&text(e.billId)&&e.historicalRuleId===null&&e.historicalRate===null&&e.historicalBasis===null&&e.historicalSplitPolicy===null&&e.calculationBasis==='actual_source_commission_not_recomputed','Nilai komisi sumber tidak valid.');
  return row;
}

/** Caller validates the native RPC before merging. An invoice may never appear
 * in both ledgers, and incomplete archives fail closed instead of showing 0. */
export function mergeHistoricalCommissionReport(native,sales,outlet,range){
  const imported=sales.filter(isImportedHistory);
  if(!imported.length)return native;
  assert(native.report_version===2,'Server laporan komisi perlu diperbarui sebelum membaca arsip sumber.');
  const ids=new Set(),entries=new Set(native.items.map(r=>r.id)),coverage=new Map(),added=[];
  for(const sale of imported){
    assert(sale.outlet_id===outlet.id&&sale.date>=range.start&&sale.date<=range.end&&!ids.has(sale.id),'Arsip komisi lintas outlet, periode, atau transaksi berulang ditolak.');ids.add(sale.id);
    assert(!native.items.some(r=>r.sale_id===sale.id),'Komisi transaksi ditemukan pada dua sumber; laporan dihentikan agar tidak terhitung ganda.');
    const a=readHistoricalCommissionArchive(sale),key=JSON.stringify([a.sourceSystem,a.sourceAccount,a.sourceOutlet,a.coverage.dateFrom,a.coverage.dateUntil]);
    assert(!coverage.has(key)||JSON.stringify(coverage.get(key))===JSON.stringify(a.coverage),'Cakupan arsip komisi saling bertentangan.');coverage.set(key,a.coverage);
    for(const e of a.entries){assert(!entries.has(e.id),'ID komisi sumber berulang.');entries.add(e.id);added.push(rowFromEntry(e,sale,a,native.outlet_name));}
  }
  const items=[...native.items,...added],groups=new Map();
  for(const row of items){
    const g=groups.get(row.staff_id)||{staff_id:row.staff_id,staff_name:row.staff_name,outlet_id:outlet.id,outlet_name:native.outlet_name,earned:0,reversed:0,source:0,transactions:new Set(),product_quantity:0,unknown_product_quantity_count:0};
    if(row.event_type==='refund')g.reversed-=row.amount;
    else{g.earned+=row.amount;if(row.source_archive)g.source+=row.amount;if(row.scope==='transaction')g.transactions.add(row.checkout_id);else if(row.product_quantity===null)g.unknown_product_quantity_count++;else g.product_quantity+=row.product_quantity;}
    groups.set(row.staff_id,g);
  }
  const summary=[...groups.values()].map(({transactions,...g})=>({...g,transaction_count:transactions.size,product_quantity:g.unknown_product_quantity_count?null:g.product_quantity,net:g.earned-g.reversed}));
  const source=added.reduce((n,r)=>n+r.amount,0);
  assert(count(source)&&count(native.totals.earned+source),'Total komisi terlalu besar.');
  return {...native,report_version:3,items,summary,totals:{earned:native.totals.earned+source,reversed:native.totals.reversed,net:native.totals.net+source,source},history:{invoiceCount:imported.length,rowCount:added.length,sourceAmount:source,coverage:[...coverage.values()]}};
}

import {validateCommissionReport} from '/dashboard-commissions-data.js';
import {validateRange} from '/dashboard-data.js';

export const COMMISSION_SUMMARY_COLUMNS=Object.freeze(['Nama Karyawan','Cabang','Transaksi','Produk','Komisi']);
export const COMMISSION_COUNT_NOTE='Transaksi = jumlah transaksi unik yang menghasilkan komisi transaksi. Produk = jumlah unit produk yang menghasilkan komisi produk, sebelum refund. Unit produk dihitung per penerima, sehingga unit yang dilayani bersama dapat muncul pada beberapa karyawan. Refund tidak dihitung sebagai transaksi atau penjualan baru; nilai Komisi sudah dikurangi refund.';
export const COMMISSION_DETAIL_COLUMNS=Object.freeze(['Nama Karyawan','ID Karyawan','Cabang','Tanggal Transaksi','ID Transaksi','ID Checkout','Jenis Catatan','Jenis Komisi','Nama Produk','ID Produk','Unit Produk','Unit Refund Tercatat','Sumber Kuantitas','Grup Komisi','ID Grup','Versi Aturan','Jenis Tarif','Nilai Tarif','Dasar Diskon','Pembagian','Dasar Komisi (Rp)','Komisi Lunas (Rp)','Pengurang Refund (Rp)','Komisi Bersih (Rp)','ID Refund','ID Catatan','Waktu Pencatatan','Sumber Nama Produk']);
const compare=(a,b)=>a.staff_name.localeCompare(b.staff_name,'id',{sensitivity:'base',numeric:true})||a.staff_id.localeCompare(b.staff_id);
export const normalizeCommissionFilters=filters=>({search:String(filters?.search||'').trim().slice(0,200)});
export function commissionReportTimezone(timeZone) {
  const zone=timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
  try{new Intl.DateTimeFormat('id-ID',{timeZone:zone}).format();return zone;}catch{throw new TypeError('Zona waktu laporan tidak valid.');}
}
export function commissionGeneratedLabel(instant,timeZone) {
  const value=new Date(instant);if(!Number.isFinite(value.getTime()))throw new TypeError('Waktu pembuatan laporan tidak valid.');
  return new Intl.DateTimeFormat('id-ID',{timeZone:commissionReportTimezone(timeZone),dateStyle:'long',timeStyle:'medium',hourCycle:'h23'}).format(value);
}
function legacySummary(report,outletName){
  const groups=new Map();
  for(const row of report.items){
    const g=groups.get(row.staff_id)||{staff_id:row.staff_id,staff_name:row.staff_name,outlet_id:report.outlet_id,outlet_name:outletName,earned:0,reversed:0,transactions:new Set(),unknownTransactions:false,product_quantity:0,unknown_product_quantity_count:0};
    if(row.event_type==='refund')g.reversed-=row.amount;
    else{g.earned+=row.amount;if(row.scope==='transaction'){if(row.checkout_id)g.transactions.add(row.checkout_id);else g.unknownTransactions=true;}else g.unknown_product_quantity_count++;}
    groups.set(row.staff_id,g);
  }
  return [...groups.values()].map(g=>({...g,transaction_count:g.unknownTransactions?null:g.transactions.size,product_quantity:g.unknown_product_quantity_count?null:0,net:g.earned-g.reversed}));
}
export function commissionReportModel(report,{outlet,filters,generatedAt,timeZone}={}) {
  const selected=outlet||{id:report?.outlet_id,name:report?.outlet_name};
  validateRange({start:report?.date_from,end:report?.date_until});
  validateCommissionReport(report,selected,{start:report?.date_from,end:report?.date_until});
  const outletName=report.outlet_name||selected.businessName||selected.name||'Nama cabang belum tersedia';
  const normalized=normalizeCommissionFilters(filters),search=normalized.search.toLocaleLowerCase('id-ID');
  const allSummary=(report.report_version>=2?report.summary:legacySummary(report,outletName)).map(row=>({...row})).sort(compare);
  const summary=allSummary.filter(row=>!search||`${row.staff_name}\n${row.outlet_name}`.toLocaleLowerCase('id-ID').includes(search));
  const staff=new Set(summary.map(row=>row.staff_id));
  const items=report.items.filter(row=>staff.has(row.staff_id)).map(row=>({...row})).sort((a,b)=>compare(a,b)||String(a.sale_date).localeCompare(String(b.sale_date))||String(a.created_at).localeCompare(String(b.created_at))||String(a.id).localeCompare(String(b.id)));
  const totals=summary.reduce((g,row)=>({earned:g.earned+row.earned,reversed:g.reversed+row.reversed,net:g.net+row.net}),{earned:0,reversed:0,net:0});
  const hasHistorical=report.report_version===3;
  if(hasHistorical)totals.source=summary.reduce((n,row)=>n+row.source,0);
  const instant=generatedAt||report.generated_at||new Date().toISOString(),zone=commissionReportTimezone(timeZone||selected.timezone||selected.time_zone);
  const warnings=[];
  if(report.report_version<2||!report.report_version)warnings.push('Server masih memakai laporan versi lama. Kuantitas produk dan rincian tarif yang belum tersedia ditampilkan sebagai —, bukan nol.');
  if(hasHistorical)warnings.push('Komisi Majoo disalin sesuai nominal dan unit pada laporan sumber, tanpa menghitung ulang memakai aturan VORA. Tarif, dasar hitung, dan rincian koreksi refund sumber yang tidak tersedia ditampilkan sebagai —. Nilai arsip bukan bukti pembayaran gaji atau bukti tidak adanya refund.');
  if(summary.some(row=>row.product_quantity===null))warnings.push('Sebagian catatan tidak memiliki sumber kuantitas lengkap. Kolom Produk ditandai —; nilai Rupiah komisi tetap berdasarkan catatan asli.');
  if(items.some(row=>row.product_name_source==='current_product'))warnings.push('Nama beberapa produk diambil dari katalog saat ini karena nama saat transaksi tidak tersedia.');
  if(items.some(row=>row.event_type==='refund'&&row.quantity_source==='payment_ratio'))warnings.push('Refund nominal mengoreksi komisi secara proporsional; jumlah unit refund tidak disimpulkan dari nilai uang.');
  const totalLabel=hasHistorical?'Total komisi tercatat':'Total komisi bersih';
  const countNote=hasHistorical?'Transaksi = transaksi unik komisi transaksi VORA. Produk = unit per penerima pada catatan VORA dan laporan sumber Majoo; layanan bersama dapat dihitung pada beberapa staf. Nilai komisi menggabungkan arsip Majoo dengan komisi VORA setelah koreksi refund VORA. Rincian refund historis Majoo tidak disimpulkan dari nominal arsip.':COMMISSION_COUNT_NOTE;
  return {outletId:report.outlet_id,outletName,dateFrom:report.date_from,dateUntil:report.date_until,filters:normalized,summary,items,totals,totalStaff:allSummary.length,generatedAt:instant,timeZone:zone,generatedLabel:commissionGeneratedLabel(instant,zone),reportVersion:report.report_version||1,warnings,hasHistorical,totalLabel,countNote};
}
export const commissionSummaryRows=model=>[COMMISSION_SUMMARY_COLUMNS,...model.summary.map(row=>[row.staff_name,row.outlet_name,row.transaction_count,row.product_quantity,row.net])];
const quantitySource={source_archive:'Laporan sumber Majoo',settlement_snapshot:'Snapshot transaksi lunas',refund_lines:'Rincian refund item',payment_ratio:'Refund nominal proporsional',missing:'Belum tersedia',not_applicable:'Tidak berlaku'};
const nameSource={source_archive:'Laporan sumber Majoo',reserved_cart:'Nama saat transaksi',current_product:'Katalog saat ini',missing:'Belum tersedia',not_applicable:'Tidak berlaku'};
export function commissionDetailRows(model){const headers=[...COMMISSION_DETAIL_COLUMNS];if(model.hasHistorical){headers[21]='Komisi Tercatat (Rp)';headers[22]='Koreksi Refund VORA (Rp)';headers[23]='Komisi Setelah Koreksi VORA (Rp)';}return [headers,...model.items.map(row=>[row.staff_name,row.staff_id,row.outlet_name||model.outletName,row.sale_date,row.source_invoice_id||row.sale_id,row.checkout_id||null,row.source_archive?'Arsip komisi Majoo':row.event_type==='refund'?'Pengurang refund':'Komisi lunas',row.scope==='product'?'Produk':'Transaksi',row.product_name??null,row.product_id??null,row.product_quantity??null,row.refund_quantity??null,quantitySource[row.quantity_source]||'Belum tersedia',row.rule_name,row.rule_id??null,row.rule_version,row.commission_kind==='percent'?'Persen':row.commission_kind==='fixed'?'Rupiah':null,row.commission_value??null,row.discount_basis==='before'?'Sebelum diskon':row.discount_basis==='after'?'Setelah diskon':null,row.multi_staff_mode==='split'?'Dibagi rata':row.multi_staff_mode==='full'?'Penuh per staf':null,row.basis,row.event_type==='earned'?row.amount:0,row.source_archive?null:row.event_type==='refund'?-row.amount:0,row.amount,row.refund_id??null,row.id,row.created_at,nameSource[row.product_name_source]||'Belum tersedia'])];}

// Read-only report compatibility for explicitly marked imported receipts.
// No database, network, transactional mutations, or current pricing.
import { refundAmount, remainingLineQty } from '/dashboard-lib-refundReports.js';
import { historicalTenderSnapshot, isImportedHistory, importedRefundAmount, receiptLineTotal } from '/dashboard-lib-importedHistory.js';
export { historicalTenderSnapshot } from '/dashboard-lib-importedHistory.js';

const known = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const money = value => known(value) && Number(value) >= 0;
export const negateKnown = value => known(value) ? (Number(value) === 0 ? 0 : -Number(value)) : null;
export const averageKnown = (value, count) => known(value) && Number.isSafeInteger(count) && count >= 0 ? count ? Number(value) / count : 0 : null;
const cart = sale => sale.cart_data ?? sale.cartData ?? [];
const hasMarker = isImportedHistory;
const nullableAdd = (previous, next) => known(previous) && known(next) ? Number(previous) + Number(next) : null;

/** A metric may be absent for one day/group without making other verified days
 * absent. An unknown value is never converted to zero or to the pre-refund bill. */
export function applyHistoricalReportCompatibility(report) {
  if(!report || !Array.isArray(report.sales) || !report.outletId) throw Error('Report with outlet scope required');
  if(report.sales.some(s=>s.outlet_id!==report.outletId) || (report.logs||[]).some(s=>s.outlet_id!==report.outletId)) throw Error('Data lintas outlet ditolak.');
  if(!report.sales.some(hasMarker)) return report;
  const logs=report.logs||[],methods=new Map(),cashiers=new Map(),orderTypes=new Map(),products=new Map();
  const days=new Map(report.days.map(day=>[day.date,{date:day.date,count:0,gross:0,net:0,unknownNetCount:0}]));
  const notices=new Set(),states=[];
  let unknownCostCount=0,unknownRefundCount=0,invalidCount=0,importedCount=0,unknownMdrCount=0,unknownSurchargeCount=0;
  const financeUnknown=new Set();
  const group=(map,name,sale,gross,refund,mdr,tenderCount=1)=>{
    const row=map.get(name)||{name,count:0,tenderCount:0,gross:0,refund:0,net:0,mdr:0,unknownNetCount:0,_receipts:new Set()};
    row._receipts.add(sale.id);row.count=row._receipts.size;row.tenderCount+=tenderCount;
    row.gross=nullableAdd(row.gross,gross);row.refund=nullableAdd(row.refund,refund);
    const net=known(gross)&&known(refund)?Number(gross)-Number(refund):null;
    row.net=nullableAdd(row.net,net);row.mdr=nullableAdd(row.mdr,mdr);if(net===null)row.unknownNetCount++;
    map.set(name,row);
  };
  for(const sale of report.sales){
    const snapshot=historicalTenderSnapshot(sale),isHistory=snapshot.kind!=='native';
    if(isHistory)importedCount++;
    if(snapshot.kind==='invalid'){invalidCount++;notices.add(snapshot.issue);}
    const rawRefund=refundAmount(sale,logs);
    const refund=isHistory?importedRefundAmount(sale):rawRefund;
    const net=money(sale.total)&&known(refund)?Number(sale.total)-Number(refund):null;
    if(refund===null){unknownRefundCount++;for(const field of ['refunds','netReceipts','tax','service','surcharge','revenue','cogs'])financeUnknown.add(field);}
    if(isHistory && cart(sale).some(line=>!money(line.buyPrice))){unknownCostCount++;financeUnknown.add('cogs');}
    if(!money(sale.mdr_fee)){unknownMdrCount++;financeUnknown.add('mdr');}
    if(!money(sale.payment_surcharge)){unknownSurchargeCount++;for(const field of ['surcharge','rounding','revenue'])financeUnknown.add(field);}
    for(const key of ['subtotal','discount','tax','service'])if(!money(sale[key])){financeUnknown.add(key);financeUnknown.add('revenue');}
    if(snapshot.kind==='invalid')for(const field of ['refunds','netReceipts','subtotal','discount','rounding','tax','service','surcharge','revenue','cogs','mdr'])financeUnknown.add(field);
    const day=days.get(sale.date);if(day){day.count++;day.gross=nullableAdd(day.gross,sale.total);day.net=nullableAdd(day.net,net);if(net===null)day.unknownNetCount++;}
    group(cashiers,sale.cashier||'Belum tercatat',sale,sale.total,refund,sale.mdr_fee);
    group(orderTypes,sale.table_type||'Belum tercatat',sale,sale.total,refund,sale.mdr_fee);
    if(snapshot.kind==='native')group(methods,sale.method||'Belum tercatat',sale,sale.total,refund,sale.mdr_fee);
    else if(snapshot.kind==='invalid')group(methods,'Riwayat impor · pembayaran perlu diperiksa',sale,sale.total,null,null);
    else {
      // One invoice can legitimately count once in each used payment method.
      // Do not create extra sales rows or duplicate product quantities.
      const single=snapshot.tenders.length===1;
      for(const tender of snapshot.tenders){
        // No arbitrary pro-rata attribution of an old refund/MDR to tenders.
        const attributedRefund=refund===0?0:single?refund:null;
        const attributedMdr=Number(sale.mdr_fee)===0 && money(sale.mdr_fee)?0:single?sale.mdr_fee:null;
        group(methods,tender.name,sale,tender.principal,attributedRefund,attributedMdr);
      }
    }
    for(const [index,line] of cart(sale).entries()){
      if(line.isPayment)continue;
      const key=JSON.stringify([line.id,line.name]),row=products.get(key)||{name:line.name||'Produk',category:line.category||'Tanpa kategori',qty:0,amount:0,recordedQty:0,recordedAmount:0,unknownQuantityCount:0};
      const recordedQty=money(line.qty)?Number(line.qty):null,recordedAmount=isHistory?receiptLineTotal(sale,line):known(recordedQty)&&money(line.price)?recordedQty*Number(line.price):null;
      const qty=refund===null?null:remainingLineQty(sale,index),amount=refund===null?null:isHistory?recordedAmount:known(qty)&&money(line.price)?qty*Number(line.price):null;
      row.qty=nullableAdd(row.qty,qty);row.amount=nullableAdd(row.amount,amount);
      row.recordedQty=nullableAdd(row.recordedQty,recordedQty);row.recordedAmount=nullableAdd(row.recordedAmount,recordedAmount);
      if(qty===null)row.unknownQuantityCount++;products.set(key,row);
    }
    states.push({id:sale.id,kind:snapshot.kind,net,refund,statusLabel:isHistory&&refund===null?'Riwayat · refund belum terverifikasi':null});
  }
  const finance={...report.finance,issues:[...report.finance.issues]},knownFinance={...report.finance};
  for(const field of financeUnknown)finance[field]=null;
  if(unknownCostCount)notices.add('HPP riwayat impor belum tersedia; angka laba belum dapat ditampilkan.');
  if(unknownRefundCount)notices.add('Refund riwayat belum terverifikasi; penerimaan bersih dan jumlah produk neto belum tersedia.');
  if(unknownMdrCount||unknownSurchargeCount)notices.add('Ada biaya pembayaran yang belum tersedia pada riwayat.');
  // Existing incomplete native receipts in the same period must not become
  // apparently complete just because the imported subset has known components.
  const profitReady=financeUnknown.size===0 && finance.complete===true;
  finance.grossProfit=profitReady?finance.grossProfit:null;
  finance.contribution=profitReady?finance.contribution:null;
  finance.margin=profitReady?finance.margin:null;
  finance.complete=profitReady;finance.issues=[...new Set([...finance.issues,...notices])];
  const ranked=map=>[...map.values()].map(({_receipts,...row})=>row).sort((a,b)=>(known(b.net)?b.net:-1)-(known(a.net)?a.net:-1)||b.gross-a.gross||a.name.localeCompare(b.name));
  const paymentNetUnknown=[...methods.values()].some(row=>row.net===null);
  return {...report,finance,operatingProfit:profitReady?report.operatingProfit:null,days:[...days.values()],methods:ranked(methods),cashiers:ranked(cashiers),orderTypes:ranked(orderTypes),
    products:[...products.values()].filter(row=>row.recordedQty>0).sort((a,b)=>b.recordedQty-a.recordedQty||a.name.localeCompare(b.name)),
    historicalCompatibility:{version:1,importedCount,invalidCount,unknownCostCount,unknownRefundCount,unknownMdrCount,unknownSurchargeCount,
      paymentChartMetric:paymentNetUnknown?'gross':'net',paymentChartLabel:paymentNetUnknown?'Pembayaran pada struk sebelum refund':'Penerimaan setelah refund',
      methodCountLabel:'Struk yang memakai metode',methodCountNote:'Satu struk dapat memakai lebih dari satu metode pembayaran.',
      productsLabel:unknownRefundCount?'Produk tercatat sebelum refund':'Produk neto setelah refund',
      missingFinanceFields:[...financeUnknown],notices:[...notices],saleStates:states,
      // Keep provisional calculations named as such for audit only. Renderers
      // must use nullable finance above, not these internal amounts.
      provisionalFinance:knownFinance}};
}

export function historicalDisplayPlan(report) {
  const h=report.historicalCompatibility;
  if(!h)return null;
  return {financialWarning:h.notices.join(' '),hideNetChart:report.days.some(day=>day.net===null),
    paymentChartMetric:h.paymentChartMetric,paymentChartLabel:h.paymentChartLabel,
    paymentCountNote:h.methodCountNote,productQuantityMetric:h.unknownRefundCount?'recordedQty':'qty',
    productAmountMetric:h.unknownRefundCount?'recordedAmount':'amount',productLabel:h.productsLabel,
    operatingProfit:report.operatingProfit,averageNet:averageKnown(report.finance.netReceipts,report.finance.transactions),
    profitRows:[['Penerimaan awal pada struk',report.finance.receipts],['Refund',negateKnown(report.finance.refunds)],['Penerimaan bersih',report.finance.netReceipts],
      ['Pajak pelanggan',negateKnown(report.finance.tax)],['Layanan',negateKnown(report.finance.service)],['Surcharge',negateKnown(report.finance.surcharge)],
      ['Penjualan bersih',report.finance.revenue],['HPP',negateKnown(report.finance.cogs)],['Laba kotor',report.finance.grossProfit],
      ['MDR',negateKnown(report.finance.mdr)],['Kontribusi setelah MDR',report.finance.contribution],['Biaya usaha tercatat',negateKnown(report.expense.total)],['Laba operasional',report.operatingProfit]]};
}

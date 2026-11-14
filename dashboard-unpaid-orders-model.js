import { normalizeReceiptDetails } from '/dashboard-receipt-details.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 250;
const finite = value => (typeof value === 'number' || typeof value === 'string' && /^-?\d+(?:\.0+)?$/.test(value)) && Number.isSafeInteger(Number(value)) && Math.abs(Number(value)) <= 1e12 ? Number(value) : null;
const money = value => { const number = finite(value); return number !== null && number >= 0 ? number : null; };
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const partsKeys = ['subtotal','discount','service','tax'];
const sumParts = value => value.subtotal - value.discount + value.service + value.tax;
function parts(value) {
  return object(value) && partsKeys.every(key => typeof value[key] === 'number' && money(value[key]) !== null)
    ? Object.fromEntries(partsKeys.map(key => [key, value[key]])) : null;
}
// Same read-only signature as APK checkoutAccounting.readOrderAccounting.
// No rate, current price, MDR or inferred historical payment enters this view.
function recordedAccounting(cart) {
  const snapshot = cart.find(item => object(item) && !item.isPayment)?._voraAccounting;
  const signature = JSON.stringify(cart.filter(item => object(item) && !item.isPayment).map(item => [item.id,item.qty,item.price]));
  return snapshot?.version === 1 && snapshot.signature === signature ? parts(snapshot.parts) : null;
}
function reference(row, cart) {
  const marker = cart[0]?._voraOrder;
  if (object(marker) && marker.version === 1 && date(marker.business_date) && /^K\d{2,16}$/.test(marker.terminal_code || '')
    && Number.isSafeInteger(marker.sequence) && marker.sequence > 0) {
    const [year,month,day] = marker.business_date.split('-');
    const expected = `ORD/${day}${month}${year.slice(-2)}/${marker.terminal_code}/${String(marker.sequence).padStart(5,'0')}`;
    if (marker.order_number === expected) return {reference:expected,referenceKind:'number'};
  }
  return {reference:row.id,referenceKind:'legacy'};
}
function capturedProgress(cart, outletId) {
  const core = cart[0]?._voraCommission, progress = core?.progress;
  if (!object(core) || core.version !== 1 || core.outlet_id !== outletId || !id(core.checkout_id) || core.payment || core.settled === true || !object(progress)
    || !Array.isArray(core.lines) || !core.lines.length || !Array.isArray(core.rules) || !Array.isArray(core.transaction_groups)
    || core.lines.some(line=>!object(line)||!id(line.line_id)||!id(line.product_id)||!Number.isSafeInteger(line.qty)||line.qty<1||money(line.unit_price)===null||money(line.discount)===null||!Array.isArray(line.groups))
    || new Set(core.lines.map(line=>line.line_id)).size!==core.lines.length) return null;
  if (!Array.isArray(progress.sale_ids) || progress.sale_ids.some(value => !id(value)) || new Set(progress.sale_ids).size !== progress.sale_ids.length || money(progress.paid_principal) === null) return null;
  if (progress.paid_principal > 0 && progress.sale_ids.length === 0 || progress.paid_principal === 0 && progress.sale_ids.length > 0) return null;
  return {paidPrincipal:progress.paid_principal,receiptIds:[...progress.sale_ids]};
}

export function normalizeUnpaidOrder(row, outletId) {
  if (!object(row) || !id(outletId) || row.outlet_id !== outletId || !id(row.id) || row.status !== 'unpaid') throw new TypeError('Pesanan tidak sesuai akses outlet atau sudah berubah. Muat ulang daftar.');
  const warnings = [], cart = Array.isArray(row.cart_data) ? row.cart_data : [];
  if (!Array.isArray(row.cart_data) || !cart.length || cart.some(item => !object(item))) warnings.push('Rincian item pesanan belum lengkap.');
  const details = normalizeReceiptDetails(row), remainingTotal = money(row.total), accounting = recordedAccounting(cart), progress = capturedProgress(cart,outletId);
  if (cart[0]?._voraCommission?.progress && !progress) warnings.push('Snapshot pembayaran komisi belum lengkap.');
  if (remainingTotal === null) warnings.push('Sisa tagihan belum dapat diverifikasi; angka tidak diperkirakan.');
  const items = details.items.map(line => {
    const qty = Number.isSafeInteger(line.qty) && line.qty > 0 ? line.qty : null, price = money(line.price);
    const total = qty !== null && price !== null && money(qty * price) !== null ? qty * price : null;
    if (qty === null || price === null || total === null) warnings.push('Ada jumlah atau harga item yang perlu diperiksa.');
    return {index:line.index,key:line.key,name:line.name,category:line.category,qty,price,total,servedBy:line.servedBy,note:line.note,extras:line.extras,pricing:line.pricing};
  });
  const adjustments = details.adjustments.map(line => ({name:line.name,qty:line.qty,price:line.price,total:line.total}));
  const markers = cart.filter(item => object(item) && item.isPayment === true);
  let paidPrincipal = null, originalTotal = null, paymentState = 'open', accountingBasis = 'remaining';
  if (markers.length) {
    paymentState = 'partial';accountingBasis = 'original';
    let paid = 0, valid = !!accounting;
    for (const marker of markers) {
      const price = finite(marker.price), qty = Number.isSafeInteger(marker.qty) && marker.qty > 0 ? marker.qty : null;
      const allocation = parts(marker._voraPaidAccounting);
      const amount = price !== null && qty !== null ? -price * qty : null;
      if (price === null || price >= 0 || amount === null || money(amount) === null || !allocation || sumParts(allocation) !== amount) valid = false;
      else paid += amount;
    }
    const gross = accounting ? sumParts(accounting) : null;
    if (valid && money(paid) !== null && gross !== null && money(gross) !== null && remainingTotal !== null && gross - paid === remainingTotal
      && (!progress || progress.paidPrincipal >= paid) && (!progress || money(remainingTotal+progress.paidPrincipal)!==null)) {
      // After an item split followed by a nominal split, this cart's negative
      // marker covers only the remaining quoted items; captured checkout progress
      // also includes the earlier item payment. Never add MDR/surcharge here.
      paidPrincipal=progress?progress.paidPrincipal:paid;originalTotal=progress?remainingTotal+progress.paidPrincipal:gross;
    }
    else warnings.push('Rincian pembayaran sebagian belum lengkap atau tidak cocok. Sisa tagihan tetap mengikuti pesanan server.');
  } else if (progress?.paidPrincipal > 0) {
    paymentState='partial';
    const gross = remainingTotal === null ? null : remainingTotal + progress.paidPrincipal;
    if (accounting && sumParts(accounting) === remainingTotal && money(gross) !== null) {paidPrincipal=progress.paidPrincipal;originalTotal=gross;}
    else warnings.push('Snapshot pembayaran sebagian belum cocok dengan sisa tagihan.');
  } else if (accounting && sumParts(accounting) !== remainingTotal) warnings.push('Komponen tagihan tersimpan belum cocok dengan sisa tagihan server.');
  if (!items.length) warnings.push('Daftar produk pesanan belum tersedia.');
  if (warnings.length) paymentState='review';
  const customer = object(row.customer) ? row.customer : {};
  return {id:row.id,outletId,...reference(row,cart),date:date(row.date)?row.date:null,name:text(row.name),description:text(row.items),orderType:text(row.order_type),tableName:text(row.ojek_code),
    customer:{name:text(customer.name),phone:text(customer.phone),address:text(customer.address)},items,adjustments,remainingTotal,originalTotal,paidPrincipal,
    accounting:accounting ? {...accounting,basis:accountingBasis} : null,paymentState,paymentLabel:paymentState==='partial'?'Dibayar sebagian':paymentState==='review'?'Perlu diperiksa':'Belum lunas',
    itemCount:items.some(item=>item.qty===null)?null:items.reduce((sum,item)=>sum+item.qty,0),servedBy:details.servedBy,orderNote:details.orderNote,
    referencedReceiptIds:progress?.receiptIds||[],warnings:[...new Set(warnings)]};
}

export function unpaidOrdersSummary(orders) {
  const unknownTotalCount=orders.filter(order=>order.remainingTotal===null).length;
  const knownRemainingTotal=orders.reduce((sum,order)=>sum+(order.remainingTotal??0),0);
  const totalOverflow=!Number.isSafeInteger(knownRemainingTotal);
  return {count:orders.length,remainingTotal:unknownTotalCount||totalOverflow?null:knownRemainingTotal,knownRemainingTotal:totalOverflow?null:knownRemainingTotal,unknownTotalCount,totalOverflow,
    partialCount:orders.filter(order=>order.paymentState==='partial'||order.paidPrincipal>0).length,
    itemCount:orders.some(order=>order.itemCount===null)?null:orders.reduce((sum,order)=>sum+order.itemCount,0)};
}

export function buildUnpaidOrdersModel(snapshot,{query='',paymentState='all',sort='newest',page=1,pageSize=20,dateFrom='',dateUntil=''}={}) {
  if (!snapshot || !id(snapshot.outletId) || !Array.isArray(snapshot.orders) || snapshot.orders.some(order=>order.outletId!==snapshot.outletId)) throw new TypeError('Daftar pesanan tidak sesuai outlet.');
  if (!['all','open','partial','review'].includes(paymentState) || !['newest','oldest','reference'].includes(sort)) throw new TypeError('Filter pesanan tidak valid.');
  if (dateFrom&&!date(dateFrom)||dateUntil&&!date(dateUntil)||dateFrom&&dateUntil&&dateFrom>dateUntil) throw new TypeError('Pilih rentang tanggal pesanan yang valid.');
  const needle=String(query).normalize('NFKC').trim().toLocaleLowerCase('id-ID'),seen=new Set();
  for(const row of snapshot.orders){if(!id(row.id)||seen.has(row.id))throw new TypeError('Pesanan berulang. Muat ulang daftar.');seen.add(row.id);}
  const filtered=snapshot.orders.filter(order=>(paymentState==='all'||order.paymentState===paymentState)&&(!dateFrom||order.date>=dateFrom)&&(!dateUntil||order.date&&order.date<=dateUntil)&&
    (!needle||[order.reference,order.id,order.name,order.description,order.orderType,order.tableName,order.customer.name,order.customer.phone,order.servedBy,...order.items.flatMap(item=>[item.name,item.note,item.servedBy])]
      .filter(value=>typeof value==='string').join(' ').normalize('NFKC').toLocaleLowerCase('id-ID').includes(needle)));
  const compareText=(a,b)=>String(a||'').localeCompare(String(b||''),'id',{numeric:true,sensitivity:'base'});
  filtered.sort((a,b)=>(sort==='reference'?compareText(a.reference,b.reference):(sort==='oldest'?compareText(a.date,b.date):compareText(b.date,a.date)))||compareText(a.reference,b.reference)||compareText(a.id,b.id));
  const size=Number.isSafeInteger(pageSize)&&pageSize>0?Math.min(pageSize,100):20,pages=Math.max(1,Math.ceil(filtered.length/size)),current=Number.isSafeInteger(page)&&page>0?Math.min(page,pages):1;
  return {...snapshot,rows:filtered.slice((current-1)*size,current*size),filteredCount:filtered.length,totalCount:snapshot.orders.length,page:current,pageSize:size,pageCount:pages,query:String(query),paymentState,sort,dateFrom,dateUntil,summary:unpaidOrdersSummary(filtered)};
}

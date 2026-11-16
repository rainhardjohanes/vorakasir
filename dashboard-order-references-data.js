import { verifyOwner } from '/dashboard-operations-data.js';

const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function hasNativeReference(row) {
  const marker=row?.cart_data?.[0]?._voraOrder;
  if(!marker||marker.version!==1||!validDate(marker.business_date)||!/^K\d{2,16}$/.test(marker.terminal_code||'')||!Number.isSafeInteger(marker.sequence)||marker.sequence<1)return false;
  const [year,month,day]=marker.business_date.split('-');
  return marker.order_number===`ORD/${day}${month}${year.slice(-2)}/${marker.terminal_code}/${String(marker.sequence).padStart(5,'0')}`;
}
export function readDisplayOrderReference(row,outletId) {
  const ref=row?._voraDisplayReference;
  if(!ref||ref.version!==1||ref.outlet_id!==outletId||ref.order_id!==row.id||!validDate(ref.business_date)||!Number.isSafeInteger(ref.sequence)||ref.sequence<1||ref.sequence>999999999)return null;
  const [year,month,day]=ref.business_date.split('-');
  const expected=`ORD/${day}${month}${year.slice(-2)}/${String(ref.sequence).padStart(5,'0')}`;
  return ref.order_number===expected?expected:null;
}
export async function hydrateOrderReferences(client,user,outlet,orders,signal) {
  if(!Array.isArray(orders)||orders.some(row=>row?.outlet_id!==outlet.id||typeof row?.id!=='string'))throw new TypeError('Pesanan tidak sesuai outlet.');
  if(!orders.length)return [];
  await verifyOwner(client,user,outlet,signal);
  const legacy=orders.filter(row=>!hasNativeReference(row));
  const refs=new Map();
  for(let start=0;start<legacy.length;start+=100){
    if(signal?.aborted)throw new DOMException('Dibatalkan','AbortError');
    const batch=legacy.slice(start,start+100),ids=batch.map(row=>row.id),allowed=new Set(ids);
    let query=client.rpc('vora_order_display_references',{p_outlet_id:outlet.id,p_order_ids:ids});
    if(signal)query=query.abortSignal(signal);
    const {data,error}=await query;
    if(signal?.aborted)throw new DOMException('Dibatalkan','AbortError');
    if(error)throw error;
    if(data?.outlet_id!==outlet.id||!Array.isArray(data.references))throw new Error('Nomor pesanan tidak sesuai outlet.');
    for(const ref of data.references){
      if(!allowed.has(ref?.order_id)||refs.has(ref.order_id)||!readDisplayOrderReference({id:ref.order_id,_voraDisplayReference:ref},outlet.id))throw new Error('Nomor pesanan belum dapat diverifikasi.');
      refs.set(ref.order_id,ref);
    }
  }
  return orders.map(row=>refs.has(row.id)?{...row,_voraDisplayReference:refs.get(row.id)}:row);
}

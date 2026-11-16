import { verifyOwner } from '/dashboard-operations-data.js';
import { hydrateOrderReferences } from '/dashboard-order-references-data.js';
import { normalizeUnpaidOrder } from '/dashboard-unpaid-orders-model.js';

const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const abort=signal=>{if(signal?.aborted)throw new DOMException('Permintaan dibatalkan.','AbortError');};
const text=(x,label,max=160)=>{if(typeof x!=='string'||!x.trim()||x.length>max)throw new Error(`${label} belum valid.`);return x;};
const uuid=(x,label)=>{if(typeof x!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x))throw new Error(`${label} belum valid.`);return x;};
const integer=(x,label,min,max)=>{if(!Number.isSafeInteger(x)||x<min||x>max)throw new Error(`${label} belum valid.`);return x;};
function own(row,outlet){if(!object(row)||row.outlet_id!==outlet.id)throw new Error('Data lintas outlet ditolak.');return row;}
function ownerScope(user,outlet){const uid=typeof user==='string'?user:user?.id;if(!uid||outlet?.merchant_id!==uid||outlet.is_deleted!==false)throw new Error('Outlet tidak tersedia untuk akun ini.');}
async function rpc(client,name,parameters,signal){abort(signal);const q=client.rpc(name,parameters);const response=await(signal?q.abortSignal(signal):q);abort(signal);if(response.error){const e=new Error(response.error.message||'Riwayat pelanggan belum dapat dimuat.');e.code=response.error.code;throw e;}return response.data;}
function metadata(data,outlet){if(!object(data)||data.outlet_id!==outlet.id)throw new Error('Respons riwayat tidak sesuai outlet.');return data;}
function sameCustomer(data,outlet,id){metadata(data,outlet);if(data.customer_id!==id||!object(data.customer)||data.customer.id!==id)throw new Error('Respons riwayat tidak sesuai pelanggan.');own(data.customer,outlet);}
function cursor(value,revision=false){if(value===null)return null;if(!object(value)||!['note','sale','order'].includes(value.type)||typeof value.id!=='string'||!value.id||value.id.length>300||revision&&(!/^[a-f0-9]{32}$/.test(value.revision||'')))throw new Error('Kursor riwayat belum valid.');return{type:value.type,id:value.id,...(revision?{revision:value.revision}:{})};}
function unique(list,key,kind,outlet){const seen=new Set();for(const row of list){own(row,outlet);const value=key(row);if(!value||seen.has(value))throw new Error(`${kind} berulang atau belum lengkap.`);seen.add(value);}return list;}
const nativeId=row=>object(row?.customer)&&typeof row.customer.id==='string'&&row.customer.id.trim()?row.customer.id:null;

export async function loadCustomerDirectory(client,user,outlet,{query='',page=1,pageSize=50,includeArchived=false,signal}={}){
 ownerScope(user,outlet);if(typeof query!=='string'||query.length>160||typeof includeArchived!=='boolean')throw new Error('Pencarian pelanggan belum valid.');
 integer(page,'Halaman',1,1000000);integer(pageSize,'Jumlah pelanggan',1,100);
 await verifyOwner(client,user,outlet,signal);
 const data=metadata(await rpc(client,'vora_customer_directory',{p_outlet_id:outlet.id,p_search:query.trim(),p_offset:(page-1)*pageSize,p_limit:pageSize,p_include_archived:includeArchived},signal),outlet);
 if(!Array.isArray(data.customers)||!Number.isSafeInteger(data.total_count)||data.total_count<0||data.offset!==(page-1)*pageSize||data.limit!==pageSize||data.customers.length>pageSize)throw new Error('Daftar pelanggan belum dapat dibaca lengkap.');
 unique(data.customers,row=>row.id,'Pelanggan',outlet);
 const customers=data.customers.map(c=>{if(!includeArchived&&c.deleted_at)throw new Error('Pelanggan arsip tidak sesuai filter.');return{id:text(c.id,'ID pelanggan'),outlet_id:c.outlet_id,name:typeof c.name==='string'?c.name:'',phone:typeof c.phone==='string'?c.phone:'',gender:typeof c.gender==='string'?c.gender:'',address:typeof c.address==='string'?c.address:'',updated_at:c.updated_at??null,deleted_at:c.deleted_at??null,price_group_name:typeof c.price_group?.name==='string'?c.price_group.name:null,price_group:object(c.price_group)?c.price_group:null};});
 return{outletId:outlet.id,customers,totalCount:data.total_count,page,pageSize,completePage:true};
}

async function historyAttempt(client,user,outlet,customerId,signal){
 const all={sales:[],orders:[],logs:[],refunds:[],links:[],notes:[]};let next=null,revision=null,customer,priceGroup,loadedAt;
 const seenRows=new Set(),seenCursors=new Set(),logMap=new Map(),refundMap=new Map(),linkMap=new Map();
 for(;;){
  const page=await rpc(client,'vora_customer_history',{p_outlet_id:outlet.id,p_customer_id:customerId,p_cursor:next,p_limit:200},signal);
  sameCustomer(page,outlet,customerId);
  if(!/^[a-f0-9]{32}$/.test(page.revision||'')||revision!==null&&revision!==page.revision||!['rows','logs','refunds','links'].every(k=>Array.isArray(page[k]))||typeof page.complete!=='boolean')throw new Error('Riwayat berubah atau belum lengkap. Muat ulang.');
  revision=page.revision;customer=page.customer;priceGroup=object(page.price_group)?page.price_group:null;loadedAt=page.loaded_at;
  for(const item of page.rows){
   if(!object(item)||!['sale','order','note'].includes(item.record_type)||typeof item.record_id!=='string'||!item.record_id||typeof item.archived!=='boolean')throw new Error('Rincian riwayat belum valid.');
   const row=own(item.row,outlet),key=`${item.record_type}:${item.record_id}`;
   if(seenRows.has(key)||String(row.id)!==item.record_id)throw new Error('Rincian riwayat berulang. Muat ulang.');seenRows.add(key);
   if(item.record_type==='note'){
    if(row.customer_id!==customerId||row.deleted_at||typeof row.body!=='string'||!Number.isSafeInteger(row.revision)||row.revision<1)throw new Error('Catatan pelanggan belum valid.');all.notes.push(row);
   }else all[item.record_type==='sale'?'sales':'orders'].push(item.archived?{...row,_voraHistoryArchived:true,_voraHistoryArchivedAt:row._voraHistoryArchivedAt||null}:row);
  }
  for(const log of page.logs){own(log,outlet);if(!log.id||!log.sale_id)throw new Error('Riwayat pembatalan belum lengkap.');if(logMap.has(log.id)&&JSON.stringify(logMap.get(log.id))!==JSON.stringify(log))throw new Error('Riwayat pembatalan berubah.');logMap.set(log.id,log);}
  for(const refund of page.refunds){own(refund,outlet);if(!refund.id||!refund.sale_id)throw new Error('Riwayat refund belum lengkap.');if(refundMap.has(refund.id)&&JSON.stringify(refundMap.get(refund.id))!==JSON.stringify(refund))throw new Error('Riwayat refund berubah.');refundMap.set(refund.id,refund);}
  for(const link of page.links){own(link,outlet);if(link.customer_id!==customerId||!['sale','order'].includes(link.record_type)||!link.record_id)throw new Error('Tautan riwayat belum valid.');const key=`${link.record_type}:${link.record_id}`;if(linkMap.has(key)&&JSON.stringify(linkMap.get(key))!==JSON.stringify(link))throw new Error('Tautan riwayat berubah.');linkMap.set(key,link);}
  const candidate=cursor(page.next_cursor,true);
  if(page.complete){if(candidate!==null)throw new Error('Penanda kelengkapan riwayat bertentangan.');break;}
  if(!candidate||!page.rows.length||candidate.revision!==revision)throw new Error('Halaman riwayat berikutnya belum tersedia.');
  const last=page.rows.at(-1);if(candidate.type!==last.record_type||candidate.id!==last.record_id)throw new Error('Urutan kursor riwayat belum valid.');
  const key=JSON.stringify(candidate);if(seenCursors.has(key))throw new Error('Halaman riwayat berulang.');seenCursors.add(key);next=candidate;
 }
 all.logs=[...logMap.values()];all.refunds=[...refundMap.values()];all.links=[...linkMap.values()];
 const recordIds=new Set([...all.sales,...all.orders].map(r=>r.id));
 if(all.logs.some(r=>!recordIds.has(r.sale_id))||all.refunds.some(r=>!all.sales.some(s=>s.id===r.sale_id)))throw new Error('Rincian refund atau pembatalan di luar riwayat pelanggan.');
 for(const[kind,list]of[['sale',all.sales],['order',all.orders]])for(const row of list){const id=nativeId(row);if(id!==customerId&&!(id===null&&linkMap.has(`${kind}:${row.id}`)))throw new Error('Transaksi bukan milik pelanggan ini.');}
 all.notes.sort((a,b)=>String(b.updated_at||b.created_at).localeCompare(String(a.updated_at||a.created_at))||a.id.localeCompare(b.id));
 all.orders=await hydrateOrderReferences(client,user,outlet,all.orders,signal);
 return{outletId:outlet.id,customer,priceGroup,...all,revision,loadedAt,complete:true,warnings:[
  'Riwayat hanya memuat transaksi yang sudah diterima server. Transaksi offline muncul setelah berhasil tersinkron.',
  'Pesanan yang dihapus sebelum fitur riwayat tersedia mungkin tidak memiliki arsip pelanggan. Data yang tidak tersedia tidak diperkirakan.'
 ]};
}
export async function loadCustomerHistory(client,user,outlet,customerId,{signal}={}){
 ownerScope(user,outlet);text(customerId,'ID pelanggan');await verifyOwner(client,user,outlet,signal);
 try{return await historyAttempt(client,user,outlet,customerId,signal);}catch(error){abort(signal);if(error.code!=='PT409')throw error;return historyAttempt(client,user,outlet,customerId,signal);}
}
export async function saveCustomerNote(client,user,outlet,customerId,draft,signal){
 ownerScope(user,outlet);text(customerId,'ID pelanggan');if(!object(draft))throw new Error('Catatan belum valid.');uuid(draft.operationId,'Referensi catatan');
 const archived=draft.deleted===true;if(draft.deleted!==undefined&&typeof draft.deleted!=='boolean')throw new Error('Pilihan hapus catatan belum valid.');
 const id=draft.id==null?null:uuid(draft.id,'ID catatan'),revision=draft.revision??0;integer(revision,'Versi catatan',0,Number.MAX_SAFE_INTEGER);
 const body=archived?null:text(draft.body,'Catatan',4000).trim();if(archived&&!id)throw new Error('Catatan yang dihapus belum dipilih.');
 await verifyOwner(client,user,outlet,signal);
 const note=own(await rpc(client,'vora_customer_history_note',{p_outlet_id:outlet.id,p_customer_id:customerId,p_operation_id:draft.operationId,p_note_id:id,p_expected_revision:revision,p_body:body,p_archive:archived},signal),outlet);
 if(note.customer_id!==customerId||!note.id||!Number.isSafeInteger(note.revision)||note.revision<1)throw new Error('Konfirmasi catatan belum lengkap. Muat ulang sebelum mengulangi.');return note;
}
export async function loadUnassignedDocuments(client,user,outlet,{search='',cursor:next=null,signal}={}){
 ownerScope(user,outlet);text(search,'Pencarian',160);if(search.trim().length<3)throw new Error('Ketik minimal 3 karakter nomor invoice, order, atau meja.');if(next!==null&&!['sale','order'].includes(next?.type))throw new Error('Kursor pencarian belum valid.');
 await verifyOwner(client,user,outlet,signal);
 const data=metadata(await rpc(client,'vora_customer_history_unassigned',{p_outlet_id:outlet.id,p_search:search.trim(),p_cursor:cursor(next),p_limit:25},signal),outlet);
 if(!Array.isArray(data.rows)||typeof data.has_more!=='boolean')throw new Error('Pencarian nota belum lengkap.');
 const orderCandidates=data.rows.filter(item=>item?.record_type==='order').map(item=>own(item.row,outlet));
 const numbered=new Map((await hydrateOrderReferences(client,user,outlet,orderCandidates,signal)).map(row=>[row.id,row]));
 const seen=new Set(),rows=data.rows.map(item=>{if(!object(item)||!['sale','order'].includes(item.record_type)||!object(item.row)||item.row.id!==item.record_id||typeof item.archived!=='boolean')throw new Error('Hasil pencarian nota belum valid.');const row=own(item.row,outlet),key=`${item.record_type}:${item.record_id}`;if(nativeId(row)!==null||seen.has(key))throw new Error('Nota sudah memiliki pelanggan atau berulang.');seen.add(key);const reference=item.record_type==='order'?normalizeUnpaidOrder({...numbered.get(row.id),status:'unpaid'},outlet.id).reference:(row.receipt_number||row.id);return{recordType:item.record_type,recordId:item.record_id,reference,date:row.date||'',time:row.time||'',total:row.total,status:row.status,archived:item.archived,customer:null};});
 const nextCursor=cursor(data.next_cursor);if(data.has_more!==!!nextCursor)throw new Error('Halaman pencarian belum lengkap.');return{outletId:outlet.id,rows,nextCursor,hasMore:data.has_more};
}
async function changeLink(client,user,outlet,customerId,draft,signal,unlink){
 ownerScope(user,outlet);text(customerId,'ID pelanggan');if(!object(draft)||!['sale','order'].includes(draft.recordType))throw new Error('Jenis nota belum valid.');text(draft.recordId,'ID nota',300);text(draft.reason,'Alasan penautan',1000);if(draft.reason.trim().length<10)throw new Error('Tuliskan alasan minimal 10 karakter.');uuid(draft.operationId,'Referensi penautan');
 await verifyOwner(client,user,outlet,signal);const data=own(await rpc(client,'vora_customer_history_link',{p_outlet_id:outlet.id,p_customer_id:customerId,p_operation_id:draft.operationId,p_record_type:draft.recordType,p_record_id:draft.recordId,p_reason:draft.reason.trim(),p_unlink:unlink},signal),outlet);
 if(data.customer_id!==customerId||data.record_type!==draft.recordType||data.record_id!==draft.recordId||data.unlinked!==unlink)throw new Error('Konfirmasi penautan belum lengkap. Muat ulang sebelum mengulangi.');return data;
}
export const linkCustomerDocument=(client,user,outlet,customerId,draft,signal)=>changeLink(client,user,outlet,customerId,draft,signal,false);
export const unlinkCustomerDocument=(client,user,outlet,customerId,draft,signal)=>changeLink(client,user,outlet,customerId,draft,signal,true);

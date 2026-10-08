// Owner backoffice operations. RLS remains the authority; every request also carries outlet scope.
export const PRODUCT_FIELDS = 'id,outlet_id,name,sku,category,unit,price,buy_price,stock,track_stock,image_uri,icon,extras,is_favorite,updated_at,deleted_at';
export const STAFF_FIELDS = 'id,outlet_id,name,role,updated_at,deleted_at';
const SETTINGS_FIELDS = 'id,outlet_id,profile_data,tax_config,rounding_config,payment_methods,receipt_data';
const pendingCreations = new Map();
export const PAYMENT_TYPES = ['Bank Transfer', 'e-Wallet', 'QRIS', 'EDC / Kartu'];
export const RECEIPT_KEYS = ['showReceiptNumber','showOrderNumber','showCustomer','showServer','showCashier','showPaymentMethod','showWifi','showLogo'];
const abort = signal => { if (signal?.aborted) throw new DOMException('Permintaan dibatalkan.', 'AbortError'); };
function scope(user, outlet) {
  const uid = typeof user === 'string' ? user : user?.id;
  if (!uid || !outlet?.id || outlet.merchant_id !== uid || outlet.is_deleted !== false) throw new Error('Outlet tidak tersedia untuk akun ini.');
  return uid;
}
async function result(query, signal) { abort(signal); const response = await (signal ? query.abortSignal(signal) : query); abort(signal); if (response.error) throw response.error; return response.data; }
function ownRow(row, outlet) { if (!row || row.outlet_id !== outlet.id) throw new Error('Data lintas outlet ditolak.'); return row; }
export async function verifyOwner(client,user,outlet,signal) {
  const uid=scope(user,outlet);
  const row=await result(client.from('outlets').select('id,merchant_id,is_deleted').eq('id',outlet.id).eq('merchant_id',uid).eq('is_deleted',false).single(),signal);
  if (row?.id !== outlet.id || row?.merchant_id !== uid || row?.is_deleted !== false) throw new Error('Akses outlet berubah. Muat ulang halaman.');
}
async function rows(client,table,fields,outlet,signal,key='id',limit=20000,softDelete=true) {
  const all=[];let cursor;const seen=new Set();
  for(;;){
    let q=client.from(table).select(fields).eq('outlet_id',outlet.id).order(key,{ascending:true}).limit(500);
    if(softDelete)q=q.is('deleted_at',null);
    if(cursor!==undefined)q=q.gt(key,cursor);
    const page=await result(q,signal);
    if(!Array.isArray(page))throw new Error('Respons data tidak valid.');
    if(!page.length)return all;
    for(const row of page){ownRow(row,outlet);if(row[key]==null||seen.has(row[key]))throw new Error('Data berubah saat dimuat. Muat ulang.');seen.add(row[key]);all.push(row);}
    if(all.length>limit)throw new Error('Katalog terlalu besar untuk dimuat sekaligus. Hubungi dukungan; data tidak dipotong.');
    cursor=page[page.length-1][key];
  }
}
async function settingsRow(client,outlet,signal){const row=await result(client.from('settings').select(SETTINGS_FIELDS).eq('outlet_id',outlet.id).maybeSingle(),signal);return row?ownRow(row,outlet):null;}
export async function loadOperations(client,user,outlet,signal){
  await verifyOwner(client,user,outlet,signal);
  const [products,categories,staff,settings,extras]=await Promise.all([
    rows(client,'products',PRODUCT_FIELDS,outlet,signal), rows(client,'categories','name,outlet_id,sort_order,deleted_at',outlet,signal,'name'),
    rows(client,'staff',STAFF_FIELDS,outlet,signal),settingsRow(client,outlet,signal),rows(client,'extras_library','id,outlet_id,name,options',outlet,signal,'id',20000,false),
  ]);
  return {outletId:outlet.id,products,categories,staff,settings:settings||{outlet_id:outlet.id},extras,loadedAt:new Date().toISOString()};
}
function text(value,label,max=200){const str=String(value??'').trim();if(!str||str.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(str))throw new Error(`${label} wajib diisi (maksimal ${max} karakter).`);return str;}
function number(value,label,max=1000000000000){if(value===''||value==null||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>max)throw new Error(`${label} harus berupa angka 0–${max}.`);return Number(value);}
export const newId=prefix=>`${prefix}-${crypto.randomUUID()}`;
export function productPayload(draft,outletId,existing){
  const out={name:text(draft.name,'Nama produk'),sku:text(draft.sku,'SKU',100),category:text(draft.category,'Kategori'),unit:text(draft.unit||'Pcs','Satuan',40),price:number(draft.price,'Harga jual')};
  if(!existing || Object.hasOwn(draft,'buy_price')&&Number(draft.buy_price)!==Number(existing.buy_price||0))out.buy_price=number(draft.buy_price??0,'Harga pokok');
  if(!existing || Object.hasOwn(draft,'track_stock')&&!!draft.track_stock!==!!existing.track_stock)out.track_stock=!!draft.track_stock;
  if(!existing){out.id=text(draft.id,'ID produk');out.outlet_id=outletId;out.stock=draft.track_stock?number(draft.stock??0,'Stok awal',2147483647):0;if(!Number.isInteger(out.stock))throw new Error('Stok awal harus bilangan bulat.');out.extras=Array.isArray(draft.extras)?draft.extras:[];out.icon='📦';}
  else if(Object.hasOwn(draft,'extras') && JSON.stringify(draft.extras)!==JSON.stringify(existing.extras||[]))out.extras=draft.extras;
  return out;
}
function version(query,row){return row.updated_at?query.eq('updated_at',row.updated_at):query;}
export async function saveProduct(client,user,outlet,draft,existing,signal){
  await verifyOwner(client,user,outlet,signal);
  if(existing)ownRow(existing,outlet);
  const payload=productPayload(draft,outlet.id,existing);
  const creationKey=`${scope(user,outlet)}:${outlet.id}:${payload.id}`;
  if(!existing&&pendingCreations.has(creationKey)&&pendingCreations.get(creationKey)!==JSON.stringify(payload))throw new Error('Penyimpanan produk sebelumnya belum terkonfirmasi. Kembalikan isi formulir, termasuk stok awal, ke nilai saat Simpan pertama lalu coba lagi. Muat ulang katalog untuk melihat data yang sudah tersimpan.');
  // Validate references under this outlet even when a legacy DB has a global category key.
  const category=await result(client.from('categories').select('name,outlet_id').eq('outlet_id',outlet.id).eq('name',payload.category).is('deleted_at',null).single(),signal);ownRow(category,outlet);
  const duplicates=await result(client.from('products').select('id,outlet_id,sku').eq('outlet_id',outlet.id).is('deleted_at',null).ilike('sku',payload.sku.replace(/[\\%_]/g,'\\$&')).limit(2),signal);
  if((duplicates||[]).some(row=>{ownRow(row,outlet);return row.id!==existing?.id&&row.id!==payload.id;}))throw new Error('SKU sudah dipakai produk lain di outlet ini.');
  if(payload.extras){if(!Array.isArray(payload.extras))throw new Error('Ekstra produk tidak valid.');for(const extra of payload.extras){const id=typeof extra==='string'?extra:extra?.id;if(!id)throw new Error('Ekstra produk tidak valid.');const ref=await result(client.from('extras_library').select('id,outlet_id').eq('outlet_id',outlet.id).eq('id',id).single(),signal);ownRow(ref,outlet);}}
  if(existing){const saved=await result(version(client.from('products').update(payload).eq('id',existing.id).eq('outlet_id',outlet.id).is('deleted_at',null),existing).select(PRODUCT_FIELDS).maybeSingle(),signal);if(!saved)throw new Error('Produk telah berubah di perangkat lain. Tutup formulir dan muat ulang sebelum menyimpan.');return ownRow(saved,outlet);}
  pendingCreations.set(creationKey,JSON.stringify(payload));
  const response=await (signal?client.from('products').insert(payload).select(PRODUCT_FIELDS).single().abortSignal(signal):client.from('products').insert(payload).select(PRODUCT_FIELDS).single());abort(signal);
  if(!response.error){const row=ownRow(response.data,outlet);await openingMovement(client,outlet,payload,signal);pendingCreations.delete(creationKey);return row;}
  if(response.error.code==='23505'){
    const saved=await result(client.from('products').select(PRODUCT_FIELDS).eq('id',payload.id).eq('outlet_id',outlet.id).is('deleted_at',null).maybeSingle(),signal);
    // A retry after a lost response returns the committed product, without rewriting live stock.
    const matches=saved&&['name','sku','category','unit','price','buy_price','track_stock'].every(key=>String(saved[key]??'')===String(payload[key]??''))&&JSON.stringify(saved.extras||[])===JSON.stringify(payload.extras||[]);
    if(matches){await openingMovement(client,outlet,payload,signal);pendingCreations.delete(creationKey);return ownRow(saved,outlet);}
  }
  if(response.error.code && response.error.code!=='23505')pendingCreations.delete(creationKey);
  throw response.error;
}
async function openingMovement(client,outlet,payload,signal){
  if(!payload.track_stock||!Number(payload.stock))return;
  const movement={id:`STM-OPEN-${payload.id}`,outlet_id:outlet.id,product_id:payload.id,product_name:payload.name,movement_type:'IN',qty:payload.stock,description:'Input stok awal produk baru dari dashboard'};
  const response=await (signal?client.from('stock_movements').insert(movement).select('id,outlet_id').single().abortSignal(signal):client.from('stock_movements').insert(movement).select('id,outlet_id').single());abort(signal);
  if(!response.error){ownRow(response.data,outlet);return;}
  if(response.error.code==='23505'){
    const found=await result(client.from('stock_movements').select('id,outlet_id,product_id,movement_type,qty').eq('id',movement.id).eq('outlet_id',outlet.id).maybeSingle(),signal);
    if(found&&found.product_id===payload.id&&found.movement_type==='IN'&&Number(found.qty)===Number(payload.stock)){ownRow(found,outlet);return;}
  }
  throw new Error('Produk sudah tersimpan, tetapi catatan stok awal belum tersimpan. Coba Simpan kembali pada formulir ini untuk menyelesaikan catatan tanpa menggandakan produk.');
}
export async function deleteProduct(client,user,outlet,product,signal){
  await verifyOwner(client,user,outlet,signal);ownRow(product,outlet);
  const saved=await result(version(client.from('products').update({deleted_at:new Date().toISOString()}).eq('id',product.id).eq('outlet_id',outlet.id).is('deleted_at',null),product).select('id,outlet_id').maybeSingle(),signal);
  if(!saved)throw new Error('Produk berubah atau sudah dihapus. Muat ulang katalog.');return ownRow(saved,outlet);
}
export async function addCategory(client,user,outlet,name,signal){await verifyOwner(client,user,outlet,signal);return ownRow(await result(client.from('categories').insert({name:text(name,'Kategori',100),outlet_id:outlet.id,sort_order:0}).select('name,outlet_id,sort_order').single(),signal),outlet);}
export async function saveStaff(client,user,outlet,draft,existing,signal){
  await verifyOwner(client,user,outlet,signal);if(existing){ownRow(existing,outlet);if(existing.role.toLowerCase()==='owner')throw new Error('Akun owner tidak diubah melalui manajemen staf.');}
  const name=text(draft.name,'Nama staf');if(!['admin','manager','cashier','staff'].includes(draft.role))throw new Error('Peran staf tidak valid.');
  const pin=String(draft.pin||'');if(pin&&!/^\d{6}$/.test(pin))throw new Error('PIN harus tepat 6 angka.');
  const payload={name,role:draft.role,...(pin?{pin}:existing?{}:{pin:'123456'})};
  let query;
  if(existing)query=version(client.from('staff').update(payload).eq('id',existing.id).eq('outlet_id',outlet.id).neq('role','owner').is('deleted_at',null),existing);
  else query=client.from('staff').insert({...payload,id:text(draft.id,'ID staf'),outlet_id:outlet.id});
  const response=await (signal?query.select(STAFF_FIELDS).maybeSingle().abortSignal(signal):query.select(STAFF_FIELDS).maybeSingle());abort(signal);
  if(response.error){
    if(!existing&&response.error.code==='23505'){
      // A lost insert response may leave an earlier PIN saved. Do not infer
      // credential success from matching public staff fields on a retry.
      throw new Error('Pembuatan staf belum dapat dipastikan. Tutup formulir dan muat ulang daftar staf. Jika staf sudah ada, gunakan Edit staf untuk mengubah PIN.');
    }
    throw response.error;
  }
  if(!response.data)throw new Error('Staf berubah di perangkat lain. Muat ulang daftar staf.');return ownRow(response.data,outlet);
}
export async function deleteStaff(client,user,outlet,member,signal){await verifyOwner(client,user,outlet,signal);ownRow(member,outlet);if(member.role.toLowerCase()==='owner')throw new Error('Akun owner tidak dapat dihapus.');const row=await result(version(client.from('staff').update({deleted_at:new Date().toISOString()}).eq('id',member.id).eq('outlet_id',outlet.id).neq('role','owner').is('deleted_at',null),member).select(STAFF_FIELDS).maybeSingle(),signal);if(!row)throw new Error('Staf berubah atau sudah dihapus. Muat ulang.');return ownRow(row,outlet);}
export async function patchSettings(client,user,outlet,field,changes,signal,baseline){
  await verifyOwner(client,user,outlet,signal);
  if(!['profile_data','tax_config','rounding_config','receipt_data'].includes(field))throw new Error('Pengaturan tidak didukung.');
  const allowed={profile_data:['businessName','address','phone','email','wifiPassword','logoUri'],tax_config:['ppnActive','ppnRate','serviceActive','serviceRate','serviceTaxable','isInclusive'],rounding_config:['cashActive','cashMultiplier','nonCashActive','nonCashMultiplier'],receipt_data:[...RECEIPT_KEYS,'footer']}[field];
  if(!changes||Object.keys(changes).some(key=>!allowed.includes(key)))throw new Error('Kolom pengaturan tidak didukung aplikasi kasir.');
  const before=await settingsRow(client,outlet,signal);
  if(baseline&&Object.keys(changes).some(key=>JSON.stringify(before?.[field]?.[key])!==JSON.stringify(baseline[key])))throw new Error('Kolom yang Anda ubah telah diperbarui di perangkat lain. Muat ulang pengaturan.');
  const merged={...(before?.[field]||{}),...changes};
  if(field==='tax_config'){for(const key of ['ppnRate','serviceRate'])if(key in changes)merged[key]=number(changes[key],'Persentase',100);}
  return writeSettingField(client,outlet,field,merged,before,signal);
}
async function writeSettingField(client,outlet,field,value,before,signal){
  let q;
  if(before){q=client.from('settings').update({[field]:value}).eq('outlet_id',outlet.id).eq('id',before.id);q=before[field]==null?q.is(field,null):q.eq(field,JSON.stringify(before[field]));}
  else q=client.from('settings').insert({outlet_id:outlet.id,[field]:value});
  const saved=await result(q.select(SETTINGS_FIELDS).maybeSingle(),signal);if(!saved)throw new Error('Pengaturan berubah di perangkat lain. Muat ulang lalu coba lagi.');return ownRow(saved,outlet);
}
export async function savePayment(client,user,outlet,draft,existingId,signal,remove=false,baseline){
  await verifyOwner(client,user,outlet,signal);const before=await settingsRow(client,outlet,signal);
  const list=Array.isArray(before?.payment_methods)?before.payment_methods:[];
  const existing=list.find(item=>item.id===existingId);if(existingId&&!existing)throw new Error('Metode pembayaran tidak ditemukan. Muat ulang.');
  if(existing&&baseline&&JSON.stringify(existing)!==JSON.stringify(baseline))throw new Error('Metode pembayaran berubah di perangkat lain. Muat ulang sebelum menyimpan.');
  let next;
  if(remove)next=list.filter(item=>item.id!==existingId);
  else{if(!PAYMENT_TYPES.includes(draft.type))throw new Error('Kelompok pembayaran tidak valid.');const item={...existing,id:existingId||text(draft.id,'ID pembayaran'),name:text(draft.name,'Nama metode',100),type:draft.type,is_active:!!draft.is_active,customer_mdr:number(draft.customer_mdr??existing?.customer_mdr??0,'Biaya pelanggan (%)',100),merchant_mdr:number(draft.merchant_mdr??existing?.merchant_mdr??0,'Biaya merchant (%)',100)};if(list.some(other=>other.id!==item.id&&other.name.toLowerCase()===item.name.toLowerCase()))throw new Error('Nama metode sudah digunakan.');next=existing?list.map(other=>other.id===item.id?item:other):[...list,item];}
  return writeSettingField(client,outlet,'payment_methods',next,before,signal);
}
export async function uploadLogo(client,user,outlet,file,signal){
  await verifyOwner(client,user,outlet,signal);if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)throw new Error('Gunakan PNG, JPG, atau WebP maksimal 2 MB.');
  const path=`${outlet.id}/${crypto.randomUUID()}.${file.type==='image/jpeg'?'jpg':file.type.split('/')[1]}`;
  const {error}=await client.storage.from('logos').upload(path,file,{contentType:file.type,upsert:false});abort(signal);if(error)throw error;
  const {data}=client.storage.from('logos').getPublicUrl(path);if(!data?.publicUrl)throw new Error('URL logo belum tersedia.');return data.publicUrl;
}
export const CSV_COLUMNS=['Nama produk','SKU','Kategori','Satuan','Harga jual','Harga pokok','Monitor stok','Stok awal'];
export function csvCell(value){const str=String(value??'');return '"'+(/^[\s]*[=+@-]/.test(str)?"'":'')+str.replaceAll('"','""')+'"';}
export function productCsv(products,template=false){const list=template?[['Nama produk Anda','SKU-001','Kategori Anda','Pcs',25000,8000,'Tidak',0]]:products.map(p=>[p.name,p.sku,p.category,p.unit,p.price,p.buy_price||0,p.track_stock?'Ya':'Tidak','']);return '\uFEFF'+[CSV_COLUMNS,...list].map(row=>row.map(csvCell).join(',')).join('\r\n');}
export function parseCsv(source){
  const text=String(source).replace(/^\uFEFF/,'');if(text.length>2*1024*1024)throw new Error('CSV maksimal 2 MB.');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw new Error('Tanda kutip CSV tidak valid.');quoted=true;}else if(c===','){row.push(cell);cell='';closed=false;}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';closed=false;}else{if(closed&&!/\s/.test(c))throw new Error('Format CSV setelah kutip tidak valid.');if(!closed)cell+=c;}}
  if(quoted)throw new Error('Tanda kutip CSV belum ditutup.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  if(rows.length<2)throw new Error('CSV belum berisi produk.');if(rows.length>501)throw new Error('Impor maksimal 500 produk per file.');return rows;
}
export function prepareImport(source,mode,data,outletId){
  return prepareImportRows(parseCsv(source),mode,data,outletId);
}
const categoryKey=name=>String(name??'').trim().toLowerCase();
function categoryNames(categories,outletId){
  const names=new Map();
  for(const category of categories){
    if(category.outlet_id!==outletId)throw new Error('Kategori lintas outlet ditolak.');
    const key=categoryKey(category.name);
    if(names.has(key))names.set(key,null);else names.set(key,category);
  }
  return names;
}
// Both upload formats use the same validation and scoped, versioned write path.
export function prepareImportRows(table,mode,data,outletId,{xlsx=false}={}){
  if(!['add','update'].includes(mode)||data.outletId!==outletId)throw new Error('Lingkup impor tidak valid.');
  if(!Array.isArray(table)||table.length<2)throw new Error('File belum berisi produk.');
  if(table.length>501)throw new Error('Impor maksimal 500 produk per file.');
  const [header,...rows]=table;
  if(!Array.isArray(header)||!header.length||header.some(v=>typeof v!=='string'))throw new Error('Judul kolom tidak valid.');
  const names=header.map(v=>v.trim().toLowerCase());
  if(new Set(names).size!==names.length)throw new Error('Judul kolom tidak boleh duplikat.');
  const idMode=xlsx&&mode==='update';
  const allowed=idMode?[...CSV_COLUMNS.filter(c=>c!=='Stok awal'),'ID produk','Versi produk']:CSV_COLUMNS;
  const indexes=new Map(allowed.map(name=>[name,names.indexOf(name.toLowerCase())]));
  if(names.some(name=>!allowed.some(column=>column.toLowerCase()===name)))throw new Error('Ada kolom yang tidak dikenal. Gunakan template yang sesuai dengan jenis impor.');
  if(indexes.get('SKU')<0)throw new Error('Kolom SKU wajib ada.');
  if(idMode&&['ID produk','Versi produk'].some(key=>indexes.get(key)<0))throw new Error('Gunakan template Ubah Produk yang memuat ID dan versi produk.');
  if(mode==='add'&&['Nama produk','Kategori','Harga jual'].some(key=>indexes.get(key)<0))throw new Error('Tambah massal memerlukan Nama produk, SKU, Kategori, dan Harga jual.');
  const seen=new Set(),seenIds=new Set(),catalog=new Map(),byId=new Map();
  const categories=categoryNames(data.categories,outletId),newCategories=new Map();
  for(const p of data.products){
    if(p.outlet_id!==outletId)throw new Error('Katalog lintas outlet ditolak.');
    if(byId.has(String(p.id)))throw new Error('ID katalog tidak unik. Muat ulang produk.');
    byId.set(String(p.id),p);
    const sku=String(p.sku||'').trim().toLowerCase();
    if(catalog.has(sku))catalog.set(sku,null);else catalog.set(sku,p);
  }
  return rows.map((cells,index)=>{
    const line=index+2;
    if(!Array.isArray(cells)||cells.length!==header.length)throw new Error(`Baris ${line}: jumlah kolom berbeda dari judul.`);
    if(cells.some(v=>v!=null&&!['string','number','boolean'].includes(typeof v)))throw new Error(`Baris ${line}: isi sel tidak valid.`);
    const get=key=>!indexes.has(key)||indexes.get(key)<0?'':String(cells[indexes.get(key)]??'').trim();
    let existing;
    if(idMode){
      const id=text(get('ID produk'),`ID produk baris ${line}`);
      if(seenIds.has(id))throw new Error(`Baris ${line}: ID produk duplikat dalam file.`);seenIds.add(id);
      existing=byId.get(id);
      if(!existing)throw new Error(`Baris ${line}: ID produk tidak ditemukan di outlet ini. Unduh ulang template ubah.`);
      if(get('Versi produk')!==String(existing.updated_at??''))throw new Error(`Baris ${line}: produk berubah setelah template diunduh. Unduh ulang template ubah sebelum menyimpan.`);
    }
    const sku=text(get('SKU')||(idMode?existing.sku:''),`SKU baris ${line}`,100),key=sku.toLowerCase();
    if(seen.has(key))throw new Error(`Baris ${line}: SKU duplikat dalam file.`);seen.add(key);
    if(!idMode)existing=catalog.get(key);
    if(mode==='add'&&catalog.has(key))throw new Error(`Baris ${line}: SKU sudah ada. Gunakan ubah massal.`);
    if(mode==='update'&&!existing)throw new Error(`Baris ${line}: SKU tidak ditemukan atau tidak unik.`);
    if(idMode&&catalog.has(key)&&catalog.get(key)?.id!==existing.id)throw new Error(`Baris ${line}: SKU sudah dipakai produk lain di outlet ini.`);
    if(mode==='update'&&get('Stok awal'))throw new Error(`Baris ${line}: kosongkan Stok awal saat mengubah produk. Saldo stok tidak ditimpa.`);
    const draft={...(existing||{}),id:existing?.id||newId('P'),sku};
    const map={'Nama produk':'name','Kategori':'category','Satuan':'unit','Harga jual':'price','Harga pokok':'buy_price','Stok awal':'stock'};
    for(const [col,field]of Object.entries(map)){const v=get(col);if(v!==''||mode==='add')draft[field]=v===''?(['buy_price','stock'].includes(field)?0:field==='unit'?'Pcs':''):v;}
    const track=get('Monitor stok').toLowerCase();if(track&&!['ya','tidak','true','false','1','0'].includes(track))throw new Error(`Baris ${line}: Monitor stok harus Ya atau Tidak.`);if(track||mode==='add')draft.track_stock=['ya','true','1'].includes(track);
    const categoryName=text(draft.category,`Kategori baris ${line}`,100),categoryId=categoryKey(categoryName),category=categories.get(categoryId);
    if(categories.has(categoryId)&&!category)throw new Error(`Baris ${line}: nama kategori tidak unik setelah huruf besar/kecil disamakan. Rapikan kategori tersebut sebelum impor.`);
    if(category?.deleted_at)throw new Error(`Baris ${line}: kategori sudah dihapus. Gunakan kategori lain atau pulihkan kategori terlebih dahulu.`);
    let newCategory=null;
    if(category)draft.category=category.name;
    else{if(!newCategories.has(categoryId))newCategories.set(categoryId,categoryName);newCategory=newCategories.get(categoryId);draft.category=newCategory;}
    productPayload(draft,outletId,existing);return {line,outletId,draft,existing,newCategory,completed:false};
  });
}
async function importCategory(client,user,outlet,name,signal,categories){
  const key=categoryKey(name),existing=categories.get(key);
  if(categories.has(key)&&!existing)throw new Error('Nama kategori tidak unik setelah huruf besar/kecil disamakan. Rapikan kategori tersebut sebelum impor.');
  if(existing){if(existing.deleted_at)throw new Error('Kategori sudah dihapus. Gunakan kategori lain atau pulihkan kategori terlebih dahulu.');return existing.name;}
  // The stable database key is outlet/name, not a generated ID. Re-read it on
  // retries so a committed insert with a lost response never creates a copy.
  await verifyOwner(client,user,outlet,signal);
  const payload={name:text(name,'Kategori',100),outlet_id:outlet.id,sort_order:0};
  const query=client.from('categories').insert(payload).select('name,outlet_id,sort_order,deleted_at').single();
  const response=await (signal?query.abortSignal(signal):query);abort(signal);
  if(!response.error){const row=ownRow(response.data,outlet);if(row.name!==payload.name||row.deleted_at)throw new Error('Kategori tersimpan belum dapat diverifikasi. Muat ulang katalog.');categories.set(key,row);return row.name;}
  if(response.error.code==='23505'){
    // Another request may have inserted it since the first scoped read. Never
    // upsert: a legacy global name key must not transfer another outlet's row.
    const current=categoryNames(await rows(client,'categories','name,outlet_id,sort_order,deleted_at',outlet,signal,'name',20000,false),outlet.id);
    const found=current.get(key);
    if(found&&!found.deleted_at){categories.set(key,found);return found.name;}
    throw new Error('Kategori belum dapat dibuat di outlet ini karena nama berbenturan atau sudah dihapus. Muat ulang kategori atau gunakan nama lain.');
  }
  throw new Error('Kategori belum dapat dipastikan tersimpan. Coba Simpan impor lagi; kategori yang sudah tersimpan akan digunakan kembali.');
}
export async function runImport(client,user,outlet,entries,signal,onProgress=()=>{}){
  if(!Array.isArray(entries)||!entries.length||entries.length>500)throw new Error('Jumlah baris impor tidak valid.');
  scope(user,outlet);abort(signal);
  for(const entry of entries){if(entry.outletId!==undefined&&entry.outletId!==outlet.id||entry.draft?.outlet_id!==undefined&&entry.draft.outlet_id!==outlet.id||entry.existing&&entry.existing.outlet_id!==outlet.id)throw new Error('Rencana impor lintas outlet ditolak.');}
  const failed=[];let completed=entries.filter(row=>row.completed).length,categories;
  for(const entry of entries){abort(signal);if(entry.completed)continue;try{
    if(entry.newCategory){
      if(!categories){await verifyOwner(client,user,outlet,signal);categories=categoryNames(await rows(client,'categories','name,outlet_id,sort_order,deleted_at',outlet,signal,'name',20000,false),outlet.id);}
      entry.draft.category=await importCategory(client,user,outlet,entry.newCategory,signal,categories);
    }
    await saveProduct(client,user,outlet,entry.draft,entry.existing,signal);entry.completed=true;completed++;
  }catch(error){if(error.name==='AbortError')throw error;failed.push({line:entry.line,message:error.message||'Gagal menyimpan'});break;}onProgress({completed,total:entries.length});}
  return {completed,total:entries.length,failed};
}

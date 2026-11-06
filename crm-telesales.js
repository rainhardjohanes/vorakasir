// Public presentation and validation only. Every ownership/contact decision is enforced by the CRM RPCs.
import {esc, date} from '/crm-model.js';
export const LEAD_STAGES = {new:'Belum dihubungi',contacting:'Sedang ditangani',interested:'Tertarik',meeting_scheduled:'Meeting terjadwal',meeting_completed:'Meeting selesai',follow_up:'Perlu follow-up',not_interested:'Tidak tertarik',converted:'Sudah berlangganan',invalid:'Nomor/usaha tidak valid',unreachable:'Belum terhubung'};
export const LEAD_LISTS = {normal:'Normal',whitelist:'Whitelist · boleh dihubungi',blacklist:'Blacklist · jangan dihubungi'};
export const CALL_GROUPS = [
  ['Sambungan telepon',{no_answer:'Tidak diangkat',unreachable:'Tidak dapat dihubungi',number_inactive:'Nomor tidak aktif',wrong_number:'Salah nomor',busy:'Sedang sibuk',call_rejected:'Panggilan ditolak',voicemail:'Masuk pesan suara'}],
  ['Belum bertemu pengambil keputusan',{callback_requested:'Minta dihubungi kembali',owner_unavailable:'Pemilik belum tersedia',gatekeeper:'Diterima staf / resepsionis'}],
  ['Kebutuhan & ketertarikan',{already_has_pos:'Sudah memakai sistem kasir',needs_information:'Minta informasi lebih lanjut',send_whatsapp:'Minta informasi melalui WhatsApp',interested:'Tertarik dengan VORA',meeting_requested:'Tertarik meeting / demo',meeting_scheduled:'Meeting / demo sudah dijadwalkan',meeting_completed:'Meeting / demo sudah terlaksana',trial_started:'Sudah mulai mencoba VORA',purchased:'Sudah membeli langganan'}],
  ['Tidak dilanjutkan',{not_interested:'Tidak tertarik',do_not_contact:'Minta tidak dihubungi lagi',business_closed:'Usaha sudah tutup',other:'Respon lainnya'}]
];
export const CALL_OUTCOMES=Object.assign({},...CALL_GROUPS.map(([,values])=>values));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controls=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
export function normalizeLeadPhone(value){
  const raw=String(value??'').trim();
  if (!raw || /[^+\d\s().-]/.test(raw) || (raw.match(/\+/g)||[]).length>1 || (raw.includes('+')&&!raw.startsWith('+'))) throw Error('Isi nomor telepon Indonesia yang benar.');
  let phone=raw.replace(/\D/g,'');
  if(phone.startsWith('0'))phone='62'+phone.slice(1);
  else if(phone.startsWith('8'))phone='62'+phone;
  else if(!phone.startsWith('62'))throw Error('Awali nomor dengan 0 atau +62.');
  if(!/^62[1-9]\d{6,12}$/.test(phone))throw Error('Nomor telepon belum lengkap atau terlalu panjang.');
  return phone;
}
function text(value,label,max,required=false){const s=String(value??'').trim();if((required&&!s)||s.length>max||controls.test(s))throw Error(`${label}${required?' wajib diisi dan':''} maksimal ${max.toLocaleString('id-ID')} karakter.`);return s;}
export function leadPayload(values,operationId,lead=null,{manageAssignments=false}={}){
  if(!UUID.test(String(operationId)))throw Error('Permintaan tidak valid. Muat ulang halaman.');
  const store_name=text(values.store_name,'Nama toko',150,true),phone=normalizeLeadPhone(values.phone),category=text(values.category,'Jenis usaha',100),city=text(values.city,'Kota / area',100),notes=text(values.notes,'Catatan',3000);
  if(lead&&normalizeLeadPhone(lead.phone_normalized||lead.phone)!==phone)throw Error('Nomor tidak dapat diganti agar riwayatnya tetap terjaga. Buat prospek terpisah untuk nomor lain.');
  const stage=values.stage||lead?.stage||'new',list_status=values.list_status||lead?.list_status||'normal';
  if(!Object.hasOwn(LEAD_STAGES,stage)||!Object.hasOwn(LEAD_LISTS,list_status))throw Error('Pilih status prospek yang tersedia.');
  if(lead&&!manageAssignments){
    if(lead.list_status==='blacklist'&&list_status!=='blacklist')throw Error('Hanya owner atau admin yang dapat membuka kembali blacklist.');
    if(['not_interested','converted','invalid'].includes(lead.stage)&&stage!==lead.stage)throw Error('Hanya owner atau admin yang dapat membuka kembali prospek ini.');
  }
  let assigned_telesales_id=manageAssignments?(values.assigned_telesales_id||null):(lead?.assigned_telesales_id||null);
  if(assigned_telesales_id&&!UUID.test(String(assigned_telesales_id)))throw Error('Pilih telesales yang tersedia.');
  return {p_operation_id:operationId,p_id:lead?.id||null,p_expected_updated_at:lead?.updated_at||null,p_lead:{store_name,phone,category,city,stage,list_status,notes,assigned_telesales_id}};
}
export function callPayload(values,operationId,lead,claimId){
  if(!UUID.test(String(operationId))||!UUID.test(String(lead?.id))||!UUID.test(String(claimId)))throw Error('Sesi telepon belum siap. Mulai telepon dari data terbaru.');
  const outcome=String(values.outcome||'');
  if(!Object.hasOwn(CALL_OUTCOMES,outcome))throw Error('Pilih respon setelah telepon.');
  const note=text(values.note,'Catatan panggilan',3000),raw=String(values.followup_at||'').trim();
  if(outcome==='other'&&!note)throw Error('Tuliskan respon yang diterima pada kolom catatan.');
  if(['callback_requested','meeting_scheduled'].includes(outcome)&&!raw)throw Error('Tentukan jadwal untuk dihubungi kembali / meeting.');
  let followup=null;
  if(raw){const d=new Date(raw);if(!Number.isFinite(+d))throw Error('Jadwal tidak valid.');followup=d.toISOString();}
  if(['do_not_contact','not_interested','purchased','business_closed','wrong_number','number_inactive'].includes(outcome)&&followup)throw Error('Kosongkan jadwal tindak lanjut untuk hasil telepon ini.');
  return {p_operation_id:operationId,p_id:lead.id,p_claim_id:claimId,p_outcome:outcome,p_note:note,p_followup_at:followup,p_expected_updated_at:lead.updated_at};
}
export function leadError(error){
  const code=error?.code;
  if(code==='23505')return 'Nomor ini sudah tercatat. Cari nomor tersebut di daftar. Jika ditangani telesales lain, minta owner atau admin memeriksa penugasannya.';
  if(['PT409','PT412','PT423','PT429','PT403','40001'].includes(code))return error?.message&& !/SQL|relation|constraint|function|postgres|stack/i.test(error.message)?error.message:'Data atau penanganan nomor sudah berubah. Perbarui data sebelum melanjutkan.';
  if(code==='42501')return 'Akses prospek ini tidak tersedia. Perbarui halaman atau hubungi owner.';
  if(['PGRST202','42883'].includes(code))return 'Ruang kerja telesales belum siap. Hubungi owner.';
  if(error instanceof TypeError||/fetch|network|abort/i.test(error?.message||''))return 'Koneksi terputus. Periksa hasil permintaan yang sama sebelum mengulang.';
  return error?.message||'Prospek belum dapat disimpan. Silakan coba kembali.';
}
export const leadBadge=(value,labels=LEAD_STAGES)=>`<span class="lead-status ${esc(value)}">${esc(labels[value]||'Belum tersedia')}</span>`;
export function callOptions(selected=''){return `<option value="">Pilih respon setelah telepon</option>${CALL_GROUPS.map(([label,values])=>`<optgroup label="${esc(label)}">${Object.entries(values).map(([key,label])=>`<option value="${key}" ${selected===key?'selected':''}>${esc(label)}</option>`).join('')}</optgroup>`).join('')}`;}
export function leadOptions(values,selected,{emptyLabel=null}={}){return `${emptyLabel!==null?`<option value="all">${esc(emptyLabel)}</option>`:''}${Object.entries(values).map(([key,label])=>`<option value="${key}" ${selected===key?'selected':''}>${esc(label)}</option>`).join('')}`;}
export function leadContactHint(lead){
  if(lead.list_status==='blacklist')return 'Jangan dihubungi. Nomor masuk blacklist.';
  if(lead.stage==='not_interested')return 'Tidak tertarik. Hubungi kembali hanya setelah owner atau admin membuka statusnya.';
  if(lead.stage==='converted')return 'Sudah berlangganan. Tidak masuk antrean telepon penawaran.';
  if(lead.stage==='invalid')return 'Nomor atau usaha tidak valid. Owner atau admin perlu memeriksa sebelum dibuka kembali.';
  const reasons={blacklist:'Jangan dihubungi. Nomor masuk blacklist.',stopped:'Prospek dihentikan. Owner atau admin perlu membuka kembali statusnya.',claimed:'Nomor sedang ditangani telesales lain. Periksa kembali setelah sesi berakhir.',scheduled:'Jadwal tindak lanjut belum tiba.',cooldown:'Masih dalam jeda panggilan. Hindari menelepon berulang.'};
  return reasons[lead.contact_block_reason]|| (lead.can_contact?'Siap dihubungi':'Belum dapat dihubungi. Perbarui data untuk memeriksa penanganannya.');
}
export function leadHistory(calls=[]){return calls.length?`<ol class="lead-timeline">${calls.map(c=>`<li><div>${leadBadge(c.outcome,CALL_OUTCOMES)}</div><p>${esc(c.note||'Tanpa catatan tambahan.')}</p>${c.followup_at?`<p class="lead-followup-date">Jadwal: ${esc(date(c.followup_at,true))}</p>`:''}<small>${esc(date(c.created_at,true))} · ${esc(c.actor_name||c.actor_email||'Tim VORA')}</small></li>`).join('')}</ol>`:'<div class="lead-history-empty">Belum ada panggilan tercatat untuk nomor ini.</div>';}

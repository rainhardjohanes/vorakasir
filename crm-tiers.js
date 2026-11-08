import { esc, date, renewalPayload } from '/crm-model.js';

export const canManageTier = session => session?.member?.active === true && ['owner','admin'].includes(session.member.role);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function validateEntitlement(value,outletId) {
  if (!value || value.outlet_id !== outletId || !['starter','premium'].includes(value.tier) || !Number.isSafeInteger(value.version) || value.version < 0 || !['default','trial','assigned','rollout_pending'].includes(value.source) || typeof value.pilot_enabled !== 'boolean' || typeof value.subscription_active !== 'boolean' || typeof value.features?.special_pricing !== 'boolean' || typeof value.features?.staff_commissions !== 'boolean') throw new TypeError('Status paket fitur belum dapat dibaca lengkap. Muat ulang.');
  return value;
}
export function tierPayload(values,entitlement,operationId) {
  validateEntitlement(entitlement,values.outlet);
  if(entitlement.pilot_enabled!==true)throw new TypeError('Paket fitur belum dibuka untuk outlet ini.');
  if (!uuid(operationId) || !uuid(values.outlet) || !['starter','premium'].includes(values.tier)) throw new TypeError('Pilihan paket fitur tidak valid.');
  const note=String(values.note||'').trim();
  if(!note || note.length>2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(note)) throw new TypeError('Isi alasan perubahan, maksimal 2.000 karakter.');
  return {p_outlet_id:values.outlet,p_operation_id:operationId,p_tier:values.tier,p_expected_version:entitlement.version,p_note:note};
}
// Paid renewal has its own atomic contract. A non-pilot outlet can select a
// package here; the separate feature-only editor retains its pilot restriction.
export function renewalTierPayload(values, entitlement, operationId, session, outlet) {
  if (!canManageTier(session)) throw new TypeError('Hanya pemilik atau admin CRM yang dapat memilih paket fitur.');
  validateEntitlement(entitlement, outlet?.id);
  if (!uuid(operationId) || !uuid(outlet?.id) || values.outlet !== outlet.id || !['starter', 'premium'].includes(values.tier)) throw new TypeError('Pilih paket Starter atau Premium untuk outlet ini.');
  return {...renewalPayload(values, operationId),
    p_expected_end_date: outlet.subscription_end_date || null,
    p_expected_plan: outlet.subscription_plan || null,
    p_tier: values.tier, p_expected_tier: entitlement.tier, p_expected_version: entitlement.version,
    p_activate_paid_outlet: values.tier === 'premium'};
}
export function validateTierRenewalResult(result, payload) {
  const r = result?.renewal, e = validateEntitlement(result?.entitlement, payload.p_outlet_id);
  const deadline = new Date(r?.new_subscription_end_date).getTime();
  const oldDeadline = payload.p_expected_end_date == null ? null : new Date(payload.p_expected_end_date).getTime();
  const sameOldDate = payload.p_expected_end_date == null ? r?.old_subscription_end_date == null : new Date(r?.old_subscription_end_date).getTime() === oldDeadline;
  if (!r || typeof result.replayed !== 'boolean' || typeof result.server_now !== 'string' || !Number.isFinite(new Date(result.server_now).getTime()) ||
    r.operation_id !== payload.p_operation_id || r.outlet_id !== payload.p_outlet_id || r.months !== payload.p_months ||
    r.amount_idr !== payload.p_amount_idr || r.payment_reference !== payload.p_payment_reference || r.note !== payload.p_note ||
    r.old_subscription_plan !== payload.p_expected_plan || !sameOldDate || typeof r.new_subscription_end_date !== 'string' || !Number.isFinite(deadline) ||
    (oldDeadline !== null && (!Number.isFinite(oldDeadline) || deadline <= oldDeadline)) ||
    r.new_subscription_plan !== ({1:'Monthly',12:'Annual',24:'Biennial'}[payload.p_months]) ||
    result.tier !== payload.p_tier || result.previous_tier !== payload.p_expected_tier || result.previous_version !== payload.p_expected_version ||
    e.tier !== payload.p_tier || e.version !== payload.p_expected_version + 1 ||
    (payload.p_tier === 'premium' && (!e.pilot_enabled || !e.subscription_active || !e.features.special_pricing || !e.features.staff_commissions))) {
    throw new TypeError('Konfirmasi langganan dan paket belum cocok. Periksa kembali permintaan yang sama.');
  }
  return result;
}
export function tierError(error) {
  if(error?.code==='PT409')return 'Paket sudah diubah oleh admin lain. Muat ulang status sebelum mencoba kembali.';
  if(error?.code==='PGRST202')return 'Pengaturan paket fitur belum tersedia pada server ini.';
  if(error instanceof TypeError)return error.message;
  return 'Hasil perubahan belum dapat dipastikan. Periksa kembali permintaan yang sama.';
}
export function tierBody(m) {
  if(!m.entitlement)return m.error?`<div class="error" role="alert">${esc(m.error)}</div>`:'<p role="status">Memuat paket fitur outlet…</p>';
  if(m.entitlement.pilot_enabled!==true)return '<div class="notice">Paket fitur baru masih dalam uji terbatas. Outlet ini tetap menggunakan fitur yang sudah tersedia; masa aktif dan data usahanya tidak berubah.</div>';
  const e=m.entitlement,disabled=m.busy||m.uncertain||m.conflict||m.saved;
  return `<div class="notice">Paket fitur terpisah dari durasi langganan. Perubahan ini tidak menambah masa aktif, tidak mencatat pembayaran, dan tidak mengubah harga langganan.</div><dl class="detail-grid"><div class="datum"><dt>Paket saat ini</dt><dd>${e.tier==='premium'?'Premium':'Starter'}${e.source==='trial'?' · Trial':''}</dd></div><div class="datum"><dt>Masa aktif tetap</dt><dd>${esc(date(m.outlet.subscription_end_date,true))}</dd></div></dl>${e.legacy_special_pricing?'<p class="notice">Hak harga spesial khusus yang sudah diberikan tetap dipertahankan.</p>':''}${m.saved?'<div class="notice">Paket fitur berhasil diperbarui dan tercatat pada audit. Masa aktif outlet tetap sama.</div>':`<form id="tier-form" class="stack"><label class="field">Paket fitur<select name="tier" ${disabled?'disabled':''}><option value="starter" ${(m.values?.tier||e.tier)==='starter'?'selected':''}>Starter — fitur dasar yang sudah tersedia</option><option value="premium" ${(m.values?.tier||e.tier)==='premium'?'selected':''}>Premium — harga spesial & komisi staf</option></select></label><label class="field">Alasan perubahan<textarea name="note" maxlength="2000" required ${disabled?'readonly':''} placeholder="Contoh: upgrade disetujui pemilik">${esc(m.values?.note||'')}</textarea></label><label class="check-line"><input type="checkbox" required name="confirmed" ${disabled?'disabled checked':''}><span>Saya sudah memeriksa outlet dan paket fitur yang dipilih.</span></label></form>`}${m.error?`<div class="error" role="alert">${esc(m.error)}</div>`:''}${m.uncertain?'<p class="notice warning">Jangan buat perubahan baru. Tombol Periksa kembali mengirim ID permintaan dan isi yang sama agar tidak menggandakan perubahan.</p>':''}`;
}

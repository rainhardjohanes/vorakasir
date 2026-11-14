import { verifyOwner } from '/dashboard-operations-data.js';
import { collect } from '/dashboard-data.js';
import { normalizeUnpaidOrder, unpaidOrdersSummary } from '/dashboard-unpaid-orders-model.js';

// Existing orders schema only: no fictional cashier/created_at/order_number.
export const UNPAID_ORDER_FIELDS='id,outlet_id,name,date,status,items,total,cart_data,customer,order_type,ojek_code,discount,promo_id,payment_surcharge,mdr_fee';
export async function loadUnpaidOrders(client,user,outlet,signal) {
  await verifyOwner(client,user,outlet,signal);
  const rows=await collect(()=>client.from('orders').select(UNPAID_ORDER_FIELDS).eq('outlet_id',outlet.id).eq('status','unpaid'),
    row=>row.outlet_id===outlet.id&&row.status==='unpaid',signal);
  const orders=rows.map(row=>normalizeUnpaidOrder(row,outlet.id));
  return {outletId:outlet.id,loadedAt:new Date().toISOString(),orders,summary:unpaidOrdersSummary(orders),complete:true,
    warnings:['Hanya pesanan belum lunas yang sudah diterima server ditampilkan. Pesanan yang belum tersinkron dari perangkat belum tersedia di dashboard.',
      'Data pesanan dapat berubah saat operasional berlangsung. Muat ulang untuk mengambil kondisi terbaru. Pesanan ini tidak ditambahkan ke angka penjualan lunas atau komisi.']};
}

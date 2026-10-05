'use strict';

const tourContent = {
  kasir: {count:'01 / PESANAN LEBIH TERTATA',name:'Kasir',title:'Layani pesanan. Jaga alurnya.',description:'Dine in, takeaway, hingga pencatatan pesanan ojek online. Siapkan menu, pilih ekstra, lalu lanjutkan ke pembayaran.',image:'kasir-tablet.png',alt:'Kasir VORA POS dengan katalog produk dan keranjang pesanan — data demo',items:['Simpan & buka kembali pesanan','Split bill per item atau nominal','Scan barcode lewat kamera','Catat tunai & metode non-tunai']},
  stok: {count:'02 / PRODUK DALAM KENDALI',name:'Produk & stok',title:'Tahu stoknya. Paham pergerakannya.',description:'Atur katalog produk, kategori, harga, dan HPP. Catat pembelian stok, periksa persediaan fisik, lalu telusuri perubahannya.',image:'inventory.png',alt:'Pengelolaan persediaan VORA POS dengan tab pembelian, opname, dan log — data demo',items:['Katalog, SKU & kategori produk','Ekstra pilihan tunggal atau lebih dari satu','Pembelian stok & opname','Kartu stok dan riwayat pergerakan']},
  laporan: {count:'03 / HASIL USAHA TERBACA',name:'Laporan penjualan',title:'Bukan hanya ramai. Tahu hasilnya.',description:'Lihat ringkasan penjualan, produk terlaris, refund, serta metode pembayaran. Gunakan angka yang tercatat untuk memahami pola usaha.',image:'laporan.png',alt:'Laporan penjualan VORA POS dengan grafik harian, metode pembayaran, dan produk terlaris — data demo',items:['Penjualan kotor & bersih','Grafik penjualan harian','Rincian metode pembayaran','Produk terlaris & riwayat transaksi']},
  laba: {count:'04 / BIAYA JUGA TERCATAT',name:'Biaya & laba',title:'Omzet terlihat. Biaya tidak terlewat.',description:'Catat biaya usaha dari kas laci, rekening, atau dana owner. Tinjau laba operasional berdasarkan penjualan, HPP, dan biaya yang sudah dicatat.',image:'laba-rugi.png',alt:'Laporan laba operasional VORA POS dengan HPP, biaya transaksi, dan biaya usaha — data demo',items:['Pencatatan biaya gaji, sewa & lainnya','Sumber dana biaya yang terpisah','Rincian HPP & biaya pembayaran','Koreksi biaya dengan jejak perubahan']}
};

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#main-nav');
function closeMenu() { navigation.classList.remove('open'); menuButton.setAttribute('aria-expanded','false'); menuButton.setAttribute('aria-label','Buka menu'); }
menuButton.addEventListener('click',()=>{const open=menuButton.getAttribute('aria-expanded')!=='true';navigation.classList.toggle('open',open);menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'Tutup menu':'Buka menu');});
navigation.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && menuButton.getAttribute('aria-expanded')==='true'){closeMenu();menuButton.focus();}});
document.addEventListener('click',event=>{if(!event.target.closest('.site-header'))closeMenu();});
window.matchMedia('(min-width: 701px)').addEventListener('change',event=>{if(event.matches)closeMenu();});

function selectTour(key) {
  const content=tourContent[key]; if(!content)return;
  document.querySelectorAll('[data-tour]').forEach(button=>{const active=button.dataset.tour===key;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  document.querySelector('#tour-count').textContent=content.count;
  document.querySelector('#tour-window-title').textContent=content.name;
  document.querySelector('#tour-title').textContent=content.title;
  document.querySelector('#tour-description').textContent=content.description;
  const list=document.querySelector('#tour-list');
  list.replaceChildren(...content.items.map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));
  const image=document.querySelector('#tour-image');image.src=content.image;image.alt=content.alt;
}
document.querySelectorAll('[data-tour]').forEach(button=>button.addEventListener('click',()=>selectTour(button.dataset.tour)));
document.querySelectorAll('[data-tour-link]').forEach(link=>link.addEventListener('click',()=>selectTour(link.dataset.tourLink)));

// Use native form submission: a user click opens WhatsApp, never sends a message.
const form=document.querySelector('#demo-form');
form.addEventListener('submit',event=>{
  const business=document.querySelector('#business-name').value.trim();
  if(!business){event.preventDefault();const input=document.querySelector('#business-name');input.setCustomValidity('Masukkan nama usaha Anda.');input.reportValidity();return;}
  const message=`Halo VORA, saya ingin konsultasi dan demo.\n\nNama usaha: ${business}\nJenis usaha: ${document.querySelector('#business-type').value}\nPilihan: ${document.querySelector('#package').value}\n\nBoleh minta detail fitur, paket, dan aktivasinya?`;
  let text=form.querySelector('input[name="text"]');
  if(!text){text=document.createElement('input');text.type='hidden';text.name='text';form.append(text);}
  text.value=message;
  form.querySelectorAll('input:not([type="hidden"]),select').forEach(input=>input.removeAttribute('name'));
});
document.querySelector('#business-name').addEventListener('input',event=>event.target.setCustomValidity(''));

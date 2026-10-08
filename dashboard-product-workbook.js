// Local-only XLSX handling. Workbook metadata is an accident-prevention check;
// authorization and product versions must still be checked against live outlet data.
let enginePromise;
const loadEngine = () => (enginePromise ||= import('/dashboard-vendor-excel-workbook.js'));

export const PRODUCT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PRODUCT_ADD_COLUMNS = Object.freeze(['Nama produk', 'SKU', 'Kategori', 'Satuan', 'Harga jual', 'Harga pokok', 'Monitor stok', 'Stok awal']);
export const PRODUCT_UPDATE_COLUMNS = Object.freeze(['ID produk', ...PRODUCT_ADD_COLUMNS.slice(0, -1), 'Versi produk']);
export const PRODUCT_WORKBOOK_LIMITS = Object.freeze({ fileBytes: 5 * 1024 * 1024, expandedBytes: 12 * 1024 * 1024, importRows: 500, exportRows: 20000 });
const META_NAME = '_VORA';
const FORMAT = 'VORA_PRODUCT_XLSX';
const SCHEMA = '1';
const EXAMPLE_NAME = '[CONTOH] Kopi Susu';
const EXAMPLE_SKU = 'CONTOH-001';
const textDecoder = new TextDecoder('utf-8', { fatal: true });
const theme = { dark: 'FF10251F', green: 'FF00B887', ink: 'FF17221F', line: 'FFDDE8E2', pale: 'FFF0F7F3' };
const message = detail => new Error(detail);

function normalizedMode(mode) {
  if (!['add', 'update', 'export'].includes(mode)) throw message('Jenis template produk tidak valid.');
  return mode === 'export' ? 'update' : mode;
}
function ownRows(rows, outletId, label) {
  if (!Array.isArray(rows) || rows.some(row => !row || row.outlet_id !== outletId)) throw message(`${label} lintas outlet ditolak. Muat ulang katalog outlet ini.`);
  return rows.filter(row => !row.deleted_at);
}
function literal(value) { return value == null ? '' : String(value); }
function finiteNumber(value, field) {
  if (value == null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw message(`${field} pada katalog tidak valid. Periksa produk sebelum mengunduh template.`);
  return number;
}
function headerStyle(sheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2', showGridLines: false }];
  sheet.getRow(1).height = 34;
  sheet.getRow(1).eachCell(cell => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.dark } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(2, sheet.rowCount), column: sheet.columnCount } };
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    row.height = 24;
    row.eachCell(cell => {
      cell.font = { name: 'Aptos', size: 11, color: { argb: theme.ink } };
      cell.alignment = { vertical: 'middle', wrapText: false };
      if (index % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.pale } };
    });
  });
}

export async function createProductWorkbook({ mode, outlet, products = [], categories = [] }) {
  const templateMode = normalizedMode(mode);
  if (!outlet?.id || typeof outlet.id !== 'string') throw message('Pilih outlet sebelum mengunduh template.');
  const catalog = ownRows(products, outlet.id, 'Produk');
  const groups = ownRows(categories, outlet.id, 'Kategori');
  if (catalog.length > PRODUCT_WORKBOOK_LIMITS.exportRows || groups.length > PRODUCT_WORKBOOK_LIMITS.exportRows) throw message('Katalog terlalu besar untuk ekspor ini. Hubungi dukungan; data tidak dipotong.');
  if (templateMode === 'update' && catalog.some(product => typeof product.id !== 'string' || !product.id)) throw message('ID produk pada katalog tidak valid. Muat ulang sebelum mengunduh.');
  const { Workbook } = await loadEngine();
  const workbook = new Workbook();
  workbook.creator = 'VORA Kasir';
  workbook.title = templateMode === 'add' ? 'VORA Kasir — Tambah Produk' : 'VORA Kasir — Ubah Produk';
  workbook.subject = 'Template produk untuk outlet yang dipilih';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Produk', { properties: { defaultRowHeight: 24, tabColor: { argb: theme.green } } });
  const columns = templateMode === 'add' ? PRODUCT_ADD_COLUMNS : PRODUCT_UPDATE_COLUMNS;
  const widths = { 'ID produk': 39, 'Nama produk': 34, SKU: 24, Kategori: 25, Satuan: 15, 'Harga jual': 18, 'Harga pokok': 18, 'Monitor stok': 18, 'Stok awal': 16, 'Versi produk': 34 };
  const numerical = new Set(['Harga jual', 'Harga pokok', 'Stok awal']);
  sheet.columns = columns.map(header => ({ header, key: header, width: widths[header], hidden: header === 'Versi produk', style: { numFmt: numerical.has(header) ? (header === 'Stok awal' ? '0' : '#,##0.00') : '@' } }));
  if (templateMode === 'update') {
    for (const product of catalog) sheet.addRow({
      'ID produk': product.id, 'Nama produk': literal(product.name), SKU: literal(product.sku), Kategori: literal(product.category), Satuan: literal(product.unit || 'Pcs'),
      'Harga jual': finiteNumber(product.price, 'Harga jual'), 'Harga pokok': finiteNumber(product.buy_price, 'Harga pokok'),
      'Monitor stok': product.track_stock ? 'Ya' : 'Tidak', 'Versi produk': literal(product.updated_at),
    });
  } else {
    sheet.addRow({ 'Nama produk': EXAMPLE_NAME, SKU: EXAMPLE_SKU, Kategori: 'Minuman', Satuan: 'Cup', 'Harga jual': 18000, 'Harga pokok': 8000, 'Monitor stok': 'Ya', 'Stok awal': 20 });
  }
  const editableRows = templateMode === 'add' ? 501 : Math.max(2, Math.min(501, sheet.rowCount));
  for (let index = 2; index <= editableRows; index++) {
    const row = sheet.getRow(index);
    // Persist a text cell even in blank add rows so Excel preserves barcode zeros.
    if (templateMode === 'add') { if (index > 2) row.getCell('SKU').value = ''; row.getCell('SKU').numFmt = '@'; }
    row.getCell('Monitor stok').dataValidation = { type: 'list', allowBlank: templateMode === 'add', formulae: ['"Ya,Tidak"'], showErrorMessage: true, errorTitle: 'Pilihan belum sesuai', error: 'Pilih Ya atau Tidak.' };
    for (const field of ['Harga jual', 'Harga pokok', ...(templateMode === 'add' ? ['Stok awal'] : [])]) row.getCell(field).dataValidation = { type: field === 'Stok awal' ? 'whole' : 'decimal', operator: 'between', formulae: [0, field === 'Stok awal' ? 2147483647 : 1000000000000], allowBlank: field !== 'Harga jual', showErrorMessage: true, errorTitle: 'Angka belum sesuai', error: 'Isi angka nol atau lebih, tanpa Rp atau rumus.' };
  }
  headerStyle(sheet);
  if (templateMode === 'add') sheet.getRow(2).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4D6' } };
  });
  const guidance = workbook.addWorksheet('Petunjuk', { properties: { tabColor: { argb: theme.green } } });
  guidance.columns = [{ header: 'VORA KASIR', width: 29 }, { header: templateMode === 'add' ? 'PANDUAN TAMBAH PRODUK' : 'PANDUAN UBAH PRODUK', width: 100 }];
  const directions = [
    ['Outlet', literal(outlet.name || outlet.id)],
    ['Diunduh pada', new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Makassar' }).format(workbook.created) + ' WITA'],
    ['Mulai di sheet Produk', templateMode === 'add' ? 'Baris 2 berisi satu produk CONTOH. Ganti datanya dengan produk Anda atau hapus baris tersebut. Nama bertanda [CONTOH] dan SKU CONTOH-001 harus diganti agar contoh tidak ikut tersimpan.' : 'Produk aktif outlet ini sudah terisi. Sisakan baris yang akan diubah; menghapus baris dari file tidak menghapus produk di aplikasi.'],
    ['Batas impor', 'Maksimal 500 produk dan 5 MB per unggahan. Katalog lebih besar tetap diekspor utuh; bagi menjadi beberapa file dengan sheet Petunjuk, Kategori, dan _VORA tetap disertakan.'],
    ['Kolom wajib', templateMode === 'add' ? 'Nama produk, SKU, Kategori, dan Harga jual wajib diisi. Satuan kosong menggunakan Pcs; Harga pokok dan Stok awal kosong menggunakan 0.' : 'ID produk dan Versi produk adalah identitas serta versi saat diunduh. Jangan mengubahnya. Kolom Versi produk disembunyikan agar tidak teredit.'],
    ['SKU', 'Gunakan format sel Teks, terutama barcode dengan nol di depan atau lebih dari 15 digit. Jangan gunakan rumus.'],
    ['Kategori', 'Gunakan nama pada sheet Kategori atau tulis kategori baru. Kategori baru ditampilkan pada pratinjau dan dibuat hanya untuk outlet terpilih setelah Anda menyetujui simpan impor.'],
    ['Angka', 'Harga ditulis sebagai angka tanpa Rp. Nilai 0 adalah nilai sah. Stok awal harus berupa bilangan bulat.'],
    ['Monitor stok', 'Isi Ya atau Tidak. Mengubah Monitor stok tidak mengubah saldo stok produk yang sudah ada.'],
    ['Saldo stok', templateMode === 'add' ? 'Stok awal hanya berlaku saat membuat produk baru dan Monitor stok = Ya.' : 'Saldo stok tidak disertakan sebagai kolom yang dapat diubah. Gunakan pembelian atau opname untuk menyesuaikan stok.'],
    ['Data lain', 'Ekstra, foto, ikon, favorit, dan riwayat transaksi tidak diubah oleh template ini.'],
    ['Format aman', 'Gunakan .xlsx. Jangan mengubah judul kolom atau menambahkan makro, rumus, tautan eksternal, gambar, atau sheet lain. Jangan menyalin file ke outlet lain.'],
    ['Produk berubah di perangkat lain', 'Unduh ulang template jika produk berubah sejak file ini dibuat, lalu terapkan perubahan pada file terbaru.'],
    ['Setelah mengunggah', 'Periksa pratinjau perubahan di dashboard sebelum menyimpan. File yang diunduh tidak mengubah data aplikasi.'],
  ];
  guidance.addRows(directions);
  headerStyle(guidance);
  guidance.autoFilter = undefined;
  guidance.eachRow((row, index) => { if (index > 1) { row.height = index === 4 || index === 5 ? 60 : 44; row.eachCell(cell => { cell.alignment = { vertical: 'middle', wrapText: true }; }); } });
  const categorySheet = workbook.addWorksheet('Kategori');
  categorySheet.columns = [{ header: 'Kategori tersedia', width: 48 }];
  for (const name of [...new Set(groups.map(group => literal(group.name)))].sort((a, b) => a.localeCompare(b, 'id'))) categorySheet.addRow([name]);
  headerStyle(categorySheet);
  const metadata = workbook.addWorksheet(META_NAME, { state: 'veryHidden' });
  metadata.addRows([['format', FORMAT], ['schema', SCHEMA], ['mode', templateMode], ['outlet_id', outlet.id]]);
  return new Uint8Array(await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true }));
}

// XLSX is a ZIP archive. Validate advertised AND actual expanded sizes before
// handing it to ExcelJS, whose ZIP loader otherwise accepts unbounded expansion.
const crcTable = Uint32Array.from({ length: 256 }, (_, number) => {
  let value = number;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; }
function zipError() { return message('File Excel rusak atau formatnya tidak didukung. Unduh template .xlsx VORA Kasir yang baru.'); }
function safeXml(bytes, name) {
  let xml;
  try { xml = textDecoder.decode(bytes); } catch { throw zipError(); }
  if (/\0|<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) throw message('File berisi struktur XML yang tidak diizinkan. Gunakan template .xlsx VORA Kasir.');
  if (/<(?:[A-Za-z_][\w.-]*:)?f(?:\s|\/?>)/i.test(xml)) throw message('File berisi rumus Excel. Ganti rumus dengan nilainya (Tempel nilai), lalu unggah kembali.');
  if (/TargetMode\s*=/i.test(xml) || /externalLink|oleObject|vbaProject|activeX/i.test(name)) throw message('File berisi tautan eksternal atau makro. Gunakan template .xlsx tanpa tautan dan makro.');
  if (name === 'xl/workbook.xml') {
    for (const match of xml.matchAll(/\bsheetId\s*=\s*["'](\d+)["']/g)) if (Number(match[1]) > 1024) throw message('Identitas sheet Excel tidak valid. Gunakan template baru.');
  }
  // Reject huge sparse dimensions before ExcelJS creates sparse JS row arrays.
  if (/^xl\/worksheets\/sheet[^/]+\.xml$/i.test(name)) {
    if (/<(?:[A-Za-z_][\w.-]*:)?mergeCell\b/i.test(xml)) throw message('Sel gabungan tidak didukung untuk impor. Gunakan template tanpa menggabungkan sel.');
    for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?col\b[^>]*>/g)) {
      for (const index of match[0].matchAll(/\b(?:min|max)\s*=\s*["'](\d+)["']/g)) if (Number(index[1]) > 128) throw message('Jumlah kolom Excel terlalu besar. Gunakan kolom pada template VORA Kasir.');
    }
    for (const match of xml.matchAll(/\b(?:ref|sqref)\s*=\s*["']([^"']+)["']/g)) {
      let previous, area = 0;
      for (const address of match[1].matchAll(/\$?([A-Z]+)\$?(\d+)/gi)) {
        let column = 0;
        for (const char of address[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
        const row = Number(address[2]);
        if (column > 128 || row > 25001) throw message('Rentang Excel terlalu besar. Gunakan template dan maksimal 500 baris produk.');
        if (previous && /^:\s*$/.test(match[1].slice(previous.end, address.index))) area += (Math.abs(column - previous.column) + 1) * (Math.abs(row - previous.row) + 1);
        else area++;
        if (area > 250000) throw message('Rentang Excel terlalu besar. Gunakan template dan maksimal 500 baris produk.');
        previous = { row, column, end: address.index + address[0].length };
      }
    }
    let count = 0;
    for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*\br\s*=\s*["'](\d+)["']/g)) if (Number(match[1]) > 25001 || ++count > 25001) throw message('Jumlah baris Excel terlalu besar. Sisakan maksimal 500 baris produk sebelum impor.');
    count = 0;
    for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b[^>]*\br\s*=\s*["']([A-Z]+)(\d+)["']/g)) {
      let column = 0;
      for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
      if (column > 128 || Number(match[2]) > 25001 || ++count > 200000) throw message('Ukuran sheet Excel terlalu besar. Gunakan template dan maksimal 500 baris produk.');
    }
  }
}
function checkZip(bytes, Inflate) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw zipError();
  const entries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (!entries || entries > 150 || entries !== view.getUint16(end + 8, true) || centralStart + centralSize !== end) throw zipError();
  const files = new Set();
  const ranges = [];
  let offset = centralStart, expanded = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw zipError();
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), expectedCrc = view.getUint32(offset + 16, true);
    const packedSize = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true), nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (next > end || !nameLength || view.getUint16(offset + 34, true) || flags & ~0x808 || ![0, 8].includes(method)) throw zipError();
    let name;
    try { name = textDecoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); } catch { throw zipError(); }
    if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || name.includes('\0') || files.has(name.toLowerCase())) throw zipError();
    files.add(name.toLowerCase());
    if (!name.endsWith('/') && !/\.(xml|rels)$/i.test(name)) throw message('File berisi lampiran atau makro yang tidak didukung. Gunakan template .xlsx VORA Kasir.');
    expanded += size;
    if (expanded > PRODUCT_WORKBOOK_LIMITS.expandedBytes) throw message('Isi Excel setelah dibuka terlalu besar. Bagi produk menjadi file yang lebih kecil.');
    if (local + 30 > centralStart || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw zipError();
    const localNameLength = view.getUint16(local + 26, true);
    const start = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (start + packedSize > centralStart || localNameLength !== nameLength || bytes.subarray(local + 30, local + 30 + localNameLength).some((byte, n) => byte !== bytes[offset + 46 + n])) throw zipError();
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== expectedCrc || view.getUint32(local + 18, true) !== packedSize || view.getUint32(local + 22, true) !== size)) throw zipError();
    ranges.push([local, start + packedSize]);
    let content;
    if (method === 0) { if (packedSize !== size) throw zipError(); content = bytes.subarray(start, start + size); }
    else {
      const chunks = []; let actual = 0;
      const inflate = new Inflate((chunk) => {
        actual += chunk.length;
        if (actual > size || actual > PRODUCT_WORKBOOK_LIMITS.expandedBytes) throw message('Ukuran isi Excel tidak valid. Gunakan template baru.');
        chunks.push(chunk);
      });
      try {
        // Small compressed chunks bound each decompressor allocation even when
        // a malicious ZIP lies about its uncompressed length in the directory.
        if (!packedSize) inflate.push(new Uint8Array(), true);
        for (let position = 0; position < packedSize; position += 256) inflate.push(bytes.subarray(start + position, start + Math.min(position + 256, packedSize)), position + 256 >= packedSize);
      } catch (error) { if (error instanceof Error && /Excel/.test(error.message)) throw error; throw zipError(); }
      if (actual !== size) throw zipError();
      content = new Uint8Array(size); let written = 0;
      for (const chunk of chunks) { content.set(chunk, written); written += chunk.length; }
    }
    if (crc32(content) !== expectedCrc) throw zipError();
    if (name.endsWith('.xml') || name.endsWith('.rels')) safeXml(content, name);
    offset = next;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, index) => index && range[0] < ranges[index - 1][1]) || offset !== end || !files.has('[content_types].xml') || !files.has('xl/workbook.xml')) throw zipError();
}

function simpleCell(cell) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && Array.isArray(value.richText)) return value.richText.map(part => literal(part.text)).join('');
  if (value?.formula || value?.sharedFormula) throw message(`Sel ${cell.address} berisi rumus. Gunakan Tempel nilai sebelum mengunggah.`);
  throw message(`Sel ${cell.address} bukan teks atau angka biasa. Hapus tanggal, tautan, atau kesalahan Excel pada sel tersebut.`);
}
export async function readProductWorkbook(input, mode, outletId) {
  const templateMode = normalizedMode(mode);
  if (!outletId || typeof outletId !== 'string') throw message('Pilih outlet sebelum mengimpor produk.');
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.length < 22) throw zipError();
  if (bytes.length > PRODUCT_WORKBOOK_LIMITS.fileBytes) throw message('File Excel maksimal 5 MB. Bagi produk menjadi beberapa file.');
  const { Workbook, Inflate } = await loadEngine();
  checkZip(bytes, Inflate);
  const workbook = new Workbook();
  try { await workbook.xlsx.load(bytes); } catch { throw zipError(); }
  if (workbook.worksheets.some(sheet => !['Produk', 'Petunjuk', 'Kategori', META_NAME].includes(sheet.name))) throw message('Ada sheet yang tidak dikenal. Gunakan template .xlsx VORA Kasir tanpa menambahkan sheet.');
  const metadata = workbook.getWorksheet(META_NAME);
  if (!metadata || metadata.actualRowCount !== 4) throw message('Identitas template tidak ditemukan. Unduh template .xlsx langsung dari dashboard outlet ini.');
  const expected = [['format', FORMAT], ['schema', SCHEMA], ['mode', templateMode], ['outlet_id', outletId]];
  for (let index = 0; index < expected.length; index++) {
    const [key, value] = expected[index];
    if (simpleCell(metadata.getCell(index + 1, 1)) !== key || simpleCell(metadata.getCell(index + 1, 2)) !== value) {
      if (key === 'outlet_id') throw message('Template berasal dari outlet lain. Unduh template dari outlet yang sedang dipilih.');
      if (key === 'mode') throw message('Jenis template berbeda. Gunakan template Tambah produk untuk tambah massal, atau template Ubah produk untuk ubah massal.');
      throw message('Versi template tidak sesuai. Unduh template terbaru dari dashboard.');
    }
  }
  const sheet = workbook.getWorksheet('Produk');
  if (!sheet) throw message('Sheet Produk tidak ditemukan. Gunakan template .xlsx VORA Kasir.');
  const columns = templateMode === 'add' ? PRODUCT_ADD_COLUMNS : PRODUCT_UPDATE_COLUMNS;
  if (sheet.columnCount !== columns.length || columns.some((name, index) => simpleCell(sheet.getCell(1, index + 1)) !== name)) throw message('Judul atau urutan kolom berubah. Gunakan template terbaru dan pertahankan semua judul kolom.');
  const rows = [[...columns]];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = columns.map((_, column) => simpleCell(row.getCell(column + 1)));
    if (values.every(value => value === '' || typeof value === 'string' && !value.trim())) return;
    if (templateMode === 'add' && (literal(values[0]).trim().toUpperCase().startsWith('[CONTOH]') || literal(values[1]).trim().toUpperCase() === EXAMPLE_SKU)) throw message(`Baris ${rowNumber} masih berisi produk contoh. Ganti nama [CONTOH] dan SKU CONTOH-001 dengan produk Anda, atau hapus baris contoh sebelum mengimpor.`);
    if (rows.length > PRODUCT_WORKBOOK_LIMITS.importRows) throw message('Impor maksimal 500 produk per file. Sisakan baris yang akan diproses, lalu unggah sisanya terpisah.');
    for (const key of ['SKU', ...(templateMode === 'update' ? ['ID produk', 'Versi produk'] : [])]) {
      if (typeof values[columns.indexOf(key)] !== 'string') throw message(`Baris ${rowNumber}: ${key} harus berformat Teks. Nol di depan dan nomor panjang tidak boleh diubah menjadi angka Excel. Unduh ulang template bila angkanya sudah berubah.`);
    }
    rows.push(values);
  });
  if (rows.length < 2) throw message('Sheet Produk belum berisi produk. Isi mulai baris 2 sebelum mengunggah.');
  return rows;
}

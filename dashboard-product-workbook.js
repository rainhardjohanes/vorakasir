// Local-only XLSX handling. Workbook metadata is an accident-prevention check;
// authorization and product versions must still be checked against live outlet data.
let enginePromise;
const loadEngine = () => (enginePromise ||= import('/dashboard-vendor-excel-workbook.js'));

export const PRODUCT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const LEGACY_ADD_COLUMNS = ['Nama produk', 'SKU', 'Kategori', 'Satuan', 'Harga jual', 'Harga pokok', 'Monitor stok', 'Stok awal'];
const LEGACY_UPDATE_COLUMNS = ['ID produk', ...LEGACY_ADD_COLUMNS.slice(0, -1), 'Versi produk'];
const layout = {
  'Nama produk': ['Nama Produk*', 34], Kategori: ['Kategori*', 25],
  Favorit: ['Produk Favorit (Y / T)', 22], 'Monitor stok': ['Monitor Persediaan (Y / T)', 24],
  Satuan: ['Satuan #1', 15], 'Harga pokok': ['Harga Beli Satuan #1', 22],
  'Harga jual': ['Harga Jual Satuan #1*', 22], SKU: ['SKU Satuan #1*', 26],
  'Harga nego': ['Izinkan Kasir Ubah Harga Jual (Y / T)', 29],
  'Batas nego': ['Maksimal % di bawah harga jual', 24], 'Stok awal': ['QTY Stok Awal', 18],
  'ID produk': ['ID Produk VORA', 40], 'Versi produk': ['Versi Produk VORA', 34],
};
const baseColumns = ['Nama produk', 'Kategori', 'Favorit', 'Monitor stok', 'Satuan', 'Harga pokok', 'Harga jual', 'SKU', 'Harga nego', 'Batas nego'];
export const PRODUCT_ADD_COLUMNS = Object.freeze([...baseColumns, 'Stok awal']);
export const PRODUCT_UPDATE_COLUMNS = Object.freeze([...baseColumns, 'ID produk', 'Versi produk']);
export const PRODUCT_WORKBOOK_LIMITS = Object.freeze({ fileBytes: 5 * 1024 * 1024, expandedBytes: 24 * 1024 * 1024, importRows: 500, exportRows: 20000 });
const PRODUCT_SHEET = 'Template Impor Produk';
const HEADER_ROW = 4;
const YES_NO = ['Favorit', 'Monitor stok', 'Harga nego'];
const META_NAME = '_VORA';
const FORMAT = 'VORA_PRODUCT_XLSX';
const SCHEMA = '2';
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
function headerStyle(sheet, header = 1, lastRow = sheet.rowCount) {
  sheet.views = [{ state: 'frozen', ySplit: header, activeCell: `A${header + 1}`, showGridLines: false }];
  sheet.getRow(header).height = 34;
  sheet.getRow(header).eachCell(cell => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.dark } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.autoFilter = { from: { row: header, column: 1 }, to: { row: Math.max(header + 1, lastRow), column: sheet.columnCount } };
  sheet.eachRow((row, index) => {
    if (index <= header) return;
    row.height = 24;
    row.eachCell(cell => {
      cell.font = { name: 'Aptos', size: 11, color: { argb: theme.ink } };
      cell.alignment = { vertical: 'middle', wrapText: false };
      if (index % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: theme.pale } };
    });
  });
}
const yesNo = value => value === true ? 'Y' : 'T';

export async function createProductWorkbook({ mode, outlet, products = [], categories = [], units = [] }) {
  const templateMode = normalizedMode(mode);
  if (!outlet?.id || typeof outlet.id !== 'string') throw message('Pilih outlet sebelum mengunduh template.');
  const catalog = ownRows(products, outlet.id, 'Produk');
  const groups = ownRows(categories, outlet.id, 'Kategori');
  if(!Array.isArray(units)||units.length>1000||units.some(row=>!row||row.outlet_id!==undefined&&row.outlet_id!==outlet.id||typeof row.code!=='string'||row.code.length>20||typeof row.name!=='string'||row.name.length>80||!Number.isInteger(row.precision)||row.precision<0||row.precision>6))throw message('Daftar satuan tidak sesuai outlet. Muat ulang katalog.');
  if (catalog.length > PRODUCT_WORKBOOK_LIMITS.exportRows || groups.length > PRODUCT_WORKBOOK_LIMITS.exportRows) throw message('Katalog terlalu besar untuk ekspor ini. Hubungi dukungan; data tidak dipotong.');
  if (templateMode === 'update' && catalog.some(product => typeof product.id !== 'string' || !product.id)) throw message('ID produk pada katalog tidak valid. Muat ulang sebelum mengunduh.');
  const { Workbook } = await loadEngine();
  const workbook = new Workbook();
  workbook.creator = 'VORA Kasir';
  workbook.title = templateMode === 'add' ? 'VORA Kasir — Tambah Produk' : 'VORA Kasir — Ubah Produk';
  workbook.subject = 'Template produk untuk outlet yang dipilih';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(PRODUCT_SHEET, { properties: { defaultRowHeight: 24, tabColor: { argb: theme.green } } });
  const columns = templateMode === 'add' ? PRODUCT_ADD_COLUMNS : PRODUCT_UPDATE_COLUMNS;
  const numerical = new Set(['Harga jual', 'Harga pokok', 'Stok awal', 'Batas nego']);
  sheet.columns = columns.map(key => ({ key, width: layout[key][1], hidden: ['ID produk', 'Versi produk'].includes(key), style: { numFmt: numerical.has(key) ? '0.######' : '@' } }));
  const exportedAt = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Makassar' }).format(workbook.created) + ' WITA';
  sheet.addRows([['Template Impor Produk'], ['Outlet', literal(outlet.name || outlet.id)], ['Tanggal Ekspor', exportedAt], columns.map(key => layout[key][0])]);
  sheet.getCell('A1').font = { name: 'Aptos', size: 16, bold: true, color: { argb: theme.dark } };
  sheet.getRow(1).height = 29;
  if (templateMode === 'update') {
    for (const product of catalog) sheet.addRow({
      'ID produk': product.id, 'Nama produk': literal(product.name), SKU: literal(product.sku), Kategori: literal(product.category), Satuan: literal(product.unit || 'Pcs'),
      'Harga jual': finiteNumber(product.price, 'Harga jual'), 'Harga pokok': finiteNumber(product.buy_price, 'Harga pokok'),
      Favorit: yesNo(product.is_favorite), 'Monitor stok': yesNo(product.track_stock),
      'Harga nego': yesNo(product.negotiation_enabled), 'Batas nego': finiteNumber(product.max_negotiation_percent, 'Batas nego'),
      'Versi produk': literal(product.updated_at),
    });
  } else {
    sheet.addRow({ 'Nama produk': EXAMPLE_NAME, SKU: EXAMPLE_SKU, Kategori: 'Minuman', Satuan: 'Cup', 'Harga jual': 18000, 'Harga pokok': 8000, Favorit: 'T', 'Monitor stok': 'Y', 'Harga nego': 'T', 'Batas nego': 0, 'Stok awal': 0 });
  }
  const lastRow = templateMode === 'add' ? HEADER_ROW + PRODUCT_WORKBOOK_LIMITS.importRows : Math.max(HEADER_ROW + 1, sheet.rowCount);
  for (const key of YES_NO) {
    const letter = sheet.getColumn(key).letter;
    sheet.dataValidations.add(`${letter}${HEADER_ROW + 1}:${letter}${lastRow}`, { type: 'list', allowBlank: true, formulae: ['"Y,T"'], showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Pilihan belum sesuai', error: 'Isi Y atau T.' });
  }
  for (const key of [...numerical].filter(key => columns.includes(key))) {
    const letter = sheet.getColumn(key).letter;
    sheet.dataValidations.add(`${letter}${HEADER_ROW + 1}:${letter}${lastRow}`, { type: key === 'Stok awal' ? 'whole' : 'decimal', operator: 'between', formulae: [0, key === 'Batas nego' ? 100 : key === 'Stok awal' ? 2147483647 : 1000000000000], allowBlank: true, showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Angka belum sesuai', error: key === 'Batas nego' ? 'Isi persentase 0–100. Contoh: isi 30 untuk 30%.' : 'Isi angka nol atau lebih, tanpa Rp atau rumus.' });
  }
  headerStyle(sheet, HEADER_ROW, lastRow);
  if (templateMode === 'add') sheet.getRow(HEADER_ROW + 1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4D6' } };
  });
  const guidance = workbook.addWorksheet('Petunjuk', { properties: { tabColor: { argb: theme.green } } });
  guidance.columns = [{ header: 'VORA KASIR', width: 29 }, { header: templateMode === 'add' ? 'PANDUAN TAMBAH PRODUK' : 'PANDUAN UBAH PRODUK', width: 100 }];
  const directions = [
    ['Outlet', literal(outlet.name || outlet.id)],
    ['Diunduh pada', exportedAt],
    ['Mulai di baris 5', templateMode === 'add' ? 'Ganti produk CONTOH pada baris 5 atau hapus baris tersebut. Pertahankan judul kolom pada baris 4.' : 'Produk aktif outlet ini sudah terisi. Sisakan baris yang akan diubah. Menghapus baris dari file tidak menghapus produk di aplikasi.'],
    ['Batas impor', 'Maksimal 500 produk dan 5 MB per unggahan. Katalog lebih besar tetap diekspor utuh; bagi menjadi beberapa file dengan sheet Petunjuk, Kategori, dan _VORA tetap disertakan.'],
    ['Kolom wajib', templateMode === 'add' ? 'Nama produk, SKU, Kategori, dan Harga jual wajib diisi. Satuan kosong menggunakan Pcs; Harga pokok dan Stok awal kosong menggunakan 0.' : 'ID produk dan Versi produk adalah identitas serta versi saat diunduh. Jangan mengubahnya. Kolom Versi produk disembunyikan agar tidak teredit.'],
    ['SKU', 'Gunakan format sel Teks, terutama barcode dengan nol di depan atau lebih dari 15 digit. Jangan gunakan rumus.'],
    ['Satuan', 'Satuan produk baru dapat memakai kode satuan outlet di bawah. Produk yang sudah tersimpan mempertahankan satuan dasarnya. Konversi kemasan diatur per barang melalui Persediaan; mengganti tulisan satuan tidak mengonversi saldo.'],
    ...units.filter(row=>row.is_active!==false).map(row=>['Satuan outlet',`${row.code} — ${row.name} · ketelitian ${row.precision} desimal`]),
    ['Kategori', 'Gunakan nama pada sheet Kategori atau tulis kategori baru. Kategori baru ditampilkan pada pratinjau dan dibuat hanya untuk outlet terpilih setelah Anda menyetujui simpan impor.'],
    ['Angka', 'Harga ditulis sebagai angka tanpa Rp. Nilai 0 adalah nilai sah. Stok awal harus bilangan bulat. Gunakan 0 jika stok awal belum diketahui.'],
    ['Pilihan Y / T', 'Isi Y untuk ya atau T untuk tidak pada Favorit, Monitor Persediaan, dan izin mengubah harga. Untuk produk baru, pilihan kosong berarti T. Saat ubah produk, pilihan kosong mempertahankan nilai sekarang.'],
    ['Batas nego', 'Isi 30 untuk potongan maksimal 30% dari harga jual. Gunakan angka 0–100. Jika harga nego aktif, harga jual harus berupa Rupiah bulat.'],
    ['Saldo stok', templateMode === 'add' ? 'Stok awal hanya berlaku saat membuat produk baru dan Monitor Persediaan = Y.' : 'Gunakan Persediaan untuk menyesuaikan stok atau satuan. Impor ubah produk mempertahankan saldo stok dan satuan dasar.'],
    ['Data lain', 'Ekstra, foto, ikon, dan riwayat transaksi dipertahankan.'],
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
  const formula = /<(?:[A-Za-z_][\w.-]*:)?f(?:\s|\/?>)/i.exec(xml);
  if (formula) {
    const address = [...xml.slice(0, formula.index).matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b[^>]*\br\s*=\s*["']([A-Z]+\d+)["']/gi)].at(-1)?.[1];
    throw message(`${address ? `Sel ${address} berisi` : 'File berisi'} rumus Excel. Ganti rumus dengan nilainya (Tempel nilai), lalu unggah kembali.`);
  }
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
      if (column > 128 || Number(match[2]) > 25001 || ++count > 250000) throw message('Ukuran sheet Excel terlalu besar. Gunakan template dan maksimal 500 baris produk.');
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
export function importValidationError(issues) {
  const error = message(issues[0]?.message || 'Periksa kembali isi template Excel.');
  error.issues = issues;
  return error;
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
  const metadata = workbook.getWorksheet(META_NAME);
  if (!metadata || metadata.actualRowCount !== 4) throw message('Identitas template tidak ditemukan. Unduh template .xlsx langsung dari dashboard outlet ini.');
  const schema = simpleCell(metadata.getCell('B2'));
  if (![SCHEMA, '1'].includes(schema)) throw message('Versi template tidak sesuai. Unduh template terbaru dari dashboard.');
  const legacy = schema === '1';
  const sheetName = legacy ? 'Produk' : PRODUCT_SHEET;
  if (workbook.worksheets.some(sheet => ![sheetName, 'Petunjuk', 'Kategori', META_NAME].includes(sheet.name))) throw message('Ada sheet yang tidak dikenal. Gunakan template .xlsx VORA Kasir tanpa menambahkan sheet.');
  const expected = [['format', FORMAT], ['schema', schema], ['mode', templateMode], ['outlet_id', outletId]];
  for (let index = 0; index < expected.length; index++) {
    const [key, value] = expected[index];
    if (simpleCell(metadata.getCell(index + 1, 1)) !== key || simpleCell(metadata.getCell(index + 1, 2)) !== value) {
      if (key === 'outlet_id') throw message('Template berasal dari outlet lain. Unduh template dari outlet yang sedang dipilih.');
      if (key === 'mode') throw message('Jenis template berbeda. Gunakan template Tambah produk untuk tambah massal, atau template Ubah produk untuk ubah massal.');
      throw message('Versi template tidak sesuai. Unduh template terbaru dari dashboard.');
    }
  }
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) throw message(`Sheet ${sheetName} tidak ditemukan. Gunakan template .xlsx VORA Kasir.`);
  const headerRow = legacy ? 1 : HEADER_ROW;
  const columns = templateMode === 'add' ? (legacy ? LEGACY_ADD_COLUMNS : PRODUCT_ADD_COLUMNS) : (legacy ? LEGACY_UPDATE_COLUMNS : PRODUCT_UPDATE_COLUMNS);
  const labels = Object.fromEntries(columns.map(key => [key, legacy ? key : layout[key][0]]));
  const columnLetters = Object.fromEntries(columns.map((key, index) => [key, sheet.getColumn(index + 1).letter]));
  for (const key of columns) {
    const cell = sheet.getCell(`${columnLetters[key]}${headerRow}`);
    if (simpleCell(cell) !== labels[key]) throw message(`Judul atau urutan kolom berubah pada sel ${cell.address}. Judul yang diharapkan: ${labels[key]}.`);
  }
  const rows = [[...columns]];
  const sourceRows = [], issues = [];
  const record = (line, key, detail) => issues.push({ line, field: labels[key], cell: `${columnLetters[key]}${line}`, message: detail });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < headerRow) return;
    // Formatting pasted to the right of the template is harmless; extra data is not.
    row.eachCell(cell => {
      if (cell.col > columns.length && literal(cell.value).trim()) issues.push({ line: rowNumber, cell: cell.address, message: `Sel ${cell.address} berada di luar kolom template. Hapus isi sel tersebut.` });
    });
    if (rowNumber === headerRow) return;
    const values = columns.map((key, index) => {
      try { return simpleCell(row.getCell(index + 1)); }
      catch (error) { record(rowNumber, key, error.message); return ''; }
    });
    if (values.every(value => value === '' || typeof value === 'string' && !value.trim())) return;
    if (rows.length > PRODUCT_WORKBOOK_LIMITS.importRows) throw message('Impor maksimal 500 produk per file. Sisakan baris yang akan diproses, lalu unggah sisanya terpisah.');
    if (templateMode === 'add') {
      for (const [key, isExample] of [['Nama produk', value => value.startsWith('[CONTOH]')], ['SKU', value => value === EXAMPLE_SKU]]) {
        if (isExample(literal(values[columns.indexOf(key)]).trim().toUpperCase())) record(rowNumber, key, 'Masih berisi produk contoh. Ganti nama dan SKU contoh atau hapus baris ini.');
      }
    }
    for (const key of ['SKU', ...(templateMode === 'update' ? ['ID produk', 'Versi produk'] : [])]) {
      if (typeof values[columns.indexOf(key)] !== 'string') record(rowNumber, key, `${key} harus berformat Teks. Masukkan kembali kode asli, termasuk nol di depan.`);
    }
    rows.push(values);
    sourceRows.push(rowNumber);
  });
  if (issues.length) throw importValidationError(issues);
  if (rows.length < 2) throw message(`Sheet ${sheetName} belum berisi produk. Isi mulai baris ${headerRow + 1} sebelum mengunggah.`);
  Object.defineProperties(rows, { sourceRows: { value: sourceRows }, columnLetters: { value: columnLetters }, columnLabels: { value: labels }, strictBooleans: { value: !legacy } });
  return rows;
}

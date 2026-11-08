import { normalizeReceiptDetails } from '/dashboard-receipt-details.js';
import { receiptIdentity } from '/dashboard-lib-importedHistory.js';
import { reportExportRows, reportAvailabilityNotes } from '/dashboard-reports.js';
import { outletDisplayName, validateRange } from '/dashboard-data.js';

let enginePromise;
const loadEngine = () => enginePromise ||= import('/dashboard-vendor-excel-workbook.js');
export const REPORT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const REPORT_EXPORT_LIMIT = 50000;
const titles = Object.freeze({ overview: 'Ringkasan dan transaksi', reports: 'Seluruh transaksi', sales: 'Laporan penjualan', profit: 'Laba & rugi', 'product-report': 'Penjualan per produk', payments: 'Metode pembayaran', 'staff-report': 'Penjualan per kasir', refunds: 'Refund & pembatalan', expenses: 'Pengeluaran usaha' });
const colors = { ink: 'FF18372B', green: 'FF17664C', pale: 'FFF0F7F2', line: 'FFD6E4DC', white: 'FFFFFFFF', muted: 'FF52645B' };
const amountFormat = '"Rp "#,##0.00;[Red]("Rp "#,##0.00);"Rp "0.00';
const moneyColumns = new Set(['Nominal IDR', 'Nilai item sebelum diskon dan pajak struk', 'Nilai struk sebelum refund', 'Refund', 'Penerimaan bersih', 'Rata-rata penerimaan per struk', 'MDR', 'Total struk', 'Penerimaan tersisa', 'Subtotal', 'Diskon', 'Pajak', 'Layanan', 'Surcharge']);
const transactionViews = new Set(['overview', 'reports', 'sales', 'refunds']);
const itemHeaders = ['No. struk', 'ID transaksi', 'Tanggal usaha', 'Waktu struk', 'Kasir', 'Pelanggan', 'Telepon pelanggan', 'Alamat pelanggan', 'No. order', 'Pemesan', 'Catatan pesanan', 'Baris struk', 'Jenis baris', 'Produk / layanan', 'Kategori', 'SKU', 'Satuan', 'Qty pada struk', 'Qty refund', 'Qty tersisa', 'Harga / item', 'Nilai item', 'Staf pelaksana', 'Catatan item', 'Ekstra tercatat', 'Kelompok harga', 'Harga normal tercatat', 'Harga referensi nego', 'Harga minimum nego', 'Batas nego (%)', 'Harga nego tercatat', 'Jenis pembayaran', 'ID order pembayaran', 'Pokok pembayaran tercatat', 'Nilai order tercatat', 'Struk pembayaran sebelumnya'];
const itemMoneyHeaders = new Set(['Harga / item', 'Nilai item', 'Harga normal tercatat', 'Harga referensi nego', 'Harga minimum nego', 'Harga nego tercatat', 'Pokok pembayaran tercatat', 'Nilai order tercatat']);

function text(value) {
  const result = String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
  if (result.length > 32767) throw new TypeError('Teks laporan terlalu panjang untuk satu sel Excel. Hubungi dukungan; isi tidak dipotong.');
  return result;
}
function scalar(value) {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Laporan berisi angka tidak valid. Muat ulang sebelum mengekspor.');
    return value;
  }
  if (typeof value !== 'string' && typeof value !== 'boolean') throw new TypeError('Laporan berisi nilai sel yang tidak didukung.');
  // ExcelJS treats plain strings as strings, including =, +, -, @ and leading
  // whitespace. Never accept formula / hyperlink objects from report values.
  return text(value);
}
function validateScope(report, outlet, range) {
  if (!outlet?.id || !report || report.outletId !== outlet.id) throw new TypeError('Laporan tidak sesuai outlet terpilih. Muat ulang laporan.');
  validateRange(range);
  if (range.start !== report.range?.start || range.end !== report.range?.end) throw new TypeError('Periode laporan berubah. Muat ulang sebelum mengekspor.');
  for (const key of ['sales', 'logs', 'refunds']) {
    if (!Array.isArray(report[key]) || report[key].some(row => !row || row.outlet_id !== outlet.id)) throw new TypeError('Data lintas outlet ditolak. Muat ulang laporan.');
  }
  if (!Array.isArray(report.expense?.expenses) || report.expense.expenses.some(row => !row?.record || row.record.outlet_id !== outlet.id)) throw new TypeError('Biaya tidak sesuai outlet terpilih. Muat ulang laporan.');
  const manualRows = report.manualCashOut?.rows ?? [];
  if (!Array.isArray(manualRows) || manualRows.some(row => !row?.record || row.record.outlet_id !== outlet.id)) throw new TypeError('Kas keluar manual tidak sesuai outlet terpilih. Muat ulang laporan.');
}

function receiptItemDetails(view, report) {
  if (!transactionViews.has(view)) return null;
  const refundIds = new Set(report.refunds.map(sale => sale.id));
  const sales = view === 'refunds' ? report.sales.filter(sale => refundIds.has(sale.id)) : report.sales;
  const rows = [];
  for (const sale of sales) {
    const details = normalizeReceiptDetails(sale);
    const lines = [...details.items.map(line => ({ line, kind: 'Produk / layanan' })),
      ...details.adjustments.map(line => ({ line, kind: 'Penyesuaian pembayaran' }))]
      .sort((a, b) => a.line.index - b.line.index);
    for (const { line, kind } of lines) {
      if (rows.length >= REPORT_EXPORT_LIMIT) throw new TypeError('Rincian item melebihi 50.000 baris. Pilih periode lebih pendek; ekspor tidak dipotong.');
      const extras = line.extras.map(extra => `${extra.group ? `${extra.group}: ` : ''}${extra.name}${extra.price === null ? '' : ` (Rp ${numberText(extra.price)} / item)`}`).join('\n');
      rows.push([receiptIdentity(sale), sale.id, sale.date, sale.time, sale.cashier, details.customer.name || null,
        details.customer.phone || null, details.customer.address || null, details.orderReference || null, details.requester || null,
        details.orderNote || null, line.index + 1, kind, line.name, line.category || null, line.sku || null, line.unit || null,
        line.qty, line.refundedQty, line.remainingQty, line.price, line.total, line.servedBy || null, line.note || null,
        extras || null, line.pricing.groupName || null, line.pricing.normalPrice, line.pricing.referencePrice,
        line.pricing.minimumPrice, line.pricing.maxPercent, line.pricing.negotiatedPrice ?? line.pricing.negotiated,
        details.payment?.mode ?? null, details.payment?.orderId ?? null, details.payment?.principal ?? null,
        details.payment?.orderTotal ?? null, details.payment?.previousSaleIds?.join('\n') || null].map(scalar));
    }
  }
  return { headers: [...itemHeaders], rows, moneyColumns: itemHeaders.map(header => itemMoneyHeaders.has(header)), notes: [
    'Setiap baris mengikuti urutan item pada struk tersimpan. Produk yang sama dengan harga, staf atau catatan berbeda tetap terpisah.',
    'Harga item sudah termasuk ekstra. Nilai item bukan penerimaan bersih; diskon nota, pajak, layanan dan refund tetap mengikuti laporan utama.',
    'Penyesuaian pembayaran bukan produk atau layanan. Pokok pembayaran dan nilai order adalah referensi, bukan tambahan penerimaan.',
    'Staf dan catatan mengikuti rincian pada struk. Data yang tidak tercatat ditampilkan sebagai —.',
  ] };
}
const numberText = value => Number(value).toLocaleString('id-ID', { maximumFractionDigits: 20 });

/** Pure full-period export model; screen search and pagination do not truncate it. */
export function reportWorkbookModel({ view, report, outlet, range = report?.range, generatedAt = new Date().toISOString(), timeZone } = {}) {
  if (!Object.hasOwn(titles, view)) throw new TypeError('Jenis laporan tidak didukung untuk ekspor ini.');
  validateScope(report, outlet, range);
  const generated = new Date(generatedAt);
  if (!Number.isFinite(generated.getTime())) throw new TypeError('Waktu pembuatan laporan tidak valid.');
  const zone = timeZone || outlet.timezone || outlet.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let generatedLabel;
  try { generatedLabel = new Intl.DateTimeFormat('id-ID', { timeZone: zone, dateStyle: 'long', timeStyle: 'medium', hourCycle: 'h23' }).format(generated); }
  catch { throw new TypeError('Zona waktu laporan tidak valid.'); }
  const rawRows = reportExportRows(view, report);
  if (rawRows.length - 1 > REPORT_EXPORT_LIMIT) throw new TypeError('Laporan melebihi 50.000 baris. Pilih periode lebih pendek; ekspor tidak dipotong.');
  const [headers, ...rows] = rawRows.map(row => row.map(scalar));
  if (!headers?.length || rows.some(row => row.length > headers.length)) throw new TypeError('Kolom laporan tidak sesuai. Muat ulang sebelum mengekspor.');
  const notes = [
    'Seluruh catatan periode ini disertakan; pencarian dan halaman tabel tidak membatasi ekspor.',
    'Data hanya mencakup catatan tersinkron. Tanggal usaha mengikuti tanggal pada struk.',
    '— berarti data belum tersedia atau tidak berlaku; bukan angka nol.',
  ];
  notes.push(...reportAvailabilityNotes(view, report));
  if (report.manualCashOut?.rows?.length) notes.push(`Kas keluar manual belum dikategorikan dan tidak termasuk total biaya usaha maupun perhitungan laba. Sebagian kas keluar dapat berupa penarikan uang owner. Tanggal kas keluar mengikuti zona waktu outlet ${report.manualCashOut.timeZone || zone}. Rincian lengkap ada pada laporan Biaya usaha.`);
  const itemDetails = receiptItemDetails(view, report);
  return { view, title: titles[view], outletId: outlet.id, outletName: text(outletDisplayName(outlet)), range: { ...range }, generatedAt: generated.toISOString(), generatedLabel, timeZone: zone, headers, rows, notes, itemDetails, moneyColumns: headers.map(header => moneyColumns.has(header)) };
}

function merged(sheet, rowIndex, endColumn, value, { size = 11, bold = false, color = colors.ink, height = 24, fill } = {}) {
  sheet.mergeCells(rowIndex, 1, rowIndex, endColumn);
  const cell = sheet.getCell(rowIndex, 1);
  cell.value = value;
  cell.font = { name: 'Aptos', size, bold, color: { argb: color } };
  cell.alignment = { vertical: 'middle', wrapText: true };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  sheet.getRow(rowIndex).height = height;
}

function addItemDetailSheet(workbook, model) {
  const detail = model.itemDetails;
  if (!detail) return;
  const sheet = workbook.addWorksheet('Rincian item', { properties: { tabColor: { argb: colors.green } } });
  sheet.columns = detail.headers.map((header, index) => ({ width: detail.moneyColumns[index] ? 22 : /Catatan|Ekstra|Alamat|sebelumnya/.test(header) ? 48 : /Qty|Baris/.test(header) ? 16 : 29 }));
  const lastColumn = detail.headers.length;
  merged(sheet, 1, lastColumn, 'VORA POS', { size: 14, bold: true, color: colors.green });
  merged(sheet, 2, lastColumn, 'RINCIAN ITEM PADA STRUK', { size: 20, bold: true, height: 38 });
  merged(sheet, 3, lastColumn, `Outlet: ${model.outletName}`);
  merged(sheet, 4, lastColumn, `Periode usaha: ${model.range.start} s.d. ${model.range.end}`);
  merged(sheet, 5, lastColumn, `Dibuat: ${model.generatedLabel} (${model.timeZone})`);
  merged(sheet, 6, lastColumn, `Cakupan: seluruh periode · ${detail.rows.length.toLocaleString('id-ID')} baris item dan penyesuaian`, { color: colors.muted });
  merged(sheet, 7, lastColumn, 'Rincian transaksi; nilai item dan penyesuaian bukan tambahan penerimaan.', { color: colors.muted });
  const header = sheet.getRow(9); header.values = detail.headers; header.height = 38;
  header.eachCell(cell => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: colors.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.green } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  for (const [index, values] of detail.rows.entries()) {
    const row = sheet.getRow(index + 10); row.values = values;
    row.height = Math.max(...values.map(value => typeof value === 'string' ? value.length : 0)) > 80 ? 72 : 36;
    row.eachCell((cell, column) => {
      const numeric = typeof cell.value === 'number';
      cell.font = { name: 'Aptos', size: 11, color: { argb: colors.ink } };
      cell.numFmt = numeric ? detail.moneyColumns[column - 1] ? amountFormat : '#,##0.########' : '@';
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: numeric ? 'right' : 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: colors.line } } };
      if (index % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.pale } };
    });
  }
  let next = detail.rows.length + 11;
  if (!detail.rows.length) merged(sheet, next++, lastColumn, 'Tidak ada rincian item tersimpan pada periode ini.', { color: colors.muted });
  for (const note of detail.notes) merged(sheet, next++, lastColumn, note, { size: 10, color: colors.muted, height: 32 });
  sheet.views = [{ state: 'frozen', ySplit: 9, activeCell: 'A10', showGridLines: false }];
  sheet.autoFilter = { from: { row: 9, column: 1 }, to: { row: Math.max(9, 9 + detail.rows.length), column: lastColumn } };
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 0, fitToHeight: 0, printTitlesRow: '9:9' };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastColumn).letter}${next - 1}`;
  sheet.headerFooter = { oddFooter: '&LVORA Kasir · Rincian item&RHalaman &P dari &N' };
}

/** Local-only XLSX bytes. Caller must recheck auth/outlet/range before exposing a link. */
export async function createReportWorkbook(options) {
  // Capture all scalars before the asynchronous engine load to avoid mutable data.
  const model = reportWorkbookModel(options);
  const { Workbook } = await loadEngine();
  const workbook = new Workbook();
  workbook.creator = 'VORA Kasir';
  workbook.title = model.title;
  workbook.subject = `${model.outletName} · ${model.range.start} – ${model.range.end}`;
  workbook.created = new Date(model.generatedAt);
  workbook.modified = new Date(model.generatedAt);
  const sheet = workbook.addWorksheet('Laporan', { properties: { tabColor: { argb: colors.green } } });
  sheet.columns = model.headers.map((header, index) => ({ width: model.moneyColumns[index] ? 22 : /Keterangan|Alasan|Catatan|Komponen/.test(header) ? 44 : /Nomor|ID |Produk|Pelanggan|Kasir|Metode/.test(header) ? 29 : 21 }));
  const lastColumn = model.headers.length;
  merged(sheet, 1, lastColumn, 'VORA POS', { size: 14, bold: true, color: colors.green, height: 28 });
  merged(sheet, 2, lastColumn, model.title.toLocaleUpperCase('id-ID'), { size: 20, bold: true, height: 38 });
  merged(sheet, 3, lastColumn, `Outlet: ${model.outletName}`);
  merged(sheet, 4, lastColumn, `Periode usaha: ${model.range.start} s.d. ${model.range.end}`);
  merged(sheet, 5, lastColumn, `Dibuat: ${model.generatedLabel} (${model.timeZone})`);
  merged(sheet, 6, lastColumn, `Cakupan: seluruh periode · ${model.rows.filter(row => row.length).length.toLocaleString('id-ID')} baris`, { color: colors.muted });
  merged(sheet, 7, lastColumn, model.notes[2], { color: colors.muted });
  const headerIndex = 9;
  const header = sheet.getRow(headerIndex);
  header.values = model.headers;
  header.height = 38;
  header.eachCell(cell => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: colors.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.green } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  for (const [index, values] of model.rows.entries()) {
    const row = sheet.getRow(headerIndex + 1 + index);
    row.values = values;
    const longest = Math.max(0, ...values.filter(value => typeof value === 'string').map(value => value.length));
    row.height = longest > 80 ? 54 : 30;
    row.eachCell((cell, column) => {
      const numeric = typeof cell.value === 'number';
      cell.font = { name: 'Aptos', size: 11, color: { argb: colors.ink } };
      cell.numFmt = numeric ? (model.moneyColumns[column - 1] ? amountFormat : '#,##0.########') : '@';
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: numeric ? 'right' : 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: colors.line } } };
      if (index % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.pale } };
    });
  }
  let next = headerIndex + model.rows.length + 2;
  if (!model.rows.length) merged(sheet, next++, lastColumn, 'Tidak ada catatan untuk periode ini.', { color: colors.muted, height: 30 });
  for (const note of model.notes) merged(sheet, next++, lastColumn, note, { size: 10, color: colors.muted, height: lastColumn <= 4 ? 45 : 28 });
  sheet.views = [{ state: 'frozen', ySplit: headerIndex, activeCell: 'A10', showGridLines: false }];
  sheet.autoFilter = { from: { row: headerIndex, column: 1 }, to: { row: Math.max(headerIndex, headerIndex + model.rows.length), column: lastColumn } };
  sheet.pageSetup = { paperSize: 9, orientation: lastColumn > 5 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '9:9', margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(lastColumn).letter}${next - 1}`;
  sheet.headerFooter = { oddFooter: '&LVORA Kasir&RHalaman &P dari &N' };
  addItemDetailSheet(workbook, model);
  return new Uint8Array(await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true }));
}

import { reportExportRows } from '/dashboard-reports.js';
import { outletDisplayName, validateRange } from '/dashboard-data.js';

let enginePromise;
const loadEngine = () => enginePromise ||= import('/dashboard-vendor-excel-workbook.js');
export const REPORT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const REPORT_EXPORT_LIMIT = 50000;
const titles = Object.freeze({ overview: 'Ringkasan dan transaksi', reports: 'Seluruh transaksi', sales: 'Laporan penjualan', profit: 'Laba & rugi', 'product-report': 'Penjualan per produk', payments: 'Metode pembayaran', 'staff-report': 'Penjualan per kasir', refunds: 'Refund & pembatalan', expenses: 'Pengeluaran usaha' });
const colors = { ink: 'FF18372B', green: 'FF17664C', pale: 'FFF0F7F2', line: 'FFD6E4DC', white: 'FFFFFFFF', muted: 'FF52645B' };
const amountFormat = '"Rp "#,##0.00;[Red]("Rp "#,##0.00);"Rp "0.00';
const moneyColumns = new Set(['Nominal IDR', 'Nilai item sebelum diskon dan pajak struk', 'Nilai struk sebelum refund', 'Refund', 'Penerimaan bersih', 'Rata-rata penerimaan per struk', 'MDR', 'Total struk', 'Penerimaan tersisa', 'Subtotal', 'Diskon', 'Pajak', 'Layanan', 'Surcharge']);

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
  if (!report.finance?.complete) notes.push(`Laporan sementara: ${(report.finance?.issues || []).join(' ') || 'Sebagian komponen belum lengkap. Periksa rekonsiliasi.'}`);
  if (report.manualCashOut?.rows?.length) notes.push(`Kas keluar manual belum dikategorikan dan tidak termasuk total biaya usaha maupun perhitungan laba. Sebagian kas keluar dapat berupa penarikan uang owner. Tanggal kas keluar mengikuti zona waktu outlet ${report.manualCashOut.timeZone || zone}. Rincian lengkap ada pada laporan Biaya usaha.`);
  return { view, title: titles[view], outletId: outlet.id, outletName: text(outletDisplayName(outlet)), range: { ...range }, generatedAt: generated.toISOString(), generatedLabel, timeZone: zone, headers, rows, notes, moneyColumns: headers.map(header => moneyColumns.has(header)) };
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
  return new Uint8Array(await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true }));
}

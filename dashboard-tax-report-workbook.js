import { taxReportExportModel } from '/dashboard-tax-report-model.js';

let enginePromise;
const loadEngine = () => enginePromise ||= import('/dashboard-vendor-excel-workbook.js');
export const TAX_REPORT_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const colors = { ink: 'FF18372B', green: 'FF17664C', pale: 'FFF0F7F2', line: 'FFD6E4DC', white: 'FFFFFFFF', muted: 'FF52645B' };
const amountFormat = '"Rp "#,##0.00;[Red]("Rp "#,##0.00);"Rp "0.00';

function merged(sheet, row, width, value, { size = 11, bold = false, height = 25, color = colors.ink } = {}) {
  sheet.mergeCells(row, 1, row, width);
  const cell = sheet.getCell(row, 1); cell.value = value;
  cell.font = { name: 'Aptos', size, bold, color: { argb: color } };
  cell.alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(row).height = height;
}

function reportSheet(workbook, name, title, section, model) {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: colors.green } } });
  const width = section.headers.length;
  sheet.columns = section.headers.map((header, index) => ({ width: section.moneyColumns[index] ? 23 : /Catatan|Keterangan|Ekstra|Sumber/.test(header) ? 44 : /Staf|Produk|layanan|struk|Identitas|Transaksi/i.test(header) ? 32 : 21 }));
  merged(sheet, 1, width, 'VORA POS', { size: 14, bold: true, color: colors.green, height: 28 });
  merged(sheet, 2, width, title, { size: 20, bold: true, height: 38 });
  merged(sheet, 3, width, `Outlet: ${model.outletName}`);
  merged(sheet, 4, width, `Periode transaksi: ${model.dateFrom} s.d. ${model.dateUntil}`);
  merged(sheet, 5, width, `Filter: ${model.filterLabel}`);
  merged(sheet, 6, width, `Dibuat: ${model.generatedLabel} (${model.timeZone})`);
  merged(sheet, 7, width, `Seluruh ${section.rows.length.toLocaleString('id-ID')} catatan sesuai filter; halaman layar tidak membatasi ekspor.`, { color: colors.muted, height: 32 });
  const header = sheet.getRow(9); header.values = section.headers; header.height = 38;
  header.eachCell(cell => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: colors.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.green } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  for (const [index, values] of section.rows.entries()) {
    const row = sheet.getRow(index + 10); row.values = values;
    row.height = values.some(value => typeof value === 'string' && (value.length > 80 || value.includes('\n'))) ? 66 : 32;
    row.eachCell((cell, column) => {
      const numeric = typeof cell.value === 'number';
      cell.font = { name: 'Aptos', size: 11, color: { argb: colors.ink } };
      cell.numFmt = numeric ? section.moneyColumns[column - 1] ? amountFormat : '#,##0.########' : '@';
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: numeric ? 'right' : 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: colors.line } } };
      if (index % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.pale } };
    });
  }
  let next = section.rows.length + 11;
  if (!section.rows.length) merged(sheet, next++, width, 'Tidak ada catatan untuk periode dan filter ini.', { color: colors.muted, height: 32 });
  for (const note of model.notes) merged(sheet, next++, width, note, { size: 10, color: colors.muted, height: 44 });
  sheet.views = [{ state: 'frozen', ySplit: 9, activeCell: 'A10', showGridLines: false }];
  sheet.autoFilter = { from: { row: 9, column: 1 }, to: { row: Math.max(9, 9 + section.rows.length), column: width } };
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '9:9', margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(width).letter}${next - 1}`;
  sheet.headerFooter = { oddFooter: '&LVORA Kasir · Pajak penjualan&RHalaman &P dari &N' };
  return sheet;
}

/** Capture a scoped scalar snapshot before the asynchronous local engine load. */
export async function createTaxReportWorkbook(options = {}) {
  const model = taxReportExportModel(options);
  const { Workbook } = await loadEngine();
  const workbook = new Workbook();
  workbook.creator = 'VORA Kasir'; workbook.title = 'Laporan pajak penjualan';
  workbook.subject = `${model.outletName} · ${model.dateFrom} – ${model.dateUntil}`;
  workbook.created = new Date(model.generatedAt); workbook.modified = new Date(model.generatedAt);
  reportSheet(workbook, 'Pajak penjualan', 'LAPORAN PAJAK PENJUALAN', model, model);
  const summary = { headers: ['Pajak awal', 'Koreksi refund', 'Pajak bersih'], rows: [[model.totals.tax ?? '—', model.totals.refundTax ?? '—', model.totals.net ?? '—']], moneyColumns: [true, true, true] };
  reportSheet(workbook, 'Ringkasan pajak', 'RINGKASAN PAJAK PENJUALAN', summary, model);
  return new Uint8Array(await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true }));
}

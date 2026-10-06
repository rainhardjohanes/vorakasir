import { escapeHtml as h } from '/dashboard-data.js';
import { refundAmount, netSaleAmount } from '/dashboard-lib-refundReports.js';

const PER_PAGE = 25;
const colors = ['#246c51', '#88b79c', '#ddba77', '#8c9db1', '#bba7c4', '#b8c9bd'];
const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const number = value => numeric(value) === null ? '—' : Number(value).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const money = value => numeric(value) === null ? '—' : `Rp ${Math.round(Number(value)).toLocaleString('id-ID')}`;
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value)) : '—';
const percent = (value, total) => total > 0 ? `${number(value / total * 100)}%` : '0%';
const fraction = (value, total) => total > 0 ? Math.max(0, Math.min(100, value / total * 100)) : 0;
const sum = (rows, key) => rows.reduce((total, row) => total + (numeric(row[key]) ?? 0), 0);
const paths = {
  chart: '<path d="M4 4v16h16M8 15v-4m4 4V7m4 8v-5"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 7h6M9 11h6M9 15h3"/>',
  product: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  payment: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
  staff: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
  refund: '<path d="M4 9a8 8 0 1 1 0 7M4 4v5h5M12 7v5l3 2"/>',
  expense: '<path d="M8 3h8v4H8zM8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 12h8M8 16h5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.chart}</svg>`;
const link = (view, label) => `<a class="r-link" href="#${h(view)}" data-report-route="${h(view)}">${h(label)} ${icon('arrow')}</a>`;
const badge = (label, tone = '') => `<span class="r-badge ${tone}">${h(label)}</span>`;
const empty = (message = 'Belum ada data pada periode ini.') => `<div class="r-empty">${icon('chart')}<p>${h(message)}</p></div>`;
const section = (title, description, body, action = '') => `<section class="r-card"><header class="r-card-head"><div><h2>${h(title)}</h2>${description ? `<p>${h(description)}</p>` : ''}</div>${action}</header>${body}</section>`;
const summary = entries => `<div class="r-summary">${entries.map(([label, value, note]) => `<div><small>${h(label)}</small><strong>${h(value)}</strong>${note ? `<p>${h(note)}</p>` : ''}</div>`).join('')}</div>`;
const table = (headers, rows) => `<div class="r-table-wrap" tabindex="0" role="region" aria-label="Tabel laporan, geser untuk melihat seluruh kolom"><table><thead><tr>${headers.map(header => `<th scope="col">${h(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}">${empty('Tidak ada catatan yang cocok dengan pilihan ini.')}</td></tr>`}</tbody></table></div>`;
const td = (value, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${h(value)}</td>`;
const small = value => `<small>${h(value)}</small>`;
const saleButton = sale => `<button type="button" class="r-transaction" data-report-sale="${h(sale.id)}">${h(sale.id)}</button>`;

function statusLabel(sale) {
  if (sale.status === 'REFUNDED') return 'Refund penuh';
  if (sale.status === 'PARTIAL_REFUND' || Number(sale.refunded_amount) > 0) return 'Refund sebagian';
  return sale.status === 'SUCCESS' ? 'Selesai' : (sale.status || 'Belum tercatat');
}
const saleStatus = sale => badge(statusLabel(sale), sale.status === 'SUCCESS' && !Number(sale.refunded_amount) ? '' : 'amber');
const expenseStatus = row => row.reversal ? 'Pembatalan' : row.reversed ? 'Dibatalkan' : 'Tercatat';
const legacyExpenses = report => report.expense.expenses.some(row => row.legacy);
function warnings(report) {
  const provisional = !report.finance.complete || report.finance.issues.length;
  return `${provisional ? `<aside class="r-warning" role="status"><strong>Laporan sementara · perlu rekonsiliasi</strong><p>${h(report.finance.issues.join(' ') || 'Komponen laporan belum lengkap.')} Angka laba dan refund belum dapat dianggap final. HPP yang tidak tersedia tidak diganti dengan harga produk saat ini.</p></aside>` : ''}${legacyExpenses(report) ? '<aside class="r-warning"><strong>Ada catatan biaya dari format lama</strong><p>Biaya lama dibaca dari keterangan kas keluar dan tanggal usaha yang tersimpan. Periksa kesesuaian catatan tersebut sebelum menggunakan laba sebagai angka final.</p></aside>' : ''}`;
}
const tabs = view => `<nav class="r-tabs" aria-label="Jenis laporan">${[['reports', 'Semua laporan'], ['sales', 'Penjualan'], ['profit', 'Laba rugi'], ['expenses', 'Biaya usaha']].map(([key, title]) => `<a href="#${key}" data-report-route="${key}" class="${key === view ? 'active' : ''}"${key === view ? ' aria-current="page"' : ''}>${title}</a>`).join('')}</nav>`;

function metrics(report) {
  const f = report.finance;
  const values = [
    ['Penjualan bersih', money(f.revenue), 'Tanpa pajak, layanan, dan surcharge', 'chart'],
    ['Jumlah transaksi', number(f.transactions), 'Seluruh struk, termasuk refund', 'receipt'],
    ['Rata-rata penerimaan', money(f.transactions ? f.netReceipts / f.transactions : 0), 'Penerimaan setelah refund per struk', 'payment'],
    ['Laba operasional', money(report.operatingProfit), f.complete ? 'Setelah HPP, MDR, dan biaya tercatat' : 'Sementara · perlu rekonsiliasi', 'expense'],
  ];
  return `<div class="r-metrics">${values.map(([label, value, note, symbol], i) => `<section class="r-card r-metric${!i ? ' r-metric-hero' : ''}"><div class="r-metric-label"><span>${icon(symbol)}</span>${h(label)}</div><strong>${h(value)}</strong><p>${h(note)}</p></section>`).join('')}</div>`;
}

function chart(report, metric = 'net') {
  const days = report.days;
  if (!report.sales.length || !days.length) return empty('Belum ada transaksi untuk menggambar tren pada periode ini.');
  const width = 740, height = 245, left = 61, right = 18, top = 18, bottom = 36;
  const maximum = Math.max(1, ...days.map(day => numeric(day[metric]) ?? 0)) * 1.12;
  const x = index => days.length === 1 ? (width + left - right) / 2 : left + index * (width - left - right) / (days.length - 1);
  const y = value => height - bottom - (numeric(value) ?? 0) / maximum * (height - top - bottom);
  const shortNumber = value => value >= 1e6 ? `${number(value / 1e6)} jt` : value >= 1000 ? `${number(value / 1000)} rb` : number(value);
  const points = days.map((day, index) => `${x(index).toFixed(2)},${y(day[metric]).toFixed(2)}`);
  const grids = Array.from({ length: 5 }, (_, index) => {
    const value = maximum * index / 4, yy = y(value);
    return `<line x1="${left}" x2="${width - right}" y1="${yy}" y2="${yy}" class="r-chart-grid"/><text x="${left - 11}" y="${yy + 4}" text-anchor="end">${h(metric === 'count' ? number(Math.round(value)) : shortNumber(value))}</text>`;
  }).join('');
  const labels = days.map((day, index) => index === 0 || index === days.length - 1 || index % Math.max(1, Math.ceil(days.length / 6)) === 0 ? `<text x="${x(index)}" y="${height - 10}" text-anchor="middle">${h(day.date.slice(8) + '/' + day.date.slice(5, 7))}</text>` : '').join('');
  const name = metric === 'count' ? 'Jumlah transaksi per hari' : 'Penerimaan bersih per hari';
  return `<svg class="r-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${name}. Rincian setiap hari tersedia pada tabel di bawah grafik."><defs><linearGradient id="report-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5c9b75" stop-opacity=".22"/><stop offset="1" stop-color="#5c9b75" stop-opacity=".01"/></linearGradient></defs>${grids}<path d="M${x(0)},${height - bottom} L${points.join(' L')} L${x(days.length - 1)},${height - bottom} Z" fill="url(#report-area)"/><polyline points="${points.join(' ')}" fill="none" stroke="#2b835e" stroke-width="2.8" stroke-linejoin="round"/>${days.map((day, index) => `<circle cx="${x(index)}" cy="${y(day[metric])}" r="${days.length === 1 ? 4 : 2.5}" fill="#2b835e"><title>${h(`${date(day.date)}: ${metric === 'count' ? number(day.count) + ' transaksi' : money(day.net)}`)}</title></circle>`).join('')}${labels}</svg>`;
}

function paymentChart(report) {
  const total = sum(report.methods, 'net');
  if (!report.methods.length) return empty('Belum ada penerimaan pada periode ini.');
  let offset = 0;
  const segments = report.methods.map((row, index) => {
    const start = offset; offset += fraction(row.net, total);
    return `${colors[index % colors.length]} ${start}% ${offset}%`;
  });
  return `<div class="r-payment-visual"><div class="r-donut" style="background:${total > 0 ? `conic-gradient(${segments.join(',')})` : '#e6ece7'}" role="img" aria-label="Komposisi metode pembayaran, rinciannya tersedia di bawah"><div><small>Metode bayar</small><strong>${number(report.methods.length)}</strong></div></div></div><div class="r-payment-legend">${report.methods.map((row, index) => `<div><i style="background:${colors[index % colors.length]}"></i><span>${h(row.name)}</span><small>${h(percent(row.net, total))}</small><strong>${h(money(row.net))}</strong></div>`).join('')}</div>`;
}

function bars(rows, field = 'net', currency = true) {
  if (!rows.length) return empty();
  const maximum = Math.max(...rows.map(row => numeric(row[field]) ?? 0), 1);
  return `<div class="r-bars">${rows.map((row, index) => `<div><div class="r-bar-label"><span>${h(row.name || row.label)}</span><strong>${h(currency ? money(row[field]) : number(row[field]))}</strong></div><div class="r-bar-track"><i style="width:${fraction(row[field], maximum)}%;background:${colors[index % colors.length]}"></i></div></div>`).join('')}</div>`;
}

function dailyDetails(report) {
  return `<details class="r-daily"><summary>Lihat rincian harian (${number(report.days.length)} hari)</summary>${table(['Tanggal usaha', 'Transaksi', 'Penerimaan bersih'], report.days.map(day => `<tr>${td(date(day.date))}${td(number(day.count), 'r-num')}${td(money(day.net), 'r-num')}</tr>`))}</details>`;
}

function overview(report) {
  const productRows = report.products.slice(0, 5).map((row, index) => `<tr><td><div class="r-product-cell"><span class="r-rank">${index + 1}</span><span class="r-product-symbol">${icon('product')}</span><div><strong>${h(row.name)}</strong>${small(row.category)}</div></div></td>${td(number(row.qty), 'r-num')}${td(money(row.amount), 'r-num')}</tr>`);
  const peak = [...report.days].sort((a, b) => b.net - a.net)[0];
  return `${metrics(report)}<div class="r-analytics">${section('Tren penerimaan', 'Angka harian berdasarkan tanggal usaha pada struk', `<div class="r-chart-total"><strong>${h(money(report.finance.netReceipts))}</strong><span>Setelah refund, termasuk pajak dan layanan</span></div><div data-report-chart>${chart(report)}</div><div class="r-chart-caption">${peak && report.sales.length ? `Penerimaan tertinggi: ${h(date(peak.date))} · ${h(money(peak.net))}` : 'Menunggu transaksi pertama pada periode ini.'}</div>${dailyDetails(report)}`, '<div class="r-chart-controls" aria-label="Tampilan grafik"><button type="button" data-report-chart-metric="net" aria-pressed="true">Penerimaan</button><button type="button" data-report-chart-metric="count" aria-pressed="false">Transaksi</button></div>')}${section('Metode pembayaran', 'Komposisi penerimaan setelah refund', paymentChart(report), link('payments', 'Rincian'))}</div><div class="r-insight"><span>${icon('chart')}</span><div><strong>${report.finance.complete ? 'Pahami laba dari transaksi yang tercatat' : 'Ada angka historis yang perlu ditinjau'}</strong><p>${report.finance.complete ? 'Rincian HPP, biaya pembayaran, dan biaya usaha tersedia di laporan laba rugi.' : 'Laporan laba rugi menunjukkan komponen yang tersedia dan catatan rekonsiliasi.'}</p></div>${link('profit', 'Lihat laba rugi')}</div><div class="r-bottom-grid">${section('Produk terlaris', 'Kuantitas neto setelah pengembalian item', table(['Produk', 'Terjual', 'Nilai item'], productRows), link('product-report', 'Lihat semua'))}${section('Jenis pesanan', 'Penerimaan bersih berdasarkan jenis pesanan', bars(report.orderTypes))}</div>${section('Transaksi terbaru', 'Pilih nomor struk untuk membuka rincian', table(salesDefinition(report).headers, report.sales.slice(0, 5).map(salesDefinition(report).row)), link('sales', 'Semua transaksi'))}`;
}

function hub(report) {
  const cards = [
    ['sales', 'receipt', 'Penjualan', 'Telusuri transaksi, rincian struk, dan penerimaan outlet.', `${number(report.sales.length)} transaksi`],
    ['product-report', 'product', 'Performa produk', 'Kenali produk terlaris dan nilai item yang masih terjual.', `${number(report.products.length)} produk tercatat`],
    ['payments', 'payment', 'Metode pembayaran', 'Lihat komposisi penerimaan, refund, dan biaya pembayaran.', `${number(report.methods.length)} metode pembayaran`],
    ['staff-report', 'staff', 'Performa staf', 'Tinjau transaksi dan penerimaan berdasarkan nama kasir.', `${number(report.cashiers.length)} nama kasir`],
    ['refunds', 'refund', 'Pengembalian dana', 'Periksa pengembalian dana untuk struk pada periode pilihan.', `${number(report.refunds.length)} struk dengan refund`],
    ['expenses', 'expense', 'Biaya usaha', 'Pantau biaya operasional dan catatan pembatalannya.', `${number(report.expense.expenses.length)} catatan biaya`],
  ];
  return `<section class="r-banner"><div><small>LAPORAN KEUANGAN</small><h2>Laporan laba rugi</h2><p>Pendapatan, harga pokok, dan biaya usaha dalam satu laporan.</p></div>${link('profit', 'Lihat laba rugi')}</section><div class="r-hub-grid">${cards.map(([view, symbol, title, description, caption]) => `<a class="r-card r-report-card" href="#${view}" data-report-route="${view}"><span>${icon(symbol)}</span><h2>${title}</h2><p>${description}</p><strong>${h(caption)} ${icon('arrow')}</strong></a>`).join('')}</div>`;
}

function profitLines(report) {
  const f = report.finance;
  return [
    ['Total nilai struk sebelum refund', f.receipts], ['Pengembalian dana', -f.refunds], ['Penerimaan bersih', f.netReceipts],
    ['Pajak pelanggan (dikeluarkan dari pendapatan)', -f.tax], ['Layanan (dikeluarkan dari pendapatan)', -f.service],
    ['Surcharge pelanggan (dikeluarkan dari pendapatan)', -f.surcharge], ['Penjualan bersih', f.revenue],
    [f.complete ? 'Harga pokok penjualan' : 'HPP tercatat (sementara)', -f.cogs], ['Laba kotor', f.grossProfit],
    ['Biaya pembayaran / MDR', -f.mdr], ['Kontribusi setelah MDR', f.contribution],
    ...report.expense.categories.filter(category => category.amount !== 0).map(category => [category.label, -category.amount]),
    ['Total biaya usaha', -report.expense.total], ['Laba operasional sebelum pajak penghasilan', report.operatingProfit],
  ];
}
const profitLine = (label, amount, subtotal = false) => `<div class="r-profit-line${subtotal ? ' r-profit-subtotal' : ''}"><span>${h(label)}</span><strong>${h(money(amount))}</strong></div>`;

function profit(report, outlet, range) {
  const f = report.finance;
  const margin = f.complete && f.revenue > 0 ? report.operatingProfit / f.revenue * 100 : null;
  return `<div class="r-profit-layout"><section class="r-card r-profit-report"><header class="r-profit-title"><div><h2>${h(outlet?.name || 'Outlet')}</h2><p>Laporan laba rugi · ${h(date(range.start))} – ${h(date(range.end))}</p></div>${badge(f.complete ? 'Data tercatat' : 'Sementara', f.complete ? '' : 'amber')}</header><div class="r-profit-section"><h3>Pendapatan usaha</h3>${profitLine('Total nilai struk sebelum refund', f.receipts)}${profitLine('Pengembalian dana', -f.refunds)}${profitLine('Penerimaan bersih', f.netReceipts, true)}${profitLine('Pajak pelanggan', -f.tax)}${profitLine('Layanan', -f.service)}${profitLine('Surcharge pelanggan', -f.surcharge)}${profitLine('Penjualan bersih', f.revenue, true)}<p>Total struk sudah memperhitungkan diskon dan pembulatan. Pajak, layanan, dan surcharge dikeluarkan dari pendapatan usaha.</p></div><div class="r-profit-section"><h3>Harga pokok & biaya pembayaran</h3>${profitLine(f.complete ? 'HPP produk terjual' : 'HPP tercatat · sementara', -f.cogs)}${profitLine('Laba kotor', f.grossProfit, true)}${profitLine('Biaya pembayaran / MDR', -f.mdr)}${profitLine('Kontribusi setelah MDR', f.contribution, true)}</div><div class="r-profit-section"><h3>Biaya operasional</h3>${report.expense.categories.filter(row => row.amount !== 0).map(row => profitLine(row.label, -row.amount)).join('') || '<p>Belum ada biaya usaha pada periode ini.</p>'}${profitLine('Total biaya usaha', -report.expense.total, true)}</div><div class="r-profit-result"><div>Laba operasional sebelum pajak penghasilan<small>${margin === null ? 'Margin belum tersedia untuk data ini' : `Margin ${number(margin)}% dari penjualan bersih`}</small></div><strong>${h(money(report.operatingProfit))}</strong></div><p class="r-footnote">Refund mengikuti tanggal penjualan asal. Laporan ini mencakup data tersinkron dan biaya yang sudah dicatat; belum mencakup pajak penghasilan.</p></section><aside class="r-card r-profit-notes"><h2>Komposisi biaya usaha</h2><p>Hanya komponen yang tercatat untuk periode dan outlet yang dipilih.</p>${bars([{ name: 'HPP tercatat', amount: f.cogs }, { name: 'Biaya pembayaran', amount: f.mdr }, { name: 'Biaya operasional', amount: report.expense.total }], 'amount')}<div class="r-note"><strong>${f.complete ? 'HPP mengikuti transaksi' : 'HPP belum lengkap'}</strong><p>HPP menggunakan snapshot biaya pada struk dan pengembalian stok. ${f.complete ? 'Harga produk saat ini tidak mengubah biaya penjualan lama.' : 'Nominal HPP di sini hanya jumlah yang dapat dibaca. Laba yang ditampilkan masih sementara.'}</p></div>${link('expenses', 'Rincian biaya usaha')}</aside></div>`;
}

function salesDefinition(report) {
  const refundedIds = new Set(report.refunds.map(row => row.id));
  return {
    headers: ['Nomor struk / waktu', 'Pelanggan', 'Kasir', 'Pembayaran', 'Status', 'Penerimaan bersih'], rows: report.sales,
    search: sale => [sale.id, sale.date, sale.time, sale.cashier, sale.method, sale.table_type, sale.customer?.name].join(' '),
    filters: [['all', 'Semua status'], ['complete', 'Selesai'], ['refund', 'Dengan refund']],
    filter: (sale, value) => value === 'all' || (value === 'refund' ? refundedIds.has(sale.id) : sale.status === 'SUCCESS' && !Number(sale.refunded_amount)),
    row: sale => `<tr><td>${saleButton(sale)}${small(`${date(sale.date)} · ${sale.time || '—'}`)}</td>${td(sale.customer?.name || 'Pelanggan umum')}${td(sale.cashier || 'Belum tercatat')}${td(sale.method || 'Belum tercatat')}<td>${saleStatus(sale)}</td>${td(money(netSaleAmount(sale, report.logs)), 'r-num')}</tr>`,
  };
}

function definition(view, report) {
  if (view === 'sales') return salesDefinition(report);
  if (view === 'product-report') return {
    headers: ['Produk', 'Kategori', 'Kuantitas neto', 'Nilai item'], rows: report.products,
    search: row => `${row.name} ${row.category}`,
    row: row => `<tr><td><strong>${h(row.name)}</strong></td>${td(row.category)}${td(number(row.qty), 'r-num')}${td(money(row.amount), 'r-num')}</tr>`,
  };
  if (view === 'payments' || view === 'staff-report') return {
    headers: [view === 'payments' ? 'Metode pembayaran' : 'Nama kasir', 'Transaksi', 'Nilai struk', 'Refund', 'Penerimaan bersih', 'Rata-rata / struk', 'MDR'],
    rows: view === 'payments' ? report.methods : report.cashiers, search: row => row.name,
    row: row => `<tr><td><strong>${h(row.name)}</strong></td>${td(number(row.count), 'r-num')}${td(money(row.gross), 'r-num')}${td(money(row.refund), 'r-num')}${td(money(row.net), 'r-num')}${td(money(row.count ? row.net / row.count : 0), 'r-num')}${td(money(row.mdr), 'r-num')}</tr>`,
  };
  if (view === 'refunds') return {
    headers: ['Struk asal', 'Tanggal penjualan', 'Kasir', 'Status', 'Nilai struk', 'Refund', 'Penerimaan tersisa'], rows: report.refunds,
    search: row => [row.id, row.date, row.cashier, row.method, ...report.logs.filter(log => log.sale_id === row.id).map(log => log.reason)].join(' '),
    filters: [['all', 'Semua refund'], ['full', 'Refund penuh'], ['partial', 'Refund sebagian'], ['unknown', 'Perlu rekonsiliasi']],
    filter: (row, value) => value === 'all' || (value === 'unknown' ? refundAmount(row, report.logs) === null : value === 'full' ? row.status === 'REFUNDED' : row.status !== 'REFUNDED'),
    row: row => `<tr><td>${saleButton(row)}</td>${td(date(row.date))}${td(row.cashier || 'Belum tercatat')}<td>${saleStatus(row)}</td>${td(money(row.total), 'r-num')}${td(money(refundAmount(row, report.logs)), 'r-num')}${td(money(netSaleAmount(row, report.logs)), 'r-num')}</tr>`,
  };
  if (view === 'expenses') return {
    headers: ['Tanggal usaha', 'Kategori / keterangan', 'Sumber dana', 'Dicatat oleh', 'Status', 'Nominal'], rows: report.expense.expenses,
    search: row => [row.date, row.label, row.description, row.source, row.staff, row.id].join(' '),
    filters: [['all', 'Semua catatan'], ['active', 'Tercatat'], ['reversed', 'Dibatalkan / pembatalan'], ['legacy', 'Format lama']],
    filter: (row, value) => value === 'all' || (value === 'legacy' ? row.legacy : value === 'active' ? !row.reversal && !row.reversed : row.reversal || row.reversed),
    row: row => `<tr>${td(date(row.date))}<td><strong>${h(row.label)}</strong>${small(row.description)}${row.legacy ? badge('Format lama', 'amber') : ''}</td>${td(row.source)}${td(row.staff || 'Belum tercatat')}<td>${badge(expenseStatus(row), row.reversal || row.reversed ? 'gray' : '')}</td>${td(money(row.amount), 'r-num')}</tr>`,
  };
  return null;
}

function visibleRows(def, state) {
  const query = state.query.trim().toLocaleLowerCase('id-ID');
  return def.rows.filter(row => (!query || def.search(row).toLocaleLowerCase('id-ID').includes(query)) && (!def.filter || def.filter(row, state.filter)));
}

function tablePage(def, state) {
  const rows = visibleRows(def, state), pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  state.page = Math.min(Math.max(0, state.page), pages - 1);
  const first = state.page * PER_PAGE, chosen = rows.slice(first, first + PER_PAGE);
  return `${table(def.headers, chosen.map(def.row))}<div class="r-table-footer"><span role="status">${rows.length ? `${number(first + 1)}–${number(Math.min(first + PER_PAGE, rows.length))} dari ${number(rows.length)}` : '0 catatan'}${rows.length !== def.rows.length ? ` · ${number(def.rows.length)} total` : ''}</span><div class="r-pagination" aria-label="Halaman tabel"><button type="button" data-report-page="${state.page - 1}"${state.page === 0 ? ' disabled' : ''} aria-label="Halaman sebelumnya">‹</button><span>${number(state.page + 1)} / ${number(pages)}</span><button type="button" data-report-page="${state.page + 1}"${state.page >= pages - 1 ? ' disabled' : ''} aria-label="Halaman berikutnya">›</button></div></div>`;
}

function reportTable(view, report, title, description, summaries) {
  const def = definition(view, report), state = { query: '', filter: 'all', page: 0 };
  return `<section class="r-card r-data-card"><header class="r-card-head"><div><h2>${h(title)}</h2><p>${h(description)}</p></div>${badge(`${number(def.rows.length)} catatan`, 'gray')}</header>${summary(summaries)}<div class="r-toolbar"><label class="r-search">${icon('search')}<span class="sr-only">Cari di ${h(title.toLocaleLowerCase('id-ID'))}</span><input type="search" data-report-search placeholder="Cari di laporan…" maxlength="200" autocomplete="off"></label>${def.filters ? `<label class="r-filter"><span class="sr-only">Filter ${h(title.toLocaleLowerCase('id-ID'))}</span><select data-report-filter>${def.filters.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>` : ''}<span class="r-export-note">CSV dan cetak mencakup seluruh catatan periode ini.</span></div><div data-report-table>${tablePage(def, state)}</div></section>`;
}

function detailView(view, report) {
  const f = report.finance;
  if (view === 'sales') return reportTable(view, report, 'Riwayat penjualan', 'Klik nomor struk untuk melihat item, komponen tagihan, dan catatan refund.', [['Penerimaan bersih', money(f.netReceipts), 'Termasuk pajak dan layanan'], ['Jumlah transaksi', number(f.transactions)], ['Pengembalian dana', money(f.refunds), f.complete ? 'Untuk struk periode ini' : 'Sementara · periksa catatan']]);
  if (view === 'product-report') return reportTable(view, report, 'Performa produk', 'Nilai item setelah refund kuantitas, sebelum diskon dan pajak struk. Tidak menunjukkan margin produk.', [['Produk tercatat', number(report.products.length)], ['Kuantitas neto', number(sum(report.products, 'qty'))], ['Nilai item', money(sum(report.products, 'amount')), 'Bukan total penerimaan struk']]);
  if (view === 'payments') return `<div class="r-two-columns">${section('Komposisi pembayaran', 'Penerimaan bersih setelah refund', paymentChart(report))}${section('Jenis pesanan', 'Penerimaan berdasarkan jenis pesanan', bars(report.orderTypes))}</div>` + reportTable(view, report, 'Rincian pembayaran', 'MDR adalah biaya yang dikenakan ke merchant; tidak otomatis kembali saat refund.', [['Penerimaan bersih', money(f.netReceipts)], ['Metode pembayaran', number(report.methods.length)], ['Biaya MDR', money(f.mdr)]]);
  if (view === 'staff-report') return reportTable(view, report, 'Penjualan per kasir', 'Dikelompokkan berdasarkan nama kasir pada struk, bukan penilaian jam kerja atau absensi.', [['Nama kasir tercatat', number(report.cashiers.length)], ['Transaksi', number(f.transactions)], ['Penerimaan bersih', money(f.netReceipts)]]);
  if (view === 'refunds') return reportTable(view, report, 'Pengembalian dana', 'Mengikuti tanggal struk asal, termasuk refund yang dilakukan di luar periode pilihan. Buka struk untuk catatan yang tersedia.', [['Struk dengan refund', number(report.refunds.length)], ['Total refund tercatat', money(f.refunds)], ['Perlu rekonsiliasi', number(report.refunds.filter(row => refundAmount(row, report.logs) === null).length)]]);
  if (view === 'expenses') return `<div class="r-note r-expense-note"><strong>Biaya dari aplikasi kasir</strong><p>Halaman ini menampilkan catatan biaya yang telah tersinkron. Pencatatan dan pembatalan biaya dilakukan melalui aplikasi VORA POS. Pembatalan bernilai negatif agar biaya tidak dihitung dua kali.</p></div>` + reportTable(view, report, 'Catatan biaya usaha', 'Tanggal usaha dan sumber dana sesuai catatan biaya asli.', [['Total biaya neto', money(report.expense.total), 'Setelah pembatalan tercatat'], ['Catatan biaya', number(report.expense.expenses.length)], ['Kategori dengan biaya', number(report.expense.categories.filter(row => row.amount !== 0).length)]]);
  return '';
}

export function renderReport(view, { report, outlet, range } = {}) {
  if (!report) return `<div class="reports-surface">${empty('Laporan belum dimuat. Pilih outlet dan periode untuk melihat data.')}</div>`;
  const actualRange = range || report.range;
  const body = view === 'overview' ? overview(report) : view === 'reports' ? hub(report) : view === 'profit' ? profit(report, outlet, actualRange) : detailView(view, report);
  return `<div class="reports-surface" data-report-view="${h(view)}">${warnings(report)}<div class="r-screen-report">${view === 'overview' ? '' : tabs(view)}${body || empty('Halaman laporan tidak tersedia.')}</div><div class="r-print-report" aria-hidden="true"></div></div>`;
}

function transactionDetail(sale, report, outlet) {
  const refund = refundAmount(sale, report.logs), net = netSaleAmount(sale, report.logs);
  const items = Array.isArray(sale.cart_data) ? sale.cart_data : [];
  const logs = report.logs.filter(row => row.sale_id === sale.id);
  const metadata = [['Outlet', outlet?.name || '—'], ['Tanggal dan waktu struk', `${date(sale.date)} · ${sale.time || '—'}`], ['Kasir', sale.cashier || 'Belum tercatat'], ['Pembayaran', sale.method || 'Belum tercatat'], ['Jenis pesanan', sale.table_type || 'Belum tercatat'], ['Pelanggan', sale.customer?.name || 'Pelanggan umum']];
  const itemRows = items.map(item => `<tr><td><strong>${h(item.name || 'Item')}</strong>${item.isPayment ? small('Penyesuaian pembayaran nominal') : ''}${(Array.isArray(item.selectedExtrasList) ? item.selectedExtrasList : []).map(extra => small(`+ ${extra.name || 'Tambahan'}`)).join('')}</td>${td(number(item.qty), 'r-num')}${td(money(item.price), 'r-num')}${td(money(numeric(item.qty) === null || numeric(item.price) === null ? null : Number(item.qty) * Number(item.price)), 'r-num')}</tr>`);
  return `<div class="reports-surface r-receipt-detail"><div class="r-detail-grid">${metadata.map(([label, value]) => `<div><small>${h(label)}</small><strong>${h(value)}</strong></div>`).join('')}</div>${table(['Item pada struk', 'Qty', 'Harga / item', 'Nilai item'], itemRows)}<div class="r-detail-totals">${[['Subtotal', sale.subtotal], ['Diskon', numeric(sale.discount) === null ? null : -Number(sale.discount)], ['Pajak', sale.tax], ['Layanan', sale.service], ['Surcharge', sale.payment_surcharge], ['Total struk', sale.total], ['Refund', refund], ['Penerimaan bersih', net]].map(([label, value], index) => profitLine(label, value, index === 5 || index === 7)).join('')}</div>${saleStatus(sale)}${refund === null ? '<div class="r-warning"><strong>Refund belum dapat dipastikan</strong><p>Struk lama ini memerlukan rekonsiliasi. Nominal yang tidak diketahui ditampilkan sebagai —.</p></div>' : ''}${logs.length ? `<section class="r-detail-logs"><h3>Catatan pengembalian dana</h3>${logs.map(log => `<article><strong>${h(log.reason || 'Tanpa keterangan')}</strong><p>${h(date(log.date))} · ${h(log.time || '—')} · ${h(log.cashier_name || 'Staf belum tercatat')}</p>${log.item_name ? `<p>${h(log.item_name)}</p>` : ''}${numeric(log.total_amount) !== null ? `<p>${h(money(log.total_amount))}</p>` : ''}</article>`).join('')}</section>` : ''}<p class="r-footnote">Rincian sesuai data transaksi yang tersinkron. Harga item sudah termasuk tambahannya; komponen yang belum tercatat ditampilkan sebagai —.</p></div>`;
}

function exportDataRows(view, report) {
  if (!report) return [];
  if (view === 'product-report') return [['Produk', 'Kategori', 'Kuantitas neto', 'Nilai item sebelum diskon dan pajak struk'], ...report.products.map(row => [row.name, row.category, row.qty, row.amount])];
  if (view === 'payments' || view === 'staff-report') return [[view === 'payments' ? 'Metode pembayaran' : 'Nama kasir', 'Transaksi', 'Nilai struk sebelum refund', 'Refund', 'Penerimaan bersih', 'Rata-rata penerimaan per struk', 'MDR'], ...(view === 'payments' ? report.methods : report.cashiers).map(row => [row.name, row.count, row.gross, row.refund, row.net, row.count ? row.net / row.count : 0, row.mdr])];
  if (view === 'profit') return [['Komponen', 'Nominal IDR'], ...profitLines(report), ['Status laporan', report.finance.complete ? 'Komponen tersedia; hanya data tersinkron' : `Sementara: ${report.finance.issues.join(' ')}`], ...(legacyExpenses(report) ? [['Catatan biaya', 'Ada biaya format lama; periksa kesesuaian sebelum menggunakan laba sebagai angka final.']] : [])];
  if (view === 'expenses') return [['ID catatan', 'Tanggal usaha', 'Kategori', 'Keterangan', 'Sumber dana', 'Staf', 'Status', 'Nominal IDR', 'Format catatan'], ...report.expense.expenses.map(row => [row.id, row.date, row.label, row.description, row.source, row.staff, expenseStatus(row), row.amount, row.legacy ? 'Lama' : 'Buku biaya'])];
  if (view === 'refunds') return [['Struk asal', 'Tanggal penjualan', 'Waktu struk', 'Kasir', 'Metode', 'Status', 'Total struk', 'Refund', 'Penerimaan tersisa', 'Catatan rekonsiliasi', 'Alasan refund tercatat'], ...report.refunds.map(sale => [sale.id, sale.date, sale.time, sale.cashier, sale.method, statusLabel(sale), numeric(sale.total), refundAmount(sale, report.logs), netSaleAmount(sale, report.logs), refundAmount(sale, report.logs) === null ? 'Refund belum dapat dipastikan' : '', report.logs.filter(log => log.sale_id === sale.id).map(log => log.reason || '').filter(Boolean).join(' | ')])];
  return [['Nomor struk', 'Tanggal usaha', 'Waktu struk', 'Pelanggan', 'Kasir', 'Jenis pesanan', 'Metode', 'Status', 'Subtotal', 'Diskon', 'Pajak', 'Layanan', 'Surcharge', 'MDR', 'Total struk', 'Refund', 'Penerimaan bersih'], ...report.sales.map(sale => [sale.id, sale.date, sale.time, sale.customer?.name || '', sale.cashier, sale.table_type, sale.method, statusLabel(sale), numeric(sale.subtotal), numeric(sale.discount), numeric(sale.tax), numeric(sale.service), numeric(sale.payment_surcharge), numeric(sale.mdr_fee), numeric(sale.total), refundAmount(sale, report.logs), netSaleAmount(sale, report.logs)])];
}

/** Full-period export: search and pagination never silently omit ledger records. */
export function reportExportRows(view, report) {
  const rows = exportDataRows(view, report);
  if (report && view !== 'profit' && legacyExpenses(report)) rows.push([], ['Catatan biaya', 'Ada biaya format lama; periksa kesesuaian sebelum menggunakan laba sebagai angka final.']);
  return rows;
}

function printReport(view, report, outlet, range) {
  const labels = { overview: 'Ringkasan dan transaksi', reports: 'Seluruh transaksi', sales: 'Penjualan', profit: 'Laba rugi', 'product-report': 'Performa produk', payments: 'Metode pembayaran', 'staff-report': 'Penjualan per kasir', refunds: 'Pengembalian dana', expenses: 'Biaya usaha' };
  // Sale print columns stay readable on A4; financial component detail remains in CSV and each receipt.
  const salePrint = ['overview', 'reports', 'sales'].includes(view);
  const rows = salePrint ? [['Nomor struk / tanggal', 'Kasir', 'Metode', 'Total struk', 'Refund', 'Neto'], ...report.sales.map(sale => [`${sale.id}\n${sale.date} ${sale.time || ''}`, sale.cashier, sale.method, money(sale.total), money(refundAmount(sale, report.logs)), money(netSaleAmount(sale, report.logs))])] : reportExportRows(view, report);
  const headers = rows[0] || [];
  return `<header class="r-print-heading"><h2>${h(labels[view] || 'Laporan')} · ${h(outlet?.name || 'Outlet')}</h2><p>${h(date(range.start))} – ${h(date(range.end))} · seluruh catatan periode ini</p></header>${['overview', 'reports'].includes(view) ? summary([['Penjualan bersih', money(report.finance.revenue)], ['Penerimaan bersih', money(report.finance.netReceipts)], ['Laba operasional', money(report.operatingProfit)]]): ''}${table(headers, rows.slice(1).map(row => `<tr>${row.map(value => td(value === null || value === undefined ? '—' : value)).join('')}</tr>`))}<p class="r-footnote">Data hanya mencakup catatan yang telah tersinkron. Tanggal mengikuti tanggal usaha pada struk. Ekspor CSV memuat seluruh komponen angka.</p>`;
}

/** Bind once after render; cleanup must be called before outlet/route/auth changes. */
export function bindReport(container, api) {
  const surface = container.querySelector('.reports-surface[data-report-view]');
  if (!surface || !api.report) return () => {};
  const view = surface.dataset.reportView, report = api.report, outlet = api.outlet, range = api.range || report.range;
  const def = definition(view, report), state = { query: '', filter: 'all', page: 0 };
  const repaintTable = () => { const host = surface.querySelector('[data-report-table]'); if (host && def) host.innerHTML = tablePage(def, state); };
  const onInput = event => {
    if (!event.target.matches('[data-report-search]') || !def) return;
    state.query = event.target.value.slice(0, 200); state.page = 0; repaintTable();
  };
  const onChange = event => {
    if (!event.target.matches('[data-report-filter]') || !def) return;
    if (!def.filters?.some(([value]) => value === event.target.value)) return;
    state.filter = event.target.value; state.page = 0; repaintTable();
  };
  const onClick = event => {
    const target = event.target.closest('[data-report-route],[data-report-sale],[data-report-page],[data-report-chart-metric]');
    if (!target || !surface.contains(target) || target.disabled) return;
    event.preventDefault(); event.stopPropagation();
    if (target.dataset.reportRoute) { api.navigate(target.dataset.reportRoute); return; }
    if (target.dataset.reportPage !== undefined && def) {
      state.page = Number(target.dataset.reportPage) || 0; repaintTable();
      surface.querySelector('.r-table-wrap')?.focus({ preventScroll: true }); return;
    }
    if (target.dataset.reportChartMetric) {
      const metric = target.dataset.reportChartMetric;
      if (!['net', 'count'].includes(metric)) return;
      surface.querySelector('[data-report-chart]').innerHTML = chart(report, metric);
      surface.querySelectorAll('[data-report-chart-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.reportChartMetric === metric)));
      return;
    }
    if (target.dataset.reportSale) {
      const sale = report.sales.find(row => row.id === target.dataset.reportSale && row.outlet_id === report.outletId);
      if (!sale) return;
      api.modal({ title: sale.id, description: 'Rincian transaksi yang tersinkron dari aplikasi kasir', content: transactionDetail(sale, report, outlet), footer: '<button type="button" class="btn btn-secondary" data-close-modal>Tutup</button>' });
    }
  };
  const beforePrint = () => {
    const host = surface.querySelector('.r-print-report');
    if (host) { host.innerHTML = printReport(view, report, outlet, range); host.setAttribute('aria-hidden', 'false'); }
  };
  const afterPrint = () => {
    const host = surface.querySelector('.r-print-report');
    if (host) { host.replaceChildren(); host.setAttribute('aria-hidden', 'true'); }
  };
  container.addEventListener('input', onInput); container.addEventListener('change', onChange); container.addEventListener('click', onClick);
  window.addEventListener('beforeprint', beforePrint); window.addEventListener('afterprint', afterPrint);
  return () => {
    container.removeEventListener('input', onInput); container.removeEventListener('change', onChange); container.removeEventListener('click', onClick);
    window.removeEventListener('beforeprint', beforePrint); window.removeEventListener('afterprint', afterPrint);
  };
}

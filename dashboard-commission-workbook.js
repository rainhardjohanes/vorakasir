import {commissionReportModel,commissionSummaryRows,commissionDetailRows} from '/dashboard-commission-report-model.js';
let enginePromise;
const loadEngine=()=>enginePromise ||= import('/dashboard-vendor-excel-workbook.js');
export const COMMISSION_XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const colors={ink:'FF18372B',green:'FF176749',pale:'FFF0F7F2',line:'FFD6E4DC',white:'FFFFFFFF',muted:'FF52645B'};
const amountFormat='"Rp "#,##0;[Red]("Rp "#,##0);"Rp "0';
const text=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,' ');
const scalar=value=>typeof value==='number'?value:value==null?'—':text(value);
function merged(sheet,row,from,to,value,{size=11,bold=false,color=colors.ink,fill,height=24}={}){
 sheet.mergeCells(row,from,row,to);const cell=sheet.getCell(row,from);cell.value=scalar(value);cell.font={name:'Aptos',size,bold,color:{argb:color}};cell.alignment={vertical:'middle',wrapText:true};if(fill)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};sheet.getRow(row).height=height;return cell;
}
function table(sheet,headers,rows,{start=10,numeric=[],money=[]}={}){
 const header=sheet.getRow(start);header.values=[...headers];header.height=30;
 header.eachCell(cell=>{cell.font={name:'Aptos',size:11,bold:true,color:{argb:colors.white}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:colors.green}};cell.alignment={vertical:'middle',wrapText:true};});
 for(let i=0;i<rows.length;i++){
  const row=sheet.getRow(start+i+1);row.values=rows[i].map(scalar);row.height=28;
  row.eachCell((cell,col)=>{cell.font={name:'Aptos',size:11,color:{argb:colors.ink}};cell.alignment={vertical:'middle',wrapText:true,horizontal:numeric.includes(col)?'right':'left'};cell.numFmt=money.includes(col)?amountFormat:numeric.includes(col)?'#,##0.########':'@';cell.border={bottom:{style:'hair',color:{argb:colors.line}}};if(i%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:colors.pale}};});
 }
 sheet.autoFilter={from:{row:start,column:1},to:{row:Math.max(start, start+rows.length),column:headers.length}};
 sheet.views=[{state:'frozen',ySplit:start,activeCell:`A${start+1}`,showGridLines:false}];
 sheet.pageSetup={paperSize:9,orientation:headers.length>5?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:`${start}:${start}`,margins:{left:0.3,right:0.3,top:0.4,bottom:0.4,header:0.2,footer:0.2}};
 sheet.headerFooter={oddFooter:'&LVORA Kasir&RHalaman &P dari &N'};
}
export async function createCommissionWorkbook({report,outlet,filters,generatedAt=new Date().toISOString(),timeZone}={}){
 const model=commissionReportModel(report,{outlet,filters,generatedAt,timeZone});
 if(model.items.length>50000)throw new TypeError('Rincian melebihi 50.000 catatan. Pilih periode lebih pendek; ekspor tidak dipotong.');
 const {Workbook}=await loadEngine();const workbook=new Workbook();workbook.creator='VORA Kasir';workbook.title='Laporan Komisi Karyawan';workbook.subject=`${model.outletName} · ${model.dateFrom} – ${model.dateUntil}`;workbook.created=new Date(model.generatedAt);workbook.modified=new Date(model.generatedAt);
 const summary=workbook.addWorksheet('Ringkasan Komisi',{properties:{tabColor:{argb:colors.green}}});
 summary.columns=[{width:30},{width:28},{width:16},{width:16},{width:24}];
 merged(summary,1,1,5,'VORA POS',{size:14,bold:true,color:colors.green,height:28});
 merged(summary,2,1,5,'LAPORAN KOMISI KARYAWAN',{size:20,bold:true,height:38});
 merged(summary,3,1,5,`Cabang: ${model.outletName}`);
 merged(summary,4,1,5,`Periode transaksi: ${model.dateFrom} s.d. ${model.dateUntil}`);
 merged(summary,5,1,5,`Filter karyawan / cabang: ${model.filters.search||'Semua'}`);
 merged(summary,6,1,5,`Dibuat: ${model.generatedLabel} (${model.timeZone})`);
 merged(summary,7,1,5,`Menampilkan ${model.summary.length} dari ${model.totalStaff} karyawan · Versi laporan ${model.reportVersion}`,{color:colors.muted});
 merged(summary,8,1,3,model.totalLabel.toLocaleUpperCase('id-ID'),{bold:true,fill:colors.pale,height:36});
 const total=merged(summary,8,4,5,model.totals.net,{size:18,bold:true,color:colors.green,fill:colors.pale,height:36});total.numFmt=amountFormat;total.alignment={horizontal:'right',vertical:'middle'};
 const [headers,...rows]=commissionSummaryRows(model);table(summary,headers,rows,{numeric:[3,4,5],money:[5]});
 let next=11+rows.length;
 if(!rows.length){merged(summary,next++,1,5,'Tidak ada komisi yang cocok dengan periode dan filter ini.',{color:colors.muted,height:32});}
 merged(summary,next++,1,4,model.totalLabel.toLocaleUpperCase('id-ID'),{bold:true,fill:colors.pale,height:30});const totalCell=summary.getCell(next-1,5);totalCell.value=model.totals.net;totalCell.numFmt=amountFormat;totalCell.font={name:'Aptos',bold:true,color:{argb:colors.green}};
 merged(summary,++next,1,5,model.countNote,{size:10,color:colors.muted,height:60});
 merged(summary,++next,1,5,'Komisi berdasarkan penerima layanan, bukan kasir pembayaran. Catatan komisi bukan bukti pembayaran gaji.',{size:10,color:colors.muted,height:34});
 for(const warning of model.warnings)merged(summary,++next,1,5,warning,{size:10,color:colors.muted,height:44});
 summary.pageSetup.printArea=`A1:E${next}`;
 const detail=workbook.addWorksheet('Rincian Komisi');detail.columns=Array.from({length:28},(_,index)=>({width:[0,2,8,13].includes(index)?28:[3,26].includes(index)?24:[4,5,14,24,25].includes(index)?38:19}));
 merged(detail,1,1,8,'VORA POS · RINCIAN KOMISI',{size:18,bold:true,height:34});
 merged(detail,2,1,8,`Cabang: ${model.outletName} | Periode: ${model.dateFrom} s.d. ${model.dateUntil}`);
 merged(detail,3,1,8,`Filter: ${model.filters.search||'Semua'} | Dibuat: ${model.generatedLabel} (${model.timeZone})`);
 merged(detail,4,1,8,model.hasHistorical?'Nilai arsip Majoo sesuai laporan sumber; koreksi refund VORA ditampilkan terpisah.':'Seluruh catatan sesuai filter; nilai positif = komisi lunas, pengurang refund ditampilkan terpisah.',{color:colors.muted});
 merged(detail,5,1,8,'— berarti data tidak tersedia atau tidak berlaku. Unit refund hanya catatan item dengan sumber pasti; bukan total seluruh unit yang dikembalikan.',{color:colors.muted,height:38});
 const [detailHeaders,...detailRows]=commissionDetailRows(model);table(detail,detailHeaders,detailRows,{start:7,numeric:[11,12,16,18,21,22,23,24],money:[21,22,23,24]});
 const end=8+detailRows.length;merged(detail,end,1,20,'TOTAL SESUAI FILTER',{bold:true,fill:colors.pale,height:30});
 for(const [col,value] of [[22,model.totals.earned],[23,model.totals.reversed],[24,model.totals.net]]){const cell=detail.getCell(end,col);cell.value=value;cell.numFmt=amountFormat;cell.font={name:'Aptos',bold:true,color:{argb:colors.green}};}
 detail.pageSetup.printArea=`A1:AB${end}`;
 return new Uint8Array(await workbook.xlsx.writeBuffer({useStyles:true,useSharedStrings:true}));
}

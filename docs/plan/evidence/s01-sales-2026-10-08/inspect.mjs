import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const dir=fileURLToPath(new URL('.',import.meta.url));
const previews=await fs.mkdtemp(path.join(os.tmpdir(),'ray-s01-preview-'));
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(dir+'/outputs/销售汇总.xlsx'));
const overview=await wb.inspect({kind:'workbook,sheet,table',maxChars:5000,tableMaxRows:5,tableMaxCols:4});
await fs.writeFile(dir+'/workbook-inspect.ndjson',overview.ndjson);
console.log(overview.ndjson);
const specs=[['销售汇总','A1:D22'],['去重后明细','A1:D289'],['金额缺失订单','A1:D6']];
const cells={};
for(const [name,range] of specs){
 const sh=wb.worksheets.getItem(name);
 cells[name]={range,values:sh.getRange(range).values,formulas:sh.getRange(range).formulas};
 const blob=await wb.render({sheetName:name,range:name==='去重后明细'?'A1:E16':name==='销售汇总'?'A1:F23':'A1:E7',scale:1.5,format:'png'});
 await fs.writeFile(path.join(previews,name+'.png'),new Uint8Array(await blob.arrayBuffer()));
}
await fs.writeFile(dir+'/workbook-values.json',JSON.stringify(cells,null,2)+'\n');
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:30},summary:'error scan'});
await fs.writeFile(dir+'/workbook-errors.ndjson',errors.ndjson);
console.log(errors.ndjson);

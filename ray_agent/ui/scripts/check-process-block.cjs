/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ts=require(root+'/node_modules/typescript');
const cache={};
function load(file){
 if(cache[file])return cache[file];const exports={};cache[file]=exports;
 const code=ts.transpileModule(fs.readFileSync(root+'/src/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',code)(name=>{throw Error(name)},exports);return exports;
}
const {groupProcessBlocks,processSettled,processBlockOpen}=load('lib/process-blocks.ts');
const live=[
 {id:'n',kind:'narration',runId:'r',at:1,text:'先看文件',turnIndex:1},
 {id:'t',kind:'tools',runId:'r',at:2,turnIndex:1,calls:[{verb:'读取文件',callId:'c'}]},
];
let rows=groupProcessBlocks(live);
assert.equal(rows.length,1);assert.equal(rows[0].type,'process');assert.equal(rows[0].block.items.length,2);
assert.equal(processSettled(live,rows[0].block),false);
assert.equal(processBlockOpen(false,null,false),true);
const settled=[...live,{id:'f',kind:'final',runId:'r',at:3,text:'好',summary:null}];
rows=groupProcessBlocks(settled);
assert.equal(rows.filter(row=>row.type==='process').length,1);
assert.equal(processSettled(settled,rows[0].block),true);
assert.equal(processBlockOpen(true,null,false),false);
assert.equal(processBlockOpen(true,true,false),true);
assert.equal(processBlockOpen(true,null,true),true);
const legacy=[
 {id:'n1',kind:'narration',runId:'r',at:1,text:'a'},
 {id:'t1',kind:'tools',runId:'r',at:2,turnIndex:1,calls:[]},
 {id:'n2',kind:'narration',runId:'r',at:3,text:'b'},
 {id:'t2',kind:'tools',runId:'r',at:4,turnIndex:2,calls:[]},
];
const grouped=groupProcessBlocks(legacy).filter(row=>row.type==='process');
assert.equal(grouped.length,2);
assert.deepEqual(grouped[0].block.items.map(item=>item.id),['n1','t1']);
assert.deepEqual(grouped[1].block.items.map(item=>item.id),['n2','t2']);
const ended=[...live,{id:'end',kind:'run_end',runId:'r',at:4,status:'failed',reason:null,reasonText:'失败',retryText:null}];
assert.equal(processSettled(ended,groupProcessBlocks(ended)[0].block),true);
console.log('PASS: process blocks group a turn, stay open while running, collapse after final or run end');

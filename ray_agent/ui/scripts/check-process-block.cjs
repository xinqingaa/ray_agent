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
const {foldSettledRuns}=load('lib/process-blocks.ts');
assert.ok(foldSettledRuns(groupProcessBlocks(legacy)).every(row=>row.type==='process'));
const done=[...legacy,{id:'d',kind:'delivery',runId:'r',at:5,files:[],note:''},{id:'f2',kind:'final',runId:'r',at:6,text:'好',summary:null}];
const folded=foldSettledRuns(groupProcessBlocks(done));
assert.deepEqual(folded.map(row=>row.type),['fold','item','item']);
assert.equal(folded[0].fold.rows.length,2);
assert.equal(foldSettledRuns(groupProcessBlocks(settled))[0].type,'process');
console.log('PASS: process blocks group a turn, stay open while running, collapse after final or run end; settled runs fold into one block');

// 用户补充、提问、审批、交付与其他运行都是边界；展开折叠后必须仍是原始时间顺序。
const idsOf = rows => rows.flatMap(row => row.type === 'fold' ? idsOf(row.fold.rows)
  : row.type === 'process' ? row.block.items.map(item => item.id) : [row.item.id]);
for (const kind of ['user', 'ask', 'approval', 'delivery', 'protection']) {
  const before = [
    {id:'p1',kind:'narration',runId:'r',at:1,text:'操作前',turnIndex:1},
    {id:'p2',kind:'narration',runId:'r',at:2,text:'继续检查',turnIndex:2},
    {id:'boundary',kind,runId:'r',at:3},
    {id:'p3',kind:'narration',runId:'r',at:4,text:'按新信息执行',turnIndex:3},
    {id:'p4',kind:'narration',runId:'r',at:5,text:'验证结果',turnIndex:4},
    {id:'final',kind:'final',runId:'r',at:6,text:'完成'},
  ];
  const after = foldSettledRuns(groupProcessBlocks(before));
  assert.deepEqual(after.map(row => row.type), ['fold','item','fold','item']);
  assert.deepEqual(idsOf(after), before.map(item => item.id));
  assert.notEqual(after[0].fold.id, after[2].fold.id, '同一运行不同折叠段必须有独立身份');
}
const interleaved = [
  {id:'r1a',kind:'narration',runId:'r1',at:1,text:'a',turnIndex:1},
  {id:'r2a',kind:'narration',runId:'r2',at:2,text:'b',turnIndex:1},
  {id:'r1b',kind:'narration',runId:'r1',at:3,text:'c',turnIndex:2},
  {id:'r1end',kind:'final',runId:'r1',at:4,text:'完成'},
  {id:'r2end',kind:'final',runId:'r2',at:5,text:'完成'},
];
assert.deepEqual(idsOf(foldSettledRuns(groupProcessBlocks(interleaved))), interleaved.map(item=>item.id));
console.log('PASS: 折叠不跨用户补充、提问、审批、交付或运行边界，顺序与分段身份保持');

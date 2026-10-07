/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ts=require(root+'/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync(root+'/src/lib/workbench-width.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const out={};new Function('require','exports',code)(()=>{throw Error('unexpected import')},out);
const {clampWorkbenchWidth,readWorkbenchWidth,WORKBENCH_DEFAULT_PX,WORKBENCH_WIDTH_KEY}=out;
assert.equal(WORKBENCH_DEFAULT_PX,416);
assert.equal(WORKBENCH_WIDTH_KEY,'rayagent.workbenchWidth');
assert.equal(clampWorkbenchWidth(100,1400),384);
assert.equal(clampWorkbenchWidth(9000,1000),600);
assert.equal(clampWorkbenchWidth(500,1400),500);
assert.equal(readWorkbenchWidth(null,1400),416);
assert.equal(readWorkbenchWidth('',1400),416);
assert.equal(readWorkbenchWidth('500',1400),500);
assert.equal(readWorkbenchWidth('100',1400),384);
assert.equal(readWorkbenchWidth('nope',1400),416);
console.log('PASS: workbench width clamps to 24rem-60vw and falls back to 26rem');

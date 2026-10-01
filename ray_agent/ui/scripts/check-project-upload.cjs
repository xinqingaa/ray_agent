/* 浏览器扫描控制的纯运行验证；不替代真实文件夹选择或上传验收。 */
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict');
const {File}=require('node:buffer');global.File=File;global.crypto=require('node:crypto').webcrypto;
const source=fs.readFileSync('src/lib/project-upload.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleObject={exports:{}};new Function('exports','require','module',js)(moduleObject.exports,require,moduleObject);
const {scanProjectUpload,sourcesFromFiles,uploadSelection}=moduleObject.exports;
const rule={version:'fixture-only',max_batch_bytes:200000,max_files:2000,max_file_bytes:50000,max_project_bytes:500000,
 always_exclude:['.git','.DS_Store'],dependency_directories:['node_modules'],conditional_directories:{dist:['package.json'],vendor:['go.mod'],'.venv':['pyproject.toml']},
 sensitive_patterns:['.env','.env.*','*.key'],venv_marker:'pyvenv.cfg'};
const file=(name,content='abc')=>({name,kind:'file',file:async()=>new File([content],name)});
(async()=>{
 let reads=0;
 const node={name:'node_modules',kind:'directory',children:async()=>{reads++;return[file('dep.txt')]}};
 const first=await scanProjectUpload([file('source.csv'),node,file('.env'),{name:'.git',kind:'directory',children:async()=>{throw Error('不得扫描版本库')}}],rule,new Set());
 assert.equal(reads,0);assert.equal(first.excluded.find(x=>x.path==='node_modules').size,null);assert.equal(first.files.length,1);
 assert.equal(first.files[0].sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 const second=await scanProjectUpload([file('source.csv'),node,file('.env')],rule,new Set(['node_modules','.env']));
 assert.equal(reads,1);assert.deepEqual(second.files.map(x=>x.path),['source.csv','node_modules/dep.txt','.env']);
 const selection=uploadSelection(second,rule,new Set(['source.csv']),new Set(['.env']));assert.equal(selection.items.length,1);assert.deepEqual(selection.include_optional,['node_modules','.env']);
 let distReads=0;const dist={name:'dist',kind:'directory',children:async()=>{distReads++;return[file('data.csv')]},hasMarker:async()=>false};
 await scanProjectUpload([file('package.json'),dist],rule,new Set());assert.equal(distReads,0);
 const ordinary=await scanProjectUpload([dist],rule,new Set());assert.equal(distReads,1);assert.equal(ordinary.files[0].path,'dist/data.csv');
 const venv={name:'materials',kind:'directory',hasMarker:async()=>true,children:async()=>{throw Error('未确认不得扫描')}};
 const marked=await scanProjectUpload([venv],rule,new Set());assert(marked.inventory.includes('materials/pyvenv.cfg'));
 const duplicate=await scanProjectUpload([file('é.txt'),file('e\u0301.txt')],rule,new Set());assert.equal(duplicate.errors.length,1);
 const limited=await scanProjectUpload([file('a'),file('b')],{...rule,max_files:1},new Set());assert(limited.errors.length>0);
 await assert.rejects(()=>scanProjectUpload([file('../bad')],rule,new Set()));
 await assert.rejects(()=>scanProjectUpload([file('a')],rule,new Set(),null,()=>true),{name:'AbortError'});
 const fallbackFile=new File(['1234'],'dep.txt');Object.defineProperty(fallbackFile,'webkitRelativePath',{value:'folder/node_modules/dep.txt'});
 const fallback=await scanProjectUpload(sourcesFromFiles([fallbackFile],true),rule,new Set());assert.equal(fallback.excluded[0].size,4);
 console.log('PASS: lazy directory exclusion, explicit rescan, marker/manifest distinctions, NFC conflicts, hash, quota, cancellation, known fallback sizes');
})().catch(error=>{console.error(error);process.exitCode=1});

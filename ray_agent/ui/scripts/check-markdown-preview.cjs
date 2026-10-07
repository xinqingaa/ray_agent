/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ts=require(root+'/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync(root+'/src/components/run/file-icon.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const out={};
new Function('require','exports',code)(name=>{
 if(name==='lucide-react')return new Proxy({},{get:()=>function Icon(){return null}});
 throw Error(name);
},out);
const {previewBodyKind,previewUnavailableReason}=out;
assert.equal(previewBodyKind('.md'),'markdown');
assert.equal(previewBodyKind('mdx'),'markdown');
assert.equal(previewBodyKind('.markdown'),'markdown');
assert.equal(previewBodyKind('.txt'),'text');
assert.equal(previewBodyKind('.json'),'text');
assert.equal(previewBodyKind('.png'),'image');
assert.equal(previewBodyKind('.pdf'),'pdf');
assert.equal(previewBodyKind('.zip'),'unavailable');
assert.equal(previewUnavailableReason('.md',100),null);
assert.equal(previewUnavailableReason('.mdx',100),null);
assert.ok(previewUnavailableReason('.zip',100));
console.log('PASS: markdown extensions use the markdown preview branch');

// 挂载实际 FilePreview；网络与基础 UI 为替身，不替代真实窗口验收。
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const React = require('react');
const {create, act} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const previewApi = {}, cache = {};
const elements = new Proxy({}, {get: (_, name) => props => React.createElement(name === 'Button' ? 'button' : 'div', props, props.children)});
class ApiError extends Error {constructor(status,code,msg){super(msg);this.status=status;this.code=code}}
function load(file) {
 if(cache[file])return cache[file];
 const exports = {};cache[file]=exports;
 const code = ts.transpileModule(fs.readFileSync(root+'/src/'+file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',code)(name => {
  if(name==='react')return React;
  if(name==='@/hooks/use-developer-mode')return load('hooks/use-developer-mode.ts');
  if(name==='react/jsx-runtime')return require('react/jsx-runtime');
  if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
  if(name==='sonner')return {toast:{error(){},warning(){}}};
  if(name==='@/lib/api/fetch' || name==='./fetch')return {ApiError};
  if(name==='@/lib/api/preview')return previewApi;
  if(name==='@/lib/core-client')return load('lib/core-client.ts');
  if(name==='@/lib/platform')return {};
  if(name==='@/components/preview/file-preview')return load('components/preview/file-preview.tsx');
  if(name==='./action')return {PreviewAction:props=>React.createElement('button',{'aria-label':props.label,onClick:props.onClick,disabled:props.disabled})};
  if(name==='./image-preview')return {ImagePreview:()=>null};
  if(name==='@/components/markdown-content')return {MarkdownContent:props=>React.createElement('p',{},props.content)};
  if(name==='@/components/run/format')return {formatBytes:x=>`${x} B`};
  if(name==='@/lib/utils')return {cn:(...x)=>x.filter(Boolean).join(' ')};
  if(name.startsWith('@/components/ui/'))return elements;
  throw Error(name);
 }, exports);
 return exports;
}
Object.assign(previewApi,load('lib/api/preview.ts'));
const {FilePreview} = load('components/preview/file-preview.tsx');
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const text = r => JSON.stringify(r.toJSON());
const button=(r,label)=>r.root.findAllByType('button').find(b=>b.props['aria-label']===label);
const result=(content,extra={})=>({kind:'text',content,revision:'v1',filename:'b.txt',size:8,...extra});
async function main(){
 let r;
 const reads=[];
 previewApi.readPreview=(endpoint,params,signal)=>{const d=deferred();reads.push({endpoint,params,signal,...d});return d.promise};
 // A failed second page keeps retry on that page; source changes cancel old requests and reset paging.
 await act(async()=>{r=create(React.createElement(FilePreview,{source:{kind:'attachment',id:'one',filename:'one.log'}}))});
 await act(async()=>{reads[0].resolve(result('page one',{partial:true,next_offset:65535}))});
 await act(async()=>{button(r,'下一段').props.onClick()});
 assert.equal(reads[1].params.get('offset'),'65535');assert.equal(reads[1].params.get('revision'),'v1');
 await act(async()=>{reads[1].reject(new ApiError(409,'conflict','文件已更新，请刷新'))});
 await act(async()=>{r.root.findAllByType('button').find(b=>b.children.includes('刷新')).props.onClick()});
 assert.equal(reads[2].params.has('revision'),false);assert.equal(reads[2].params.get('offset'),'0');
 await act(async()=>{r.update(React.createElement(FilePreview,{source:{kind:'attachment',id:'two',filename:'two.txt'}}))});
 assert.equal(reads[2].signal.aborted,true);
 await act(async()=>{reads[3].resolve(result('second file'))});
 await act(async()=>{reads[2].resolve(result('late original'))});
 assert.ok(text(r).includes('second file'));assert.ok(!text(r).includes('late original'));
 await act(async()=>{r.unmount()});
 console.log('PASS: actual shared viewer keeps failed page retry; segmented reads preserve version; source switch cancels and resets; errors never show stale content');
}
main().catch(e=>{console.error(e);process.exitCode=1});

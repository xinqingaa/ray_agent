// 执行实际 React effects；传输与基础 UI 元素为替身，不能替代浏览器验收。
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const React = require('react');
const {create, act} = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const api = {};
const elements = new Proxy({}, {get: (_, name) => props => React.createElement(name === 'Button' ? 'button' : 'div', props, props.children)});
function load(file) {
 const exports = {};
 const code = ts.transpileModule(fs.readFileSync(root+'/src/'+file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',code)(name => {
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return require('react/jsx-runtime');
  if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
  if(name==='sonner')return {toast:{error(){}}};
  if(name==='@/lib/api/project')return {projectApi:api};
  if(name==='@/lib/utils')return {cn:(...x)=>x.filter(Boolean).join(' ')};
  if(name.startsWith('@/components/ui/'))return elements;
  throw Error(name);
 }, exports);
 return exports;
}
const {ProjectPane} = load('components/workbench/project-pane.tsx');
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const listing = {entries:['a.txt','b.txt'].map(name=>({name,path:name,type:'file'})),truncated:false};
const text = r => JSON.stringify(r.toJSON());
const fileButton = (r,path) => r.root.findAllByType('button').find(b=>b.findAll(node => node.type === 'span' && node.children.includes(path)).length > 0);
async function main(){
 let r;
 const reads=[];
 api.getTree=async()=>listing;
 api.getFile=(_,path)=>{const d=deferred();reads.push({path,...d});return d.promise};
 await act(async()=>{r=create(React.createElement(ProjectPane,{sessionId:'s'}))});
 await act(async()=>{fileButton(r,'a.txt').props.onClick()});
 await act(async()=>{fileButton(r,'b.txt').props.onClick()});
 await act(async()=>{reads[1].resolve({kind:'text',content:'new B'})});
 await act(async()=>{reads[0].resolve({kind:'text',content:'late A'})});
 assert.ok(text(r).includes('new B'));assert.ok(!text(r).includes('late A'));
 await act(async()=>{r.update(React.createElement(ProjectPane,{sessionId:'s',refreshSignal:1}))});
 assert.equal(reads.length,3);assert.equal(reads[2].path,'b.txt');
 await act(async()=>{reads[2].reject(Error('file disappeared'))});
 assert.ok(text(r).includes('file disappeared'));assert.ok(!text(r).includes('new B'));
 await act(async()=>{r.unmount()});
 console.log('PASS: actual ProjectPane React effects reject late file response; tool refresh rereads selection; read failure clears old preview');
}
main().catch(e=>{console.error(e);process.exitCode=1});

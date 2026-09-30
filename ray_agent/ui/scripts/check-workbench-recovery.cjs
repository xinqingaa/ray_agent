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
  if(name==='@/lib/api/project')return {projectApi:api};
  if(name==='@/lib/utils')return {cn:(...x)=>x.filter(Boolean).join(' ')};
  if(name.startsWith('@/components/ui/'))return elements;
  throw Error(name);
 }, exports);
 return exports;
}
const {ProjectPane} = load('components/workbench/project-pane.tsx');
const {ChangesPane} = load('components/workbench/changes-pane.tsx');
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const listing = {entries:['a.txt','b.txt'].map(name=>({name,path:name,type:'file'})),truncated:false};
const entry = path => ({path,index:'modified',worktree:'modified',kind:'ordinary'});
const status = branch => ({state:'ok',branch,entries:[entry('a.txt'),entry('b.txt')]});
const diff = (scope,text) => ({scope,state:'ok',files:[],diff:text});
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
 const states=[];const diffs=[];const branches=[];
 api.getGitStatus=()=>{const d=deferred();states.push(d);return d.promise};
 api.getGitDiff=(_,scope,path)=>{const d=deferred();diffs.push({scope,path,...d});return d.promise};
 const onBranchUpdate=x=>branches.push(x);
 await act(async()=>{r=create(React.createElement(ChangesPane,{sessionId:'s',onBranchUpdate}))});
 await act(async()=>{r.update(React.createElement(ChangesPane,{sessionId:'s',onBranchUpdate,refreshSignal:1}))});
 await act(async()=>{states[1].resolve(status('current'))});
 await act(async()=>{states[0].resolve(status('late'))});
 assert.deepEqual(branches,['current']);
 await act(async()=>{fileButton(r,'a.txt').props.onClick()});
 await act(async()=>{fileButton(r,'b.txt').props.onClick()});
 assert.deepEqual(diffs.map(d=>[d.path,d.scope]),[['a.txt','staged'],['a.txt','worktree'],['b.txt','staged'],['b.txt','worktree']]);
 await act(async()=>{diffs[2].resolve(diff('staged','new B staged'));diffs[3].resolve(diff('worktree','new B working'))});
 await act(async()=>{diffs[0].resolve(diff('staged','late A staged'));diffs[1].resolve(diff('worktree','late A working'))});
 assert.ok(text(r).includes('new B staged'));assert.ok(text(r).includes('new B working'));assert.ok(!text(r).includes('late A'));
 await act(async()=>{r.update(React.createElement(ChangesPane,{sessionId:'s',onBranchUpdate,refreshSignal:2}))});
 await act(async()=>{states[2].resolve(status('latest'))});
 assert.equal(diffs.length,6);assert.equal(diffs[4].path,'b.txt');
 await act(async()=>{diffs[4].resolve({...diff('staged',''),state:'timeout',error:'timeout visible'});diffs[5].resolve(diff('worktree','updated B'))});
 assert.ok(text(r).includes('timeout visible'));assert.ok(text(r).includes('updated B'));
 await act(async()=>{r.unmount()});
 console.log('PASS: actual ChangesPane React effects reject late status/diff, preserve both scopes, refresh selected diff and expose timeout');
}
main().catch(e=>{console.error(e);process.exitCode=1});

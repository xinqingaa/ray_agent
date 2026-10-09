/* eslint-disable @typescript-eslint/no-require-imports */
// 实际 hook、工具卡与工作台；浏览器存储、网络和基础 UI 为替身。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const React = require('react'), {create, act} = require('react-test-renderer');
const root = path.resolve(__dirname, '..'), ts = require('typescript'), cache = {};
global.IS_REACT_ACT_ENVIRONMENT = true;
const events = new EventTarget(), storage = new Map(), timers = new Set();
let writeBlocked = false, pulls = 0, downloaded;
global.window = {localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key,value) => {if(writeBlocked) throw Error('blocked'); storage.set(key,value)}}, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events), setInterval: fn => {timers.add(fn); return fn}, clearInterval: fn => timers.delete(fn)};
const ui = new Proxy({}, {get: (_,name) => props => React.createElement(name === 'Button' ? 'button' : 'div', props, props.children)});
function load(file) {
 if(cache[file]) return cache[file]; const exports = {}; cache[file] = exports;
 const code = ts.transpileModule(fs.readFileSync(root+'/src/'+file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',code)(name => {
  if(name === 'react' || name === 'react/jsx-runtime') return require(name);
  if(name === 'lucide-react') return new Proxy({}, {get:()=>()=>null});
  if(name === 'next/link') return {default:props=>React.createElement('a',props,props.children)};
  if(name === 'sonner') return {toast:{error(){}}};
  if(name === '@/lib/utils') return {cn:(...xs)=>xs.filter(Boolean).join(' ')};
  if(name === '@/lib/api/session') return {sessionApi:{viewShell:async()=>{pulls++; return {output:'stdout'}}}};
  if(name === '@/lib/api/file') return {fileApi:{}};
  if(name === '@/lib/api/preview') return {downloadFileBatch:async files=>{downloaded=files}};
  if(name === '@/components/run/file-icon') return {previewUnavailableReason:()=>null};
  if(name === './clock') return {useNow:()=>0};
  if(name === '@/components/preview/file-row') return {FileRow:props=>React.createElement('div',{},props.file.filename,props.actions,props.children)};
  if(name.startsWith('@/components/ui/')) return ui;
  if(['@/components/workbench/managed-project-pane','@/components/preview/file-preview','@/components/preview/image-preview','@/components/preview/file-row','@/components/preview/action'].includes(name)) return ui;
  const target = name.startsWith('@/') ? name.slice(2) : path.posix.join(path.posix.dirname(file),name);
  return load(target + (fs.existsSync(root+'/src/'+target+'.ts') ? '.ts' : '.tsx'));
 },exports);return exports;
}
const {useDeveloperMode,setDeveloperMode} = load('hooks/use-developer-mode.ts');
let mode;
function Probe(){mode=useDeveloperMode(); return React.createElement('p',{},String(mode.enabled))}
const text = r => JSON.stringify(r.toJSON());
const call = {callId:'private-call-id',family:'shell',verb:'执行命令',toolset:'shell',name:'execute',target:'private-command',startedAt:0,status:'running',raw:{args:{session_id:'shell-session',command:'private-command'},content:{session_id:'shell-session'}},result:{summary:'技术计数'}};
async function main(){
 let probe,r;
 await act(async()=>{probe=create(React.createElement(Probe))}); assert.equal(mode.enabled,false);
 await act(async()=>setDeveloperMode(true)); assert.equal(mode.enabled,true);assert.equal(storage.get('rayagent:developer-mode'),'true');
 const {Workbench}=load('components/workbench/workbench.tsx');
 const props={sessionId:'s',focus:call,following:true,shellCall:call,browserCall:null,files:[],tab:'terminal',onTab(){},onFollowLatest(){},onClose(){}};
 await act(async()=>{r=create(React.createElement(Workbench,props))}); assert.equal(pulls,1); assert.equal(timers.size,1); assert.ok(text(r).includes('终端'));
 await act(async()=>setDeveloperMode(false)); assert.equal(timers.size,0);assert.ok(!text(r).includes('终端'));assert.ok(text(r).includes('查看'));
 await act(async()=>setDeveloperMode(true)); assert.equal(timers.size,1);
 await act(async()=>r.update(React.createElement(Workbench,{...props,active:false}))); assert.equal(timers.size,0);
 await act(async()=>r.unmount());
 await act(async()=>setDeveloperMode(false));
 const files=[{id:'input',filename:'input.txt',extension:'txt',source:'upload',size:1},{id:'output',filename:'output.txt',extension:'txt',source:'delivery',size:1}];
 await act(async()=>{r=create(React.createElement(Workbench,{...props,tab:'files',focus:null,shellCall:null,files}))});
 assert.ok(text(r).includes('交付结果'));assert.ok(text(r).includes('输入材料'));
 await act(async()=>r.root.findAllByType('div').find(node=>node.props.label==='下载本次交付').props.onClick());
 assert.deepEqual(downloaded.map(file=>file.id),['output']);await act(async()=>r.unmount());
 storage.set('rayagent:developer-mode','false'); const event=new Event('storage');event.key='rayagent:developer-mode';
 await act(async()=>window.dispatchEvent(event)); assert.equal(mode.enabled,false);
 writeBlocked=true;await act(async()=>setDeveloperMode(true));assert.equal(mode.enabled,true);writeBlocked=false;
 await act(async()=>setDeveloperMode(false));await act(async()=>probe.unmount());
 await act(async()=>{probe=create(React.createElement(Probe))});assert.equal(mode.enabled,false);
 const {ToolCard}=load('components/run/tool-card.tsx');
 await act(async()=>{r=create(React.createElement(ToolCard,{call:{...call,status:'failed',result:{error:'写入失败，请重试'}},defaultExpanded:true}))});
 assert.ok(text(r).includes('写入失败，请重试'));assert.ok(!text(r).includes('private-command'));assert.ok(!text(r).includes('private-call-id'));await act(async()=>r.unmount());
 const browser={...call,family:'browser',verb:'打开网页',target:'https://example.com',status:'succeeded',raw:{args:{url:'https://example.com'},content:{content:'页面正文'}}};
 await act(async()=>{r=create(React.createElement(ToolCard,{call:browser}))}); assert.equal(r.root.findAllByType('a').length,1);await act(async()=>r.unmount());
 const mcp={...call,family:'mcp',status:'succeeded',raw:{args:{},content:{outcome:{data:{text:'业务结果 42'}}}}};
 await act(async()=>{r=create(React.createElement(ToolCard,{call:mcp,defaultExpanded:true}))});assert.ok(text(r).includes('业务结果 42'));assert.ok(!text(r).includes('private-call-id'));await act(async()=>r.unmount());await act(async()=>probe.unmount());
 console.log('PASS: 实际 hook 存储/跨页事件/写入失败回退；工作台关闭模式或面板时停止终端轮询；隐藏标签回退；错误和业务结果保留；网址单入口');
}
main().catch(error=>{console.error(error);process.exitCode=1});

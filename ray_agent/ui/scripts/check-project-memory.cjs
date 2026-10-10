/* eslint-disable @typescript-eslint/no-require-imports */
// 实际组件；API、基础 UI 与浏览器事件为替身，不代替真实布局验收。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ts=require(root+'/node_modules/typescript'),React=require('react');
const {create,act}=require('react-test-renderer');global.IS_REACT_ACT_ENVIRONMENT=true;
const api={},sessions={},cache=new Map();let confirm=false,developer=false;
global.window={setTimeout,clearTimeout,setInterval,clearInterval,confirm:()=>confirm,addEventListener(){},removeEventListener(){}};
global.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
const elementCache={};
const elements=new Proxy({}, {get:(_,name)=>elementCache[name] ??= props=>React.createElement(name==='Button'?'button':'div',props,props.children)});
class ApiError extends Error{constructor(code,msg){super(msg);this.code=code}}
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
const code=ts.transpileModule(fs.readFileSync(root+'/src/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','exports',code)(name=>{
if(name==='react')return React;if(name==='react/jsx-runtime')return require(name);
if(name==='next/link')return {default:props=>React.createElement('a',props,props.children)};
if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
if(name==='@/lib/api/project')return {projectApi:api};if(name==='@/lib/api/session')return {sessionApi:sessions};
if(name==='@/hooks/use-developer-mode')return {useDeveloperMode:()=>({visibility:{memoryInternals:developer}})};
if(name==='@/hooks/use-unsaved-navigation')return {useUnsavedNavigation(){}};
if(name==='@/lib/catalog-bus')return {subscribeCatalog:()=>()=>{}};
if(name==='@/components/markdown-content' || name==='./markdown-content')return {MarkdownContent:props=>React.createElement('p',null,props.content)};
if(name==='@/components/ui/icon-action' || name==='./icon-action' || name==='./ui/icon-action')return {IconAction:props=>React.createElement('button',{'aria-label':props.label,onClick:props.onClick},props.label)};
if(name==='@/components/ui/segmented-control')return {SegmentedControl:props=>React.createElement('div',null,props.options.map(item=>React.createElement('button',{key:item.value,onClick:()=>props.onValueChange(item.value)},item.label)))};
if(name==='@/lib/utils')return {cn:(...values)=>values.filter(Boolean).join(' ')};
if(name==='@/lib/api/fetch')return {ApiError};if(name==='@/components/ui/overlay-toolbar')return load('components/ui/overlay-toolbar.tsx');
if(name.startsWith('@/components/ui/'))return elements;
if(name==='./ui/overlay-toolbar')return load('components/ui/overlay-toolbar.tsx');
if(name.startsWith('./ui/'))return elements;
if(name.startsWith('.')) {const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),name));return load(resolved+'.tsx')}
if(name.startsWith('@/'))return load(name.slice(2)+(name.endsWith('use-unsaved-navigation')?'.ts':'.tsx'));
throw Error(name)},exports);return exports}
const {ProjectMemoryPanel}=load('components/project-memory-panel.tsx');
const button=(r,label)=>r.root.findAllByType('button').find(b=>b.children.join('')===label);
const text=r=>JSON.stringify(r.toJSON());
async function main(){let r,closed=0,changed=0,project={id:'p',name:'项目',instructions:'保留原材料',settings_version:2,notes:'原笔记',notes_version:3};
api.sessions=async()=>({sessions:[]});api.detail=async()=>project;api.memory=async()=>({project:{...project,summaries:[]},candidates:[],project_prompt:'项目段',frozen:null});api.memoryHistory=async()=>[];
const writes=[];api.updateNotes=async()=>{};api.update=async()=>{throw Error('笔记编辑不能提交设置')};
await act(async()=>{r=create(React.createElement(ProjectMemoryPanel,{projectId:'p',open:true,onClose:()=>closed++,onChanged:()=>changed++}))});
assert.ok(!text(r).includes('查看使用内容'));
await act(async()=>button(r,'笔记').props.onClick());await act(async()=>button(r,'编辑笔记').props.onClick());
await act(async()=>r.root.findByType('textarea').props.onChange({target:{value:'我的草稿'}}));
await act(async()=>r.root.findAllByType('button').find(b=>b.props['aria-label']==='关闭项目记忆').props.onClick());assert.equal(closed,0);
await act(async()=>button(r,'查看修改记录').props.onClick());assert.ok(button(r,'刷新修改记录'));await act(async()=>button(r,'返回笔记').props.onClick());assert.equal(r.root.findByType('textarea').props.value,'我的草稿');
api.updateNotes=async()=>{throw new ApiError(409,'版本冲突')};project={...project,notes:'Agent新结论',notes_version:4};
await act(async()=>button(r,'保存').props.onClick());assert.equal(r.root.findByType('textarea').props.value,'我的草稿');assert.ok(text(r).includes('Agent新结论'));
await act(async()=>button(r,'按最新版本继续').props.onClick());
api.updateNotes=async(id,content,base)=>{writes.push({id,content,base});project={...project,notes:content,notes_version:base+1}};
await act(async()=>button(r,'保存').props.onClick());assert.deepEqual(writes,[{id:'p',content:'我的草稿',base:4}]);assert.equal(changed,1);
await act(async()=>button(r,'编辑笔记').props.onClick());await act(async()=>r.root.findByType('textarea').props.onChange({target:{value:''}}));
await act(async()=>button(r,'保存').props.onClick());assert.equal(writes.at(-1).content,'');assert.equal(writes.at(-1).base,5);
await act(async()=>r.unmount());console.log('PASS: 独立笔记保存、dirty 关闭、409 保留草稿/比较/合并、清空与刷新');
const {ProjectSummaryDialog}=load('components/project-summary-dialog.tsx');sessions.summary=async()=>{throw Error('读取失败')};
await act(async()=>{r=create(React.createElement(ProjectSummaryDialog,{sessionId:'s',title:'对话',onClose(){},onChanged(){}}))});assert.ok(text(r).includes('读取失败'));assert.ok(!text(r).includes('正在读取摘要'));await act(async()=>r.unmount());console.log('PASS: 摘要首次读取失败结束 loading');
const {ProjectSummariesPage}=load('components/project-summaries-page.tsx');
api.memory=async()=>({project:{...project,summaries:[]},candidates:[{session_id:'s',title:'来源对话',summary:'保留原摘要',state:'failed',error:'生成失败'}],project_prompt:'项目段',frozen:null});
await act(async()=>{r=create(React.createElement(ProjectSummariesPage,{projectId:'p',onChanged(){}}))});assert.ok(text(r).includes('保留原摘要'));assert.ok(text(r).includes('生成失败'));
await act(async()=>button(r,'编辑 来源对话 的摘要').props.onClick());assert.ok(text(r).includes('读取失败'));await act(async()=>button(r,'返回摘要列表').props.onClick());assert.ok(text(r).includes('保留原摘要'));await act(async()=>r.unmount());
console.log('PASS: 主页共用摘要列表、失败保留摘要、编辑读取失败可返回');
const {ProjectContextDialog}=load('components/project-context-dialog.tsx');developer=true;
api.memory=async()=>({project:{...project,summaries:[]},candidates:[],project_prompt:'当前项目段',frozen:{...project,notes:'对话 B 快照',summaries:[]},occupying_session_id:'b',active_run_id:'run-b'});
await act(async()=>{r=create(React.createElement(ProjectContextDialog,{projectId:'p',sessionId:'a',open:true,onClose(){}}))});assert.ok(text(r).includes('活动运行快照'));assert.ok(text(r).includes('其他对话'));assert.ok(!text(r).includes('本次对话快照'));assert.ok(r.root.findAllByType('a').some(node=>node.props.href==='/sessions/b'));await act(async()=>r.unmount());
console.log('PASS: 项目上下文正确标识其他对话活动快照与来源链接');}

main().catch(error=>{console.error(error);process.exitCode=1});

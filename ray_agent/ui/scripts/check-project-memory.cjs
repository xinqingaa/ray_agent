/* eslint-disable @typescript-eslint/no-require-imports */
// 实际组件；API、基础 UI 与浏览器事件为替身，不代替真实布局验收。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ts=require(root+'/node_modules/typescript'),React=require('react');
const {create,act}=require('react-test-renderer');global.IS_REACT_ACT_ENVIRONMENT=true;
const api={},sessions={},cache=new Map();let confirm=false;
global.window={confirm:()=>confirm,addEventListener(){},removeEventListener(){}};
global.document={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
const elements=new Proxy({}, {get:(_,name)=>props=>React.createElement(name==='Button'?'button':'div',props,props.children)});
class ApiError extends Error{constructor(code,msg){super(msg);this.code=code}}
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
const code=ts.transpileModule(fs.readFileSync(root+'/src/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','exports',code)(name=>{
if(name==='react')return React;if(name==='react/jsx-runtime')return require(name);
if(name==='next/link')return {default:props=>React.createElement('a',props,props.children)};
if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
if(name==='@/lib/api/project')return {projectApi:api};if(name==='@/lib/api/session')return {sessionApi:sessions};
if(name==='@/lib/api/fetch')return {ApiError};if(name.startsWith('@/components/ui/'))return elements;
if(name.startsWith('@/'))return load(name.slice(2)+(name.endsWith('use-unsaved-navigation')?'.ts':'.tsx'));
throw Error(name)},exports);return exports}
const {ProjectMemoryPanel}=load('components/project-memory-panel.tsx');
const button=(r,label)=>r.root.findAllByType('button').find(b=>b.children.join('')===label);
const text=r=>JSON.stringify(r.toJSON());
async function main(){let r,closed=0,changed=0,project={id:'p',name:'项目',instructions:'保留原材料',settings_version:2,notes:'原笔记',notes_version:3};
api.detail=async()=>project;api.memory=async()=>({project:{...project,summaries:[]},candidates:[],project_prompt:'项目段',frozen:null});api.memoryHistory=async()=>[];
const writes=[];api.updateNotes=async()=>{};api.update=async()=>{throw Error('笔记编辑不能提交设置')};
await act(async()=>{r=create(React.createElement(ProjectMemoryPanel,{projectId:'p',open:true,onClose:()=>closed++,onChanged:()=>changed++}))});
await act(async()=>button(r,'项目笔记').props.onClick());await act(async()=>button(r,'编辑项目笔记').props.onClick());
await act(async()=>r.root.findByType('textarea').props.onChange({target:{value:'我的草稿'}}));
await act(async()=>r.root.findAllByType('button').find(b=>b.props['aria-label']==='关闭项目记忆').props.onClick());assert.equal(closed,0);
api.updateNotes=async()=>{throw new ApiError(409,'版本冲突')};project={...project,notes:'Agent新结论',notes_version:4};
await act(async()=>button(r,'保存项目笔记').props.onClick());assert.equal(r.root.findByType('textarea').props.value,'我的草稿');assert.ok(text(r).includes('Agent新结论'));
await act(async()=>button(r,'已比较，以最新版本保存合并稿').props.onClick());
api.updateNotes=async(id,content,base)=>{writes.push({id,content,base});project={...project,notes:content,notes_version:base+1}};
await act(async()=>button(r,'保存项目笔记').props.onClick());assert.deepEqual(writes,[{id:'p',content:'我的草稿',base:4}]);assert.equal(changed,1);
await act(async()=>button(r,'编辑项目笔记').props.onClick());await act(async()=>r.root.findByType('textarea').props.onChange({target:{value:''}}));
await act(async()=>button(r,'保存项目笔记').props.onClick());assert.equal(writes.at(-1).content,'');assert.equal(writes.at(-1).base,5);
await act(async()=>r.unmount());console.log('PASS: 独立笔记保存、dirty 关闭、409 保留草稿/比较/合并、清空与刷新');
const {ProjectSummaryDialog}=load('components/project-summary-dialog.tsx');sessions.summary=async()=>{throw Error('读取失败')};
await act(async()=>{r=create(React.createElement(ProjectSummaryDialog,{sessionId:'s',title:'对话',onClose(){},onChanged(){}}))});assert.ok(text(r).includes('读取失败'));assert.ok(!text(r).includes('正在读取摘要'));await act(async()=>r.unmount());console.log('PASS: 摘要首次读取失败结束 loading');}
main().catch(error=>{console.error(error);process.exitCode=1});

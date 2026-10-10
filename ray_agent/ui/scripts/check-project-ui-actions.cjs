// 实际数据确认组件：固定占用响应验证弹窗退出和导航；API、路由与基础 UI 为替身。
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
global.IS_REACT_ACT_ENVIRONMENT=true;
global.document={visibilityState:'visible',getElementById:()=>null};
global.window={setInterval,clearInterval,dispatchEvent(){}};
global.requestAnimationFrame=callback=>setImmediate(callback);global.cancelAnimationFrame=clearImmediate;
const projectApi={detail:async()=>({id:'p',name:'项目',instructions:'',settings_version:1}),update:async()=>{throw Error('保存失败')},archive:async()=>({})};
const pushed=[],cache=new Map(),empty=()=>null;
const dataApi={latest:async()=>null,preview:async()=>({name:'所有项目与对话',counts:{projects:1,sessions:1,files:0,snapshots:0},blocked_reason:'请先停止等待处理的对话',occupying_session_id:'waiting',task:null}),start:async()=>{throw Error('不得触发删除')}};
function load(file){
 if(cache.has(file))return cache.get(file);
 const exports={},code=ts.transpileModule(fs.readFileSync(root+'/src/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',code)(name=>{
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return require(name);
  if(name==='next/navigation')return {useRouter:()=>({push:href=>pushed.push(href)})};
  if(name==='lucide-react')return new Proxy({},{get:()=>empty});
  if(name==='@/hooks/use-unsaved-navigation')return {useUnsavedNavigation(){}};
  if(name==='@/lib/api/project')return {projectApi};
  if(name==='@/lib/api/fetch')return {ApiError:class extends Error {}};
  if(name==='@/lib/api/data')return {dataApi};
  if(name==='@/lib/drafts')return {notifyDataCleared(){throw Error('不得清空草稿')}};
  if((name==='@/components/data-cleanup-dialog'||name==='./data-cleanup-dialog'))return load('components/data-cleanup-dialog.tsx');
  if(name==='@/components/ui/icon-action')return {IconAction:({label,...props})=>React.createElement('button',{'aria-label':label,...props},props.children)};
  if(name==='@/components/ui/button')return {Button:props=>React.createElement('button',props,props.children)};
  if(name==='@/components/ui/dialog')return new Proxy({},{get:(_,key)=>key==='Dialog'?({open,children})=>open?React.createElement('div',{'data-dialog':true},children):null:props=>React.createElement('div',props,props.children)});
  throw Error('未提供替身：'+name);
 },exports);cache.set(file,exports);return exports;
}
const {DataSection}=load('components/settings/data-section.tsx'),tick=()=>new Promise(resolve=>setImmediate(resolve));
async function scenario(allow){
 let renderer;
 function SettingsHost(){const [open,setOpen]=React.useState(true);return open?React.createElement('section',{'data-settings':true},React.createElement(DataSection,{onNavigate:()=>{if(!allow)return false;setOpen(false);return true}})):React.createElement('p',null,'设置已退出')}
 await act(async()=>{renderer=create(React.createElement(SettingsHost));await tick()});
 const find=label=>renderer.root.findAllByType('button').find(node=>node.props['aria-label']===label||node.children.join('')===label);
 await act(async()=>{find('清空所有项目与对话').props.onClick();await tick()});
 assert.equal(find('永久清空').props.disabled,true);assert.equal(renderer.root.findAllByProps({'data-dialog':true}).length,1);
 const before=pushed.length;await act(async()=>find('查看占用对话').props.onClick());
 if(allow){assert.equal(pushed.at(-1),'/sessions/waiting');assert.equal(renderer.root.findAllByProps({'data-dialog':true}).length,0);assert.equal(renderer.root.findAllByProps({'data-settings':true}).length,0)}else{assert.equal(pushed.length,before);assert.equal(renderer.root.findAllByProps({'data-dialog':true}).length,1)}
 await act(async()=>renderer.unmount());
}
async function settings(){
 const {ProjectSettingsDialog}=load('components/project-settings-dialog.tsx');let renderer,closed=0,saved=0;
 await act(async()=>{renderer=create(React.createElement(ProjectSettingsDialog,{id:'p',onClose:()=>closed++,onSaved:()=>saved++}));await tick()});
 const button=label=>renderer.root.findAllByType('button').find(node=>node.children.join('')===label);
 const input=()=>renderer.root.findByType('input');
 assert.equal(button('保存').props.disabled,true);
 await act(async()=>input().props.onChange({target:{value:' 项目 '}}));assert.equal(button('保存').props.disabled,true);
 await act(async()=>input().props.onChange({target:{value:'改名'}}));assert.equal(button('归档').props.disabled,true);assert.equal(button('删除').props.disabled,true);
 await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(input().props.value,'改名');assert.equal(closed,0);assert.ok(JSON.stringify(renderer.toJSON()).includes('保存失败'));
 projectApi.update=async()=>({id:'p',name:'改名',instructions:'',settings_version:2});
 await act(async()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));assert.equal(closed,1);assert.equal(saved,1);assert.equal(button('保存').props.disabled,true);
 await act(async()=>button('删除').props.onClick());await act(async()=>{await tick()});assert.equal(renderer.root.findAllByProps({'data-dialog':true}).length,1);
 await act(async()=>button('取消').props.onClick());assert.equal(renderer.root.findAllByProps({'data-dialog':true}).length,1);assert.ok(renderer.root.findAllByType('input').some(node=>node.props.value==='改名'));
 await act(async()=>renderer.unmount());
 console.log('PASS: 名称空白归一化、草稿禁用生命周期操作、保存失败保留、成功退出、删除取消恢复单层设置。');
}
(async()=>{await scenario(true);await scenario(false);await settings();console.log('PASS: 查看占用对话退出清空与设置弹窗后导航；离开被拒绝时保留弹窗，不触发删除。')})().catch(error=>{console.error(error);process.exitCode=1});

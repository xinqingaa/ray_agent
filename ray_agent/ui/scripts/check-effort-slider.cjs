/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer');
const root=path.resolve(__dirname,'..'),ts=require(root+'/node_modules/typescript');
global.IS_REACT_ACT_ENVIRONMENT=true;
const configApi={},sessionApi={},cache={};
const ui=new Proxy({}, {get:(_,name)=>props=>React.createElement(name==='Button'?'button':name==='Input'?'input':'div',{...props,'data-component':name},props.children)});
function load(file){
 if(cache[file])return cache[file];const exports={};cache[file]=exports;
 const code=ts.transpileModule(fs.readFileSync(root+'/src/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',code)(name=>{
  if(name==='react')return React;if(name==='react/jsx-runtime')return require(name);
  if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
  if(name==='sonner')return {toast:{error(){}}};
  if(name==='@/lib/api/config')return {configApi};if(name==='@/lib/api/session')return {sessionApi};
  if(name==='@/lib/utils')return {cn:(...xs)=>xs.filter(Boolean).join(' ')};
  if(name==='@/components/run/format')return {formatTime:()=>'now'};
  if(name==='@/components/ui/slider')return load('components/ui/slider.tsx');
  if(name.startsWith('@/components/ui/'))return ui;
  if(name.startsWith('@/'))return load(name.slice(2)+'.'+(name.includes('components/')?'tsx':'ts'));
  if(name.startsWith('.')){
   const base=path.resolve(root,'src',path.dirname(file),name);
   const hit=['.tsx','.ts',''].map(ext=>base+ext).find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
   if(hit)return load(path.relative(path.join(root,'src'),hit));
  }
  throw Error(name+' from '+file);
 },exports);return exports;
}
const model=(id,levels,ordered)=>({id,context_window:1000000,max_output:393216,choices:['disabled',...levels],default_choice:levels[0],
 reasoning_options:[{id:'disabled',enabled:false},...levels.map(id=>({id,enabled:true}))],reasoning_ordered:ordered,reasoning_family:'one',temperature_when:'disabled',temperature_max:2});
async function main(){
 configApi.getModels=async()=>({provider:'fixture',default_model:'a',models:[model('a',['low','high','max'],true)]});
 const {ModelPicker}=load('components/model-picker.tsx');let r;
 await act(async()=>{r=create(React.createElement(ModelPicker,{sessionId:'s',savedModel:'a',savedReasoning:'high',onSelection(){}}))});
 await act(async()=>r.root.findAllByProps({'data-component':'Popover'})[0].props.onOpenChange(true));
 const slider=()=>r.root.findByProps({role:'slider'});
 const described=slider().props['aria-describedby'];
 assert.ok(described);assert.ok(r.root.findByProps({id:described}));
 assert.equal(r.root.findAllByType('button').filter(node=>['low','high','max'].includes(node.props.children)).length,0);
 assert.equal(slider().props.tabIndex,0);
 await act(async()=>r.root.findAllByProps({'data-component':'Switch'})[0].props.onCheckedChange(false));
 assert.equal(slider().props['aria-disabled'],true);
 assert.equal(slider().props['aria-valuetext'],'思考已关闭');
 assert.equal(slider().props['aria-valuenow'],undefined);
 await act(async()=>r.unmount());
 configApi.getModels=async()=>{throw Error('目录失败')};
 await act(async()=>{r=create(React.createElement(ModelPicker,{onSelection(){}}))});
 await act(async()=>{});
 assert.ok(JSON.stringify(r.toJSON()).includes('模型目录不可用'));
 assert.ok(JSON.stringify(r.toJSON()).includes('目录失败'));
 await act(async()=>r.unmount());
 const {checkTemperature}=load('components/settings/llm-section.tsx');
 assert.equal(checkTemperature('0'),null);assert.equal(checkTemperature('2'),null);
 assert.equal(checkTemperature('-0.1'),'范围为 0–2');assert.equal(checkTemperature('2.1'),'范围为 0–2');
 console.log('PASS: single slider tab stop, hidden scale, disabled value text, catalog error keeps trigger, temperature 0-2');
}
main().catch(e=>{console.error(e);process.exitCode=1});

/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer');
const root=path.resolve(__dirname,'..'),ts=require(root+'/node_modules/typescript');
global.IS_REACT_ACT_ENVIRONMENT=true;
const preferenceStorage = new Map();
global.window = Object.assign(new EventTarget(), {localStorage: {
 getItem: key => preferenceStorage.get(key) ?? null,
 setItem: (key,value) => preferenceStorage.set(key,value),
}});
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
  if(name==='@/components/run/format')return {formatTime:()=> 'now'};
  if(name==='@/components/ui/slider')return load('components/ui/slider.tsx');
  if(name.startsWith('@/components/ui/'))return ui;
  if(name.startsWith('@/'))return load(name.slice(2)+'.'+(name.includes('components/')?'tsx':'ts'));
  throw Error(name);
 },exports);return exports;
}
const model=(id,family,levels,off)=>({id,vendor:'fixture',vendor_label:'Fixture',context_window:1000000,max_output:393216,choices:[off,...levels],default_choice:levels[1],
 reasoning_options:[{id:off,enabled:false},...levels.map(id=>({id,enabled:true}))],reasoning_ordered:true,reasoning_family:family,temperature_when:'disabled',temperature_max:2});
async function main(){
 const a=model('a','one',['low','high','max'],'disabled'),b=model('b','two',['low','medium','high','xhigh','ultra'],'none');
 a.vision=true;b.vision=false;
 const helpers=load('lib/model-selection.ts');assert.equal(helpers.selectModel({model:'a',reasoning:'high'},a,b).reasoning,'medium');
 assert.deepEqual(helpers.thinkingOptions(b).map(o=>o.id),['low','medium','high','xhigh','ultra']);
 const c={...model('new-model-from-server','three',['low','high'],'none'),vendor:'openai',vendor_label:'OpenAI'};
 const catalog={provider:'fixture',default_model:'a',models:[a,b,c]};
 assert.deepEqual(helpers.modelsForVendor(catalog.models,'openai').map(m=>m.id),['new-model-from-server']);
 configApi.getModels=async()=>catalog;
 const calls=[];sessionApi.setModel=async(id,next)=>{calls.push(next);return next};
 const {ModelPicker}=load('components/model-picker.tsx');let r;
 const pickerProps={sessionId:'s',savedModel:'a',savedReasoning:'high',onSelection(){}};
 await act(async()=>{r=create(React.createElement(ModelPicker,pickerProps))});
 const popover=()=>r.root.findAllByProps({'data-component':'Popover'})[0];
 await act(async()=>popover().props.onOpenChange(true));
 const tabs=()=>r.root.findByProps({'data-component':'SegmentedControl'});
 assert.ok(!JSON.stringify(r.toJSON()).includes('支持看图'));
 await act(async()=>popover().props.onOpenChange(false));
 assert.equal(calls.length,0);
 await act(async()=>popover().props.onOpenChange(true));
 await act(async()=>tabs().props.onValueChange('openai'));
 assert.equal(r.root.findByProps({role:'radio',title:'new-model-from-server'}).props['aria-checked'],true);
 assert.equal(r.root.findByProps({role:'slider'}).props['aria-valuetext'],'high');
 assert.equal(calls.length,0);
 await act(async()=>popover().props.onOpenChange(false));
 assert.deepEqual(calls,[{model:'new-model-from-server',reasoning:'high'}]);
 assert.equal(popover().props.open,false);calls.length=0;
 await act(async()=>popover().props.onOpenChange(true));
 await act(async()=>tabs().props.onValueChange('fixture'));
 assert.equal(r.root.findByProps({role:'radio',title:'a'}).props['aria-checked'],true);
 await act(async()=>r.root.findByProps({role:'radio',title:'b'}).props.onClick());
 await act(async()=>tabs().props.onValueChange('fixture'));
 assert.equal(r.root.findByProps({role:'radio',title:'b'}).props['aria-checked'],true);
 assert.ok(JSON.stringify(r.toJSON()).includes('已改用默认 medium'));
 assert.ok(!JSON.stringify(r.toJSON()).includes('下一次新运行估算'));
 const slider=()=>r.root.findByProps({role:'slider'});
 assert.equal(slider().props['aria-valuemax'],4);
 await act(async()=>slider().props.onKeyDown({key:'End',preventDefault(){}}));
 assert.equal(slider().props['aria-valuetext'],'ultra');assert.equal(calls.length,0);
 await act(async()=>r.root.findAllByProps({'data-component':'Switch'})[0].props.onCheckedChange(false));
 assert.equal(r.root.findAllByType('button').filter(n=>n.props.children==='应用'||n.props.children==='取消'||n.props.children==='关闭').length,0);
 await act(async()=>popover().props.onOpenChange(false));
 assert.deepEqual(calls,[{model:'b',reasoning:'none'}]);assert.equal(popover().props.open,false);assert.equal(slider().props['aria-disabled'],true);
 sessionApi.setModel=async()=>{throw Error('rejected effort')};
 await act(async()=>popover().props.onOpenChange(true));
 await act(async()=>r.root.findAllByProps({'data-component':'Switch'})[0].props.onCheckedChange(true));
 await act(async()=>popover().props.onOpenChange(false));
 assert.equal(popover().props.open,true);assert.ok(JSON.stringify(r.toJSON()).includes('rejected effort'));
 await act(async()=>r.update(React.createElement(ModelPicker,{...pickerProps,runModel:'a'})));
 assert.ok(!JSON.stringify(r.toJSON()).includes('本次运行 '));
 assert.ok(!JSON.stringify(r.toJSON()).includes('渠道'));
 await act(async()=>r.unmount());
 const preference=load('lib/model-preference.ts');
 assert.deepEqual(preference.readModelPreference(),{model:'b',reasoning:'none'},'失败切换不能改最近偏好');
 const sent=[];
 let sentChoice;
 await act(async()=>{r=create(React.createElement(ModelPicker,{onSelection:next=>{sent.push(next);sentChoice=next}}))});
 assert.deepEqual(sentChoice,{model:'b',reasoning:'none'},'新对话恢复值进入发送选择');
 assert.ok(!sent.some(item=>item&&item.model==='a'&&item.reasoning==='high'),'读到本地记录前不发出目录默认');
 assert.ok(JSON.stringify(r.toJSON()).includes('模型与思考：b，none'));
 await act(async()=>r.unmount());
 await act(async()=>{r=create(React.createElement(ModelPicker,{...pickerProps,onSelection:next=>{sentChoice=next}}))});
 assert.deepEqual(sentChoice,{model:'a',reasoning:'high'},'已有会话优先自身选择');
 assert.deepEqual(preference.readModelPreference(),{model:'b',reasoning:'none'},'浏览已有会话不改最近偏好');
 await act(async()=>r.unmount());
 assert.deepEqual(preference.validModelPreference({model:'retired',reasoning:'max'},catalog),{model:'a',reasoning:'high'});
 assert.deepEqual(preference.validModelPreference({model:'b',reasoning:'removed'},catalog),{model:'b',reasoning:'medium'});
 const getStored=window.localStorage.getItem,setStored=window.localStorage.setItem;
 window.localStorage.getItem=()=>{throw Error('denied')};window.localStorage.setItem=()=>{throw Error('denied')};
 preference.rememberModelPreference({model:'a',reasoning:'low'});
 assert.deepEqual(preference.readModelPreference(),{model:'a',reasoning:'low'});
 window.localStorage.getItem=getStored;window.localStorage.setItem=setStored;
 const {useConfigForm}=load('components/settings/form.tsx');let form,saved;const base={a:'old A',b:'old B'};
 function Form(){form=useConfigForm({name:'fixture',load:async()=>base,toValues:x=>({...x}),fromValues:x=>({...x}),validate:x=>x.b==='invalid'?{b:'bad'}:{},save:async(next,fields)=>{saved={fields};return {...base,a:next.a}}});return null;}
 await act(async()=>{r=create(React.createElement(Form))});await act(async()=>{form.setValue('a','new A');form.setValue('b','invalid')});
 await act(async()=>form.save(['a']));assert.deepEqual(saved.fields,['a']);assert.equal(form.values.b,'invalid');assert.ok(form.dirty);
 await act(async()=>form.reset(['b']));assert.equal(form.values.a,'new A');assert.equal(form.values.b,'old B');assert.ok(!form.dirty);
 await act(async()=>r.unmount());
 const {SaveBar}=load('components/settings/form.tsx');let resetArguments;
 await act(async()=>{r=create(React.createElement(SaveBar,{dirty:true,saving:false,invalid:false,onReset:(...args)=>{resetArguments=args}}))});
 await act(async()=>r.root.findAllByType('button').find(n=>n.children.includes('撤销修改')).props.onClick({type:'click'}));
 assert.deepEqual(resetArguments,[]);await act(async()=>r.unmount());
 console.log('PASS: recent model/effort restore, actual send selection, session precedence, invalid preference fallback, storage failure, rejected selection isolation; vendor switch selects first model, same tab preserves selection, no vision/run/channel labels, server-defined model list, semantic fallback, commit on close, rejection keeps menu, scoped save preserves hidden draft, reset excludes click event');
}
main().catch(e=>{console.error(e);process.exitCode=1});

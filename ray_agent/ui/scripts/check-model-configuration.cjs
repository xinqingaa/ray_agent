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
  if(name==='@/components/run/format')return {formatTime:()=> 'now'};
  if(name.startsWith('@/components/ui/'))return ui;
  if(name.startsWith('@/'))return load(name.slice(2)+'.'+(name.includes('components/')?'tsx':'ts'));
  throw Error(name);
 },exports);return exports;
}
const model=(id,family,levels,off)=>({id,context_window:1000000,max_output:393216,choices:[off,...levels],default_choice:levels[1],
 reasoning_options:[{id:off,enabled:false},...levels.map(id=>({id,enabled:true}))],reasoning_ordered:true,reasoning_family:family,temperature_when:'disabled',temperature_max:2});
async function main(){
 const a=model('a','one',['low','high','max'],'disabled'),b=model('b','two',['low','medium','high','xhigh','ultra'],'none');
 const helpers=load('lib/model-selection.ts');assert.equal(helpers.selectModel({model:'a',reasoning:'high'},a,b).reasoning,'medium');
 assert.deepEqual(helpers.thinkingOptions(b).map(o=>o.id),['low','medium','high','xhigh','ultra']);
 configApi.getModels=async()=>({provider:'fixture',default_model:'a',models:[a,b]});
 const calls=[];sessionApi.setModel=async(id,next)=>{calls.push(next);return next};
 const {ModelPicker}=load('components/model-picker.tsx');let r;
 await act(async()=>{r=create(React.createElement(ModelPicker,{sessionId:'s',savedModel:'a',savedReasoning:'high',onSelection(){}}))});
 await act(async()=>r.root.findAllByProps({'data-component':'Popover'})[0].props.onOpenChange(true));
 await act(async()=>r.root.findAllByProps({role:'radio'}).find(n=>n.props.children[0]==='b').props.onClick());
 assert.ok(JSON.stringify(r.toJSON()).includes('已改用默认 medium'));
 assert.ok(!JSON.stringify(r.toJSON()).includes('下一次新运行估算'));
 const slider=()=>r.root.findByProps({role:'slider'});
 assert.equal(slider().props['aria-valuemax'],4);
 await act(async()=>slider().props.onKeyDown({key:'End',preventDefault(){}}));
 assert.equal(slider().props['aria-valuetext'],'ultra');assert.equal(calls.length,0);
 await act(async()=>r.root.findAllByProps({'data-component':'Switch'})[0].props.onCheckedChange(false));
 await act(async()=>r.root.findAllByType('button').find(n=>n.props.children==='应用').props.onClick());
 assert.deepEqual(calls,[{model:'b',reasoning:'none'}]);assert.equal(slider().props['aria-disabled'],true);
 sessionApi.setModel=async()=>{throw Error('rejected effort')};
 await act(async()=>r.root.findAllByProps({'data-component':'Switch'})[0].props.onCheckedChange(true));
 await act(async()=>r.root.findAllByType('button').find(n=>n.props.children==='应用').props.onClick());
 assert.ok(JSON.stringify(r.toJSON()).includes('rejected effort'));await act(async()=>r.unmount());
 const {useConfigForm}=load('components/settings/form.tsx');let form,saved;const base={a:'old A',b:'old B'};
 function Form(){form=useConfigForm({name:'fixture',load:async()=>base,toValues:x=>({...x}),fromValues:x=>({...x}),validate:x=>x.b==='invalid'?{b:'bad'}:{},save:async(next,fields)=>{saved={fields};return {...base,a:next.a}}});return null;}
 await act(async()=>{r=create(React.createElement(Form))});await act(async()=>{form.setValue('a','new A');form.setValue('b','invalid')});
 await act(async()=>form.save(['a']));assert.deepEqual(saved.fields,['a']);assert.equal(form.values.b,'invalid');assert.ok(form.dirty);
 await act(async()=>form.reset(['b']));assert.equal(form.values.a,'new A');assert.equal(form.values.b,'old B');assert.ok(!form.dirty);
 await act(async()=>r.unmount());console.log('PASS: vendor-defined levels and closing id, semantic fallback, draft-only slider, one apply, rejection, scoped save preserves hidden draft');
}
main().catch(e=>{console.error(e);process.exitCode=1});

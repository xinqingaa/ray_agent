/* eslint-disable @typescript-eslint/no-require-imports */
// 实际菜单和圆环组件；DOM 几何与基础弹层使用替身，实际滚动由浏览器检查。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const React=require('react'),{create,act}=require('react-test-renderer'),ts=require('typescript');
global.IS_REACT_ACT_ENVIRONMENT=true;global.CSS={escape:x=>x};
const root=path.resolve(__dirname,'../src'),cache=new Map();
const ui=new Proxy({}, {get:(_,name)=>props=>React.createElement(name==='Button'?'button':'div',props,props.children)});
function load(file){
 if(cache.has(file))return cache.get(file).exports;
 const m={exports:{}};cache.set(file,m);
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',js)(name=>{
  if(name==='react'||name==='react/jsx-runtime')return require(name);
  if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
  if(name==='@/hooks/use-developer-mode')return {useDeveloperMode:()=>({visibility:{canShowCommand:()=>true}})};
  if(name.startsWith('@/components/ui/'))return ui;
  if(name==='@/lib/utils')return {cn:(...xs)=>xs.filter(Boolean).join(' '),formatTokenCount:String};
  const base=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);
  const found=['.ts','.tsx'].map(ext=>base+ext).find(p=>fs.existsSync(p));
  if(!found)throw Error(name);return load(found);
 },m,m.exports);return m.exports;
}
const {SlashCommandList}=load(path.join(root,'components/input-command-menu.tsx'));
const {ContextRing,ContextRingGlyph}=load(path.join(root,'components/run/context-ring.tsx'));
const usage={context:{usedTokens:500,windowTokens:1000,lastTurnTokens:100},watermarkRatio:.8,session:{prompt:0,completion:0,total:0,cached:null}};
const context={hasSession:true,hasRuns:true,runStatus:'completed',waitingApproval:false,waitingReply:false,submitting:false,uploading:false,compacting:false,planMode:false,contextUsage:usage,actions:{}};
const extra=Array.from({length:20},(_,i)=>({id:`skill:${i}`,title:`Skill ${i}`,description:'说明',keyword:`s${i}`,aliases:[],keywords:[],icon:()=>null,available:()=>({available:true}),run(){}}));
let list={scrollTop:0,getBoundingClientRect:()=>({top:0,bottom:160}),querySelector:()=>({getBoundingClientRect:()=>({top:400-list.scrollTop,bottom:440-list.scrollTop})})};
async function main(){
 let c,selected=null,ran=[];
 const props={query:'',extraCommands:extra,context,activeId:'upload',keyboardStep:0,onActiveIdChange:id=>selected=id,onRun:c=>ran.push(c.id)};
 await act(async()=>{c=create(React.createElement(SlashCommandList,props),{createNodeMock:el=>el.props.role==='listbox'?list:null})});
 const option=id=>c.root.findAllByProps({role:'option'}).find(x=>x.props['data-value']===id);
 assert.equal(option('project'),undefined);
 assert.equal(option('compact').findAllByType('button').length,0,'圆环不嵌套按钮');
 assert.ok(option('compact').findByProps({role:'img'}).props['aria-label'].includes('50%'));
 list.scrollTop=80;
 await act(async()=>option('skill:9').props.onPointerMove({pointerType:'mouse',clientX:10,clientY:20,movementX:1,movementY:0}));
 assert.equal(selected,'skill:9');
 await act(async()=>c.update(React.createElement(SlashCommandList,{...props,activeId:selected})));
 assert.equal(list.scrollTop,80,'悬停不触发滚动');
 selected=null;
 await act(async()=>option('skill:8').props.onPointerMove({pointerType:'mouse',clientX:10,clientY:20,movementX:0,movementY:0}));
 assert.equal(selected,null,'静止鼠标不抢回键盘选择');
 await act(async()=>c.update(React.createElement(SlashCommandList,{...props,activeId:'skill:9',keyboardStep:1})));
 assert.equal(list.scrollTop,280,'键盘越界时最小滚动');
 list.scrollTop=100;
 await act(async()=>c.update(React.createElement(SlashCommandList,{...props,activeId:'skill:8',keyboardStep:1})));
 assert.equal(list.scrollTop,100,'滚轮位置不被选中项变化拉回');
 await act(async()=>c.update(React.createElement(SlashCommandList,{...props,query:'no-such-command',keyboardStep:1})));
 assert.equal(list.scrollTop,0,'新查询从顶部开始');
 assert.ok(c.root.findByProps({role:'listbox'}).props.className.includes('h-['));
 await act(async()=>c.update(React.createElement(SlashCommandList,{...props,context:{...context,runStatus:'running'}})));
 await act(async()=>option('compact').props.onClick());assert.deepEqual(ran,[]);
 assert.match(option('compact').props['aria-label'],/不可用/);
 await act(async()=>c.unmount());
 let full,glyph;
 await act(async()=>{full=create(React.createElement(ContextRing,{usage}));glyph=create(React.createElement(ContextRingGlyph,{usage}))});
 assert.deepEqual(full.root.findAllByType('circle').map(x=>x.props),glyph.root.findAllByType('circle').map(x=>x.props));
 await act(async()=>glyph.update(React.createElement(ContextRingGlyph,{})));
 assert.equal(glyph.root.findAllByType('circle').length,1);assert.ok(glyph.root.findByType('circle').props.strokeDasharray);
 await act(async()=>{full.unmount();glyph.unmount()});
 console.log('PASS: 鼠标不滚动、键盘最小滚动、滚轮不回拉、静止指针不抢选择、固定高度、project 移除、圆环复用与未知态、禁用压缩');
}
main().catch(e=>{console.error(e);process.exitCode=1});

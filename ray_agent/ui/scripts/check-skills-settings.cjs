/* eslint-disable @typescript-eslint/no-require-imports */
// 运行实际 Skills 设置组件；网络、弹层宿主与 Markdown 渲染使用替身。焦点与渲染由浏览器走查。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const React = require('react'), {create, act} = require('react-test-renderer'), ts = require('typescript');
global.IS_REACT_ACT_ENVIRONMENT = true;
const values = new Map();
global.sessionStorage = {getItem:k=>values.get(k) ?? null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
let discard = false;
global.window = {confirm:()=>discard};
const candidate = {path:'', name:'sample-skill',description:'可复用方法',version:'a'.repeat(64),text:'---\nname: sample-skill\ndescription: 可复用方法\n---\n# 方法\n\n**核对目标**',files:[{path:'SKILL.md',size:110,sha256:'a'},{path:'agents/openai.yaml',size:10,sha256:'b'}],warnings:[]};
const builtin = {...candidate,id:'builtin',name:'find-skills',builtin:true,enabled:true,source:{kind:'builtin'}};
const installed = {...candidate,id:'installed',builtin:false,enabled:true,source:{kind:'manual'}};
let lostPublish = false, completed = null;
let items = [builtin], imports = [], publishes = [], details = 0, failPublish = true, changed = 0;
const api = {
  list:async()=>items,
  detail:async(name)=>{details++; return items.find(s=>s.name===name)},
  import:async(payload)=>{imports.push(payload); return {...ready,id:payload.operation_id}},
  uploadLocal:async(data)=>{const operation_id=data.get('operation_id'); imports.push({operation_id}); return {...ready,id:operation_id}},
  operation:async(id)=>completed?.id===id?completed:({...ready,id}),
  file:async()=>new Blob(['interface: test']),
  importFile:async()=>new Blob(['interface: test']),
  delete:async()=>{items=[builtin]},
  publish:async(id,c)=>{publishes.push({id,path:c.path}); if(failPublish){failPublish=false;throw Error('暂时无法安装')} items=[builtin,installed];if(lostPublish){lostPublish=false;completed={...ready,id,stage:'completed',result:installed};throw Error('响应丢失')}return {...ready,stage:'completed',result:installed}},
};
const ready = {id:'operation',stage:'ready',source:{kind:'manual'},candidates:[candidate],error:null,result:null};
const ui = new Proxy({}, {get:(_,name)=>props=>{
  if(name==='Dialog') return props.open ? React.createElement('dialog',{'data-open':true},props.children) : null;
  const tag = name==='Input'?'input':name==='Textarea'?'textarea':name==='Button'?'button':'div';
  return React.createElement(tag,props,props.children);
}});
const root = path.resolve(__dirname, '..'), cache = new Map();
function load(filename) {
  if(cache.has(filename))return cache.get(filename).exports;
  const m={exports:{}};cache.set(filename,m);
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',code)(name=>{
    if(name==='react' || name==='react/jsx-runtime')return require(name);
    if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
    if(name.startsWith('@/components/ui/'))return ui;
    if(name==='@/components/markdown-content')return {MarkdownContent:props=>React.createElement('article',{'data-markdown':props.content})};
    if(name==='@/lib/utils')return {cn:(...x)=>x.filter(Boolean).join(' '),formatFileSize:n=>`${n} B`};
    if(name==='@/lib/api/skills')return {skillsApi:api,skillsChanged:()=>changed++};
    if(name==='sonner')return {toast:{success(){}}};
    if(name.startsWith('@/')){
      const base=path.join(root,'src',name.slice(2));
      const found=['.ts','.tsx'].map(ext=>base+ext).find(candidate=>fs.existsSync(candidate));
      if(!found)throw Error(name);
      return load(found);
    }
    throw Error(name);
  },m,m.exports);
  return m.exports;
}
const m = {exports: load(path.join(root,'src/components/settings/skills-section.tsx'))};
const text = node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.children?.map(text).join('')??'';
async function main(){
  let c,dirty=false;
  const props={onDirtyChange:value=>{dirty=value}};
  await act(async()=>{c=create(React.createElement(m.exports.SkillsSection,props))});
  const buttons=()=>c.root.findAllByType('button');
  const button=label=>buttons().find(n=>n.props['aria-label']===label || text(n)===label);
  const click=async label=>{assert.ok(button(label),label);await act(async()=>button(label).props.onClick({currentTarget:{focus(){}}}))};
  const input=placeholder=>c.root.findAllByType('input').find(n=>n.props.placeholder===placeholder);
  await click('find-skills内置可复用方法');
  assert.equal(details,1);assert.equal(c.root.findAllByType('textarea').length,0);assert.equal(button('编辑正文'),undefined);
  assert.equal(c.root.findByType('article').props['data-markdown'],'# 方法\n\n**核对目标**');
  await click('agents/openai.yaml');assert.equal(c.root.findAllByType('article').length,0);
  assert.ok(c.root.findAllByType('pre').some(n=>text(n).includes('interface: test')));
  await click('SKILL.md');assert.equal(c.root.findAllByType('article').length,1);
  await act(async()=>c.root.findByType('dialog').parent.props.onOpenChange(false));
  assert.equal(c.root.findAllByType('dialog').length,0);
  const local = load(path.join(root,'src/lib/skill-local.ts'));
  const loose = local.classifyLocalPaths(['notes.md','a.txt'], 'loose');
  assert.equal(loose.ok, true);
  assert.deepEqual(loose.files.map(item => item.path).sort(), ['SKILL.md','a.txt']);
  assert.equal(local.classifyLocalPaths(['a.md','b.md'], 'loose').ok, false);
  assert.equal(local.classifyLocalPaths(['pack.zip','a.txt'], 'loose').ok, false);
  assert.equal(local.classifyLocalPaths(['SKILL.md','guide.md'], 'loose').ok, false);
  assert.equal(local.classifyLocalPaths(['pack.zip'], 'loose').zip, true);
  const folder = local.classifyLocalPaths(['skill/SKILL.md','skill/run.py','skill/.DS_Store','__MACOSX/x'], 'folder');
  assert.deepEqual(folder.files.map(item => item.path), ['skill/SKILL.md','skill/run.py']);
  assert.equal(local.classifyLocalPaths(['skill/.git/config'], 'folder').ok, false);
  assert.equal(local.hasSkillFrontmatter('---\nname: a\n---\nbody\n'), true);
  assert.equal(local.hasSkillFrontmatter('# 标题\n'), false);
  await click('新增 Skill');await click('本地内容');await click('直接编写从空白正文开始');
  await act(async()=>{
    input('my-skill').props.onChange({target:{value:'sample-skill'}});
    input('什么时候使用这个 Skill').props.onChange({target:{value:'可复用方法'}});
    c.root.findByType('textarea').props.onChange({target:{value:'# 方法\n\n**核对目标**'}});
  });
  assert.equal(dirty,true);
  await act(async()=>c.update(React.createElement(m.exports.SkillsSection,{...props,active:false})));
  assert.equal(c.root.findAllByType('dialog').length,0);
  await act(async()=>c.update(React.createElement(m.exports.SkillsSection,{...props,active:true})));
  assert.equal(input('my-skill').props.value,'sample-skill');
  await click('取消');assert.equal(c.root.findAllByType('dialog').length,1,'拒绝放弃后保留表单');
  await click('GitHub');assert.ok(button('获取'));assert.equal(button('安装 Skill'),undefined);assert.equal(button('改用文件'),undefined);
  await click('本地内容');assert.equal(input('my-skill').props.value,'sample-skill');
  await click('查看排版');assert.equal(c.root.findAllByType('article').length,1);
  await click('继续编辑');assert.equal(c.root.findAllByType('textarea').length,1);
  await click('安装 Skill');assert.ok(c.root.findByProps({role:'alert'}));
  await click('安装 Skill');assert.equal(publishes[0].id,publishes[1].id);assert.equal(publishes[0].path,'');
  assert.equal(c.root.findAllByType('dialog').length,1,'成功后留在详情');assert.equal(dirty,false);assert.equal(changed,1);
  await click('删除 Skill');await click('删除');assert.equal(c.root.findAllByType('dialog').length,0);
  await click('新增 Skill');await click('本地内容');
  assert.equal(button('预览'),undefined);
  const fileInput=c.root.findAllByType('input').find(n=>n.props.type==='file' && n.props.accept);
  await act(async()=>{await fileInput.props.onChange({target:{files:[new File(['---\nname: sample-skill\n---\nbody'],'SKILL.md')],value:''}});await new Promise(r=>setTimeout(r,0))});
  assert.ok(c.root.findAllByType('article').length,'选择文件后自动打开正文');
  assert.equal(button('获取'),undefined);
  lostPublish=true;await click('安装 Skill');
  assert.equal(c.root.findAllByType('dialog').length,1,'响应丢失后读回完成结果并打开详情');
  assert.equal(c.root.findAllByProps({role:'alert'}).length,0);
  await act(async()=>c.unmount());
  // 快速切换文件时，迟到的读取不能覆盖当前对象。
  const Reader=load(path.join(root,'src/components/skill-reader.tsx')).SkillReader;
  let completeYaml;
  const yaml=new Promise(resolve=>{completeYaml=resolve});
  const reading={...installed,files:[...installed.files,{path:'scripts/run.py',size:5,sha256:'c'}]};
  await act(async()=>{c=create(React.createElement(Reader,{skill:reading,readFile:p=>p==='agents/openai.yaml'?yaml:Promise.resolve(new Blob(['print(1)']))}))});
  await click('agents/openai.yaml');await click('scripts/run.py');
  await act(async()=>{completeYaml(new Blob(['late yaml']));await Promise.resolve()});
  assert.ok(c.root.findAllByType('pre').some(n=>text(n).includes('print(1)')));
  assert.ok(!c.root.findAllByType('pre').some(n=>text(n).includes('late yaml')));
  await act(async()=>c.unmount());
  const previousFetch=global.fetch;let sent;
  global.fetch=async(_url,options)=>{sent=options;return new Response(JSON.stringify({code:200,data:{}}),{headers:{'content-type':'application/json'}})};
  await load(path.join(root,'src/lib/api/fetch.ts')).request('/skills/example',{method:'DELETE'});
  assert.equal(sent.headers['Content-Type'],undefined,'无正文删除不标为 JSON');
  global.fetch=previousFetch;

  console.log('PASS: 内置只读、包文件读取、草稿排版、关闭保护、失败重试、安装留在详情、删除、选择文件后自动打开');
}
main().catch(error=>{console.error(error);process.exitCode=1});

/* eslint-disable @typescript-eslint/no-require-imports */
// 实际输入组件、剪贴板提取与草稿模块；上传、模型目录和基础 UI 为受控替身。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const React = require('react'), {create, act} = require('react-test-renderer');
const ts = require('typescript'), root = path.resolve(__dirname, '..'), cache = new Map();
global.IS_REACT_ACT_ENVIRONMENT = true;
const values = new Map(), listeners = new Map(), messages = [];
global.sessionStorage = {getItem:k=>values.get(k) ?? null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
global.localStorage = {getItem:()=>null};
global.CustomEvent = class {constructor(type, options){this.type=type;this.detail=options.detail}};
global.window = {
  addEventListener:(type, fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn)},
  removeEventListener:(type, fn)=>listeners.get(type)?.delete(fn),
  dispatchEvent:event=>listeners.get(event.type)?.forEach(fn=>fn(event)),
};
const fileApi = {}, projectApi = {};
function ModelPicker() {return null}
const ui = new Proxy({}, {get:(_,name)=>props=>React.createElement(name==='Button'?'button':'div',{...props,'data-component':name},props.children)});
function load(relative) {
  const filename = path.join(root, relative);
  if(cache.has(filename))return cache.get(filename).exports;
  const m={exports:{}};cache.set(filename,m);
  const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',code)(name=>{
    if(name==='react')return React;
    if(name==='react/jsx-runtime')return require(name);
    if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
    if(name==='sonner')return {toast:new Proxy({}, {get:()=>message=>messages.push(message)})};
    if(name==='next/navigation')return {useRouter:()=>({push(){}})};
    if(name==='@/hooks/use-developer-mode')return {useDeveloperMode:()=>({visibility:{canShowCommand:()=>true}})};
    if(name==='@/providers/projects-provider')return {useProjects:()=>null};
    if(name==='@/components/model-picker')return {ModelPicker};
    if(name==='@/components/project-picker')return {ProjectPicker:()=>null};
    if(name==='@/components/preview/attachment-thumbnail')return {AttachmentThumbnail:()=>null};
    if(name==='@/components/preview/file-preview-dialog')return {FilePreviewDialog:()=>null};
    if(name==='@/components/input-command-menu')return {PlusCommandMenu:()=>null,SlashCommandList:()=>null};
    if(name.startsWith('@/components/ui/'))return ui;
    if(name==='@/lib/utils')return {cn:(...x)=>x.filter(Boolean).join(' '),formatFileSize:n=>String(n)};
    if(name==='@/lib/api/file')return {fileApi};
    if(name==='@/lib/api/project')return {projectApi};
    if(name.startsWith('@/')){
      const base=path.join(root,'src',name.slice(2));
      const found=['.ts','.tsx'].map(ext=>base+ext).find(candidate=>fs.existsSync(candidate));
      return load(path.relative(root,found));
    }
    if(name.startsWith('.')){
      const base=path.resolve(path.dirname(filename),name);
      return load(path.relative(root,base+'.ts'));
    }
    return require(name);
  },m,m.exports);
  return m.exports;
}
const {ChatInput}=load('src/components/chat-input.tsx');
const {clipboardImages}=load('src/lib/composer-images.ts');
const {readDraft,checkAcceptance}=load('src/lib/drafts.ts');
const image=new File(['pixels'],'screenshot.png',{type:'image/png'});
const clipboard=(files,text='')=>({items:files.map(file=>({kind:'file',type:file.type,getAsFile:()=>file})),files,getData:type=>type==='text/plain'?text:''});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const fileInfo=(file,id='f')=>({id,filename:file.name,extension:'.png',size:file.size,mime_type:file.type});
async function main(){
  assert.equal(clipboardImages(clipboard([image])).length,1);
  assert.equal(clipboardImages(clipboard([new File(['x'],'no-extension',{type:'image/png'})]))[0].name.endsWith('.png'),true);
  assert.deepEqual(clipboardImages(clipboard([new File(['text'],'note.txt',{type:'text/plain'})])),[]);
  assert.equal(clipboardImages({items:[],files:[image]}).length,1);
  const ref=React.createRef();let component;
  const sent=[];
  const props={ref,draftScope:'origin',onSend:async(...args)=>sent.push(args)};
  await act(async()=>{component=create(React.createElement(ChatInput,props))});
  const textarea=()=>component.root.findByType('textarea');
  await act(async()=>textarea().props.onChange({target:{value:'图片任务草稿',selectionStart:6}}));
  let prevented=0, uploads=0;
  fileApi.uploadFile=async({file})=>{uploads++;return fileInfo(file)};
  await act(async()=>textarea().props.onPaste({clipboardData:clipboard([image],'附加文字'),preventDefault(){prevented++}}));
  assert.equal(prevented,0);assert.equal(uploads,1);assert.equal(ref.current.getFiles().length,1);
  await act(async()=>textarea().props.onPaste({clipboardData:clipboard([], '纯文本'),preventDefault(){prevented++}}));
  assert.equal(uploads,1);assert.equal(prevented,0);
  await act(async()=>component.root.findByProps({'aria-label':'发送'}).props.onClick());
  assert.equal(sent[0][2].image_mode,'auto');assert.equal(sent[0][1][0].id,'f');
  assert.equal(ref.current.getInputValue(),'');assert.equal(ref.current.getFiles().length,0);
  console.log('PASS: 单次图片不重复提取、文件名补全、混合/纯文本粘贴、发送像素模式与清空');

  const pending=deferred();fileApi.uploadFile=()=>pending.promise;
  await act(async()=>textarea().props.onPaste({clipboardData:clipboard([image]),preventDefault(){prevented++}}));
  assert.equal(component.root.findByProps({'aria-label':'发送'}).props.disabled,true);
  await act(async()=>component.update(React.createElement(ChatInput,{...props,draftScope:'next'})));
  await act(async()=>pending.resolve(fileInfo(image,'late')));
  assert.equal(ref.current.getFiles().length,0);
  assert.equal(readDraft('next').files.length,0);
  assert.equal(readDraft('origin').files[0].id,'late');
  console.log('PASS: 上传中禁发，迟到结果只返回发起草稿，不污染当前页面');

  fileApi.uploadFile=async({file})=>{if(file.name==='bad.png')throw Error('controlled failure');return fileInfo(file,'success')};
  await act(async()=>textarea().props.onPaste({clipboardData:clipboard([image,new File(['bad'],'bad.png',{type:'image/png'})]),preventDefault(){}}));
  assert.deepEqual(ref.current.getFiles().map(file=>file.id),['success']);
  assert.ok(messages.some(message=>message.includes('bad.png')));
  await act(async()=>component.unmount());
  await act(async()=>{component=create(React.createElement(ChatInput,{...props,draftScope:'nonvisual'}))});
  await act(async()=>textarea().props.onChange({target:{value:'作为文件处理',selectionStart:6}}));
  await act(async()=>textarea().props.onPaste({clipboardData:clipboard([image]),preventDefault(){}}));
  assert.equal(component.root.findByProps({'aria-label':'发送'}).props.disabled,false);
  assert.equal(component.root.findAllByProps({'data-component':'ItemTitle'}).length,0);
  assert.ok(component.root.findAllByType('button').some(node=>node.props['aria-label']===`预览 ${image.name}`));
  assert.ok(component.root.findAllByType('button').some(node=>node.props['aria-label']===`移除 ${image.name}`));
  assert.ok(!JSON.stringify(component.toJSON()).includes('模型视觉能力'));
  assert.equal(readDraft('nonvisual').imageMode,'auto');
  await act(async()=>component.root.findByProps({'aria-label':'发送'}).props.onClick());
  assert.equal(sent.at(-1)[2].image_mode,'auto');
  const detail={last_seq:2,runs:[{run_id:'r',mode:'normal'}],events:[{event:'message',data:{seq:2,run_id:'r',role:'user',message:'same',attachments:[],image_mode:'files'}}]};
  assert.equal(checkAcceptance(detail,{message:'same',attachments:[],mode:'normal',image_mode:'auto',afterSeq:1}).kind,'absent');
  assert.equal(checkAcceptance(detail,{message:'same',attachments:[],mode:'normal',image_mode:'files',afterSeq:1}).kind,'accepted');
  await act(async()=>component.unmount());
  console.log('PASS: 部分上传失败、缩略图与预览/移除入口、不依赖模型目录发送、旧模式受理核对');
  await act(async()=>{component=create(React.createElement(ChatInput,{...props,draftScope:'image-limit'}))});
  fileApi.uploadFile=async({file})=>fileInfo(file,crypto.randomUUID());
  await act(async()=>textarea().props.onChange({target:{value:'查看三张图片',selectionStart:6}}));
  await act(async()=>textarea().props.onPaste({clipboardData:clipboard([image,image,image]),preventDefault(){}}));
  assert.equal(ref.current.getFiles().length,3);
  assert.equal(component.root.findByProps({'aria-label':'发送'}).props.disabled,false);
  await act(async()=>component.unmount());
  console.log('PASS: 多图按原附件发送，像素预算交由后端处理');
}
main().catch(error=>{console.error(error);process.exitCode=1});

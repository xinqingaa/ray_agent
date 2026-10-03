// 实际扫描器与审核树回归；合成文件和 React renderer，不调用产品服务。
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const {create, act} = require('react-test-renderer');
const root = path.resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
global.IS_REACT_ACT_ENVIRONMENT = true;
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(root + '/src/' + file, 'utf8'), {compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports',code)(name => {
    if(name === 'react') return React;
    if(name === 'react/jsx-runtime') return require(name);
    if(name === 'lucide-react') return new Proxy({}, {get:() => () => null});
    if(name === '@/components/ui/button') return {Button:props => React.createElement('button',props,props.children)};
    if(name === '@/components/run/format') return {formatBytes:bytes => bytes+' B'};
    if(name === '@/lib/utils') return {cn:(...values) => values.filter(Boolean).join(' ')};
    throw Error(name);
  }, exports);
  return exports;
}
const {scanProjectUpload, uploadSelection} = load('lib/project-upload.ts');
const {ProjectUploadTree} = load('components/project-upload-tree.tsx');
const rules = {version:'test',max_file_bytes:100,max_batch_bytes:1000,max_files:100,always_exclude:['.git'],dependency_directories:['node_modules'],conditional_directories:{},sensitive_patterns:['.env'],venv_marker:'pyvenv.cfg'};
const file = (name, data='synthetic') => ({name,kind:'file',file:async () => new File([data],name)});
let dependencyScans=0;
const sources = [
  {name:'资料',kind:'directory',children:async () => [file('source.csv'),{name:'报告',kind:'directory',children:async () => [file('结果.txt')]}]},
  {name:'node_modules',kind:'directory',children:async () => {dependencyScans++;return [file('index.js')]}},
  {name:'.git',kind:'directory',children:async () => {throw Error('禁止进入版本库')}},
  file('.env'), file('超大文件.bin','a'.repeat(101)),
];
(async () => {
  let scan = await scanProjectUpload(sources,rules,new Set());
  assert.equal(dependencyScans,0);
  assert.deepEqual(uploadSelection(scan,rules).items.map(item => item.path),['资料/source.csv','资料/报告/结果.txt']);
  let confirmed=new Set(), optionalCalls=[];
  const props = () => ({scan,optionalRows:scan.excluded,confirmed,overwrite:new Set(),preflight:null,result:null,disabled:false,sourceName:'合成',onOptional:(...args) => optionalCalls.push(args),onOverwrite() {}});
  let renderer;
  await act(async () => {renderer=create(React.createElement(ProjectUploadTree,props()))});
  const content=() => JSON.stringify(renderer.toJSON());
  const control=label => renderer.root.findAllByType('button').find(button => button.children.join('')===label);
  const node=title => renderer.root.findAllByProps({role:'treeitem'}).find(item => item.findAllByProps({title}).length);
  await act(async () => node('node_modules').props.onClick());
  assert.ok(content().includes('未扫描，大小未统计'));
  await act(async () => renderer.root.findByType('input').props.onChange({target:{checked:true}}));
  assert.deepEqual(optionalCalls,[['node_modules',true]]);
  assert.equal(dependencyScans,0);
  await act(async () => control('需确认').props.onClick());
  assert.ok(!node('source.csv'));
  assert.ok(node('.env'));
  await act(async () => control('已排除').props.onClick());
  await act(async () => node('.git').props.onClick());
  assert.equal(renderer.root.findAllByType('input').length,0);
  confirmed=new Set(['node_modules','.env']);
  scan=await scanProjectUpload(sources,rules,confirmed);
  assert.equal(dependencyScans,1);
  const selection=uploadSelection(scan,rules);
  assert.ok(selection.items.some(item => item.path==='node_modules/index.js'));
  assert.ok(selection.items.some(item => item.path==='.env'));
  assert.ok(!selection.items.some(item => item.path.startsWith('.git') || item.path==='超大文件.bin'));
  await act(async () => renderer.update(React.createElement(ProjectUploadTree,{...props(),preflight:{items:[{path:'资料/source.csv',conflict:true}]}})));
  await act(async () => control('需确认').props.onClick());
  assert.ok(node('source.csv'));
  await act(async () => node('source.csv').props.onClick());
  assert.ok(content().includes('确认覆盖同名文件'));
  await act(async () => renderer.update(React.createElement(ProjectUploadTree,{...props(),result:{results:{failures:{'资料/source.csv':'合成：上传失败'}}}})));
  await act(async () => control('上传失败').props.onClick());
  assert.ok(node('source.csv'));
  assert.ok(!node('index.js'));
  await act(async () => renderer.unmount());
  console.log('PASS: 树筛选不改上传集合；禁止项不可确认；未知大小、确认后扫描、覆盖与失败状态正确');
})().catch(error => {console.error(error);process.exitCode=1});

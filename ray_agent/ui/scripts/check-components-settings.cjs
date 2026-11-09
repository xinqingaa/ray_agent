/* eslint-disable @typescript-eslint/no-require-imports */
// 实际组件配合延迟网络替身：安装身份、取消／重试、重新挂载与迟到响应。
const assert = require('node:assert/strict');
const React = require('react');
const {act, create} = require('react-test-renderer');
const {createLoader} = require('./workspace-loader.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const store = new Map();
global.sessionStorage = {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key)};
const initial = {component_id:'browser-chromium',state:'not_installed',version:null,target_version:'chromium-test',size:1000000,operation:null};
let row = {...initial}, lost = true, delayed = null;
const requests = [], cancelled = [], retried = [];
const operation = {operation_id:'op-1',generation:1,status:'running',phase:'获取中',can_cancel:true,can_retry:false,cancel_requested_at:null,error:null};
const api = {
  list: async () => delayed ? delayed : [{...row}],
  install: async (id, request) => {requests.push({id,request});if(lost){lost=false;throw Error('响应丢失')}row={...initial,state:'fetching',operation:{...operation}};return operation},
  cancel: async id => {cancelled.push(id);row={...row,state:'cancelled',operation:{...operation,status:'cancelled',can_cancel:false,can_retry:true}};return row.operation},
  retry: async id => {retried.push(id);row={...row,state:'fetching',operation:{...operation,generation:2}};return row.operation},
};
const {ComponentsSection} = createLoader({
  '@/lib/api/components':{componentsApi:api},
  '@/components/ui/button':{Button: props=>React.createElement('button',props,props.children)},
  './form':{SectionHeader:props=>React.createElement('h2',null,props.title),LoadError:props=>React.createElement('div',null,props.message,React.createElement('button',{onClick:props.onRetry},'重新读取'))},
})('src/components/settings/components-section.tsx');
const text = node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node?.children?.map(text).join('')??'';
async function main(){
  let view;
  await act(async()=>{view=create(React.createElement(ComponentsSection))});
  const click = async label => {
    const button=view.root.findAllByType('button').find(n=>text(n)===label);
    assert.ok(button,label); await act(async()=>button.props.onClick());
  };
  await click('安装');
  assert.equal(requests.length,1); assert.equal(store.size,1);
  await click('安装');
  assert.equal(requests[0].request,requests[1].request,'未知结果重用同一请求身份');
  assert.equal(store.size,0);
  assert.ok(text(view.toJSON()).includes('获取中'));
  await click('取消安装');assert.deepEqual(cancelled,['op-1']);
  await click('重试安装');assert.deepEqual(retried,['op-1']);
  await act(async()=>view.unmount());
  await act(async()=>{view=create(React.createElement(ComponentsSection))});
  assert.ok(text(view.toJSON()).includes('获取中'),'重新打开设置读回持久进度');
  await act(async()=>view.unmount());
  let resolve;
  delayed=new Promise(done=>{resolve=done});
  await act(async()=>{view=create(React.createElement(ComponentsSection))});
  assert.ok(text(view.toJSON()).includes('正在读取'));
  await act(async()=>view.unmount());
  await act(async()=>resolve([{...initial,state:'available'}]));
  console.log('components settings checks passed');
}
main().catch(error=>{console.error(error);process.exitCode=1});

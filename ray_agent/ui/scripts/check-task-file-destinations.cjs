/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const React = require('react');
const {act, create} = require('react-test-renderer');
const {createLoader} = require('./workspace-loader.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
global.HTMLElement = global.Element = class {};
global.document = {activeElement: null};
global.requestAnimationFrame = callback => callback();

const load = createLoader({
  '@/components/ui/icons': new Proxy({}, {get: () => () => null}),
  '@/lib/api/workspace': {rootApi: {entries: async rootId => {
    assert.equal(rootId, 'authorized-root');
    return {entries: [
      {name: '材料', kind: 'directory', path: {root_id: rootId, relative_path: '材料'}},
      {name: '快捷方式', kind: 'symlink', path: {root_id: rootId, relative_path: '快捷方式'}},
    ]};
  }}},
});
const {TaskLayout} = load('src/components/task-layout.tsx');
const {TaskFilePicker} = load('src/lib/task-file-picker.ts');
const actions = [];
function Harness() {
  const choose = React.useContext(TaskFilePicker);
  return React.createElement('button', {onClick: () => choose([file])}, '选文件');
}
const file = {name: '样例.md'};
const attachment = files => actions.push(['attach', files]);
const folder = (files, directory) => actions.push(['folder', files, directory]);
function paperEvent({target, directory, point, composer = false} = {}) {
  const element = new HTMLElement();
  element.closest = selector => {
    if (selector === '[data-drop-directory]' && directory !== undefined) return {dataset: {dropDirectory: directory}};
    if (selector === '[data-task-drop]' && target) return {dataset: {taskDrop: target}};
    return null;
  };
  return {
    preventDefault() {},
    target: element,
    currentTarget: {
      querySelector: () => composer ? {getBoundingClientRect: () => ({left: 40, top: 40, right: 160, bottom: 160})} : null,
      querySelectorAll: () => [],
    },
    clientX: point?.[0] ?? 0,
    clientY: point?.[1] ?? 0,
    dataTransfer: {types: ['Files'], files: [file]},
  };
}
async function main() {
  let tree;
  await act(async () => {
    tree = create(React.createElement(TaskLayout, {
      workspace: true, attach: attachment, addToFolder: folder, folderRootId: 'authorized-root',
    }, React.createElement(Harness)));
  });
  const button = title => tree.root.findAllByType('button').find(node => node.children.join('') === title);
  const paper = () => tree.root.findByProps({className: 'task-paper'}).props;
  await act(async () => button('选文件').props.onClick());
  assert.ok(button('材料/'));
  assert.equal(button('快捷方式/'), undefined);
  await act(async () => button('材料/').props.onClick());
  await act(async () => button('只加入文件夹').props.onClick());
  assert.deepEqual(actions.pop(), ['folder', [file], '材料']);
  await act(async () => button('选文件').props.onClick());
  await act(async () => button('取消').props.onClick());
  assert.equal(actions.length, 0);

  await act(async () => paper().onDragEnter(paperEvent()));
  assert.equal(tree.root.findAllByProps({'data-task-drop': 'folder'}).length, 1);
  await act(async () => paper().onDrop(paperEvent({target: 'folder', directory: '材料'})));
  assert.deepEqual(actions.pop(), ['folder', [file], '材料']);
  await act(async () => paper().onDragEnter(paperEvent()));
  await act(async () => paper().onDrop(paperEvent({target: 'folder', point: [90, 90], composer: true})));
  assert.deepEqual(actions.pop(), ['attach', [file]]);
  assert.equal(tree.root.findAllByProps({'data-task-drop': 'attach'}).length, 0);

  await act(async () => tree.update(React.createElement(TaskLayout, {attach: attachment})));
  await act(async () => paper().onDragEnter(paperEvent()));
  assert.equal(tree.root.findAllByProps({'data-task-drop': 'folder'}).length, 0);
  await act(async () => paper().onDragLeave(paperEvent()));
  await act(async () => tree.unmount());
  console.log('PASS: 选文件与拖放共用实际目录，覆盖取消、直接拖入输入框与独立对话单落点');
}
main().catch(error => {console.error(error); process.exitCode = 1;});

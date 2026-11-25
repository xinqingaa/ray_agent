/* eslint-disable @typescript-eslint/no-require-imports */
// 实际组件配合延迟网络替身：装前/装后说明、水波纹各阶段、线描图标可访问名、安装身份复用、取消/重试、卸载二次确认与占用冲突。
const assert = require('node:assert/strict');
const React = require('react');
const {act, create} = require('react-test-renderer');
const {createLoader} = require('./workspace-loader.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
const store = new Map();
global.sessionStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
  removeItem: key => store.delete(key),
};
const initial = {
  component_id: 'browser-chromium',
  state: 'not_installed',
  version: null,
  target_version: 'chromium-test',
  update_available: true,
  platform: 'macos-arm64',
  size: 1000000,
  operation: null,
  error: null,
};
let row = {...initial}, lost = true, delayed = null, uninstallConflict = false;
const requests = [], cancelled = [], retried = [], uninstalled = [];
const operation = {
  operation_id: 'op-1',
  generation: 1,
  status: 'running',
  phase: '获取中',
  progress: {completed: 400000, total: 1000000},
  can_cancel: true,
  can_retry: false,
  cancel_requested_at: null,
  error: null,
};
const api = {
  list: async () => delayed ? delayed : [{...row}],
  install: async (id, request) => {
    requests.push({id, request});
    if (lost) {lost = false; throw Error('响应丢失');}
    row = {...initial, state: 'fetching', operation: {...operation}};
    return operation;
  },
  cancel: async id => {
    cancelled.push(id);
    row = {...row, state: 'cancelled', operation: {...operation, status: 'cancelled', can_cancel: false, can_retry: true}};
    return row.operation;
  },
  retry: async id => {
    retried.push(id);
    row = {...row, state: 'fetching', operation: {...operation, generation: 2}};
    return row.operation;
  },
  uninstall: async id => {
    uninstalled.push(id);
    if (uninstallConflict) {
      uninstallConflict = false;
      throw Error('自动化浏览器正在被运行中的任务使用，请待任务结束后再卸载');
    }
    row = {...initial, state: 'not_installed', version: null, operation: null};
    return {...row};
  },
};

function MockDangerConfirmDialog({open, onOpenChange, title, description, children, confirmLabel, onConfirm}) {
  const [error, setError] = React.useState(null);
  if (!open) return null;
  return React.createElement('div', {'data-testid': 'danger-dialog', role: 'alertdialog'},
    React.createElement('h4', null, title),
    description && React.createElement('p', null, description),
    children,
    error && React.createElement('p', {role: 'alert'}, error),
    React.createElement('button', {type: 'button', onClick: () => onOpenChange(false)}, '取消'),
    React.createElement('button', {
      type: 'button',
      onClick: async () => {
        setError(null);
        try {
          await onConfirm();
          onOpenChange(false);
        } catch (err) {
          setError(err instanceof Error ? err.message : '操作失败');
        }
      },
    }, confirmLabel),
  );
}

const {ComponentsSection} = createLoader({
  '@/lib/api/components': {componentsApi: api},
  '@/components/ui/button': {Button: props => React.createElement('button', props, props.children)},
  '@/components/ui/icon-action': {
    IconAction: ({label, children, ...props}) =>
      React.createElement('button', {'aria-label': label, title: label, ...props}, children),
  },
  '@/components/ui/danger-confirm-dialog': {DangerConfirmDialog: MockDangerConfirmDialog},
  './form': {
    SectionHeader: props => React.createElement('h2', null, props.title),
    LoadError: props => React.createElement('div', null, props.message, React.createElement('button', {onClick: props.onRetry}, '重新读取')),
  },
})('src/components/settings/components-section.tsx');

const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children?.map(text).join('') ?? '';

async function main() {
  let view;
  await act(async () => {view = create(React.createElement(ComponentsSection));});
  const byAria = label => view.root.findAllByType('button').find(n => n.props['aria-label'] === label);
  const byText = label => view.root.findAllByType('button').find(n => text(n) === label);

  // 1. 装前/装后能力说明清晰可见
  const initialText = text(view.toJSON());
  assert.ok(initialText.includes('访问动态网页'), '应展示装后新增能力');
  assert.ok(initialText.includes('联网搜索'), '应展示未装时仍可用的能力');

  // 2. 安装图标可访问名 + 响应丢失时复用同一 request_id
  const installBtn = byAria('安装自动化浏览器');
  assert.ok(installBtn, '安装图标应具备可读 aria-label');
  await act(async () => installBtn.props.onClick());
  assert.equal(requests.length, 1);
  assert.equal(store.size, 1);
  await act(async () => byAria('安装自动化浏览器').props.onClick());
  assert.equal(requests[0].request, requests[1].request, '未知结果重用同一请求身份');
  assert.equal(store.size, 0);

  // 3. 水波纹进度态：已知总量
  const meter = view.root.find(n => n.props?.role === 'progressbar');
  assert.equal(meter.props['data-stage'], 'fetching');
  assert.equal(meter.props['aria-valuenow'], 40);
  assert.equal(meter.props.style['--water-level'], '40%');
  assert.ok(text(view.toJSON()).includes('40%'));

  // 4. 水波纹校验阶段：保留「正在校验」
  row = {...row, state: 'verifying', operation: {...operation, phase: '校验中'}};
  await act(async () => {view.unmount(); view = create(React.createElement(ComponentsSection));});
  const verifyingMeter = view.root.find(n => n.props?.role === 'progressbar');
  assert.equal(verifyingMeter.props['data-stage'], 'verifying');
  assert.ok(text(view.toJSON()).includes('正在校验'));

  // 5. 水波纹未知总量阶段
  row = {...row, state: 'fetching', operation: {...operation, phase: '获取中', progress: {completed: 123456, total: null}}};
  await act(async () => {view.unmount(); view = create(React.createElement(ComponentsSection));});
  assert.equal(view.root.find(n => n.props?.role === 'progressbar').props['data-stage'], 'indeterminate');

  // 6. 取消与重试
  await act(async () => byAria('取消安装自动化浏览器').props.onClick());
  assert.deepEqual(cancelled, ['op-1']);
  await act(async () => byAria('重试安装自动化浏览器').props.onClick());
  assert.deepEqual(retried, ['op-1']);

  // 7. 重挂载读回持久进度
  await act(async () => view.unmount());
  await act(async () => {view = create(React.createElement(ComponentsSection));});
  assert.equal(view.root.find(n => n.props?.role === 'progressbar').props['data-stage'], 'fetching');

  // 8. 已安装状态：卸载图标 + 二次确认 + 占用冲突留在弹框内 + 再次确认成功回退未安装
  row = {...initial, state: 'available', version: 'chromium-test', update_available: false, operation: null};
  await act(async () => {view.unmount(); view = create(React.createElement(ComponentsSection));});
  const uninstallBtn = byAria('卸载自动化浏览器');
  assert.ok(uninstallBtn, '已安装组件应提供卸载图标');
  await act(async () => uninstallBtn.props.onClick());
  const dialogText = text(view.root.find(n => n.props?.['data-testid'] === 'danger-dialog'));
  assert.ok(dialogText.includes('自动化浏览器'), '确认框应列出组件名');
  assert.ok(dialogText.includes('卸载影响'), '确认框应列出卸载影响');
  assert.ok(dialogText.includes('保留内容'), '确认框应列出保留内容');

  uninstallConflict = true;
  await act(async () => byText('确认卸载').props.onClick());
  assert.ok(text(view.toJSON()).includes('正在被运行中的任务使用'), '占用冲突应显示在确认框内');
  assert.ok(view.root.find(n => n.props?.['data-testid'] === 'danger-dialog'), '冲突后弹框应保持打开');

  await act(async () => byText('确认卸载').props.onClick());
  assert.equal(uninstalled.length, 2);
  assert.ok(byAria('安装自动化浏览器'), '卸载成功后应回退为未安装并可重新安装');

  // 9. 延迟响应在卸载后不再报错
  await act(async () => view.unmount());
  let resolve;
  delayed = new Promise(done => {resolve = done;});
  await act(async () => {view = create(React.createElement(ComponentsSection));});
  assert.ok(text(view.toJSON()).includes('正在读取'));
  await act(async () => view.unmount());
  await act(async () => resolve([{...initial, state: 'available'}]));
  console.log('components settings checks passed');
}
main().catch(error => {console.error(error); process.exitCode = 1;});

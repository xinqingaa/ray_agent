/* eslint-disable @typescript-eslint/no-require-imports */
// WP3 静态预览、目录静态站点右键菜单与 R2 成果列表后台刷新容错：挂载真实组件，网络与宿主为受控替身。
const assert = require('node:assert/strict');
const React = require('react');
const {createLoader} = require('./workspace-loader.cjs');
const {setupDom} = require('./dom-env.cjs');
const {window, document, act, flush, createRoot} = setupDom();

const calls = {
  mounts: [],
  deleted: [],
  savedBytes: [],
  savedResources: [],
  openedExternal: [],
  toasts: {success: [], error: []},
  previewSiteCalls: [],
  retries: 0,
};

let nextMountSeq = 0;
let mountBehavior = null;

const element = (type = 'div') => React.forwardRef((props, ref) => React.createElement(type, {...props, ref}, props.children));

const fetchStub = {
  ApiError: class ApiError extends Error {},
  clientError: (code, msg) => new Error(msg),
  errorFromBody: (_s, _b, msg) => new Error(msg),
  post: async (endpoint, body) => {
    calls.mounts.push({endpoint, body});
    if (mountBehavior) return mountBehavior(body);
    const n = ++nextMountSeq;
    return {
      mount_token: `tok-${n}`,
      kind: body.kind,
      title: body.kind === 'root_dir' ? 'site' : 'app.html',
      entry_path: 'index.html',
      preview_url: `http://127.0.0.1:19100/s/tok-${n}/index.html`,
      origin: 'http://127.0.0.1:19100',
      expires_at: Date.now() + 1800_000,
      export_zip_path: body.kind === 'root_dir' ? `/previews/static/mounts/tok-${n}/export.zip` : null,
    };
  },
  del: async endpoint => {
    calls.deleted.push(endpoint);
    return {deleted: true};
  },
};

const actionStub = {
  PreviewAction: props => React.createElement('button', {
    type: 'button',
    'aria-label': props.label,
    'aria-pressed': props.pressed,
    disabled: props.disabled,
    onClick: props.onClick,
  }, props.label),
};

const load = createLoader({
  sonner: {
    toast: {
      error: msg => calls.toasts.error.push(msg),
      success: msg => calls.toasts.success.push(msg),
      message: () => {},
      warning: () => {},
    },
  },
  '@/lib/platform': {
    isDesktop: () => true,
    fileManagerName: () => 'Finder',
    openExternal: async url => {calls.openedExternal.push(url);},
    saveResource: async (path, filename) => {calls.savedResources.push([path, filename]); return `/tmp/${filename}`;},
    saveBytes: async (blob, filename) => {
      const buf = new Uint8Array(await blob.arrayBuffer());
      calls.savedBytes.push({filename, type: blob.type, bytes: Array.from(buf)});
      return `/tmp/${filename}`;
    },
    revealInFileManager: async () => {},
  },
  '@/lib/core-client': {
    coreHeaders: () => ({}),
    coreUrl: p => `http://core${p}`,
  },
  '@/lib/api/fetch': fetchStub,
  './fetch': fetchStub,
  '@/lib/clipboard': {copyText: async () => {}},
  '@/lib/navigation': {
    Link: React.forwardRef((props, ref) => React.createElement('a', {...props, ref}, props.children)),
    useRouter: () => ({push: () => {}, replace: () => {}}),
    usePathname: () => '/',
  },
  '@/components/markdown-content': {MarkdownContent: props => React.createElement('p', {}, props.content)},
  '@/components/run/format': {formatBytes: n => `${n} B`},
  '@/components/preview/action': actionStub,
  './action': actionStub,
  '@/components/preview/image-preview': {ImagePreview: () => null},
  './image-preview': {ImagePreview: () => null},
  './entry-name-input': {EntryNameInput: () => null},
  '@/components/ui/button': {Button: element('button')},
  '@/components/ui/scroll-area': {ScrollArea: element('div')},
  '@/components/ui/segmented-control': {SegmentedControl: () => null},
  '@/components/ui/dialog': {
    Dialog: ({open, children}) => (open ? React.createElement('div', {role: 'dialog'}, children) : null),
    DialogContent: element('div'),
    DialogTitle: element('h2'),
    DialogDescription: element('p'),
  },
  '@/components/ui/dropdown-menu': {
    DropdownMenu: ({children}) => React.createElement('div', null, children),
    DropdownMenuTrigger: ({children}) => children,
    DropdownMenuContent: ({children}) => React.createElement('div', {role: 'menu'}, children),
    DropdownMenuItem: ({children, onSelect, disabled}) => React.createElement('button', {
      type: 'button',
      role: 'menuitem',
      disabled,
      onClick: () => {if (!disabled) onSelect?.();},
    }, children),
    DropdownMenuSeparator: () => React.createElement('hr'),
  },
  '@/components/ui/alert-dialog': {
    AlertDialog: () => null,
    AlertDialogContent: element('div'),
    AlertDialogHeader: element('div'),
    AlertDialogTitle: element('h2'),
    AlertDialogDescription: element('p'),
    AlertDialogFooter: element('div'),
  },
  '@/components/ui/icon-action': {
    IconAction: props => React.createElement('button', {
      type: 'button',
      'aria-label': props.label,
      onClick: props.onClick,
    }, props.children),
  },
  '@/components/ui/menu-entries': {
    MenuEntryItems: ({entries}) => React.createElement('div', null, entries.filter(e => e.type === 'item').map(e =>
      React.createElement('button', {key: e.label, type: 'button', onClick: e.onSelect}, e.label))),
  },
  '@/hooks/use-folder-tree': {
    useFolderTree: () => ({
      tree: {directories: {}, expanded: []},
      toggle: () => {},
      loadDirectory: async () => {},
    }),
  },
  '@/hooks/use-entry-operations': {useEntryOperations: () => ({})},
  '@/hooks/use-session-title': {useSessionTitleLookup: () => () => null},
  '@/providers/workspace-live-provider': {
    useWorkspaceLive: () => ({change: {signal: 0, batch: {paths: [], refresh: false}}, lease: null, refreshLease: async () => {}}),
  },
  '@/lib/api/documents': {documentsApi: {summary: async () => null, list: async () => []}},
  '@/lib/api/workspace': {historyApi: {modifiedRuns: async () => []}, rootApi: {}},
  './folder-toolbar-actions': {FolderToolbarActions: () => null},
  './delete-entry-dialog': {DeleteEntryDialog: () => null},
  './recent-changes': {RecentChanges: () => null},
});

const {ContextMenuProvider} = load('src/components/ui/context-menu.tsx');
const {FilePreview} = load('src/components/preview/file-preview.tsx');
const {FolderTree} = load('src/components/workspace/folder-tree.tsx');
const {FolderPanel} = load('src/components/workspace/folder-panel.tsx');

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

async function mountNode(node) {
  const container = document.getElementById('root');
  const root = createRoot(container);
  act(() => {root.render(React.createElement(ContextMenuProvider, null, node));});
  await flush();
  return root;
}

function rightClick(target) {
  const ev = new window.MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 12, clientY: 12});
  act(() => {target.dispatchEvent(ev);});
}

async function checkWebPreviewAndBridge() {
  const root = await mountNode(React.createElement(FilePreview, {
    source: {kind: 'attachment', id: 'att-1', filename: 'calendar.html', size: 2048},
  }));

  const iframe = $('iframe');
  assert.ok(iframe, 'HTML 文件默认进入应用内 WebPreview iframe');
  assert.equal(iframe.getAttribute('referrerpolicy'), 'no-referrer');
  const sandbox = iframe.getAttribute('sandbox').split(/\s+/);
  assert.ok(sandbox.includes('allow-scripts') && sandbox.includes('allow-same-origin') && sandbox.includes('allow-downloads'));
  assert.equal(calls.mounts[0].body.kind, 'attachment');

  // 桌面 / 手机视口切换
  const mobileBtn = $('[aria-label="手机视口"]');
  assert.equal(mobileBtn.getAttribute('aria-pressed'), 'false');
  act(() => {mobileBtn.click();});
  await flush();
  assert.equal($('[aria-label="手机视口"]').getAttribute('aria-pressed'), 'true');
  assert.ok($('iframe').className.includes('w-[390px]'));

  // postMessage 下载桥安全校验：伪造 origin / 伪造 source / 错 token / 超限全部拒绝；合法消息写入 saveBytes
  const bytes = new Uint8Array([65, 66, 67]).buffer;
  const fakeWindow = {};
  const frameWin = $('iframe').contentWindow;
  const dispatchMsg = (data, origin = 'http://127.0.0.1:19100', source = frameWin) => {
    act(() => {
      window.dispatchEvent(new window.MessageEvent('message', {data, origin, source}));
    });
  };

  dispatchMsg({type: 'rayagent:preview-download', mountToken: 'tok-1', filename: 'evil.ics', bytes}, 'https://evil.example', frameWin);
  dispatchMsg({type: 'rayagent:preview-download', mountToken: 'tok-1', filename: 'evil.ics', bytes}, 'http://127.0.0.1:19100', fakeWindow);
  dispatchMsg({type: 'rayagent:preview-download', mountToken: 'wrong-token', filename: 'evil.ics', bytes}, 'http://127.0.0.1:19100', frameWin);
  await flush();
  assert.equal(calls.savedBytes.length, 0, '伪造 origin/source/token 的导出消息不得触发保存');

  // 超 50 MiB 拒绝
  const huge = new Uint8Array(50 * 1024 * 1024 + 1);
  dispatchMsg({type: 'rayagent:preview-download', mountToken: 'tok-1', filename: 'huge.bin', bytes: huge});
  await flush();
  assert.equal(calls.savedBytes.length, 0);
  assert.ok(calls.toasts.error.some(m => m.includes('50 MiB')));

  // 合法消息触发 saveBytes 并清理路径穿越文件名
  dispatchMsg({type: 'rayagent:preview-download', mountToken: 'tok-1', filename: '../日程.ics', mimeType: 'text/calendar', bytes});
  await flush();
  assert.equal(calls.savedBytes.length, 1);
  assert.equal(calls.savedBytes[0].filename, '日程.ics');
  assert.deepEqual(calls.savedBytes[0].bytes, [65, 66, 67]);

  // 切换查看源码与运行预览
  globalThis.fetch = async () => new Response(
    JSON.stringify({data: {kind: 'text', content: '<!doctype html><p>源码内容</p>', revision: 'r1', filename: 'calendar.html', size: 32}}),
    {status: 200, headers: {'content-type': 'application/json'}},
  );
  const viewSourceItem = $$('[role="menuitem"]').find(el => el.textContent.includes('查看源码'));
  assert.ok(viewSourceItem, 'HTML 预览菜单包含查看源码');
  act(() => {viewSourceItem.click();});
  await flush();
  assert.ok(!$('iframe'), '查看源码时卸载 iframe');
  assert.ok(document.body.textContent.includes('源码内容'), '显示 HTML 源码文本');
  const runPreviewItem = $$('[role="menuitem"]').find(el => el.textContent.includes('运行预览'));
  assert.ok(runPreviewItem, '源码视图菜单包含运行预览');
  act(() => {runPreviewItem.click();});
  await flush();
  assert.ok($('iframe'), '点击运行预览回到 WebPreview iframe');

  // 切换到 root_dir 并导出 ZIP
  act(() => {
    root.render(React.createElement(ContextMenuProvider, null, React.createElement(FilePreview, {
      source: {kind: 'root_dir', rootId: 'r1', path: 'site', title: '我的站点'},
    })));
  });
  await flush();
  assert.ok(calls.deleted.some(url => url.includes('tok-2')), '切换来源后清理旧挂载');
  const exportZipItem = $$('[role="menuitem"]').find(el => el.textContent.includes('打包导出 ZIP'));
  assert.ok(exportZipItem, '静态目录预览菜单包含打包导出 ZIP');
  act(() => {exportZipItem.click();});
  await flush();
  assert.deepEqual(calls.savedResources.at(-1), ['/previews/static/mounts/tok-3/export.zip', '我的站点.zip']);

  act(() => {root.unmount();});
  await flush();
  assert.ok(calls.deleted.some(url => url.includes('tok-3')), '卸载时清理挂载');
}

async function checkFolderTreeStaticSiteMenu() {
  const tree = {
    directories: {
      '': {
        status: 'ready',
        truncated: false,
        entries: [
          {name: 'site-collapsed', kind: 'directory', size: null, modified_at: null, modified_ns: null, link_target: null, static_entry: 'index.html'},
          {name: 'site-loaded', kind: 'directory', size: null, modified_at: null, modified_ns: null, link_target: null, static_entry: null},
          {name: 'plain-dir', kind: 'directory', size: null, modified_at: null, modified_ns: null, link_target: null, static_entry: null},
        ],
      },
      'site-loaded': {
        status: 'ready',
        truncated: false,
        entries: [{name: 'index.htm', kind: 'file', size: 12, modified_at: null, modified_ns: '1', link_target: null, static_entry: null}],
      },
      'plain-dir': {
        status: 'ready',
        truncated: false,
        entries: [{name: 'notes.md', kind: 'file', size: 12, modified_at: null, modified_ns: '2', link_target: null, static_entry: null}],
      },
    },
    expanded: ['site-loaded', 'plain-dir'],
  };

  const root = await mountNode(React.createElement(FolderTree, {
    tree,
    selectedPath: null,
    onSelect: () => {},
    onToggle: () => {},
    onRetry: () => {},
    onPreviewStaticSite: (path, entryPath) => calls.previewSiteCalls.push([path, entryPath]),
  }));

  rightClick($('[data-tree-path="site-collapsed"]'));
  await flush();
  let items = $$('[role="menu"] [role="menuitem"]').map(n => n.textContent);
  assert.equal(items[0], '作为静态站点预览', '未展开目录根据 static_entry 出现静态站点预览');
  act(() => {$$('[role="menu"] [role="menuitem"]')[0].click();});
  await flush();

  rightClick($('[data-tree-path="site-loaded"]'));
  await flush();
  items = $$('[role="menu"] [role="menuitem"]').map(n => n.textContent);
  assert.equal(items[0], '作为静态站点预览', '已加载目录检测 index.htm 出现静态站点预览');
  act(() => {$$('[role="menu"] [role="menuitem"]')[0].click();});
  await flush();

  rightClick($('[data-tree-path="plain-dir"]'));
  await flush();
  items = $$('[role="menu"] [role="menuitem"]').map(n => n.textContent);
  assert.ok(!items.includes('作为静态站点预览'), '普通目录不出现静态站点预览');

  assert.deepEqual(calls.previewSiteCalls, [['site-collapsed', 'index.html'], ['site-loaded', 'index.htm']]);
  act(() => {root.unmount();});
}

async function checkDeliveriesR2Tolerance() {
  const workspace = {
    id: 'w1',
    name: '项目',
    status: 'active',
    version: 1,
    folder: {root_id: 'r1', path: '/tmp/ws', status: 'available', marker_writable: true, checked_at: null},
    write_lease: null,
    local_execution_enabled: false,
    auto_memory_enabled: true,
    instruction_version: null,
    instruction_preview: null,
    created_at: 0,
    updated_at: 0,
  };
  const deliveries = [
    {id: 'f1', filename: '结果报告.html', extension: '.html', size: 1024, source: 'delivery'},
  ];

  const root = await mountNode(React.createElement(FolderPanel, {
    workspace,
    embedded: true,
    selectedTab: 'delivered',
    deliveries,
    deliveryStatus: {
      loading: false,
      refreshing: false,
      error: '后台刷新成果失败：网络超时',
      retry: () => {calls.retries += 1;},
    },
  }));

  const alert = $('[role="alert"]');
  assert.ok(alert && alert.textContent.includes('后台刷新成果失败：网络超时'), 'R2：后台刷新失败就地提示原因');
  assert.ok(document.body.textContent.includes('结果报告.html'), 'R2：保留已有成果列表不被清空');
  const retryBtn = $$('button').find(b => b.textContent === '重试');
  assert.ok(retryBtn, 'R2：就地提供重试按钮');
  act(() => {retryBtn.click();});
  assert.equal(calls.retries, 1);

  act(() => {root.unmount();});
}

async function main() {
  await checkWebPreviewAndBridge();
  await checkFolderTreeStaticSiteMenu();
  await checkDeliveriesR2Tolerance();
  console.log('check-static-preview: passed');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

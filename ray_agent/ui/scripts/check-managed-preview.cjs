/* eslint-disable @typescript-eslint/no-require-imports */
// WP4 受管轻量服务与项目预览：时间线预览卡、不折叠投影、启动/运行/失败/日志/修复闭环与成果区置顶列表。
const assert = require('node:assert/strict');
const React = require('react');
const {createLoader} = require('./workspace-loader.cjs');
const {setupDom} = require('./dom-env.cjs');
const {window, document, act, flush, createRoot} = setupDom();

const pollCallbacks = [];
const origSetInterval = window.setInterval.bind(window);
window.setInterval = (fn, ms, ...args) => {
  if (ms === 1500) {
    pollCallbacks.push(fn);
    return 9000 + pollCallbacks.length;
  }
  return origSetInterval(fn, ms, ...args);
};
window.clearInterval = () => {};

const calls = {
  starts: [],
  stops: [],
  restarts: [],
  logs: [],
  deletes: [],
  zips: [],
  opened: [],
  fixPrompts: [],
  mounts: [],
  toasts: {success: [], error: []},
};

const previewStore = new Map();
let logState = {text: 'SERVICE_READY\n', next_offset: 14, truncated: false};

const element = (type = 'div') => React.forwardRef((props, ref) => React.createElement(type, {...props, ref}, props.children));

const fetchStub = {
  ApiError: class ApiError extends Error {},
  clientError: (_code, msg) => new Error(msg),
  errorFromBody: (_s, _b, msg) => new Error(msg),
  get: async (endpoint, params) => {
    const logsMatch = endpoint.match(/^\/previews\/([^/]+)\/logs$/);
    if (logsMatch) {
      const id = decodeURIComponent(logsMatch[1]);
      const offset = Number(params?.offset ?? 0);
      calls.logs.push({id, offset});
      const prev = previewStore.get(id);
      if (offset === 0) {
        return {
          preview_id: id,
          state: prev?.state ?? 'running',
          text: logState.text,
          next_offset: logState.text.length,
          truncated: logState.truncated,
        };
      }
      const delta = logState.text.slice(offset);
      return {
        preview_id: id,
        state: prev?.state ?? 'running',
        text: delta,
        next_offset: logState.text.length,
        truncated: false,
      };
    }
    const getMatch = endpoint.match(/^\/previews\/([^/]+)$/);
    if (getMatch) {
      const id = decodeURIComponent(getMatch[1]);
      return {...previewStore.get(id)};
    }
    if (endpoint === '/previews') {
      return {previews: Array.from(previewStore.values())};
    }
    throw new Error(`unexpected GET ${endpoint}`);
  },
  post: async (endpoint, body) => {
    if (endpoint === '/previews/static/mounts') {
      calls.mounts.push(body);
      return {
        mount_token: 'tok-static',
        kind: body.kind,
        title: 'static',
        entry_path: 'index.html',
        preview_url: 'http://127.0.0.1:19100/s/tok-static/index.html',
        origin: 'http://127.0.0.1:19100',
        expires_at: Date.now() + 1800_000,
        export_zip_path: null,
      };
    }
    const actionMatch = endpoint.match(/^\/previews\/([^/]+)\/(start|stop|restart)$/);
    if (actionMatch) {
      const id = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];
      const current = {...previewStore.get(id)};
      if (action === 'start' || action === 'restart') {
        calls[action === 'start' ? 'starts' : 'restarts'].push(id);
        current.state = 'running';
        current.port = 43120;
        current.preview_url = 'http://127.0.0.1:43120/';
        current.error = null;
      } else {
        calls.stops.push(id);
        current.state = 'stopped';
        current.port = null;
        current.preview_url = null;
      }
      previewStore.set(id, current);
      return {...current};
    }
    throw new Error(`unexpected POST ${endpoint}`);
  },
  del: async endpoint => {
    const delMatch = endpoint.match(/^\/previews\/([^/]+)$/);
    if (delMatch) {
      const id = decodeURIComponent(delMatch[1]);
      calls.deletes.push(id);
      previewStore.delete(id);
      return {deleted: true};
    }
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
    openExternal: async () => {},
    saveResource: async (path, filename) => {calls.zips.push([path, filename]); return `/tmp/${filename}`;},
    saveBytes: async () => '/tmp/file',
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
    useFolderTree: () => ({tree: {directories: {}, expanded: []}, toggle: () => {}, loadDirectory: async () => {}}),
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
const {projectSession} = load('src/lib/session-projection.ts');
const {groupProcessBlocks, foldSettledRuns} = load('src/lib/process-blocks.ts');
const {PreviewCard} = load('src/components/run/preview-card.tsx');
const {FilePreview} = load('src/components/preview/file-preview.tsx');
const {ManagedPreviewList} = load('src/components/preview/managed-preview-list.tsx');
const {FolderPanel} = load('src/components/workspace/folder-panel.tsx');

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

async function mountNode(node) {
  const root = createRoot(document.getElementById('root'));
  act(() => {root.render(React.createElement(ContextMenuProvider, null, node));});
  await flush();
  return root;
}

function ev(seq, type, data = {}, runId = 'run-1') {
  return {
    event: type,
    data: {created_at: 1_700_000_000_000 + seq * 1000, seq, run_id: runId, ...data},
  };
}

async function checkProjectionProcessBlocksAndCard() {
  const projected = projectSession({
    id: 'sess-1',
    events: [
      ev(1, 'run', {status: 'running'}),
      ev(2, 'turn', {phase: 'started', index: 1}),
      ev(3, 'tool', {
        tool_call_id: 'call-1',
        name: 'preview',
        function: 'register_preview',
        status: 'called',
        args: {name: '轻服务应用', kind: 'service', path: 'app'},
        result: {success: true, message: '已登记'},
      }),
      ev(4, 'preview', {
        preview_id: 'prev-1',
        name: '轻服务应用',
        kind: 'service',
        root_id: 'r1',
        relative_path: 'app',
        entry_path: '',
        workspace_id: 'w1',
        note: '支持本机数据持久化',
      }),
      ev(5, 'message', {role: 'assistant', message: '已完成并登记应用内预览。', summary: 'done'}),
      ev(6, 'run', {status: 'completed'}),
    ],
  });

  const previewItem = projected.timeline.find(item => item.kind === 'preview');
  assert.ok(previewItem, 'preview 事件投影进入时间线');
  assert.equal(previewItem.previewId, 'prev-1');
  assert.equal(previewItem.previewKind, 'service');
  assert.equal(previewItem.note, '支持本机数据持久化');

  const folded = foldSettledRuns(groupProcessBlocks(projected.timeline));
  assert.ok(folded.some(row => row.type === 'item' && row.item.kind === 'preview'), '预览卡片不随过程块折叠隐藏');

  const stoppedPreview = {
    id: 'prev-1',
    workspace_id: 'w1',
    session_id: 'sess-1',
    run_id: 'run-1',
    name: '轻服务应用',
    kind: 'service',
    root_id: 'r1',
    relative_path: 'app',
    entry_path: '',
    start_command: 'python3 server.py',
    health_path: '/health',
    state: 'stopped',
    port: null,
    preview_url: null,
    error: null,
    exit_code: null,
    started_at: null,
    created_at: 1,
    updated_at: 1,
  };

  let opened = 0;
  const r1 = await mountNode(React.createElement(PreviewCard, {
    name: previewItem.name,
    previewKind: previewItem.previewKind,
    note: previewItem.note,
    live: stoppedPreview,
    onOpen: () => {opened += 1;},
  }));
  assert.ok(document.body.textContent.includes('点击启动'));
  const startCardBtn = $$('button').find(b => b.textContent.includes('启动并预览'));
  assert.ok(startCardBtn, 'stopped 轻量服务展示“启动并预览”');
  act(() => {startCardBtn.click();});
  assert.equal(opened, 1);
  act(() => {r1.unmount();});
}

async function checkManagedWebPreviewStates() {
  const svcStopped = {
    id: 'prev-1',
    workspace_id: 'w1',
    session_id: 'sess-1',
    run_id: 'run-1',
    name: '值班应用',
    kind: 'service',
    root_id: 'r1',
    relative_path: 'app',
    entry_path: '',
    start_command: 'python3 server.py',
    health_path: '/health',
    state: 'stopped',
    port: null,
    preview_url: null,
    error: null,
    exit_code: null,
    started_at: null,
    created_at: 1,
    updated_at: 1,
  };
  previewStore.set('prev-1', svcStopped);

  const changes = [];
  const root = await mountNode(React.createElement(FilePreview, {
    source: {kind: 'managed', previewId: 'prev-1', initial: svcStopped},
    onPreviewChange: p => changes.push(p.state),
    onAskAgentFix: p => calls.fixPrompts.push(p),
  }));

  // 1. stopped 态：友好启动引导，默认折叠命令与终端日志
  assert.ok(document.body.textContent.includes('点击下方按钮在本机启动应用内预览'));
  assert.equal($('iframe'), null, 'stopped 态未挂载 iframe');
  assert.equal($('pre[aria-label="预览服务运行日志"]'), null, '默认不暴露原始终端日志');
  assert.ok(!document.body.textContent.includes('命令：python3 server.py'), '默认不暴露原始启动命令');

  // 2. 点击“启动预览” -> running + iframe + 视口切换
  const startBtn = $$('button').find(b => b.textContent.includes('启动预览'));
  assert.ok(startBtn);
  await act(async () => {startBtn.click(); await flush();});
  assert.deepEqual(calls.starts, ['prev-1']);
  assert.ok(changes.includes('running'));

  const iframe = $('iframe');
  assert.ok(iframe && iframe.getAttribute('src') === 'http://127.0.0.1:43120/', 'running 态展示回环地址 iframe');
  assert.equal(iframe.getAttribute('referrerpolicy'), 'no-referrer');

  const mobileBtn = $('[aria-label="手机视口"]');
  act(() => {mobileBtn.click();});
  await flush();
  assert.ok($('iframe').className.includes('w-[390px]'));

  // 3. 渐进披露：展开命令与目录 + 增量日志轮询
  const detailsItem = $$('[role="menuitem"]').find(b => b.textContent.includes('展开启动命令与目录'));
  act(() => {detailsItem.click();});
  await flush();
  assert.ok(document.body.textContent.includes('命令：python3 server.py'));
  assert.ok(document.body.textContent.includes('目录：app'));

  const logsItem = $$('[role="menuitem"]').find(b => b.textContent.includes('查看运行日志'));
  await act(async () => {logsItem.click(); await flush();});
  assert.equal(calls.logs[0].offset, 0);
  const pre = $('pre[aria-label="预览服务运行日志"]');
  assert.ok(pre && pre.textContent.includes('SERVICE_READY'));

  logState.text = 'SERVICE_READY\nSECOND_LINE\n';
  const latestPoll = pollCallbacks.at(-1);
  assert.ok(latestPoll, 'running 态且打开日志面板后开启 1500ms 增量轮询');
  await act(async () => {await latestPoll(); await flush();});
  assert.equal(calls.logs.at(-1).offset, 14, '后续轮询携带 next_offset');
  assert.ok($('pre[aria-label="预览服务运行日志"]').textContent.includes('SECOND_LINE'));

  act(() => {root.unmount();});

  // 4. failed 态：错误提示、查看日志、重试启动与“让 Agent 修复”
  const svcFailed = {
    ...svcStopped,
    id: 'prev-fail',
    name: '故障服务',
    state: 'failed',
    error: '端口监听超时',
    exit_code: 1,
  };
  previewStore.set('prev-fail', svcFailed);
  const failedRoot = await mountNode(React.createElement(FilePreview, {
    source: {kind: 'managed', previewId: 'prev-fail', initial: svcFailed},
    onAskAgentFix: p => calls.fixPrompts.push(p),
  }));
  assert.ok(document.body.textContent.includes('预览暂时无法启动'));
  assert.ok(document.body.textContent.includes('端口监听超时'));
  const fixBtn = $$('button').find(b => b.textContent.includes('让 Agent 修复'));
  assert.ok(fixBtn);
  act(() => {fixBtn.click();});
  assert.ok(calls.fixPrompts[0].includes('故障服务') && calls.fixPrompts[0].includes('端口监听超时'));

  const retryBtn = $$('button').find(b => b.textContent.includes('重试启动'));
  await act(async () => {retryBtn.click(); await flush();});
  assert.ok(calls.starts.includes('prev-fail'));
  assert.ok($('iframe'), '重试成功后恢复 iframe 预览');
  act(() => {failedRoot.unmount();});
}

async function checkPinnedManagedPreviewListInOutcomes() {
  const workspace = {
    id: 'w1',
    name: '工作区',
    status: 'active',
    version: 1,
    folder: {root_id: 'r1', path: '/tmp/ws', status: 'available', marker_writable: true, checked_at: null},
    write_lease: null,
    local_execution_enabled: true,
    auto_memory_enabled: true,
    instruction_version: null,
    instruction_preview: null,
    created_at: 0,
    updated_at: 0,
  };
  const previews = [
    {
      id: 'prev-p1',
      workspace_id: 'w1',
      session_id: 'sess-1',
      run_id: null,
      name: '排班小工具',
      kind: 'service',
      root_id: 'r1',
      relative_path: 'shift',
      entry_path: '',
      start_command: 'python3 server.py',
      health_path: '/health',
      state: 'stopped',
      port: null,
      preview_url: null,
      error: null,
      exit_code: null,
      started_at: null,
      created_at: 1,
      updated_at: 1,
    },
    {
      id: 'prev-p2',
      workspace_id: null,
      session_id: 'sess-1',
      run_id: null,
      name: '静默日报页',
      kind: 'static',
      root_id: 'r1',
      relative_path: 'report.html',
      entry_path: '',
      start_command: null,
      health_path: '/',
      state: 'ready',
      port: null,
      preview_url: null,
      error: null,
      exit_code: null,
      started_at: null,
      created_at: 2,
      updated_at: 2,
    },
  ];
  const deliveries = [
    {id: 'f1', filename: '说明文档.md', extension: '.md', size: 512, source: 'delivery'},
  ];

  // 工作区成果页置顶展示“可运行预览”
  const root = await mountNode(React.createElement(FolderPanel, {
    workspace,
    embedded: true,
    selectedTab: 'delivered',
    previews,
    deliveries,
    onOpenManagedPreview: p => calls.opened.push(p.id),
  }));
  const pinnedSection = $('section[aria-label="可运行预览"]');
  assert.ok(pinnedSection, '成果区顶部展示可运行预览');
  const fullText = document.body.textContent;
  assert.ok(fullText.indexOf('排班小工具') < fullText.indexOf('说明文档.md'), '可运行预览置顶于普通交付物之前');
  const openBtn = $$('button', pinnedSection).find(b => b.textContent.includes('排班小工具'));
  act(() => {openBtn.click();});
  assert.deepEqual(calls.opened, ['prev-p1']);
  act(() => {root.unmount();});

  // 空 previews 时不显示“可运行预览”区块且保留交付列表
  const emptyPreviewRoot = await mountNode(React.createElement(FolderPanel, {
    workspace,
    embedded: true,
    selectedTab: 'delivered',
    previews: [],
    deliveries,
    onOpenManagedPreview: p => calls.opened.push(p.id),
  }));
  assert.equal($('section[aria-label="可运行预览"]'), null);
  assert.ok(document.body.textContent.includes('说明文档.md'));
  act(() => {emptyPreviewRoot.unmount();});

  // 独立对话（无 workspace）通过 ManagedPreviewList 独立渲染置顶预览
  const soloRoot = await mountNode(React.createElement(ManagedPreviewList, {
    previews: [previews[1]],
    onOpen: p => calls.opened.push(p.id),
  }));
  assert.ok($('section[aria-label="可运行预览"]'));
  assert.ok(document.body.textContent.includes('可直接打开'));
  const soloBtn = $$('button', $('section[aria-label="可运行预览"]')).find(b => b.textContent.includes('静默日报页'));
  act(() => {soloBtn.click();});
  assert.deepEqual(calls.opened, ['prev-p1', 'prev-p2']);
  act(() => {soloRoot.unmount();});
}

async function main() {
  await checkProjectionProcessBlocksAndCard();
  await checkManagedWebPreviewStates();
  await checkPinnedManagedPreviewListInOutcomes();
  console.log('check-managed-preview: passed');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

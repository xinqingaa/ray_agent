/* eslint-disable @typescript-eslint/no-require-imports */
// WP5：传统 .doc 图标/索引分类识别、不可预览时的 Finder/下载入口，以及 Excel 未缓存公式诚实预览。
const assert = require('node:assert/strict');
const React = require('react');
const {createLoader} = require('./workspace-loader.cjs');
const {setupDom} = require('./dom-env.cjs');
const {document, act, flush, createRoot} = setupDom();

const calls = {
  revealed: [],
  downloaded: [],
};

let nextPreviewPayload = null;
global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({data: nextPreviewPayload}),
});
const element = (type = 'div') => React.forwardRef((props, ref) => React.createElement(type, {...props, ref}, props.children));

const fetchStub = {
  ApiError: class ApiError extends Error {},
  clientError: (_code, msg) => new Error(msg),
  errorFromBody: (_s, _b, msg) => new Error(msg),
  get: async () => nextPreviewPayload,
  post: async () => ({}),
  del: async () => ({deleted: true}),
};

const actionStub = {
  PreviewAction: props => React.createElement('button', {
    type: 'button',
    'aria-label': props.label,
    disabled: props.disabled,
    onClick: props.onClick,
  }, props.label),
};

const load = createLoader({
  sonner: {toast: {error: () => {}, success: () => {}, message: () => {}, warning: () => {}}},
  '@/lib/platform': {
    isDesktop: () => true,
    fileManagerName: () => 'Finder',
    openExternal: async () => {},
    saveResource: async (_path, name) => {calls.downloaded.push(name); return `/tmp/${name}`;},
    saveBytes: async () => '/tmp/file',
    revealInFileManager: async (rootId, relPath) => {calls.revealed.push([rootId, relPath]);},
  },
  '@/lib/core-client': {
    coreHeaders: () => ({}),
    coreUrl: p => `http://core${p}`,
  },
  '@/lib/api/fetch': fetchStub,
  './fetch': fetchStub,
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
  '@/components/preview/web-preview': {WebPreview: () => null},
  './web-preview': {WebPreview: () => null},
  '@/components/ui/button': {Button: element('button')},
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
  },
});

const {previewBodyKind, previewUnavailableReason, FileTypeBadge} = load('src/components/run/file-icon.tsx');
const {categoryForPath} = load('src/lib/document-index-policy.ts');
const {FilePreview} = load('src/components/preview/file-preview.tsx');

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

async function mountNode(node) {
  const root = createRoot(document.getElementById('root'));
  act(() => {root.render(node);});
  await flush();
  return root;
}

async function checkDocMetadata() {
  assert.equal(previewBodyKind('.doc'), 'docx');
  assert.equal(previewBodyKind('.DOC'), 'docx');
  assert.equal(previewUnavailableReason('.doc'), null);
  assert.equal(categoryForPath('申报材料/立项.doc'), 'documents');
  const badgeRoot = await mountNode(React.createElement(FileTypeBadge, {extension: '.doc', compact: true}));
  assert.ok(document.body.textContent.includes('DOC'));
  act(() => {badgeRoot.unmount();});
}

async function checkUnavailableWithFinderAndDownload() {
  // 工作区不可预览文件：展示明确原因与“在 Finder 中显示”按钮，无“下载”按钮
  nextPreviewPayload = {
    kind: 'unavailable',
    filename: '旧档.doc',
    size: 4096,
    revision: 'rev-1',
    reason: '传统 .doc 文件无法解析，可能已加密、损坏或格式不受支持',
  };
  let callbackRevealed = 0;
  const wsRoot = await mountNode(React.createElement(FilePreview, {
    source: {kind: 'root', rootId: 'r1', path: 'docs/旧档.doc', filename: '旧档.doc'},
    onReveal: () => {callbackRevealed += 1;},
  }));
  assert.ok(document.body.textContent.includes('传统 .doc 文件无法解析'));
  const finderBtn = $$('button').find(b => b.textContent.includes('在 Finder 中显示') && b.getAttribute('role') !== 'menuitem');
  assert.ok(finderBtn, '工作区不可预览页面就地提供“在 Finder 中显示”按钮');
  assert.equal($$('button').find(b => b.textContent === '下载'), undefined, '工作区文件不提供下载');
  act(() => {finderBtn.click();});
  assert.equal(callbackRevealed, 1);
  act(() => {wsRoot.unmount();});

  // 未传 onReveal 的工作区 root 来源回退调用平台 revealInFileManager
  const fallbackRoot = await mountNode(React.createElement(FilePreview, {
    source: {kind: 'root', rootId: 'r2', path: 'sub/raw.bin', filename: 'raw.bin'},
  }));
  const fallbackBtn = $$('button').find(b => b.textContent.includes('在 Finder 中显示') && b.getAttribute('role') !== 'menuitem');
  act(() => {fallbackBtn.click();});
  assert.deepEqual(calls.revealed, [['r2', 'sub/raw.bin']]);
  act(() => {fallbackRoot.unmount();});

  // 会话附件不可预览：展示“下载”按钮，无“在 Finder 中显示”
  const attRoot = await mountNode(React.createElement(FilePreview, {
    source: {kind: 'attachment', id: 'att-bin', filename: 'archive.dat', size: 1024},
  }));
  assert.ok($$('button').find(b => b.textContent.includes('下载') && b.getAttribute('role') !== 'menuitem'));
  assert.equal($$('button').find(b => b.textContent.includes('在 Finder 中显示')), undefined);
  act(() => {attRoot.unmount();});
}

async function checkExcelUncachedFormulaPreview() {
  nextPreviewPayload = {
    kind: 'table',
    filename: '预算汇总.xlsx',
    size: 8192,
    revision: 'rev-xlsx',
    sheets: ['明细'],
    sheet: 0,
    row: 0,
    column: 0,
    widths: [120, 120, 120],
    merges: [],
    total_rows: 2,
    total_columns: 3,
    formula_missing: true,
    rows: [
      [{text: '项目'}, {text: '已知合计'}, {text: '未保存公式'}],
      [
        {text: '合计'},
        {text: '30', formula: '=A1+A2', uncached: false},
        {
          text: '=SUM(B2:C2)',
          formula: '=SUM(B2:C2)',
          uncached: true,
          style: {color: '#000000', background: '#ffffff', bold: true},
        },
      ],
    ],
  };

  let revealClicks = 0;
  const wsExcel = await mountNode(React.createElement(FilePreview, {
    source: {kind: 'root', rootId: 'r1', path: '预算汇总.xlsx', filename: '预算汇总.xlsx'},
    onReveal: () => {revealClicks += 1;},
  }));

  const banner = $('[data-uncached-formula-banner="true"]');
  assert.ok(banner, 'formula_missing 为真时顶部渲染醒目提示条');
  assert.ok(banner.textContent.includes('未保存计算结果的公式'));
  const bannerFinder = $$('button', banner).find(b => b.textContent.includes('在 Finder 中显示'));
  assert.ok(bannerFinder, '顶部提示条就地提供 Finder 入口');
  act(() => {bannerFinder.click();});
  assert.equal(revealClicks, 1);

  const uncachedCell = $('[data-uncached-formula="true"]');
  assert.ok(uncachedCell, 'uncached 单元格带有显式标识属性');
  assert.equal(uncachedCell.textContent, '=SUM(B2:C2)');
  assert.ok(uncachedCell.className.includes('font-mono'), 'uncached 单元格使用等宽弱色样式');
  assert.ok((uncachedCell.getAttribute('title') || '').includes('未保存计算结果的公式'));
  assert.equal(uncachedCell.style.color, '', 'uncached 单元格不被黑字原色覆盖');
  assert.equal(uncachedCell.style.background, '', 'uncached 单元格不被白底原色覆盖');

  const cachedCell = $$('tbody td').find(td => td.textContent === '30');
  assert.ok(cachedCell);
  assert.equal(cachedCell.getAttribute('data-uncached-formula'), null);
  assert.equal(cachedCell.getAttribute('title'), '=A1+A2');
  act(() => {wsExcel.unmount();});

  // 附件场景下顶部提示条提供“下载原件”
  const attExcel = await mountNode(React.createElement(FilePreview, {
    source: {kind: 'attachment', id: 'att-xls', filename: '汇总.xlsx', size: 2048},
  }));
  const attBanner = $('[data-uncached-formula-banner="true"]');
  const attDownload = $$('button', attBanner).find(b => b.textContent.includes('下载原件'));
  assert.ok(attDownload);
  await act(async () => {attDownload.click(); await flush();});
  assert.deepEqual(calls.downloaded, ['汇总.xlsx']);
  act(() => {attExcel.unmount();});
}

async function main() {
  await checkDocMetadata();
  await checkUnavailableWithFinderAndDownload();
  await checkExcelUncachedFormulaPreview();
  console.log('check-doc-and-excel-preview: passed');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});

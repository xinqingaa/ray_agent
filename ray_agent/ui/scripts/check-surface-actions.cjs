/* eslint-disable @typescript-eslint/no-require-imports */
// 右键表面的菜单项与动作：挂载真实的 ContextMenuProvider 与会话行、文件树、回复（含嵌套的链接与代码块）、
// 用户消息与失败回合，断言菜单项与动作调用。边界依赖（平台、导航、会话状态、附件、重型卡片）为受控替身。
const assert = require('node:assert/strict');
const React = require('react');
const {createLoader} = require('./workspace-loader.cjs');
const {setupDom} = require('./dom-env.cjs');
const {window, document, act, flush, createRoot} = setupDom();

const calls = {opened: [], revealed: [], written: [], toasts: [], pushed: [], onClick: [], onRename: [], onDelete: [],
  onCopyPath: [], onStartRename: [], onRequestDelete: [], onSelect: [], quote: [], fill: [], retry: [], preview: [], download: []};
const devVisibility = {toolDetails: false, toolMetrics: false, connectionSettings: false};
let markdownModule = null;
const getMarkdown = () => markdownModule;

const load = createLoader({
  sonner: {toast: {error: message => calls.toasts.push(message), success: () => {}, message: () => {}}},
  '@/lib/platform': {
    isDesktop: () => true,
    fileManagerName: () => 'Finder',
    revealInFileManager: async (rootId, path) => {calls.revealed.push([rootId, path])},
    openExternal: async url => {calls.opened.push(url)},
    readClipboardText: async () => '',
    writeClipboardText: async text => {calls.written.push(text)},
  },
  '@/lib/navigation': {
    Link: React.forwardRef((props, ref) => React.createElement('a', {...props, ref}, props.children)),
    useRouter: () => ({push: href => calls.pushed.push(href)}),
    usePathname: () => '/',
  },
  '@/providers/sessions-provider': {useCompactingSessionId: () => null, useSessionWaitKind: () => null},
  '@/components/run/run-status': {RunStatus: () => null, sidebarTitle: title => title},
  '@/components/run/file-icon': {fileExtension: () => '', FileTypeBadge: () => null, previewBodyKind: () => 'text', previewUnavailableReason: () => null},
  '@/components/run/format': {formatBytes: () => '3 B', formatCount: n => String(n)},
  '@/components/run/clock': {useNow: () => null},
  '@/lib/api/preview': {downloadFile: async () => {}, isWebPage: () => false, downloadPreviewSource: async () => null, openPreviewTab: async () => {}},
  '@/lib/api/usage': {formatEstimatedCost: n => String(n)},
  '@/hooks/use-developer-mode': {useDeveloperMode: () => ({visibility: {...devVisibility, canShowCommand: () => true}})},
  '@/lib/api/skills': {SKILLS_CHANGED: 'skills-changed', skillsApi: {list: async () => []}},
  '@/lib/api/fetch': {ApiError: class ApiError extends Error {}, errorFromBody: () => null},
  '@/lib/api/file': {fileApi: {}},
  '@/lib/api/project': {projectApi: {}},
  '@/lib/send-recovery': {recoverSubmission: async () => null, UncertainSubmissionError: class UncertainSubmissionError extends Error {}},
  '@/hooks/use-usage-preferences': {useUsagePreferences: () => ({value: {voice: 'off'}})},
  '@/components/model-picker': {ModelPicker: () => null},
  '@/components/voice-input': {VoiceInput: () => null},
  '@/components/input-command-menu': {PlusCommandMenu: () => null, SlashCommandList: () => null},
  '@/components/preview/file-preview-dialog': {FilePreviewDialog: () => null},
  '@/components/skill-mark': {SkillMark: () => null},
  '@/components/preview/attachment-thumbnail': {AttachmentThumbnail: () => null},
  './entry-name-input': {EntryNameInput: () => null},
  './approval-card': {ApprovalCard: () => null},
  './ask-card': {AskCard: () => null},
  './delivery-card': {DeliveryCard: () => null},
  './run-references': {RunReferences: () => null},
  './status-bar': {RunStatusBar: () => null},
  './tool-group': {ToolGroup: () => null},
  './notices': {AttemptNotice: () => null, CompactionNotice: () => null, ProtectionNotice: () => null},
  './document-citations': {
    // 回复正文用真实的 MarkdownContent；引用角标等只在知识检索路径，这里不展开
    DocumentCitedReply: props => React.createElement(getMarkdown().MarkdownContent, {content: props.text}),
  },
});

markdownModule = load('src/components/markdown-content.tsx');
const {ContextMenuProvider} = load('src/components/ui/context-menu.tsx');
const {SessionItem} = load('src/components/session-item.tsx');
const {ChatInput} = load('src/components/chat-input.tsx');
const {FolderTree} = load('src/components/workspace/folder-tree.tsx');
const {TimelineItemView} = load('src/components/run/timeline-item.tsx');

const menuLabels = () => Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).map(node => node.textContent);
const menuItem = label => Array.from(document.querySelectorAll('[role="menuitem"]')).find(node => node.textContent === label);
const $ = (selector, root = document) => root.querySelector(selector);

function rightClick(node, x = 10, y = 10) {
  const event = new window.MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: x, clientY: y});
  act(() => {node.dispatchEvent(event);});
  return event;
}

async function clickItem(label) {
  const node = menuItem(label);
  assert.ok(node, `菜单项「${label}」存在`);
  await act(async () => {node.click();});
  await flush();
}

function closeMenu() {
  if (!document.querySelector('[role="menu"]')) return;
  act(() => {document.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));});
}

function selectNode(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function clearSelection() {
  window.getSelection().removeAllRanges();
}

async function mount(element) {
  const container = document.getElementById('root');
  const root = createRoot(container);
  act(() => {root.render(React.createElement(ContextMenuProvider, null, element));});
  await flush();
  return root;
}

const session = {session_id: 's1', title: '项目计划', status: 'completed', latest_message_at: '2026-11-20T10:00:00Z', unread_message_count: 0};

const tree = {
  directories: {
    '': {status: 'ready', truncated: false, entries: [
      {name: 'docs', kind: 'directory', size: null, modified_ns: null},
      {name: 'note.txt', kind: 'file', size: 3, modified_ns: '17'},
    ]},
    docs: {status: 'ready', truncated: false, entries: [{name: 'plan.md', kind: 'file', size: 10, modified_ns: '18'}]},
  },
  expanded: ['docs'],
  loading: [],
  errors: {},
};

const reply = [
  '前言 [示例链接](https://example.com/a) 还有一段',
  '',
  '```js',
  'const x = 1',
  '```',
  '',
  '结尾段落',
].join('\n');

function setValue(node, value) {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(node, value);
  act(() => {node.dispatchEvent(new window.Event('input', {bubbles: true}));});
}

async function composerChecks() {
  const ref = React.createRef();
  const root = await mount(React.createElement(ChatInput, {ref, draftScope: 'surface-check', onSend: async () => {}}));
  const textarea = $('textarea');
  assert.ok(textarea, '输入框已挂载');
  const pickerClicks = [];
  document.addEventListener('click', event => {if (event.target instanceof window.HTMLInputElement && event.target.type === 'file') pickerClicks.push(event.target);});
  // 空输入：不给清空（不可用的项不出现，而不是灰显）；有草稿后出现清空
  rightClick(textarea);
  assert.deepEqual(menuLabels(), ['添加附件', '粘贴', '全选'], '空输入框：添加附件与编辑项，没有清空');
  closeMenu();
  setValue(textarea, '草稿内容');
  await flush();
  rightClick(textarea);
  assert.deepEqual(menuLabels(), ['添加附件', '清空', '粘贴', '全选'], '有草稿：表面项在前，编辑项在后');
  closeMenu();

  // 有选中文字：表面项之后是剪切与复制
  textarea.focus();
  textarea.setSelectionRange(0, 2);
  rightClick(textarea);
  assert.deepEqual(menuLabels(), ['添加附件', '清空', '剪切', '复制', '粘贴', '全选'], '选中文字时出现剪切与复制');
  closeMenu();

  // 添加附件：调用上传命令，打开文件选择
  textarea.setSelectionRange(0, 0);
  rightClick(textarea);
  await clickItem('添加附件');
  assert.equal(pickerClicks.length, 1, '添加附件打开文件选择');

  // 清空：文字与输入框一起清空（可撤销的替换）
  rightClick(textarea);
  await clickItem('清空');
  assert.equal(textarea.value, '', '清空移除草稿文字');
  assert.equal(ref.current?.getInputValue(), '', '清空后输入框状态为空');
  act(() => {root.unmount();});
}

async function main() {
  await composerChecks();
  // —— 会话行：打开、重命名、复制标题、删除（删除在最后，分隔线之后）
  let root = await mount(React.createElement(SessionItem, {
    session, isActive: false, href: '/sessions/s1', onClick: id => calls.onClick.push(id),
    onDelete: (value) => calls.onDelete.push(value.session_id), onRename: (value) => calls.onRename.push(value.session_id),
  }));
  rightClick($('[data-navigate]'));
  assert.deepEqual(menuLabels(), ['打开', '重命名', '复制标题', '删除'], '会话行菜单项与顺序');
  await clickItem('复制标题');
  assert.deepEqual(calls.written.at(-1), '项目计划', '复制标题写入会话标题');
  rightClick($('[data-navigate]'));
  await clickItem('打开');
  assert.deepEqual(calls.pushed.at(-1), '/sessions/s1', '打开走整行链接');
  assert.deepEqual(calls.onClick.at(-1), 's1', '打开同时通知选中');
  rightClick($('[data-navigate]'));
  await clickItem('重命名');
  assert.deepEqual(calls.onRename, ['s1'], '重命名调用现有的重命名入口');
  rightClick($('[data-navigate]'));
  await clickItem('删除');
  assert.deepEqual(calls.onDelete, ['s1'], '删除调用现有的删除入口');
  act(() => {root.unmount();});

  // 没有链接也没有选中回调的会话行不出现「打开」
  root = await mount(React.createElement(SessionItem, {session, isActive: false, onDelete: () => {}}));
  rightClick($('[data-navigate]'));
  assert.deepEqual(menuLabels(), ['复制标题', '删除'], '无法打开时不给出打开');
  closeMenu();
  act(() => {root.unmount();});

  // —— 文件树：文件的菜单项、复制路径与重命名、删除的回调
  root = await mount(React.createElement(FolderTree, {
    tree, selectedPath: null, onSelect: () => {}, onToggle: () => {}, onRetry: () => {}, editBusy: false,
    onReveal: path => calls.revealed.push(['tree', path]), onAdd: () => {}, onCopyPath: path => calls.onCopyPath.push(path),
    onStartRename: path => calls.onStartRename.push(path), onStartCreate: () => {}, onRequestDelete: path => calls.onRequestDelete.push(path),
    onEditChange: () => {}, onEditCommit: () => {}, onEditCancel: () => {},
  }));
  rightClick($('[data-tree-path="note.txt"]'));
  assert.deepEqual(menuLabels(), ['预览', '添加文件到所在目录', '在 Finder 中显示', '复制路径', '重命名', '删除'], '文件行菜单项与顺序');
  await clickItem('复制路径');
  assert.deepEqual(calls.onCopyPath, ['note.txt'], '复制路径交给面板换算绝对路径');
  rightClick($('[data-tree-path="note.txt"]'));
  await clickItem('重命名');
  assert.deepEqual(calls.onStartRename, ['note.txt'], '重命名进入现有的就地编辑');
  rightClick($('[data-tree-path="note.txt"]'));
  await clickItem('删除');
  assert.deepEqual(calls.onRequestDelete, ['note.txt'], '删除交给面板的删除确认');

  // 文件夹：没有预览与重命名，有添加到此目录与新建文件夹
  rightClick($('[data-tree-path="docs"]'));
  assert.deepEqual(menuLabels(), ['添加文件到此目录', '新建文件夹', '在 Finder 中显示', '复制路径', '删除'], '文件夹行菜单项与顺序');
  closeMenu();
  act(() => {root.unmount();});

  // —— 回复：嵌套的链接与代码块取最内层；无选中时给复制全文与 Markdown
  const quote = text => calls.quote.push(text);
  const handlers = {quoteText: quote, fillDraft: text => calls.fill.push(text)};
  root = await mount(React.createElement(TimelineItemView, {item: {kind: 'final', id: 'f1', runId: 'r1', text: reply, summary: null, deliveredFiles: []}, handlers}));
  const link = $('a[href="https://example.com/a"]');
  assert.ok(link, '回复里有链接');
  rightClick(link);
  assert.deepEqual(menuLabels(), ['在浏览器中打开', '复制链接'], '链接取最内层的菜单');
  await clickItem('在浏览器中打开');
  assert.deepEqual(calls.opened, ['https://example.com/a'], '在浏览器中打开调用 openExternal');
  rightClick(link);
  await clickItem('复制链接');
  assert.equal(calls.written.at(-1), 'https://example.com/a', '复制链接写入地址');

  const code = $('.markdown-content pre');
  assert.ok(code, '回复里有代码块');
  rightClick($('.markdown-content pre code') ?? code);
  assert.deepEqual(menuLabels(), ['复制代码'], '代码块取最内层的菜单');
  await clickItem('复制代码');
  assert.equal(calls.written.at(-1), 'const x = 1', '复制代码写入代码原文');

  const paragraph = $('.markdown-content p');
  rightClick(paragraph);
  assert.deepEqual(menuLabels(), ['复制全文', '复制为 Markdown'], '无选中时的回复菜单');
  await clickItem('复制全文');
  assert.ok(calls.written.at(-1).includes('前言') && calls.written.at(-1).includes('结尾段落'), '复制全文是渲染后的纯文字');
  rightClick(paragraph);
  await clickItem('复制为 Markdown');
  assert.equal(calls.written.at(-1), reply, '复制为 Markdown 写入原文');

  // 有选中文字：先给复制选中与引用到输入框，选中内容以块引用加入输入框
  selectNode(paragraph);
  rightClick(paragraph);
  assert.deepEqual(menuLabels(), ['复制选中内容', '引用到输入框', '复制全文', '复制为 Markdown'], '有选中文字时的回复菜单');
  await clickItem('引用到输入框');
  assert.deepEqual(calls.quote.at(-1), `> ${paragraph.textContent.trim()}`, '引用为 Markdown 块引用');
  selectNode(paragraph);
  rightClick(paragraph);
  await clickItem('复制选中内容');
  assert.equal(calls.written.at(-1), paragraph.textContent.trim(), '复制选中内容写入选中的文字');
  clearSelection();

  // 选中文字在链接上时，链接仍取最内层
  selectNode(link);
  rightClick(link);
  assert.deepEqual(menuLabels(), ['在浏览器中打开', '复制链接'], '选中的链接仍取最内层菜单');
  closeMenu();
  clearSelection();
  act(() => {root.unmount();});

  // —— 用户消息：复制与填回输入框
  root = await mount(React.createElement(TimelineItemView, {
    item: {kind: 'user', id: 'u1', runId: 'r1', text: '帮我整理这份计划', attachments: [], injected: false, skill: null},
    handlers: {fillDraft: text => calls.fill.push(text)},
  }));
  rightClick($('.whitespace-pre-wrap'));
  assert.deepEqual(menuLabels(), ['复制', '填回输入框'], '用户消息菜单项');
  await clickItem('复制');
  assert.equal(calls.written.at(-1), '帮我整理这份计划', '复制用户消息原文');
  rightClick($('.whitespace-pre-wrap'));
  await clickItem('填回输入框');
  assert.deepEqual(calls.fill.at(-1), '帮我整理这份计划', '填回输入框交给会话的输入框');
  act(() => {root.unmount();});

  // —— 失败回合：重试与终态条的按钮是同一动作
  root = await mount(React.createElement(TimelineItemView, {
    item: {kind: 'run_end', id: 'e1', runId: 'r1', status: 'failed', reasonText: '模型请求失败。', retryText: '重新发送这段话'},
    handlers: {onRetry: (text, runId) => calls.retry.push([text, runId])},
  }));
  const bar = $('[aria-label="重试"]');
  assert.ok(bar, '终态条有重试按钮');
  rightClick(bar);
  assert.deepEqual(menuLabels(), ['重试'], '失败回合的菜单只有重试');
  await clickItem('重试');
  assert.deepEqual(calls.retry, [['重新发送这段话', 'r1']], '重试调用终态条的同一回调');
  act(() => {root.unmount();});

  // 非失败的回合没有菜单，右键不出现原生菜单
  root = await mount(React.createElement(TimelineItemView, {
    item: {kind: 'run_end', id: 'e2', runId: 'r2', status: 'cancelled', reasonText: '已停止。', retryText: null},
    handlers: {onRetry: () => {}},
  }));
  const cancelled = rightClick($('[role="status"], div'));
  assert.equal(cancelled.defaultPrevented, true, '无菜单的回合仍阻止原生菜单');
  assert.deepEqual(menuLabels(), [], '无菜单的回合没有菜单');
  act(() => {root.unmount();});

  console.log('check-surface-actions: 通过');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

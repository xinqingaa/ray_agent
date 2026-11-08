/* RayAgent 工作室原型 v2
   静态 HTML/CSS/JS，不连接真实核心。状态、内容与切换入口都集中在文件后半段。 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- icons ---------- */

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m8.5 10 3.5 3.5 3.5-3.5"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M14.8 4.5v15"/>',
  sliders: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/><circle cx="9" cy="6.5" r="1.7" fill="currentColor"/><circle cx="15.2" cy="12" r="1.7" fill="currentColor"/><circle cx="7.8" cy="17.5" r="1.7" fill="currentColor"/>',
  list: '<path d="M8.5 6h11M8.5 12h11M8.5 18h11"/><circle cx="4.2" cy="6" r="1" fill="currentColor"/><circle cx="4.2" cy="12" r="1" fill="currentColor"/><circle cx="4.2" cy="18" r="1" fill="currentColor"/>',
  file: '<path d="M6.2 3.5h7l4.8 4.8v12.2H6.2z"/><path d="M13.2 3.5v4.8h4.8"/>',
  folder: '<path d="M3.5 7.2V5.8a1.3 1.3 0 0 1 1.3-1.3h4l2 2h8.4a1.3 1.3 0 0 1 1.3 1.3v10.4a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3z"/>',
  check: '<path d="m5 12.5 4.4 4.4L19 7.6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.8v4.6l3 1.9"/>',
  alert: '<path d="M12 3.8 3.6 19h16.8z"/><path d="M12 9v4.4"/><circle cx="12" cy="16.4" r=".7" fill="currentColor"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
  up: '<path d="M12 19V5.5M6.4 11.1 12 5.5l5.6 5.6"/>',
  clip: '<path d="m20.5 11.6-8.2 8.2a5.2 5.2 0 0 1-7.4-7.4l8.8-8.8a3.5 3.5 0 0 1 5 5l-8.8 8.8a1.7 1.7 0 0 1-2.5-2.5l8.1-8.1"/>',
  grid: '<rect x="3.8" y="3.8" width="7" height="7" rx="1"/><rect x="13.2" y="3.8" width="7" height="7" rx="1"/><rect x="3.8" y="13.2" width="7" height="7" rx="1"/><rect x="13.2" y="13.2" width="7" height="7" rx="1"/>',
  book: '<path d="M4 5.7A2.7 2.7 0 0 1 6.7 3H20v16H6.7A2.7 2.7 0 0 1 4 16.3z"/><path d="M4 16.3A2.7 2.7 0 0 1 6.7 13.6H20"/>',
  download: '<path d="M12 3.8v10.4M7.8 10.4 12 14.6l4.2-4.2"/><path d="M4.5 17.4v2.8h15v-2.8"/>',
  eye: '<path d="M2.8 12s3.5-6.2 9.2-6.2S21.2 12 21.2 12s-3.5 6.2-9.2 6.2S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.4"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M19 14.5v4.8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.8"/>',
  more: '<circle cx="5.5" cy="12" r="1.1" fill="currentColor"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/><circle cx="18.5" cy="12" r="1.1" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4"/>',
  moon: '<path d="M19.4 14.8A7.8 7.8 0 0 1 9.2 4.6 8 8 0 1 0 19.4 14.8Z"/>',
  refresh: '<path d="M19 8.5V4.8l-2.3 2.3A7.5 7.5 0 1 0 19.2 13"/><path d="M19 4.8h-3.6"/>',
  pin: '<path d="m9 4 6 6-1.4 1.4-1.9-.4-2.5 2.5.4 1.9L4 21l-1-1 3.6-5.6 1.9.4 2.5-2.5-.4-1.9z"/>',
};

function svg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}
function icon(name) { return `<span class="icon">${svg(name)}</span>`; }

/* ---------- fixture data ---------- */

const LOOSE = [
  {title: '把这段会议录音转成纪要', meta: '昨天'},
  {title: '这张图里的表格怎么读', meta: '周一'},
  {title: '润色这封拒绝信', meta: '3/12'},
];

const WORKSPACES = [
  {
    id: 'quarter', name: '季度复盘', mark: '季', color: 'var(--clay)',
    path: '~/Documents/工作/季度复盘',
    status: 'running', statusText: '运行中',
    style: '先给结论，再给依据；数字要能回到原文。',
    styleVersion: 'v3', memories: 2,
    sessions: [
      {id: 'compare', title: '整理竞品表', group: '今天', time: '今天 10:42', seq: '第 3 次对话', status: 'running', prompt: '把文件夹里的竞品资料整理成一页要点，标出我们在定价上的差别。结论先写，再列依据。'},
      {id: 'minutes', title: '写纪要给市场', group: '昨天', time: '昨天 18:06', seq: '第 2 次对话', status: 'done', prompt: '把今天的产品会整理成给市场的纪要，控制在三段以内。', reply: ['已经整理成三段：结论、依据、待确认。结论放在最前面，涉及价格的部分都保留了原话。', '有一段录音没有转写成功，我没有把它写进纪要，只在文末留了缺口。'], tools: [{verb: '整理', name: '产品会录音.mp3', meta: '42 分钟 · 2 段'}]},
      {id: 'pricing', title: '定价策略讨论', group: '本周', time: '周一 14:20', seq: '第 1 次对话', status: 'done', prompt: '把定价讨论里的三个方案收敛成一个建议，说明代价。', reply: ['建议走「按席位的基础版 + 教育渠道单独报价」。三个方案里，只有这个在 20 人以内不亏，也不把团队版过早拆碎。', '代价是要维护两套报价口径，销售容易讲混。纪要里已经把两套口径的边界写清楚。'], tools: [{verb: '读取', name: '定价讨论.md', meta: '8 段'}]},
      {id: 'verify', title: '核验竞品结论', group: '更早', time: '3/11', seq: '第 1 次对话', status: 'done', prompt: '核验上一版竞品结论里引用的三个数字。', reply: ['三个数字里有两个能在原文定位，第三个只出现在二手转述里。已在原结论旁标了「待核验」，没有直接改数。'], tools: [{verb: '读取', name: '竞品-A.pdf', meta: '第 2、4 页'}]},
    ],
    files: [
      {name: '竞品-A.pdf', ext: 'PDF', type: 'pdf', size: '2.4 MB', meta: '12 页 · 今天 10:40', status: '可检索', tone: 'ok', color: 'var(--clay)', folder: '竞品资料'},
      {name: '竞品-B.pdf', ext: 'PDF', type: 'pdf', size: '1.8 MB', meta: '8 页 · 今天 10:39', status: '可检索', tone: 'ok', color: 'var(--clay)', folder: '竞品资料'},
      {name: '纪要.md', ext: 'MD', type: 'md', size: '12 KB', meta: '3 段 · 昨天', status: '已解析', tone: 'ok', color: 'var(--slate)'},
      {name: '扫描合同.pdf', ext: 'PDF', type: 'pdf', size: '3.1 MB', meta: '待 OCR', status: '待解析', tone: 'wait', color: 'var(--ochre)', folder: '合同', note: 'OCR 与语义组件按 P7 规划'},
      {name: '对比表.xlsx', ext: 'XLSX', type: 'xlsx', size: '18 KB', meta: '今天 10:47', status: '本次写入', tone: 'write', color: 'var(--moss)', output: true},
    ],
    outputs: ['对比表.xlsx'],
    recent: ['竞品-A.pdf', '对比表.xlsx', '纪要.md'],
    fileCount: 5,
  },
  {
    id: 'course', name: '课程笔记', mark: '课', color: 'var(--moss)',
    path: '~/Documents/学习/课程笔记',
    status: 'done', statusText: '昨天有更新',
    style: '每周把讲义和自己的批注合并成一页；术语保留英文原词。',
    styleVersion: 'v2', memories: 4,
    sessions: [
      {id: 'week3', title: '整理第三周阅读笔记', group: '昨天', time: '昨天 21:10', seq: '第 2 次对话', status: 'done', prompt: '把第三周的讲义、课堂笔记和我的批注合成一页。', reply: ['已经按「概念 / 例子 / 我还不确定的地方」整理。你标了问号的两处，我保留了原问题，没有替你下结论。', '术语保留英文原词；第一次出现的地方加了中文解释。'], tools: [{verb: '读取', name: 'week-03.pdf', meta: '24 页'}], delivery: {name: '第三周笔记.md', ext: 'MD', size: '9 KB', meta: '已保存到工作区文件夹', color: 'var(--slate)'}},
      {id: 'reading', title: '列一份补读清单', group: '本周', time: '周一 09:28', seq: '第 1 次对话', status: 'done', prompt: '根据前三周的笔记，列出我还需要补读的材料。', reply: ['清单按「先补概念 / 再补案例」排。只有三篇是必读，其余标成可选，避免一次铺得太开。']},
    ],
    files: [
      {name: 'week-03.pdf', ext: 'PDF', type: 'pdf', size: '4.2 MB', meta: '24 页 · 昨天', status: '可检索', tone: 'ok', color: 'var(--ochre)', folder: '讲义'},
      {name: '第三周笔记.md', ext: 'MD', type: 'md', size: '9 KB', meta: '昨天 21:12', status: '本次写入', tone: 'write', color: 'var(--slate)', output: true},
      {name: '课堂速记.md', ext: 'MD', type: 'md', size: '6 KB', meta: '周一', status: '已解析', tone: 'ok', color: 'var(--slate)'},
    ],
    outputs: ['第三周笔记.md'],
    recent: ['第三周笔记.md', 'week-03.pdf'],
    fileCount: 3,
  },
  {
    id: 'expense', name: '出差报销', mark: '出', color: 'var(--ochre)',
    path: '~/Documents/行政/出差报销',
    status: 'offline', statusText: '文件夹不可用',
    style: '按公司模板整理票据，金额和日期要能对上。',
    styleVersion: 'v1', memories: 1,
    sessions: [
      {id: 'receipts', title: '整理 3 月票据', group: '3/12', time: '3/12 16:40', seq: '第 1 次对话', status: 'offline', prompt: '把三月的票据按模板整理成报销单，金额和日期对不上时标出来。', reply: ['文件夹暂时找不到。之前的对话和已经读过的票据记录还在，重新定位文件夹后我再继续。', '我不会在原路径新建空文件夹，也不会把票据复制到别的目录。'], tools: [{verb: '读取', name: '3 月票据', meta: '上次读取 · 12 张'}]},
    ],
    files: [
      {name: '3 月票据.pdf', ext: 'PDF', type: 'pdf', size: '8.6 MB', meta: '12 张 · 上次读取', status: '上次读取', tone: '', color: 'var(--ochre)', folder: '票据'},
      {name: '报销模板.xlsx', ext: 'XLSX', type: 'xlsx', size: '24 KB', meta: '上次读取', status: '上次读取', tone: '', color: 'var(--moss)', folder: '票据'},
    ],
    outputs: [],
    recent: ['3 月票据.pdf'],
    fileCount: 2,
  },
  {
    id: 'review', name: '产品评审', mark: '产', color: 'var(--slate)',
    path: '~/Documents/工作/产品评审',
    status: 'archived', statusText: '已归档',
    style: '评审只记录决定、依据和待验证项，不写过程感想。',
    styleVersion: 'v2', memories: 3,
    sessions: [
      {id: 'q2', title: '评审会问题清单', group: '3/18', time: '3/18 11:05', seq: '第 2 次对话', status: 'done', prompt: '把评审会上没有决定的问题列出来，按影响排序。', reply: ['清单留在这里，工作区已归档，不能再发起新的工具调用。', '上次的排序是：权限模型 > 空状态 > 导入失败后的恢复；每一项都写了负责人和下次评审时间。']},
    ],
    files: [
      {name: '评审记录.md', ext: 'MD', type: 'md', size: '18 KB', meta: '3/18', status: '只读', tone: '', color: 'var(--slate)'},
      {name: '问题清单.md', ext: 'MD', type: 'md', size: '7 KB', meta: '3/18', status: '只读', tone: '', color: 'var(--slate)'},
    ],
    outputs: [],
    recent: ['评审记录.md'],
    fileCount: 2,
  },
];

const RUN_META = {
  running: {label: '运行中 12s', pill: 'is-running', text: '运行中', head: '正在整理 · 第 3 次对话'},
  approval: {label: '等待你的决定', pill: 'is-waiting', text: '等待你的决定', head: '已准备好写入 · 等待确认'},
  done: {label: '已完成 · 1m 12s', pill: 'is-done', text: '已完成', head: '已完成 · 第 3 次对话'},
  offline: {label: '文件夹不可用', pill: 'is-offline', text: '文件夹不可用', head: '对话可继续 · 文件工具暂停'},
};

/* ---------- state ---------- */

const params = new URLSearchParams(location.search);
const saved = (() => { try { return localStorage.getItem('rayagent.v2.workspace'); } catch { return null; } })();
const initialWorkspace = WORKSPACES.some(w => w.id === params.get('workspace'))
  ? params.get('workspace')
  : (WORKSPACES.some(w => w.id === saved) ? saved : 'quarter');

const state = {
  workspaceId: initialWorkspace,
  sessionId: null,
  run: 'running',
  trayTab: 'files',
  trayOpen: window.innerWidth > 900,
  indexOpen: false,
  theme: params.get('theme') === 'dark' ? 'dark' : (() => { try { return localStorage.getItem('rayagent.v2.theme') || 'light'; } catch { return 'light'; } })(),
  launchpad: false,
  search: '',
  modal: null,
  preview: null,
  dockHidden: false,
  bannerDismissed: false,
  lastFocus: null,
};

function currentWorkspace() { return WORKSPACES.find(w => w.id === state.workspaceId) || WORKSPACES[0]; }
function currentSession() {
  const ws = currentWorkspace();
  return ws.sessions.find(s => s.id === state.sessionId) || null;
}
function isMain() { return state.workspaceId === 'quarter' && state.sessionId === 'compare'; }
function workspaceRunKey() {
  const ws = currentWorkspace();
  if (!currentSession()) return 'empty';
  if (ws.status === 'archived') return 'archived';
  if (ws.status === 'offline') return 'offline';
  if (ws.id === 'quarter' && state.sessionId === 'compare') return state.run;
  return currentSession().status === 'waiting' ? 'approval' : currentSession().status;
}
function runMeta() {
  const key = workspaceRunKey();
  if (key === 'empty') return {label: '空闲', pill: 'is-done', text: '空闲', head: '等待你的输入'};
  if (key === 'archived') return {label: '已归档', pill: 'is-done', text: '已归档', head: '只读'};
  if (key === 'done' && !isMain()) return {label: '已完成', pill: 'is-done', text: '已完成', head: '已完成'};
  return RUN_META[key] || RUN_META.done;
}

/* ---------- shared fragments ---------- */

function statusDot(key) {
  const klass = key === 'running' ? 'is-running'
    : key === 'approval' ? 'is-waiting'
      : key === 'offline' || key === 'failed' ? 'is-offline'
        : key === 'archived' ? 'is-archived' : 'is-done';
  return `<span class="status-dot ${klass}" aria-hidden="true"></span>`;
}

function fileMark(file) {
  return `<span class="file-mark" style="--mark:${file.color || 'var(--accent)'}" aria-hidden="true">${file.ext || 'FILE'}</span>`;
}

function fileRowHtml(file, offline, archived, child = false) {
  const status = offline ? (file.output ? '未写入' : '上次读取') : archived ? '只读' : file.status;
  const tone = offline ? (file.output ? 'fail' : '') : archived ? '' : file.tone;
  return `<button class="file-row ${child ? 'is-child' : ''}" type="button" data-file="${file.name}" title="打开 ${file.name}">
    ${fileMark(file)}
    <span style="min-width:0"><span class="file-name">${file.name}</span><span class="file-meta">${file.meta}</span></span>
    <span class="file-status ${fileStatusClass(tone)}" ${file.note ? `title="${file.note}"` : ''}>${status}</span>
  </button>`;
}

function fileStatusClass(status) {
  if (status === 'ok') return 'is-ok';
  if (status === 'wait') return 'is-wait';
  if (status === 'fail') return 'is-fail';
  if (status === 'write') return 'is-write';
  return '';
}

function emptySessionRow() {
  return `<div class="index-section"><div class="section-head"><h2>对话</h2><button class="index-new" type="button" data-action="new-chat" aria-label="新对话">${icon('plus')}</button></div>
    <p style="padding:9px;color:var(--faint);font-size:10.5px">还没有对话。写下一件事，它就会成为这里的第一页。</p></div>`;
}

/* ---------- render: rail ---------- */

function renderRail() {
  const rail = $('#rail');
  const bottom = `<div class="rail-bottom">
    <button class="rail-btn" type="button" data-action="launchpad" aria-label="打开启动台" title="启动台">${icon('grid')}</button>
    <span class="rail-sep"></span>
    <button class="rail-btn" type="button" data-action="settings" aria-label="设置" title="设置">${icon('sliders')}</button>
    <button class="rail-avatar" type="button" data-action="settings" aria-label="账户与设置">林</button>
  </div>`;
  const items = WORKSPACES.map(ws => {
    const active = ws.id === state.workspaceId;
    const status = ws.status === 'offline' ? 'is-offline' : ws.status === 'archived' ? 'is-archived' : ws.status === 'done' ? '' : 'is-waiting';
    const dot = ws.status === 'running' ? `<span class="rail-ws-state" aria-hidden="true"></span>`
      : ws.status === 'offline' || ws.status === 'archived' ? `<span class="rail-ws-state ${status}" aria-hidden="true"></span>` : '';
    return `<button class="rail-ws ${active ? 'is-active' : ''}" type="button" data-workspace="${ws.id}" style="--ws-color:${ws.color}" aria-label="${ws.name} · ${ws.statusText}" aria-current="${active ? 'page' : 'false'}">
      ${ws.mark}${dot}<span class="rail-tip">${ws.name}<span style="color:#9aa48f"> · ${ws.statusText}</span></span>
    </button>`;
  }).join('');
  rail.innerHTML = `${items}
    <button class="rail-ws rail-add" type="button" data-action="new-workspace" aria-label="新建工作区" title="新建工作区">${icon('plus')}</button>
    ${bottom}`;
}

/* ---------- render: index ---------- */

function renderIndex() {
  const ws = currentWorkspace();
  const session = currentSession();
  const groups = [...new Set(ws.sessions.map(s => s.group))];
  const sessionHtml = groups.map(group => {
    const rows = ws.sessions.filter(s => s.group === group).map(s => {
      const active = s.id === state.sessionId;
      const runKey = s.id === 'compare' && ws.id === 'quarter' && state.sessionId === 'compare' ? workspaceRunKey() : s.status;
      const meta = runKey === 'approval' ? '待决定'
        : runKey === 'offline' ? '不可用'
          : runKey === 'running' ? s.time.replace('今天 ', '')
            : s.time;
      return `<button class="session-row ${active ? 'is-active' : ''}" type="button" data-session="${s.id}" aria-current="${active ? 'true' : 'false'}">
        <span class="session-state">${statusDot(runKey)}</span>
        <span class="session-title">${s.title}</span>
        <span class="session-meta ${runKey === 'running' ? 'is-running' : runKey === 'approval' || runKey === 'offline' ? 'is-warning' : ''}">${meta}</span>
      </button>`;
    }).join('');
    return `<div class="date-group"><div class="date-label">${group}</div>${rows}</div>`;
  }).join('') || `<p style="padding:9px;color:var(--faint);font-size:10.5px">还没有对话。</p>`;

  const looseHtml = LOOSE.map(item => `<button class="loose-row" type="button" data-action="loose" data-title="${item.title}">
    <span class="loose-title">${item.title}</span><span class="loose-meta">${item.meta}</span>
  </button>`).join('');

  const styleTag = ws.styleVersion ? `<span class="plan-tag" title="工作方式与记忆按 P5 规划">P5 · 规划</span>` : '';

  $('#index').innerHTML = `
    <div class="index-head">
      <div class="index-kicker">工作区 <span style="margin-left:auto">${statusDot(ws.status === 'offline' ? 'offline' : ws.status === 'archived' ? 'archived' : ws.status === 'running' ? 'running' : 'done')}</span></div>
      <div class="index-title-row"><h1 class="index-title" title="${ws.name}">${ws.name}</h1></div>
      <div class="index-path" title="${ws.path}">${ws.path}</div>
      <button class="index-style" type="button" data-action="open-style" aria-label="查看这里的工作方式">
        <span class="index-style-label">${icon('book')} 这里的工作方式 ${styleTag}</span>
        <span class="index-style-quote">${ws.style || '还没有写下工作方式。'}</span>
        <span class="index-style-meta"><span>${ws.styleVersion || 'v0'}</span><span>·</span><span>${ws.memories || 0} 条记忆</span><span style="margin-left:auto">查看</span></span>
      </button>
    </div>
    <div class="index-rule"></div>
    <div class="index-scroll">
      ${ws.sessions.length ? `<div class="index-section"><div class="section-head"><h2>对话</h2><button class="index-new" type="button" data-action="new-chat" aria-label="新对话">${icon('plus')}</button></div>${sessionHtml}</div>`
        : emptySessionRow()}
      <div class="loose-section">
        <div class="section-head"><h2>散页</h2><span style="color:var(--faint);font-family:var(--mono);font-size:8.5px">不进入工作区</span></div>
        ${looseHtml}
        <button class="all-loose" type="button" data-action="launchpad">全部散页与工作区</button>
      </div>
    </div>
    <div class="index-foot"><span>⌘O 切换工作区</span><button type="button" data-action="settings">工作区设置</button></div>`;
}

/* ---------- render: work head, banner ---------- */

function renderWorkHead() {
  const ws = currentWorkspace();
  const session = currentSession();
  const meta = runMeta();
  const title = session ? session.title : '新的对话';
  const seq = session ? session.seq : '尚未编号';
  const planAvailable = session && isMain();
  const output = ws.outputs && ws.outputs[0];
  $('#workHead').innerHTML = `
    <button class="icon-btn index-toggle" type="button" data-action="toggle-index" aria-label="显示对话目录">${icon('panel')}</button>
    <div class="work-head-main">
      <h1 class="work-title">${title}</h1>
      <div class="work-sub">
        <span>${session ? `${seq} · ${session.time}` : '把第一句话写下来'}</span>
        ${ws.status === 'offline' ? '<span class="dot-sep"></span><span style="color:var(--danger)">文件工具已暂停</span>' : ''}
      </div>
    </div>
    <div class="work-actions">
      ${planAvailable ? `<button class="label-btn" type="button" data-action="open-plan">${icon('list')} 计划</button>` : ''}
      ${output ? `<button class="icon-btn" type="button" data-action="open-output" data-file="${output}" aria-label="打开本次成果">${icon('file')}</button>` : ''}
      <button class="icon-btn" type="button" data-action="session-menu" aria-label="对话操作">${icon('more')}</button>
    </div>`;
}

function renderBanner() {
  const slot = $('#bannerSlot');
  const ws = currentWorkspace();
  let html = '';
  if (state.bannerDismissed) {
    slot.classList.remove('has-banner');
    slot.innerHTML = '';
    return;
  }
  if (ws.status === 'archived') {
    html = `<div class="banner">
      <span class="banner-mark">${icon('alert')}</span>
      <div class="banner-copy"><div class="banner-title">工作区已归档</div><div class="banner-desc">对话和材料保留只读；取消归档后可以继续在这里工作。</div></div>
      <div class="banner-actions"><button class="btn" type="button" data-action="unarchive">取消归档</button></div>
    </div>`;
  } else if (ws.status === 'offline' || (isMain() && state.run === 'offline')) {
    html = `<div class="banner">
      <span class="banner-mark">${icon('alert')}</span>
      <div class="banner-copy"><div class="banner-title">文件夹暂时找不到</div><div class="banner-desc">「${ws.name}」的对话和材料记录还在；文件工具已暂停，不会在原路径新建空文件夹。</div></div>
      <div class="banner-actions"><button class="btn" type="button" data-action="relocate">重新定位</button><button class="btn btn-quiet" type="button" data-action="dismiss-banner">稍后</button></div>
    </div>`;
  }
  slot.innerHTML = html;
  slot.classList.toggle('has-banner', !!html);
}

/* ---------- render: timeline ---------- */

function entryUser(time, text, label = '你的要求') {
  return `<div class="entry entry-user"><div class="entry-time">${time}</div><div class="entry-node is-user" aria-hidden="true"></div><div class="entry-body"><div class="entry-label"><span class="who">${label}</span></div><div>${text}</div></div></div>`;
}

function entryAgent(time, paragraphs, label = 'RayAgent') {
  return `<div class="entry entry-agent"><div class="entry-time">${time}</div><div class="entry-node is-agent" aria-hidden="true"></div><div class="entry-body"><div class="entry-label"><span class="lead-mark">R</span><span class="who">${label}</span></div>${paragraphs.map(p => `<p>${p}</p>`).join('')}</div></div>`;
}

function entryTools(time, rows) {
  return `<div class="entry entry-tools"><div class="entry-time">${time}</div><div class="entry-node is-tool" aria-hidden="true"></div><div class="entry-body"><div class="entry-label"><span class="who">执行记录</span></div><div class="tools">${rows.map(row => `<div class="tool-row">
      ${row.state === 'fail' ? '<span class="tool-fail"></span>' : row.state === 'wait' ? '<span class="tool-wait"></span>' : '<span class="tool-ok"></span>'}
      <span class="tool-verb">${row.verb}</span><span class="tool-name">${row.name}</span><span class="tool-meta">${row.meta || ''}</span>
    </div>`).join('')}</div></div></div>`;
}

function planForRun(run) {
  const now = run === 'done' ? 4 : run === 'approval' ? 3 : run === 'offline' ? 2 : 2;
  return [
    {title: '读取并解析三份资料', state: 'done'},
    {title: '提取定价与折扣口径', state: 'done'},
    {title: '对比席位与渠道差异', state: now >= 3 ? 'done' : 'now', meta: now === 3 ? '进行中' : ''},
    {title: '写入对比表并给出结论', state: now >= 4 ? 'done' : now === 3 ? 'now' : 'todo', meta: run === 'approval' && now === 3 ? '等待确认' : ''},
  ];
}

function entryPlan(run) {
  const items = planForRun(run);
  const done = items.filter(i => i.state === 'done').length;
  const blocked = run === 'offline';
  const list = items.map(item => `<div class="plan-item is-${item.state}"><span class="plan-box" aria-hidden="true"></span><span>${item.title}</span><span class="plan-state">${item.state === 'done' ? '完成' : item.state === 'now' ? (blocked ? '暂缓' : item.meta || '进行中') : ''}</span></div>`).join('');
  const note = `<div class="plan-note">${blocked ? '文件工具暂停，写入这一步还没有开始。' : '白板照片尚未解析，结论会标注这个缺口。'}</div>`;
  if (run === 'approval') {
    return `<div class="entry entry-plan"><div class="entry-time">10:43</div><div class="entry-node is-plan" aria-hidden="true"></div><div class="entry-body">
      <div class="plan-block is-compact" id="planBlock">
        <div class="plan-head"><span class="plan-title">本次计划</span><span class="plan-count">${done} / ${items.length}</span></div>
        <div class="plan-item is-now"><span class="plan-box" aria-hidden="true"></span><span>写入对比表并给出结论</span><span class="plan-state">等待确认</span></div>
        <details class="plan-details"><summary>查看全部 ${items.length} 项</summary>${list}${note}</details>
      </div>
    </div></div>`;
  }
  return `<div class="entry entry-plan"><div class="entry-time">10:43</div><div class="entry-node is-plan ${run === 'running' ? 'is-running' : ''}" aria-hidden="true"></div><div class="entry-body">
    <div class="plan-block" id="planBlock">
      <div class="plan-head"><span class="plan-title">本次计划</span><span class="plan-count">${done} / ${items.length}</span></div>
      ${run === 'running' ? `<div class="plan-live"><span class="thinking-dot"></span><span>正在对比第 3 条：教育渠道折扣</span><span class="plan-live-meta">已用 12s · 还在继续</span></div>` : ''}
      ${list}
      ${note}
    </div>
  </div></div>`;
}

function entryApproval() {
  return `<div class="entry entry-approval"><div class="entry-time">10:46</div><div class="entry-node is-approval" aria-hidden="true"></div><div class="entry-body">
    <div class="approval-block" id="approvalBlock">
      <div class="approval-kicker">${icon('alert')} 需要你决定</div>
      <div class="approval-title">写入 <span class="mono" style="font-size:15px">对比表.xlsx</span>？</div>
      <div class="approval-desc">会在工作区文件夹中新建 1 个文件，共 4 个工作表；覆盖同名文件前会先备份。<br>这次写入只影响这个文件，完成后可以撤销。</div>
      <div class="approval-actions"><button class="btn btn-primary" type="button" data-action="allow">允许写入</button><button class="btn" type="button" data-action="deny">拒绝</button><span class="approval-note">只允许这一次</span></div>
    </div>
  </div></div>`;
}

function entryFinal() {
  return `<div class="entry entry-agent entry-final"><div class="entry-time">10:47</div><div class="entry-node is-agent" aria-hidden="true"></div><div class="entry-body">
    <div class="entry-label"><span class="lead-mark">R</span><span class="who">RayAgent</span><span class="label-note">已完成</span></div>
    <p><strong>结论：</strong>在 20 人以内，我们的基础版更便宜；超过 50 人，对方的团队版折扣更低。教育渠道对方给到 7 折，我们没有对应折扣。</p>
    <p>依据来自 <button class="file-link" type="button" data-file="竞品-A.pdf">竞品-A 第 2 页</button>、<button class="file-link" type="button" data-file="竞品-B.pdf">竞品-B 第 4 页</button>和 <button class="file-link" type="button" data-file="纪要.md">纪要.md 第 3 段</button>。白板照片尚未解析，没有纳入结论。</p>
    <div class="delivery-row">
      ${fileMark({ext: 'XLSX', color: 'var(--moss)'})}
      <div><div class="delivery-name">对比表.xlsx</div><div class="delivery-meta">18 KB · 已保存到工作区文件夹</div></div>
      <div class="delivery-actions"><button class="mini" type="button" data-file="对比表.xlsx">打开</button><button class="mini" type="button" data-action="reveal">在 Finder 中显示</button></div>
    </div>
    <div class="run-stats"><span>4 轮</span><span>1m 12s</span><span>18.3k tokens</span><button type="button" data-action="run-detail">详情</button></div>
    <div class="margin-note" style="margin-top:12px">本次写入 1 个文件。<button class="file-link" type="button" data-action="undo">撤销本次修改</button></div>
  </div></div>`;
}

function entryOffline() {
  return `<div class="entry entry-agent"><div class="entry-time">10:46</div><div class="entry-node is-agent" aria-hidden="true"></div><div class="entry-body"><div class="entry-label"><span class="lead-mark">R</span><span class="who">RayAgent</span><span class="label-note">已暂停</span></div>
    <p>文件夹暂时找不到。我已经保留了这次对话的上下文；重新定位后可以从这里继续。</p>
    <p class="margin-note">没有在原路径新建空文件夹，也没有把已经读过的材料复制到别处。</p>
  </div></div>`;
}

function mainTimeline() {
  const run = state.run;
  const intro = run === 'done'
    ? ['三份资料已经读完。先给结论，再列依据；扫描合同和尚未解析的白板照片没有纳入这次结论。']
    : run === 'approval'
      ? ['三份资料已经读完，对比表也已经生成。写入文件夹前需要你确认；这一步不会改动其他文件。']
      : run === 'offline'
        ? ['读资料这一步已经完成，但文件夹刚刚失联。我先停在这里，不写入任何文件。']
        : ['先读三份资料，再按「价格结构 / 折扣 / 席位」三栏对比。白板照片还没解析，我会在结论里标出这个缺口。'];
  const tools = run === 'approval' ? [
    {verb: '读取', name: '三份竞品资料', meta: '3 份 · 4.0s', state: 'ok'},
    {verb: '准备写入', name: '对比表.xlsx', meta: '等待确认', state: 'wait'},
  ] : [
    {verb: '读取', name: '竞品-A.pdf', meta: '12 页 · 2.1s', state: 'ok'},
    {verb: '读取', name: '竞品-B.pdf', meta: '8 页 · 1.6s', state: 'ok'},
    {verb: '读取', name: '纪要.md', meta: '3 段 · 0.3s', state: 'ok'},
    {verb: run === 'done' ? '写入' : run === 'offline' ? '未写入' : '准备写入', name: '对比表.xlsx', meta: run === 'done' ? '18 KB · 完成' : run === 'offline' ? '文件夹不可用' : '等待确认', state: run === 'done' ? 'ok' : run === 'offline' ? 'fail' : 'wait'},
  ];
  let html = entryUser('10:42', '把文件夹里的竞品资料整理成一页要点，标出我们在定价上的差别。结论先写，再列依据。');
  html += entryAgent('10:42', intro);
  html += entryTools('10:43', tools);
  html += entryPlan(run);
  if (run === 'approval') html += entryApproval();
  if (run === 'offline') html += entryOffline();
  if (run === 'done') html += entryFinal();
  return html;
}

function genericTimeline(session) {
  if (!session) return '';
  const ws = currentWorkspace();
  const run = ws.status === 'archived' ? 'archived' : ws.status === 'offline' ? 'offline' : session.status;
  let html = entryUser(session.time, session.prompt || '继续上次的工作。');
  const reply = session.reply || ['上次的结果留在这里。'];
  html += entryAgent(session.time, reply);
  if (session.tools && session.tools.length) {
    html += entryTools(session.time, session.tools.map(t => ({...t, state: t.state || 'ok'})));
  }
  if (session.delivery && run !== 'offline' && run !== 'archived') {
    const d = session.delivery;
    html += `<div class="entry entry-agent"><div class="entry-time">—</div><div class="entry-node is-delivery" aria-hidden="true"></div><div class="entry-body">
      <div class="delivery-row">${fileMark(d)}<div><div class="delivery-name">${d.name}</div><div class="delivery-meta">${d.size} · ${d.meta}</div></div><div class="delivery-actions"><button class="mini" type="button" data-file="${d.name}">打开</button><button class="mini" type="button" data-action="reveal">在 Finder 中显示</button></div></div>
    </div></div>`;
  }
  if (run === 'done') {
    html += `<div class="entry entry-agent"><div class="entry-time"></div><div class="entry-node" style="visibility:hidden"></div><div class="entry-body"><div class="run-stats"><span>2 轮</span><span>34s</span><span>6.2k tokens</span><button type="button" data-action="run-detail">详情</button></div></div></div>`;
  }
  if (run === 'offline') {
    html += entryOffline();
  }
  if (run === 'archived') {
    html += `<div class="entry entry-agent"><div class="entry-time"></div><div class="entry-node" style="visibility:hidden"></div><div class="entry-body"><div class="margin-note">工作区已归档，只读。取消归档后可以继续。</div></div></div>`;
  }
  return html;
}

function newStart() {
  return `<div class="new-start">
    <div class="new-start-title">从这件事开始。</div>
    <p class="new-start-desc">这个工作区里的材料、工作方式和记忆都会在新对话里接着用。先写下你想推进的事，或者把一份文件拖进来。</p>
  </div>`;
}

function renderTimeline() {
  const ws = currentWorkspace();
  const session = currentSession();
  const timeline = $('#timeline');
  if (!session) {
    timeline.innerHTML = newStart();
  } else if (isMain()) {
    timeline.innerHTML = mainTimeline();
  } else {
    timeline.innerHTML = genericTimeline(session);
  }
  // 让页面开头先被看到；等到用户切换状态时再决定滚动位置
  const scroll = $('#workScroll');
  scroll.scrollTop = 0;
  if (isMain() && state.run === 'done') {
    const toFinal = () => {
      const final = document.querySelector('.entry-final');
      scroll.scrollTop = final ? Math.max(0, final.offsetTop - 10) : scroll.scrollHeight;
    };
    requestAnimationFrame(toFinal);
    setTimeout(toFinal, 160);
    if (document.fonts?.ready) document.fonts.ready.then(toFinal).catch(() => {});
  }
}

/* ---------- render: composer ---------- */

function renderComposer() {
  const ws = currentWorkspace();
  const session = currentSession();
  const meta = runMeta();
  if (ws.status === 'archived') {
    $('#composer').innerHTML = `<div class="composer-inner"><div class="composer-state" style="color:var(--muted)">${icon('alert')} 工作区已归档，取消归档后可以继续。</div></div>`;
    return;
  }
  let stateLine = '';
  if (isMain() && state.run === 'approval') stateLine = `<div class="composer-state">${icon('alert')} 等待你的决定；也可以先补充说明。<button class="state-link" type="button" data-action="scroll-approval">回到审批</button></div>`;
  if (ws.status === 'offline' || (isMain() && state.run === 'offline')) stateLine = `<div class="composer-state is-offline">${icon('alert')} 文件工具已暂停，仍可以继续对话。<button class="state-link" type="button" data-action="relocate">重新定位</button></div>`;
  const placeholder = !session ? '从这件事开始写…'
    : isMain() && state.run === 'approval' ? '等待你的决定，或补充说明…'
      : ws.status === 'offline' || (isMain() && state.run === 'offline') ? '继续对话；文件工具恢复后再读写文件…'
        : '继续这件事，或补充要求…';
  $('#composer').innerHTML = `<div class="composer-inner">
    ${stateLine}
    <div class="composer-box">
      <textarea class="composer-input" id="composerInput" rows="1" placeholder="${placeholder}" aria-label="输入消息"></textarea>
      <div class="composer-bar">
        <button class="composer-tool" type="button" data-action="attach">${icon('clip')}<span>附件</span></button>
        <button class="composer-tool" type="button" data-action="open-plan">${icon('list')}<span>计划</span></button>
        <button class="composer-ref" type="button" data-action="refs">参考 3 个文件</button>
        <div class="composer-right">
          <button class="model-pick" type="button" data-action="model">Claude 4.5 <span class="model-think">思考</span> ${icon('chevron')}</button>
          <button class="send-btn" type="button" data-action="send" aria-label="发送">${icon('up')}</button>
        </div>
      </div>
    </div>
    <div class="composer-hint">Enter 发送 · Shift + Enter 换行</div>
  </div>`;
  const input = $('#composerInput');
  if (input) {
    input.addEventListener('input', autoGrow);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendDraft();
      }
    });
  }
}

function autoGrow(event) {
  const el = event.currentTarget;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}

/* ---------- render: materials ---------- */

function renderTray() {
  const ws = currentWorkspace();
  const offline = ws.status === 'offline' || (isMain() && state.run === 'offline');
  const archived = ws.status === 'archived';
  const canAdd = !offline && !archived;
  let files = ws.files || [];
  if (state.trayTab === 'outputs') files = files.filter(f => f.output);
  if (state.trayTab === 'recent') files = (ws.recent || []).map(name => files.find(f => f.name === name)).filter(Boolean);
  const tabCount = state.trayTab === 'outputs' ? (ws.outputs || []).length : state.trayTab === 'recent' ? (ws.recent || []).length : (ws.files || []).length;
  let rows = '';
  if (files.length) {
    if (state.trayTab === 'files') {
      const folders = [...new Set(files.map(f => f.folder).filter(Boolean))];
      const rootFiles = files.filter(f => !f.folder);
      rows = folders.map(folder => {
        const items = files.filter(f => f.folder === folder);
        return `<div class="tree-folder"><span class="tree-folder-icon">${icon('folder')}</span><span>${folder}</span><span class="tree-count">${items.length}</span></div>${items.map(f => fileRowHtml(f, offline, archived, true)).join('')}`;
      }).join('') + rootFiles.map(f => fileRowHtml(f, offline, archived)).join('');
    } else {
      rows = files.map(f => fileRowHtml(f, offline, archived)).join('');
    }
  } else {
    rows = `<div class="tray-empty"><div class="tray-empty-title">${state.trayTab === 'outputs' ? '还没有成果' : '文件夹是空的'}</div><div class="tray-empty-desc">${state.trayTab === 'outputs' ? '这次没有写出文件。成果只列本次运行写入文件夹的文件。' : '把文件拖进来，或从文件夹添加；原有文件不会被移动。'}</div></div>`;
  }
  const error = offline ? `<div class="tray-error"><div class="tray-error-title">无法读取文件夹</div><div class="tray-error-desc">${ws.path} 暂时不可用。下面保留上次读取的文件，重新定位后更新。</div><button class="btn" type="button" data-action="relocate">重新检查</button></div>` : '';
  $('#tray').innerHTML = `
    <div class="tray-head">
      <div style="flex:1"><div class="tray-title">材料</div><div class="tray-count">${ws.fileCount || files.length} 个文件 · 索引 ${ws.fileCount || files.length} / ${ws.fileCount || files.length}</div></div>
      <div class="tray-head-actions">
        ${canAdd ? `<button class="icon-btn" type="button" data-action="attach" aria-label="添加资料">${icon('plus')}</button>` : ''}
        <button class="icon-btn" type="button" data-action="reveal-folder" aria-label="在 Finder 中显示">${icon('external')}</button>
      </div>
    </div>
    <div class="tray-tabs" role="tablist" aria-label="材料视图">
      <button class="tray-tab ${state.trayTab === 'files' ? 'is-on' : ''}" type="button" role="tab" aria-selected="${state.trayTab === 'files'}" data-tray-tab="files">文件夹 <span class="tab-count">${ws.files.length}</span></button>
      <button class="tray-tab ${state.trayTab === 'outputs' ? 'is-on' : ''}" type="button" role="tab" aria-selected="${state.trayTab === 'outputs'}" data-tray-tab="outputs">本次成果 <span class="tab-count">${(ws.outputs || []).length}</span></button>
      <button class="tray-tab ${state.trayTab === 'recent' ? 'is-on' : ''}" type="button" role="tab" aria-selected="${state.trayTab === 'recent'}" data-tray-tab="recent">最近 <span class="tab-count">${(ws.recent || []).length}</span></button>
    </div>
    <div class="tray-scroll">
      ${error}
      <div class="tray-section">
        <div class="tray-section-head"><h3>${state.trayTab === 'outputs' ? '本次写入' : state.trayTab === 'recent' ? '最近改动' : '文件夹与成果'}</h3><span>${tabCount}</span></div>
        ${rows}
      </div>
      ${canAdd ? `<div class="tray-drop">把文件拖到这里，加入这个工作区<br>不会移动原文件</div>` : `<div class="tray-drop" style="border-style:solid;border-color:transparent;color:var(--faint)">${archived ? '已归档，材料只读' : '文件夹不可用，暂时不能添加材料'}</div>`}
    </div>
    <div class="tray-foot"><span>${offline ? '上次读取' : archived ? '只读' : `索引 ${ws.fileCount} / ${ws.fileCount}`}</span><button type="button" data-action="reveal-folder">打开文件夹</button></div>`;
}

/* ---------- render: run pill, dock ---------- */

function renderRunPill() {
  const meta = runMeta();
  const pill = $('#runPill');
  pill.className = `run-pill ${meta.pill}`;
  $('#runPillText').textContent = meta.label;
}

function renderDock() {
  const dock = $('#dock');
  const items = [
    ['running', '运行中'], ['approval', '待决定'], ['done', '已完成'], ['offline', '离线'], ['empty', '新对话'],
  ];
  dock.innerHTML = `<span class="dock-label"><span class="mini-mark">R</span><b>工作室 v2</b><span>状态</span></span>
    ${items.map(([key, label]) => `<button class="dock-btn ${state.sessionId === null && key === 'empty' || state.sessionId !== null && isMain() && state.run === key ? 'is-on' : ''}" type="button" data-dock-state="${key}">${label}</button>`).join('')}
    <span class="dock-sep"></span>
    <button class="dock-btn" type="button" data-action="launchpad">启动台</button>
    <button class="dock-btn" type="button" data-action="open-output">预览成果</button>
    <button class="dock-btn" type="button" data-action="attach">添加资料</button>
    <span class="dock-spacer"></span>
    <button class="dock-btn" type="button" data-action="theme">${state.theme === 'dark' ? '日间' : '夜间'}</button>
    <button class="dock-btn dock-hide" type="button" data-action="hide-dock">隐藏</button>`;
}

/* ---------- render: launchpad ---------- */

function renderLaunchpad() {
  const overlay = $('#launchpad');
  const ws = currentWorkspace();
  const session = ws.sessions[0];
  overlay.innerHTML = `
    <div class="launchpad-bar">
      <div class="launchpad-bar-left">
        <button class="brand" type="button" data-close aria-label="关闭启动台"><span class="brand-mark"><svg viewBox="0 0 32 32" fill="none"><path d="M8 24.75V7.25h9a5.5 5.5 0 0 1 0 11H8" stroke="currentColor" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/><path d="m16.5 18.25 7.5 6.5" stroke="var(--accent)" stroke-width="3.1" stroke-linecap="round"/></svg></span><span class="brand-name">RayAgent</span></button>
        <span style="width:1px;height:15px;background:var(--line)"></span>
        <span>启动台</span>
      </div>
      <button class="launchpad-close" type="button" data-close>关闭 <kbd>Esc</kbd></button>
    </div>
    <div class="launchpad-inner">
      <div class="lp-kicker">按工作区整理，也保留不进入工作区的散页。</div>
      <h1 class="lp-title">回到工作。</h1>
      <p class="lp-sub">打开一个工作区，或接着上次的对话。工作区里的工作方式、记忆和材料只在它自己里面可见。</p>
      <div class="lp-search">${icon('search')}<input id="lpSearchInput" type="search" placeholder="搜索工作区、对话或文件" autocomplete="off" aria-label="搜索工作区、对话或文件"><kbd>⌘K</kbd></div>
      <div class="lp-continue">
        <div class="lp-continue-main">
          <div class="lp-continue-label">继续 ${ws.name} <span style="color:var(--faint)">/${session ? session.title : '新对话'}</span></div>
          <div class="lp-continue-row"><span class="lp-continue-tab" style="--ws-color:${ws.color}"></span><span class="lp-continue-name">${ws.name}</span><span style="display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:10px">${statusDot(ws.status === 'offline' ? 'offline' : ws.status === 'archived' ? 'archived' : ws.status === 'running' ? 'running' : 'done')} ${ws.statusText}</span></div>
          <div class="lp-continue-path">${ws.path}</div>
          <div class="lp-continue-desc">上次停在 <b>${session ? session.title : '还没有对话'}</b>${session ? ` · ${session.time}` : ''}${ws.status === 'offline' ? ' · 文件夹暂时不可用' : ''}</div>
        </div>
        <div class="lp-continue-actions"><button class="btn btn-primary" type="button" data-lp-workspace="${ws.id}" data-lp-session="${session ? session.id : ''}">继续这次对话</button><button class="btn" type="button" data-lp-workspace="${ws.id}">打开工作区</button></div>
      </div>
      <div class="lp-grid">
        <section><div class="lp-h">工作区 <span>${WORKSPACES.length} 个</span></div><div id="lpWorkspaceList"></div></section>
        <section><div class="lp-h">散页 <span>${LOOSE.length} 条</span></div><div id="lpLooseList"></div></section>
      </div>
      <div class="lp-actions"><button class="btn" type="button" data-action="new-workspace">${icon('plus')}新建工作区</button><button class="btn" type="button" data-action="open-folder">${icon('folder')}打开文件夹</button><span class="spacer"></span><button class="btn btn-quiet" type="button" data-action="settings">设置</button></div>
      <div class="lp-footnote">工作区之间不共享记忆、材料与索引；散页不属于任何工作区。</div>
    </div>`;
  filterLaunchpad(state.search);
}

function filterLaunchpad(query) {
  const q = (query || '').trim().toLowerCase();
  const list = $('#lpWorkspaceList');
  const loose = $('#lpLooseList');
  if (!list || !loose) return;
  const wsMatches = WORKSPACES.filter(ws => {
    if (!q) return true;
    return [ws.name, ws.path, ws.statusText, ...ws.sessions.map(s => s.title)].join(' ').toLowerCase().includes(q);
  });
  list.innerHTML = wsMatches.length ? wsMatches.map(ws => {
    const session = ws.sessions[0];
    const statusKey = ws.status === 'offline' ? 'offline' : ws.status === 'archived' ? 'archived' : 'done';
    return `<button class="ws-row" type="button" data-lp-workspace="${ws.id}">
      <span class="ws-row-tab" style="--ws-color:${ws.color}"></span>
      <span><span class="ws-row-name">${ws.name}</span><span class="ws-row-meta">${ws.sessions.length} 个对话 · ${ws.fileCount} 个文件${session ? ` · ${session.title}` : ''}</span></span>
      <span class="ws-row-side"><span class="ws-row-status">${statusDot(statusKey)} ${ws.statusText}</span><span class="ws-row-time">${session ? session.time : ''}</span></span>
    </button>`;
  }).join('') : `<div class="lp-empty">没有找到匹配的工作区。</div>`;
  const looseMatches = LOOSE.filter(item => !q || item.title.toLowerCase().includes(q));
  loose.innerHTML = looseMatches.length ? `<div class="loose-list">${looseMatches.map(item => `<button class="lp-loose" type="button" data-action="loose" data-title="${item.title}"><span class="lp-loose-title">${item.title}</span><span class="lp-loose-meta">${item.meta}</span></button>`).join('')}</div><button class="lp-loose" type="button" data-action="new-loose" style="border-bottom:0;color:var(--faint)"><span class="lp-loose-title">新的独立对话</span><span class="lp-loose-meta">+</span></button>` : `<div class="lp-empty">没有找到匹配的散页。</div>`;
}

function openLaunchpad(focusSearch = false) {
  state.launchpad = true;
  state.search = '';
  renderLaunchpad();
  const overlay = $('#launchpad');
  overlay.hidden = false;
  if (focusSearch) {
    requestAnimationFrame(() => $('#lpSearchInput')?.focus());
  }
}

function closeLaunchpad() {
  state.launchpad = false;
  state.search = '';
  $('#launchpad').hidden = true;
}

/* ---------- preview ---------- */

function findFile(name) {
  for (const ws of WORKSPACES) {
    const file = (ws.files || []).find(f => f.name === name);
    if (file) return file;
  }
  return {name, ext: 'FILE', type: 'md', size: '', meta: '工作区文件', color: 'var(--accent)'};
}

function pdfSheet() {
  return `<div class="paper-sheet">
    <div class="sheet-kicker">竞品资料 / 价格与渠道</div>
    <h2 class="sheet-title">竞品定价与渠道政策</h2>
    <p class="sheet-sub">整理自竞品公开价目与渠道说明 · 供季度复盘使用</p>
    <div class="sheet-rule"></div>
    <p class="sheet-p">竞品 A 采用版本 + 席位的混合计价，基础版覆盖 5 个席位；竞品 B 只按席位计价，团队版从 10 个席位起售。</p>
    <table class="sheet-table">
      <thead><tr><th>口径</th><th>我们</th><th>竞品 A</th><th>竞品 B</th></tr></thead>
      <tbody>
        <tr><td>基础版 / 月</td><td class="num">¥ 99 / 席位</td><td class="num">¥ 99 / 5 席位</td><td class="num">¥ 89 / 席位</td></tr>
        <tr><td>团队版 / 月</td><td class="num">¥ 199 / 席位</td><td class="num">¥ 199 / 10 席位</td><td class="num">¥ 169 / 席位</td></tr>
        <tr><td>教育渠道</td><td class="num">—</td><td class="num">7 折</td><td class="num">8 折</td></tr>
        <tr><td>年付</td><td class="num">9 折</td><td class="num">8.5 折</td><td class="num">8 折</td></tr>
      </tbody>
    </table>
    <div class="sheet-note">阅读提示：竞品 A 的「基础版」按 5 席位打包，折算到单席位后低于我们的基础版；竞品 B 的团队版在 50 人以上有额外折扣。</div>
    <p class="sheet-p" style="margin-top:18px">渠道政策部分来自竞品 B 第 4 页；教育折扣需要销售确认是否含税。</p>
    <div class="sheet-page">竞品-A · 第 2 页</div>
  </div>`;
}

function xlsxSheet() {
  return `<div class="preview-xlsx">
    <div class="xlsx-bar"><b>对比表.xlsx</b><span>·</span><span>工作表 1 / 4</span><span style="margin-left:auto">本次写入 · 18 KB</span></div>
    <table class="xlsx-grid">
      <thead><tr><th style="width:34px"></th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead>
      <tbody>
        <tr><th>1</th><td>产品线</td><td>我们</td><td>竞品 A</td><td>竞品 B</td></tr>
        <tr><th>2</th><td>基础版</td><td class="num">99 / 席位</td><td class="num">99 / 5 席位</td><td class="num">89 / 席位</td></tr>
        <tr><th>3</th><td>团队版</td><td class="num">199 / 席位</td><td class="num">199 / 10 席位</td><td class="num">169 / 席位</td></tr>
        <tr><th>4</th><td>教育渠道</td><td class="num">—</td><td class="num">7 折</td><td class="num">8 折</td></tr>
        <tr><th>5</th><td>年付</td><td class="num">9 折</td><td class="num">8.5 折</td><td class="num">8 折</td></tr>
        <tr><th>6</th><td>结论</td><td class="hl">20 人内基础版更便宜</td><td class="hl">50 人以上团队版更低</td><td class="hl">教育渠道有缺口</td></tr>
        <tr><th>7</th><td>依据</td><td>A 第 2 页</td><td>B 第 4 页</td><td>纪要.md 第 3 段</td></tr>
        <tr><th>8</th><td>未覆盖</td><td>白板照片未解析</td><td></td><td></td></tr>
        <tr><th>9</th><td></td><td></td><td></td><td></td></tr>
      </tbody>
    </table>
  </div>`;
}

function mdSheet() {
  return `<div class="md-sheet">
    <div class="sheet-kicker">会议纪要 / 内部</div>
    <h2 class="sheet-title" style="font-size:23px">季度复盘 · 定价讨论</h2>
    <div class="sheet-rule"></div>
    <h3>结论</h3>
    <p>维持按席位计价；教育渠道单独申请折扣，不写进标准价目。</p>
    <h3>依据</h3>
    <ul><li>20 人以内，我们的基础版总价低于竞品 A 的 5 席打包价。</li><li>50 人以上，竞品 B 的团队版折扣更低。</li><li>教育渠道对方给到 7 折，我们没有对应折扣。</li></ul>
    <h3>待确认</h3>
    <p>白板照片里的渠道政策还没有进入可检索文本，下一次对话需要补上。</p>
    <div class="sheet-page">纪要.md · 第 3 段</div>
  </div>`;
}

function renderPreview() {
  const file = findFile(state.preview);
  const body = file.type === 'xlsx' ? xlsxSheet() : file.type === 'md' ? mdSheet() : pdfSheet();
  $('#preview').innerHTML = `<div class="preview-panel" role="dialog" aria-modal="true" aria-labelledby="previewName">
    <div class="preview-head">
      ${fileMark(file)}
      <div class="preview-title"><div class="preview-name" id="previewName">${file.name}</div><div class="preview-meta">${file.size} · ${file.meta} · 只读预览</div></div>
      <div class="preview-actions"><button class="mini" type="button" data-action="download">${icon('download')}下载</button><button class="mini" type="button" data-action="reveal">${icon('external')}在 Finder 中显示</button><button class="icon-btn" type="button" data-close aria-label="关闭预览">${icon('x')}</button></div>
    </div>
    <div class="preview-body">${body}</div>
  </div>`;
}

function openPreview(name) {
  state.lastFocus = document.activeElement;
  state.preview = name;
  renderPreview();
  $('#preview').hidden = false;
  requestAnimationFrame(() => $('#preview [data-close]')?.focus());
}

function closePreview() {
  state.preview = null;
  $('#preview').hidden = true;
  state.lastFocus?.focus?.();
}

/* ---------- modal ---------- */

function openModal(html) {
  state.lastFocus = document.activeElement;
  $('#modal').innerHTML = html;
  $('#modal').hidden = false;
  requestAnimationFrame(() => $('#modal [data-close], #modal .btn-primary')?.focus());
}

function closeModal() {
  state.modal = null;
  $('#modal').hidden = true;
  state.lastFocus?.focus?.();
}

function addMaterialModal() {
  return `<div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-head"><div class="modal-kicker">添加资料 · ${currentWorkspace().name}</div><h2 class="modal-title" id="modalTitle">把材料放进来。</h2><p class="modal-desc">文件会加入这个工作区的检索，原文件留在文件夹原位，不会被移动或复制。</p></div>
    <div class="modal-body">
      <button class="choice-row" type="button" data-choice="files"><span class="choice-icon">${icon('file')}</span><span><span class="choice-title">选择文件</span><span class="choice-desc">加入 1 个或多个文件；同名文件会先询问再覆盖索引。</span></span></button>
      <button class="choice-row" type="button" data-choice="folder"><span class="choice-icon">${icon('folder')}</span><span><span class="choice-title">选择文件夹</span><span class="choice-desc">递归加入文件夹里的材料；稍后可以在设置里调整范围。</span></span></button>
      <div class="dropzone" id="dropzone">或者把文件拖到这里</div>
    </div>
    <div class="modal-foot"><span class="modal-note">不会移动原文件</span><button class="btn" type="button" data-close>取消</button><button class="btn btn-primary" type="button" data-choice="files">选择文件</button></div>
  </div>`;
}

function styleModal() {
  const ws = currentWorkspace();
  return `<div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-head"><div class="modal-kicker">工作区背景 · <span class="plan-tag">P5 · 规划</span></div><h2 class="modal-title" id="modalTitle">这里的工作方式</h2><p class="modal-desc">每次新对话都会带上这段文字，不需要重新交代。记忆条目在运行结束后自动提炼，也可以随时撤回。</p></div>
    <div class="modal-body">
      <div class="tray-block" style="margin-bottom:10px"><div class="tray-block-label">${icon('book')} 当前版本 <span style="margin-left:auto">${ws.styleVersion}</span></div><div class="tray-block-quote" style="font-size:13px">${ws.style}</div></div>
      <div class="tray-section-head" style="padding:2px 0 6px"><h3>常驻记忆</h3><span>${ws.memories} 条</span></div>
      <div class="choice-row"><span class="choice-icon" style="color:var(--accent)">${icon('pin')}</span><span><span class="choice-title">数字要能回到原文</span><span class="choice-desc">来自 3/11 的对话 · 你确认过</span></span></div>
      <div class="choice-row"><span class="choice-icon" style="color:var(--accent)">${icon('pin')}</span><span><span class="choice-title">结论先写，依据放后面</span><span class="choice-desc">来自 3/2 的对话 · 你确认过</span></span></div>
    </div>
    <div class="modal-foot"><span class="modal-note">下一版接入真实记忆</span><button class="btn" type="button" data-close>关闭</button></div>
  </div>`;
}

function refsModal() {
  const files = currentWorkspace().files.filter(f => f.tone === 'ok' || f.tone === 'write').slice(0, 3);
  return `<div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-head"><div class="modal-kicker">本次对话</div><h2 class="modal-title" id="modalTitle">这次参考了什么</h2><p class="modal-desc">只列本次运行实际读到的材料；白板照片尚未解析，没有进入参考。</p></div>
    <div class="modal-body">${files.map(f => `<button class="choice-row" type="button" data-file="${f.name}">${fileMark(f)}<span><span class="choice-title">${f.name}</span><span class="choice-desc">${f.meta} · ${f.size}</span></span></button>`).join('')}</div>
    <div class="modal-foot"><span class="modal-note">3 个文件 · 2 段记忆</span><button class="btn" type="button" data-close>关闭</button></div>
  </div>`;
}

function newWorkspaceModal() {
  return `<div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-head"><div class="modal-kicker">新建工作区</div><h2 class="modal-title" id="modalTitle">给这件事一个文件夹。</h2><p class="modal-desc">工作区绑定一个本地文件夹。新建会在默认位置创建空文件夹；也可以打开已有文件夹。</p></div>
    <div class="modal-body">
      <label class="choice-row" style="cursor:text"><span class="choice-icon">${icon('folder')}</span><span style="flex:1"><span class="choice-title">工作区名称</span><input value="新的工作区" style="display:block;width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;padding:4px 0 3px;font-family:var(--serif);font-size:16px;color:var(--ink)" aria-label="工作区名称"></span></label>
      <div class="choice-row" style="cursor:default"><span class="choice-icon">${icon('book')}</span><span><span class="choice-title">工作方式可以先空着</span><span class="choice-desc">创建后在这里写下角色、原则和禁止事项；以后每次新对话自动带上。</span></span></div>
    </div>
    <div class="modal-foot"><span class="modal-note">文件夹位置稍后确认</span><button class="btn" type="button" data-close>取消</button><button class="btn btn-primary" type="button" data-choice="create-ws">创建工作区</button></div>
  </div>`;
}

function modelModal() {
  const models = [
    ['Claude 4.5', '思考 · 默认', true],
    ['GPT-5.1', '标准', false],
    ['Gemini 3 Pro', '长上下文', false],
  ];
  return `<div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal-head"><div class="modal-kicker">下一次运行</div><h2 class="modal-title" id="modalTitle">选择模型</h2><p class="modal-desc">只影响之后的新运行；正在执行的任务保持开始时的配置。</p></div>
    <div class="modal-body">${models.map(([name, note, on]) => `<button class="choice-row" type="button" data-choice="model" data-model="${name}"><span class="choice-icon" style="color:${on ? 'var(--accent)' : 'var(--faint)'}">${icon(on ? 'check' : 'chevron')}</span><span><span class="choice-title">${name}</span><span class="choice-desc">${note}</span></span></button>`).join('')}</div>
    <div class="modal-foot"><span class="modal-note">配置来自本机模型目录</span><button class="btn" type="button" data-close>关闭</button></div>
  </div>`;
}

/* ---------- interactions ---------- */

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

function renderAll() {
  document.documentElement.dataset.theme = state.theme;
  document.body.classList.toggle('tray-hidden', !state.trayOpen);
  document.body.classList.toggle('tray-open', state.trayOpen);
  document.body.classList.toggle('index-open', state.indexOpen);
  const ws = currentWorkspace();
  $('#workspaceTab').style.background = ws.color;
  $('#workspaceSwitchName').textContent = ws.name;
  renderRail();
  renderIndex();
  renderWorkHead();
  renderBanner();
  renderTimeline();
  renderComposer();
  renderTray();
  renderRunPill();
  renderDock();
  $$('[data-action="toggle-tray"]').forEach(el => el.setAttribute('aria-expanded', String(state.trayOpen)));
}

function switchWorkspace(id, sessionId = undefined) {
  const ws = WORKSPACES.find(w => w.id === id);
  if (!ws) return;
  state.workspaceId = id;
  state.sessionId = sessionId !== undefined ? sessionId : (ws.sessions[0] ? ws.sessions[0].id : null);
  state.bannerDismissed = false;
  state.trayTab = 'files';
  try { localStorage.setItem('rayagent.v2.workspace', id); } catch { /* ignore */ }
  renderAll();
}

function switchSession(id) {
  state.sessionId = id;
  state.bannerDismissed = false;
  renderAll();
}

function setDockState(key) {
  if (key === 'empty') {
    state.workspaceId = 'quarter';
    state.sessionId = null;
    state.run = 'running';
    try { localStorage.setItem('rayagent.v2.workspace', 'quarter'); } catch { /* ignore */ }
    renderAll();
    toast('原型：这是新对话的空状态；现有对话仍在左侧。');
    return;
  }
  state.workspaceId = 'quarter';
  state.sessionId = 'compare';
  state.run = key;
  state.bannerDismissed = false;
  renderAll();
}

function sendDraft() {
  const input = $('#composerInput');
  const text = (input?.value || '').trim();
  if (!text) { toast('先写点什么。'); return; }
  const timeline = $('#timeline');
  const time = '刚刚';
  timeline.insertAdjacentHTML('beforeend', entryUser(time, text.replace(/[<>&]/g, ch => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[ch])), '你补充的'));
  input.value = '';
  input.style.height = 'auto';
  const scroll = $('#workScroll');
  scroll.scrollTop = scroll.scrollHeight;
  const offline = currentWorkspace().status === 'offline' || (isMain() && state.run === 'offline');
  setTimeout(() => {
    const reply = offline
      ? ['收到。文件工具恢复后我再处理这条；现在不会读写文件夹。']
      : ['收到。这是原型里的占位回复——正式版会把这条作为这次运行的补充，接着当前的时间线继续。'];
    timeline.insertAdjacentHTML('beforeend', entryAgent(time, reply));
    scroll.scrollTop = scroll.scrollHeight;
  }, 650);
}

function openOutputPreview() {
  const file = currentWorkspace().outputs?.[0];
  if (!file) { toast('这次对话没有写出文件。'); return; }
  openPreview(file);
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('rayagent.v2.theme', state.theme); } catch { /* ignore */ }
  document.documentElement.dataset.theme = state.theme;
  renderDock();
  toast(state.theme === 'dark' ? '夜间纸面' : '日间纸面');
}

function showIndex() {
  state.indexOpen = !state.indexOpen;
  document.body.classList.toggle('index-open', state.indexOpen);
}

function hideDock() {
  state.dockHidden = true;
  document.body.classList.add('dock-hidden');
  $('#dockRestore').hidden = false;
}

function restoreDock() {
  state.dockHidden = false;
  document.body.classList.remove('dock-hidden');
  $('#dockRestore').hidden = true;
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action], [data-workspace], [data-session], [data-file], [data-tray-tab], [data-dock-state], [data-lp-workspace], [data-choice], [data-close]');
  if (!target) {
    if (event.target.id === 'launchpad') closeLaunchpad();
    if (event.target.id === 'modal') closeModal();
    if (event.target.id === 'preview') closePreview();
    return;
  }

  if (target.hasAttribute('data-close')) {
    if (target.closest('#launchpad')) closeLaunchpad();
    else if (target.closest('#preview')) closePreview();
    else closeModal();
    return;
  }
  if (target.dataset.dockState) { setDockState(target.dataset.dockState); return; }
  if (target.dataset.workspace) { switchWorkspace(target.dataset.workspace); closeLaunchpad(); return; }
  if (target.dataset.session) { switchSession(target.dataset.session); closeLaunchpad(); return; }
  if (target.dataset.lpWorkspace) {
    switchWorkspace(target.dataset.lpWorkspace, target.dataset.lpSession || undefined);
    closeLaunchpad();
    return;
  }
  if (target.dataset.trayTab) {
    state.trayTab = target.dataset.trayTab;
    renderTray();
    return;
  }
  if (target.dataset.file) {
    if (target.closest('#preview') || target.closest('#modal')) closeModal();
    openPreview(target.dataset.file);
    return;
  }
  if (target.dataset.choice) {
    const choice = target.dataset.choice;
    if (choice === 'model') { toast(`原型：已记录为「${target.dataset.model}」；保存逻辑沿用现有设置。`); closeModal(); }
    else if (choice === 'create-ws') { toast('原型：工作区已创建；接下来会让你选择文件夹。'); closeModal(); }
    else { toast(choice === 'folder' ? '原型：会打开系统文件夹选择器。' : '原型：会打开系统文件选择器。'); closeModal(); }
    return;
  }

  const action = target.dataset.action;
  if (!action) return;
  switch (action) {
    case 'launchpad': openLaunchpad(); break;
    case 'search': openLaunchpad(true); break;
    case 'new-workspace': openModal(newWorkspaceModal()); break;
    case 'new-chat':
      state.sessionId = null;
      state.indexOpen = false;
      renderAll();
      toast('原型：这是一段新对话的开头；正式版会创建新的运行。');
      break;
    case 'settings': toast('原型：设置沿用现有分区，下一版单独做。'); break;
    case 'toggle-tray':
      state.trayOpen = !state.trayOpen;
      document.body.classList.toggle('tray-open', state.trayOpen);
      renderAll();
      break;
    case 'toggle-index': showIndex(); break;
    case 'open-style': openModal(styleModal()); break;
    case 'open-plan':
      if ($('#planBlock')) $('#planBlock').scrollIntoView({block: 'center', behavior: 'smooth'});
      else toast('这次对话还没有计划。');
      break;
    case 'open-output': openOutputPreview(); break;
    case 'attach': openModal(addMaterialModal()); break;
    case 'refs': openModal(refsModal()); break;
    case 'model': openModal(modelModal()); break;
    case 'send': sendDraft(); break;
    case 'session-menu': toast('原型：重命名、归档和删除沿用现有对话菜单。'); break;
    case 'allow': state.run = 'done'; renderAll(); toast('已允许写入；对比表已经保存到文件夹。'); break;
    case 'deny': state.run = 'running'; renderAll(); toast('已拒绝这次写入；文件没有变化。'); break;
    case 'scroll-approval': $('#planBlock')?.scrollIntoView({block: 'center', behavior: 'smooth'}); break;
    case 'relocate': toast('原型：会打开系统选择器，按标记认回工作区。'); break;
    case 'dismiss-banner': state.bannerDismissed = true; renderBanner(); break;
    case 'unarchive': toast('原型：取消归档后会恢复可写。'); break;
    case 'reveal':
    case 'reveal-folder': toast('原型：正式版会在 Finder 中定位文件夹。'); break;
    case 'download': toast('原型：正式版会下载到本机。'); break;
    case 'run-detail': toast('原型：会在开发者视图里展开逐轮耗时与用量。'); break;
    case 'undo': toast('原型：撤销会检查冲突，只恢复这次运行写过的文件。'); break;
    case 'loose': toast(`原型：打开散页「${target.dataset.title}」。散页不进入工作区。`); closeLaunchpad(); break;
    case 'new-loose': toast('原型：会新建一条不属于任何工作区的散页。'); break;
    case 'open-folder': toast('原型：会打开系统文件夹选择器。'); break;
    case 'theme': toggleTheme(); break;
    case 'hide-dock': hideDock(); break;
    case 'restore-dock': restoreDock(); break;
    default: break;
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'lpSearchInput') {
    state.search = event.target.value;
    filterLaunchpad(state.search);
  }
});

document.addEventListener('keydown', event => {
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (!state.launchpad) openLaunchpad(true);
    else $('#lpSearchInput')?.focus();
    return;
  }
  if (mod && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    openLaunchpad();
    return;
  }
  if (event.key === 'Escape') {
    if (state.launchpad) closeLaunchpad();
    else if (!$('#preview').hidden) closePreview();
    else if (!$('#modal').hidden) closeModal();
    else if (state.indexOpen) { state.indexOpen = false; document.body.classList.remove('index-open'); }
    else if (document.body.classList.contains('tray-open') && window.innerWidth <= 900) { state.trayOpen = false; document.body.classList.remove('tray-open'); }
  }
});

/* dropzone for add material */
document.addEventListener('dragover', event => {
  const zone = event.target.closest('#dropzone');
  if (!zone) return;
  event.preventDefault();
  zone.classList.add('is-over');
});
document.addEventListener('dragleave', event => {
  const zone = event.target.closest('#dropzone');
  if (zone) zone.classList.remove('is-over');
});
document.addEventListener('drop', event => {
  const zone = event.target.closest('#dropzone');
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove('is-over');
  toast('原型：收到拖入的文件；正式版会先检查重名和索引范围。');
  closeModal();
});

/* ---------- init ---------- */

function applyParams() {
  const runParam = params.get('state');
  if (['running', 'approval', 'done', 'offline'].includes(runParam)) {
    state.run = runParam;
    state.workspaceId = 'quarter';
    state.sessionId = 'compare';
  }
  if (runParam === 'empty') {
    state.sessionId = null;
    state.workspaceId = 'quarter';
  }
  if (params.get('workspace') && WORKSPACES.some(w => w.id === params.get('workspace'))) {
    const ws = WORKSPACES.find(w => w.id === params.get('workspace'));
    state.workspaceId = ws.id;
    state.sessionId = ws.sessions[0]?.id || null;
  }
  if (!state.sessionId && !['empty'].includes(runParam)) {
    const ws = currentWorkspace();
    state.sessionId = ws.sessions[0]?.id || null;
  }
}

function init() {
  // resolve static icon placeholders in the shell
  $$('[data-icon]').forEach(el => { el.innerHTML = svg(el.dataset.icon); });
  applyParams();
  renderAll();
  const runParam = params.get('state');
  if (runParam === 'preview') {
    state.run = 'done';
    state.workspaceId = 'quarter';
    state.sessionId = 'compare';
    renderAll();
    openPreview(params.get('file') || '对比表.xlsx');
  }
  if (runParam === 'launchpad') openLaunchpad(false);
  if (params.get('dialog') === 'add') openModal(addMaterialModal());
  if (runParam === 'style') openModal(styleModal());
  if (runParam === 'refs') openModal(refsModal());
  $('#dockRestore').addEventListener('click', restoreDock);
}

init();

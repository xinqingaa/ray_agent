// RayAgent V5 原型：壳层、对话、工作区背景。全部为静态模拟。
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const RESIDENT_LIMIT = 12;
const TYPE_RANK = {约束: 0, 偏好: 1, 决定: 2, 事实: 3};

const state = {
  route: {page: 'session', ws: 'review', session: 's1'},
  expanded: {review: true},
  scenario: 'done',
  list: 'open',
  insp: {open: true, tab: 'folder', preview: null},
  processOpen: false,
  refsOpen: false,
  approved: false,
  memories: DATA.memories.map(m => ({...m})),
  candidates: DATA.candidates.map(c => ({...c})),
  style: {...DATA.workingStyle},
  proposal: {...DATA.proposal},
  autoMemory: true,
  uploads: [],
  quotes: [],
  tree: JSON.parse(JSON.stringify(DATA.tree)),
  remembered: ['m4', 'm7'],
  planOpen: false,
  model: {id: 'opus', level: 1, think: true},
  slash: {open: false, q: '', idx: 0},
  composerSkill: null,
  planMode: false,
};

/* ================================================================ 路由 */
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'ws') {
    const ws = parts[1] || 'review';
    if (parts[2] === 'context') return {page: 'context', ws};
    if (parts[2] === 'knowledge') return {page: 'knowledge', ws};
    if (parts[2]) return {page: 'session', ws, session: parts[2]};
    return {page: 'ws-home', ws};
  }
  if (parts[0] === 'chat') return parts[1] ? {page: 'chat', chat: parts[1]} : {page: 'chat-home'};
  if (['skills', 'components'].includes(parts[0])) return {page: parts[0]};
  if (parts[0] === 'settings') { setTimeout(() => openSettings(), 0); return {page: 'session', ws: 'review', session: 's1'}; }
  return {page: 'session', ws: 'review', session: 's1'};
}
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
function railOf(route) {
  if (route.page.startsWith('chat')) return 'chats';
  if (['skills', 'components', 'settings'].includes(route.page)) return route.page;
  return 'workspaces';
}
const wsById = id => DATA.workspaces.find(w => w.id === id);
const pendingCount = () => state.candidates.length + (state.proposal ? 1 : 0);

/* ================================================================ 轨道 */
const RAIL = [
  [{id: 'chats', icon: 'chats', tip: '独立对话', href: '#/chat/c1'},
   {id: 'workspaces', icon: 'folder', tip: '工作区', href: '#/ws/review/s1'}],
  [{id: 'skills', icon: 'spark', tip: 'Skill', href: '#/skills'},
   {id: 'components', icon: 'box', tip: '运行组件', href: '#/components'}],
];
function renderRail() {
  $('.rail-new').innerHTML = icon('plus');
  $('#rail-groups').innerHTML = RAIL.map(group => `<div class="rail-group">${group.map(item =>
    `<button class="rail-btn" data-rail="${item.id}" data-href="${item.href}" data-tip="${item.tip}" aria-label="${item.tip}">${icon(item.icon)}${item.id === 'workspaces' ? '<span class="badge" id="ws-badge"></span>' : ''}</button>`
  ).join('')}</div>`).join('<div class="rail-sep" role="separator"></div>');
  $('#rail-foot').innerHTML = `
    <button class="rail-btn" data-action="theme" data-tip="切换深浅" aria-label="切换深浅">${icon(document.documentElement.classList.contains('dark') ? 'sun' : 'moon')}</button>
    <button class="rail-btn" data-action="settings" data-tip="设置  ⌘," aria-label="设置">${icon('settings')}</button>`;
}
function syncRail() {
  const active = railOf(state.route);
  let target = null;
  $$('.rail-btn[data-rail]').forEach(btn => {
    const on = btn.dataset.rail === active;
    btn.setAttribute('aria-current', on);
    if (on) target = btn;
  });
  const ind = $('#rail-indicator');
  if (target) {
    ind.style.opacity = 1;
    ind.style.setProperty('--y', `${target.offsetTop}px`);
  } else ind.style.opacity = 0;
  const badge = $('#ws-badge');
  if (badge) badge.style.display = pendingCount() ? '' : 'none';
}

/* ================================================================ 列表 */
function renderList() {
  const rail = railOf(state.route);
  const app = $('#app');
  if (!['chats', 'workspaces', 'skills'].includes(rail)) { app.dataset.list = 'none'; return; }
  app.dataset.list = state.list;
  if (rail === 'skills') { $('#list').innerHTML = listFrame('Skill', 'skill-add', '添加 Skill', skillListHTML()); return; }
  const r = state.route;
  let body = '';
  if (rail === 'chats') {
    const groups = ['今天', '昨天', '更早'];
    body = groups.map(g => {
      const items = DATA.independent.filter(c => c.when === g);
      if (!items.length) return '';
      return `<div class="list-label">${g}</div>` + items.map(c =>
        `<button class="row" data-href="#/chat/${c.id}" aria-current="${r.chat === c.id}"><span class="row-title">${esc(c.title)}</span><span class="row-meta">${c.time}</span></button>`).join('');
    }).join('');
    $('#list').innerHTML = listFrame('独立对话', 'new-chat', '新对话', body);
    return;
  }
  body = DATA.workspaces.map(w => {
    const open = !!state.expanded[w.id];
    const here = r.ws === w.id;
    const pill = w.state === 'missing' ? '<span class="state-pill wait">找不到文件夹</span>'
      : w.state === 'archived' ? '<span class="state-pill">已归档</span>' : '';
    const sessions = w.sessions.map(s => {
      const status = s.id === 's1' ? (state.scenario === 'done' ? '' : state.scenario === 'approval' ? 'waiting' : 'live') : s.status;
      const dot = status ? `<span class="status-dot ${status}" title="${status === 'live' ? '运行中' : '等你回复'}"></span>` : '';
      return `<button class="row" data-href="#/ws/${w.id}/${s.id}" aria-current="${r.page === 'session' && r.session === s.id}"><span class="row-title">${esc(s.title)}</span>${dot || `<span class="row-meta">${s.time}</span>`}</button>`;
    }).join('');
    return `
      <button class="row ws-row" data-ws-toggle="${w.id}" aria-expanded="${open}" aria-current="${here && r.page === 'ws-home'}">
        <span class="ws-mark">${wsIcon(w.hue, open && here)}</span><span class="row-title">${esc(w.name)}</span>${pill}
      </button>
      <div class="ws-children ${open ? 'open' : ''}"><div>${sessions}</div></div>`;
  }).join('');
  $('#list').innerHTML = listFrame('工作区', 'add-ws', '添加工作区', `<div class="list-label">本机</div>${body}`);
}
function listFrame(title, action, tip, body) {
  return `<div class="list-inner">
    <div class="list-head"><span class="list-title">${title}</span>
      <button class="ghost-btn" data-action="${action}" data-tip="${tip}" aria-label="${tip}">${icon('plus', 'sm')}</button>
    </div>
    <div class="list-scroll">${body}</div></div>`;
}

/* ================================================================ 顶栏 */
let topKey = '';
function renderTop() {
  const r = state.route;
  const ws = r.ws && wsById(r.ws);
  const key = `${r.page.startsWith('chat') ? 'chat' : ws ? 'ws:' + ws.id : r.page}`;
  const listToggle = ['chats', 'workspaces', 'skills'].includes(railOf(r))
    ? `<button class="ghost-btn" data-action="toggle-list" data-tip="${state.list === 'open' ? '收起列表' : '展开列表'}" aria-label="收起或展开列表" aria-pressed="${state.list !== 'open'}">${icon('sidebar')}</button>` : '';
  if (key !== topKey) {
    topKey = key;
    let middle = '';
    if (ws) {
      middle = `<div class="seg" role="tablist" aria-label="工作区视图" id="ws-seg">
        ${segBtn('chat', 'chat', '对话')}
        ${segBtn('context', 'layers', '背景', `<span class="count" id="ctx-count"></span>`)}
        ${segBtn('knowledge', 'library', '知识')}
      </div>`;
    }
    $('#topbar').innerHTML = `${listToggle}<div class="crumb" id="crumb"></div><div class="top-spacer"></div>${middle}<div class="top-spacer"></div><div id="top-actions" style="display:flex;gap:2px"></div>`;
  }
  // 面包屑与右侧动作每次更新，图标组只切换选中态以保留弹性动画
  const lt = $('[data-action="toggle-list"]');
  if (lt) lt.setAttribute('aria-pressed', state.list !== 'open');
  let crumb = '';
  if (ws) {
    const s = ws.sessions.find(x => x.id === r.session);
    crumb = s && r.page === 'session'
      ? `<button class="ws" data-href="#/ws/${ws.id}">${esc(ws.name)}</button><span class="sep">/</span><span class="here">${esc(s.title)}</span>`
      : `<span class="here">${esc(ws.name)}</span>`;
  } else if (r.page.startsWith('chat')) {
    const c = DATA.independent.find(x => x.id === r.chat);
    crumb = `<span class="here">${c ? esc(c.title) : '新对话'}</span>`;
  } else crumb = `<span class="here">${{skills: 'Skill', components: '运行组件', settings: '设置'}[r.page]}</span>`;
  $('#crumb').innerHTML = crumb;
  const view = r.page === 'context' ? 'context' : r.page === 'knowledge' ? 'knowledge' : 'chat';
  $$('#ws-seg .seg-btn').forEach(b => b.setAttribute('aria-selected', b.dataset.view === view));
  const cc = $('#ctx-count');
  if (cc) cc.textContent = pendingCount() || '';
  const hasInsp = r.page === 'session' || r.page === 'ws-home' || r.page === 'chat';
  $('#top-actions').innerHTML = (ws || r.page.startsWith('chat') ? `<button class="ghost-btn" data-tip="搜索  ⌘K" aria-label="搜索">${icon('search')}</button>` : '')
    + (hasInsp ? `<button class="ghost-btn" data-action="toggle-insp" data-tip="${state.insp.open ? '收起右侧' : '展开右侧'}" aria-label="右侧面板" aria-pressed="${state.insp.open}">${icon('panelRight')}</button>` : '');
}
function segBtn(view, ic, label, extra = '') {
  return `<button class="seg-btn" role="tab" data-view="${view}" aria-selected="false" aria-label="${label}">${icon(ic, 'sm')}<span class="seg-label">${label}</span>${extra}</button>`;
}

/* ================================================================ 主区 */
let stageKey = '';
function renderStage() {
  const r = state.route;
  const key = JSON.stringify(r);
  if (key === stageKey) { refreshStage(); return; }
  stageKey = key;
  const stage = $('#stage');
  if (r.page === 'session' || r.page === 'chat') {
    stage.innerHTML = `<section class="sheet" id="conv">
        <div class="scroll" id="conv-scroll"><div class="column" id="timeline"></div></div>
        <div class="dock"><div class="dock-inner" id="dock"></div></div>
        ${dropzoneHTML()}
      </section>${inspectorShell(r.page === 'chat')}`;
    refreshStage();
  } else if (r.page === 'ws-home') {
    stage.innerHTML = `<section class="sheet" id="conv"><div class="home" id="home"></div>${dropzoneHTML()}</section>${inspectorShell(false)}`;
    refreshStage();
  } else if (r.page === 'chat-home') {
    stage.innerHTML = `<section class="sheet" id="conv"><div class="home" id="home"></div>${dropzoneHTML()}</section>`;
    refreshStage();
  } else if (r.page === 'context') {
    stage.innerHTML = `<section class="sheet"><div class="scroll" id="ctx-scroll"><div class="ctx" id="ctx"></div></div></section>`;
    renderContext();
  } else if (r.page === 'knowledge') renderKnowledge(stage);
  else if (r.page === 'skills') renderSkills(stage);
  else if (r.page === 'components') renderComponents(stage);
}
function refreshStage() {
  const r = state.route;
  if (r.page === 'session' || r.page === 'chat') { renderTimeline(); renderDock(); renderInspector(); }
  if (r.page === 'ws-home' || r.page === 'chat-home') { renderHome(); if (r.page === 'ws-home') renderInspector(); }
  if (r.page === 'context') renderContext();
}

/* ---------------------------------------------------------------- 对话时间线 */
function stepsFor(scn) {
  const all = DATA.steps;
  if (scn === 'running') return all.slice(0, 4).map((s, i) => ({...s, live: i === 3, ok: i < 3, obj: i === 3 ? '「渠道 返点」' : s.obj}));
  if (scn === 'approval') return all.slice(0, 4);
  if (scn === 'resume') return all.slice(0, 6).map((s, i) => ({...s, live: i === 5, ok: i < 5, verb: i === 5 ? '正在写入' : s.verb}));
  return all;
}
function stepHTML(s, i) {
  return `<li class="step ${s.ok ? 'ok' : ''} ${s.live ? 'live' : ''}" data-step="${i}" tabindex="0">
    <span class="step-node">${icon(s.live ? 'dot' : s.ok ? 'check' : s.icon)}</span>
    <span class="step-verb">${s.verb}</span><span class="step-obj">${esc(s.obj)}</span>
    ${s.approval && s.ok ? '<span class="step-tag">你批准了</span>' : ''}
  </li>`;
}
function renderTimeline() {
  const r = state.route;
  const tl = $('#timeline');
  if (r.page === 'chat') { tl.innerHTML = independentChat(); return; }
  if (r.session !== 's1') { tl.innerHTML = otherSession(r.session); return; }
  const scn = state.scenario;
  const user = `<div class="msg-user">
      <div class="bubble"><span class="skill-token">${icon('spark', 'xs')}竞品分析</span>对比竞品-A、B 的价格结构和渠道差异，做成对比表放进「成果」，结论先写。</div>
      <div class="chips">${['竞品-A.pdf', '竞品-B.pdf'].map(f => `<button class="chip" data-open-file="${f}">${fileGlyph(f)}${f}<span class="sub">材料/</span></button>`).join('')}</div>
    </div>`;
  const steps = stepsFor(scn);
  const done = scn === 'done';
  const open = done ? state.processOpen : true;
  const head = done
    ? `${icon('chevronRight', 'sm chev')}<span>执行过程</span><span class="meta">${steps.length} 步 · 1 分 42 秒</span>`
    : `${icon('chevronRight', 'sm chev')}<span>${scn === 'approval' ? '等你批准' : '正在处理'}</span><span class="meta num">${steps.filter(s => s.ok).length} 步完成</span>`;
  const process = `<div class="process ${open ? 'open' : ''}" id="process">
      <button class="process-head" data-action="toggle-process" aria-expanded="${open}">${head}</button>
      <div class="collapse ${open ? 'open' : ''}"><div>
        <p class="narration" style="margin:10px 0 2px">先读两份材料，统一按工作区约定的三类渠道整理，再检索访谈纪要补充返点数据。</p>
        <ol class="steps">${steps.map(stepHTML).join('')}</ol>
      </div></div>
    </div>`;
  let tail = '';
  if (scn === 'approval') {
    tail = `<div class="approval" role="group" aria-label="待批准">
      <div class="approval-head">${icon('shield')}<b>要在文件夹里运行一条命令</b><span class="who">执行前询问 · 本机执行</span></div>
      <div class="approval-body">生成对比表需要运行脚本，会在「成果」新建一个文件。<div class="code">$ python build_table.py --out 成果/竞品对比表.xlsx</div></div>
      <div class="approval-acts"><button class="btn primary magnetic" data-action="approve">${icon('check', 'sm')}批准这一次</button><button class="btn quiet" data-action="deny">拒绝</button></div>
    </div>`;
  }
  if (done) tail = finalReply();
  tl.innerHTML = user + process + tail;
  bindMagnetic(tl);
}
function finalReply() {
  const rememberedCount = state.remembered.length;
  return `<article class="reply">
      <p class="lead">A 靠渠道返点扩张，B 正把重心转向线上并取消了年付折扣；如果我们沿用上季 8% 的返点假设，会低估 A 的渠道吸引力。</p>
      <p>A 的标准版年费 ¥4,800，渠道伙伴返点 12%<span class="cite" data-cite="1" tabindex="0">1</span>，明显高于上季估算。B 自 Q3 起统一按月计费 ¥420，不再提供年付折扣<span class="cite" data-cite="2" tabindex="0">2</span>；代理商反馈其线上渠道占比已超过六成<span class="cite" data-cite="3" tabindex="0">3</span>。</p>
      <div class="table-wrap"><table>
        <thead><tr><th>维度</th><th>竞品-A</th><th>竞品-B</th></tr></thead>
        <tbody>
          <tr><td>价格</td><td>¥4,800 / 年</td><td>¥420 / 月</td></tr>
          <tr><td>主力渠道</td><td>渠道</td><td>线上</td></tr>
          <tr><td>返点</td><td>12%</td><td>未公开</td></tr>
          <tr><td>备注</td><td>按季度结算</td><td>Q3 起无年付</td></tr>
        </tbody></table></div>
      <p style="color:var(--ink-2)">B 的返点在两份材料里都没有出现，表里标为“未公开”，没有推测。</p>
    </article>
    <div class="delivery" data-open-file="竞品对比表.xlsx" tabindex="0">
      ${fileGlyph('x.xlsx', 'lg')}
      <div><div class="name">竞品对比表.xlsx</div><div class="sub">已写入 成果/ · 9 KB</div></div>
      <div class="acts">
        <button class="ghost-btn" data-tip="预览" aria-label="预览">${icon('eye', 'sm')}</button>
        <button class="ghost-btn" data-tip="在 Finder 中显示" aria-label="在 Finder 中显示">${icon('finder', 'sm')}</button>
      </div>
    </div>
    <div class="reply-foot">
      <button class="foot-btn" data-action="toggle-refs" aria-expanded="${state.refsOpen}">${icon('quote', 'xs')}本次参考</button>
      ${rememberedCount ? `<button class="foot-btn" data-action="show-remembered">${icon('bookmark', 'xs')}记住了 ${rememberedCount} 条</button>` : ''}
      ${state.candidates.length ? `<button class="foot-btn" data-href="#/ws/review/context" style="color:var(--wait)">${icon('alert', 'xs')}${state.candidates.length} 条待你确认</button>` : ''}
      <button class="foot-btn" data-action="undo-run">${icon('undo', 'xs')}撤销修改</button>
      <div class="stats">
        <span data-tip="本次运行用时">${icon('clock')}1m 42s</span>
        <span data-tip="模型请求轮次">${icon('repeat')}6 轮</span>
        <span data-tip="生成速度（可见文本估算）">${icon('gauge')}38 tok/s</span>
        <span data-tip="输入与输出 Token">21.4k</span>
      </div>
    </div>
    <div class="collapse ${state.refsOpen ? 'open' : ''}" id="refs"><div>${refsHTML()}</div></div>`;
}
function refsHTML() {
  const R = DATA.references;
  return `<div class="refs"><div class="refs-flow">
    <div class="refs-col"><h4>${icon('layers', 'xs')}工作方式</h4>
      <button class="ref-item" data-href="#/ws/review/context"><span class="t">当前版本</span><span class="loc">${R.style}</span></button></div>
    <div class="refs-col"><h4>${icon('pin', 'xs')}常驻记忆 <span class="n">${R.resident.length}</span></h4>
      ${R.resident.map(t => `<button class="ref-item" data-href="#/ws/review/context"><span class="t">${esc(t)}</span></button>`).join('')}</div>
    <div class="refs-col"><h4>${icon('search', 'xs')}检索命中 <span class="n">${R.recalled.length}</span></h4>
      ${R.recalled.map(x => `<button class="ref-item" ${x.kind === 'file' ? `data-open-file="${x.label}"` : ''}>${x.kind === 'file' ? fileGlyph(x.label) : icon('chat', 'xs')}<span class="t">${esc(x.label)}</span><span class="loc">${x.loc}</span></button>`).join('')}</div>
  </div></div>`;
}
function independentChat() {
  return `<div class="msg-user"><div class="bubble">把这段周会录音的要点整理成纪要，按决定、待办、风险分开。</div>
      <div class="chips"><span class="chip">${fileGlyph('a.m4a')}周会录音.m4a<span class="sub">18.2 MB</span></span></div></div>
    <div class="process"><button class="process-head">${icon('chevronRight', 'sm chev')}<span>执行过程</span><span class="meta">3 步 · 48 秒</span></button></div>
    <article class="reply"><p class="lead">周会做了两个决定，留下三项待办，其中报价口径需要周五前确认。</p>
      <h3>决定</h3><p>新版定价下周一起对渠道生效；竞品-C 暂不纳入比较。</p>
      <h3>待办</h3><p>周敏整理渠道反馈（周三）；财务复核返点（周四）；市场确认报价口径（周五）。</p></article>
    <div class="reply-foot"><div class="stats"><span>${icon('clock')}48s</span><span>${icon('repeat')}3 轮</span><span>${icon('gauge')}41 tok/s</span></div></div>`;
}
function otherSession(id) {
  const s = wsById(state.route.ws).sessions.find(x => x.id === id);
  if (id === 's2') {
    return `<div class="msg-user"><div class="bubble">根据昨天的讨论写一份给市场部的纪要。</div></div>
      <article class="reply"><p>写之前需要确认一件事：</p></article>
      <div class="approval" style="box-shadow:0 0 0 1px color-mix(in srgb,var(--wait) 30%,transparent)">
        <div class="approval-head">${icon('chat')}<b>Agent 在等你回答</b></div>
        <div class="approval-body">纪要只发给周敏，还是同时抄送管理层？在下方输入框回复即可继续。</div></div>`;
  }
  return `<div class="msg-user"><div class="bubble">${esc(s ? s.title : '')}</div></div><article class="reply"><p style="color:var(--ink-2)">（示例会话）</p></article>`;
}

/* ---------------------------------------------------------------- 输入区 */
function renderDock() {
  const r = state.route;
  const scn = r.page === 'session' && r.session === 's1' ? state.scenario : 'done';
  const live = scn === 'running' || scn === 'resume';
  const plan = (scn === 'running' || scn === 'approval' || scn === 'resume') ? planHTML() : '';
  const placeholder = scn === 'approval' ? '先处理上面的批准；也可以补充要求或停止' : live ? '补充要求，会在下一轮前交给 Agent' : '继续提要求，或拖入文件';
  $('#dock').innerHTML = `${plan}${composerHTML(placeholder, live)}`;
  bindMagnetic($('#dock'));
}
function planStages() {
  // 批准后（resume）表格已生成，进入核对
  return DATA.plan.stages.map((st, i) => {
    if (state.scenario !== 'resume' || i !== 2) return st;
    return {...st, steps: [{text: '运行脚本生成表格', state: 'done'}, {text: '核对数字与页码', state: 'active'}]};
  });
}
const planNode = (st, live) => st === 'done' ? icon('check', 'xs')
  : st === 'active' ? (live ? '<span class="spin" aria-label="进行中"></span>' : '<span class="hollow"></span>') : '<span class="hollow"></span>';
function planHTML() {
  const stages = planStages();
  const live = state.scenario !== 'approval';
  const doneN = stages.filter(p => p.state === 'done').length;
  const cur = stages.find(p => p.state !== 'done');
  const sub = cur?.steps?.find(x => x.state === 'active');
  const unit = stages.some(x => x.steps) ? '阶段' : '项';
  const open = state.planOpen;
  return `<div class="plan ${open ? 'open' : ''}" id="plan">
    <div class="plan-pop" role="region" aria-label="计划清单" ${open ? '' : 'inert'}>
      <div class="plan-pop-head"><div><div class="plan-title">${esc(DATA.plan.title)}</div><div class="plan-desc">${esc(DATA.plan.desc)}</div></div>
        <button class="ghost-btn" data-action="plan-history" data-tip="历史清单" aria-label="历史清单">${icon('history', 'sm')}</button></div>
      <ol class="plan-list">${stages.map(st => `
        <li class="plan-item ${st.state}"><span class="pnode">${planNode(st.state, live && !st.steps)}</span><span class="ptext">${esc(st.text)}</span></li>
        ${st.steps ? `<li><ol class="plan-sub">${st.steps.map(x => `<li class="plan-item ${x.state}"><span class="pnode">${planNode(x.state, live)}</span><span class="ptext">${esc(x.text)}</span></li>`).join('')}</ol></li>` : ''}`).join('')}
      </ol>
    </div>
    <button class="planbar" data-action="toggle-plan" aria-expanded="${open}" aria-label="${open ? '收起计划' : '展开计划'}">
      <span class="num">${unit} ${doneN}/${stages.length}</span>
      <span class="track"><span class="fill" style="width:${doneN / stages.length * 100}%"></span></span>
      <span class="cur">${esc(cur ? cur.text : '全部完成')}${sub ? `<span class="cur-sub"> · ${esc(sub.text)}</span>` : ''}</span>
      ${icon('chevronDown', 'sm chev')}
    </button></div>`;
}
function currentModel(id = state.model.id) {
  for (const g of DATA.models) { const m = g.items.find(x => x.id === id); if (m) return {...m, vendor: g.vendor, mark: g.mark}; }
}
function modelLabel() {
  const m = currentModel();
  const lv = !state.model.think ? '不思考' : m.levels ? '思考 ' + m.levels[state.model.level] : '思考';
  return `${icon(m.mark, 'xs vendor')}${m.name}<span style="color:var(--ink-3)">· ${lv}</span>${icon('chevronDown', 'xs')}`;
}
function attachHTML() {
  const sk = state.composerSkill
    ? `<span class="skill-token lg" data-tip="${esc(state.composerSkill.desc)}">${icon('spark', 'xs')}${esc(state.composerSkill.name)}<button class="x" data-action="clear-skill" aria-label="移除 Skill">${icon('x', 'xs')}</button></span>` : '';
  const pm = state.planMode ? `<span class="mode-pill">${icon('listChecks', 'xs')}计划模式<button class="x" data-action="toggle-plan-mode" aria-label="退出计划模式">${icon('x', 'xs')}</button></span>` : '';
  const ups = state.uploads.map(u => `<span class="chip upchip ${u.stage === 3 ? 'ready' : ''}" data-up="${u.id}">${fileGlyph(u.name)}${esc(u.name)}<span class="stage-txt">${['上传中', '解析中', '建立索引', '可检索'][u.stage]}</span><span class="bar" style="width:${[30, 60, 85, 100][u.stage]}%"></span></span>`).join('');
  const qs = state.quotes.map(q => `<span class="chip">${icon('quote', 'xs')}<span>${esc(q)}</span></span>`).join('');
  return pm + sk + ups + qs;
}
function composerHTML(placeholder, live) {
  const isWs = state.route.page !== 'chat' && state.route.page !== 'chat-home';
  return `<div class="composer">
    <div class="slash" id="slash" role="listbox" aria-label="命令与 Skill" hidden></div>
    <div class="attach" id="composer-attach">${attachHTML()}</div>
    <textarea rows="1" placeholder="${placeholder}  ·  输入 / 选择命令或 Skill" aria-label="输入" id="composer-input"></textarea>
    <div class="composer-row">
      <button class="ghost-btn" data-action="attach" data-tip="添加文件（也可以直接拖入）" aria-label="添加文件">${icon('clip')}</button>
      <button class="ghost-btn" data-action="slash-open" data-tip="命令与 Skill  /" aria-label="命令与 Skill">${icon('spark')}</button>
      ${isWs ? `<button class="ghost-btn" data-action="toggle-plan-mode" data-tip="计划模式" aria-label="计划模式" aria-pressed="${state.planMode}">${icon('listChecks')}</button>` : ''}
      <button class="model" data-action="model" aria-haspopup="dialog">${modelLabel()}</button>
      <button class="send magnetic ${live ? 'stop' : ''}" aria-label="${live ? '停止生成' : '发送'}" data-tip="${live ? '停止生成' : '发送  ↵'}">${icon(live ? 'stop' : 'arrowUp', 'sm')}</button>
    </div></div>`;
}
function refreshAttach() { const a = $('#composer-attach'); if (a) a.innerHTML = attachHTML(); $$('[data-action="toggle-plan-mode"][aria-pressed]').forEach(b => b.setAttribute('aria-pressed', state.planMode)); }

/* ---------------------------------------------------------------- 斜杠菜单 */
function slashItems() {
  const q = state.slash.q.toLowerCase();
  const isWs = state.route.page !== 'chat' && state.route.page !== 'chat-home';
  return DATA.slash.filter(x => (!x.ws || isWs) && (!q || x.name.toLowerCase().includes(q) || x.desc.includes(q)));
}
function ringSVG(v) {
  const c = 2 * Math.PI * 7;
  return `<svg class="ctx-ring" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" class="bg"/><circle cx="9" cy="9" r="7" class="fg" stroke-dasharray="${c * v} ${c}"/></svg>`;
}
function renderSlash() {
  const el = $('#slash');
  if (!el) return;
  if (!state.slash.open) { el.hidden = true; el.classList.remove('show'); return; }
  const items = slashItems();
  state.slash.idx = Math.min(state.slash.idx, Math.max(0, items.length - 1));
  let last = '';
  const rows = items.map((x, i) => {
    const head = x.group !== last ? `<div class="slash-group">${x.group}</div>` : '';
    last = x.group;
    return head + `<div class="slash-item ${i === state.slash.idx ? 'on' : ''}" role="option" aria-selected="${i === state.slash.idx}" data-slash="${i}">
      <span class="slash-ic">${icon(x.icon, 'sm')}</span>
      <span class="slash-main"><span class="slash-name">${esc(x.name)}</span><span class="slash-desc">${esc(x.desc)}</span></span>
      ${x.ring ? `<span class="slash-side" data-tip="上下文已用 ${Math.round(x.ring * 100)}%">${ringSVG(x.ring)}<span class="num">${Math.round(x.ring * 100)}%</span></span>` : ''}
      ${x.src ? `<span class="src-tag">${esc(x.src)}</span>` : ''}
      ${x.id === 'plan' && state.planMode ? `<span class="src-tag on">已开启</span>` : ''}
    </div>`;
  }).join('');
  el.innerHTML = `<div class="slash-list" id="slash-list">${rows || `<div class="slash-empty">没有匹配「${esc(state.slash.q)}」的命令或 Skill</div>`}</div>
    <div class="slash-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 确认</span><span><kbd>esc</kbd> 关闭</span><span class="grow"></span><span>Skill 只作用于这一条消息</span></div>`;
  if (el.hidden) { el.hidden = false; requestAnimationFrame(() => el.classList.add('show')); }
}
function openSlash(q = '') { state.slash = {open: true, q, idx: 0}; renderSlash(); }
function closeSlash() { if (!state.slash.open) return; state.slash.open = false; const el = $('#slash'); if (el) { el.classList.remove('show'); setTimeout(() => { if (!state.slash.open) el.hidden = true; }, 160); } }
function moveSlash(d) {
  const items = slashItems();
  if (!items.length) return;
  state.slash.idx = (state.slash.idx + d + items.length) % items.length;
  $$('.slash-item').forEach((r, i) => { r.classList.toggle('on', i === state.slash.idx); r.setAttribute('aria-selected', i === state.slash.idx); });
  // 键盘越出可视范围时只做最小滚动
  const row = $(`.slash-item[data-slash="${state.slash.idx}"]`), list = $('#slash-list');
  if (row && list) {
    const top = row.offsetTop - list.offsetTop, bottom = top + row.offsetHeight;
    if (top < list.scrollTop + 26) list.scrollTop = Math.max(0, top - 26);
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
  }
}
function pickSlash(i = state.slash.idx) {
  const x = slashItems()[i];
  const ta = $('#composer-input');
  if (ta) ta.value = ta.value.replace(/(^|\s)\/\S*$/, '$1');
  closeSlash();
  if (!x) return;
  if (x.group === 'Skill') { state.composerSkill = x; refreshAttach(); }
  else if (x.id === 'plan') { state.planMode = !state.planMode; refreshAttach(); }
  else if (x.id === 'compact') toast('正在压缩上下文，会话历史保留', 'layers');
  else if (x.id === 'attach') simulateDrop();
  ta?.focus();
}
document.addEventListener('input', e => {
  if (e.target.id !== 'composer-input') return;
  const ta = e.target;
  ta.style.height = 'auto'; ta.style.height = Math.min(180, ta.scrollHeight) + 'px';
  const before = ta.value.slice(0, ta.selectionStart);
  const m = before.match(/(?:^|\s)\/(\S*)$/);
  if (m) { if (!state.slash.open || state.slash.q !== m[1]) { state.slash = {open: true, q: m[1], idx: 0}; renderSlash(); } }
  else closeSlash();
});
document.addEventListener('keydown', e => {
  if (e.target.id !== 'composer-input') return;
  if (e.isComposing) return;
  if (state.slash.open) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSlash(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSlash(-1); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSlash(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSlash(); }
    return;
  }
  if (e.key === 'Backspace' && !e.target.value && state.composerSkill) { state.composerSkill = null; refreshAttach(); }
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); if (e.target.value.trim() || state.composerSkill) toast('原型：已发送（示例不产生回复）', 'arrowUp'); }
});
document.addEventListener('mousemove', e => {
  // 鼠标只改变高亮，不滚动列表
  const row = e.target.closest?.('.slash-item');
  if (!row || row.classList.contains('on')) return;
  state.slash.idx = +row.dataset.slash;
  $$('.slash-item').forEach(r => { r.classList.toggle('on', r === row); r.setAttribute('aria-selected', r === row); });
});

/* ---------------------------------------------------------------- 模型菜单 */
let modelDraft = null;
function openModel(btn) {
  modelDraft = {...state.model, note: ''};
  const pop = $('#model-pop');
  pop.hidden = false;
  renderModel();
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.min(innerWidth - w - 12, Math.max(12, r.right - w)) + 'px';
  pop.style.top = (r.top - h - 8 < 12 ? r.bottom + 8 : r.top - h - 8) + 'px';
  pop.style.animation = 'none'; pop.offsetHeight; pop.style.animation = '';
  btn.setAttribute('aria-expanded', 'true');
}
function renderModel() {
  const d = modelDraft;
  const m = currentModel(d.id);
  const lv = m.levels;
  const cur = !d.think ? '关闭' : lv ? lv[d.level] : '开启';
  $('#model-pop').innerHTML = `
    <div class="model-list">${DATA.models.map(g => `
      <div class="model-group">${icon(g.mark, 'xs')}${g.vendor}</div>
      ${g.items.map(x => `<button class="model-row ${x.id === d.id ? 'on' : ''}" data-model="${x.id}" data-tip="输出上限 ${x.out}">
        <span class="mname">${x.name}</span><span class="mctx num">${x.ctx}</span>${x.id === d.id ? icon('check', 'xs mcheck') : '<span class="mcheck"></span>'}</button>`).join('')}`).join('')}
    </div>
    <div class="think">
      <div class="think-head"><b>思考</b><span class="think-cur">${cur}</span><span class="think-note">${esc(d.note)}</span>
        <button class="switch" role="switch" aria-checked="${d.think}" data-action="think-toggle" ${m.canOff ? '' : 'disabled'} data-tip="${m.canOff ? '开关思考' : '这个模型不能关闭思考'}" aria-label="思考"><span class="knob"></span></button></div>
      <div class="think-body ${d.think ? '' : 'off'}">
        ${lv ? `<div class="lv" role="slider" tabindex="0" aria-label="思考强度" aria-valuemin="0" aria-valuemax="${lv.length - 1}" aria-valuenow="${d.level}" aria-valuetext="${lv[d.level]}" style="--n:${lv.length - 1};--i:${d.level}">
            <span class="lv-fill"></span>${lv.map((t, i) => `<span class="lv-stop ${i <= d.level ? 'lit' : ''}" style="--k:${i}" data-tip="${t}"></span>`).join('')}<span class="lv-thumb"></span>
          </div>
          <div class="lv-labels" style="--n:${lv.length - 1}">${lv.map((t, i) => `<span style="--k:${i}" class="${i === d.level ? 'on' : ''}">${t}</span>`).join('')}</div>`
        : `<div class="lv-none">这个模型没有可选档位</div>`}
      </div>
    </div>`;
}
function setLevel(i) {
  const m = currentModel(modelDraft.id);
  if (!m.levels || !modelDraft.think) return;
  i = Math.max(0, Math.min(m.levels.length - 1, i));
  if (i === modelDraft.level) return;
  modelDraft.level = i; modelDraft.note = '';
  // 只更新属性，让拖柄与填充走弹性过渡
  const lv = $('.lv');
  lv.style.setProperty('--i', i); lv.setAttribute('aria-valuenow', i); lv.setAttribute('aria-valuetext', m.levels[i]);
  $$('.lv-stop').forEach((s, k) => s.classList.toggle('lit', k <= i));
  $$('.lv-labels span').forEach((s, k) => s.classList.toggle('on', k === i));
  $('.think-cur').textContent = m.levels[i];
  $('.think-note').textContent = '';
}
function closeModel() {
  const pop = $('#model-pop');
  if (pop.hidden) return;
  pop.hidden = true;
  $$('.model[aria-expanded]').forEach(b => b.removeAttribute('aria-expanded'));
  const {note, ...next} = modelDraft;
  const changed = JSON.stringify(next) !== JSON.stringify(state.model);
  modelDraft = null;
  if (!changed) return;
  state.model = next;
  $$('.model').forEach(b => { b.innerHTML = modelLabel(); });
  toast('下一次运行使用新的模型设置', 'check');
}
function chooseModel(id) {
  const prev = currentModel(modelDraft.id), next = currentModel(id);
  modelDraft.id = id; modelDraft.note = '';
  if (!next.canOff) modelDraft.think = true;
  if (next.levels) {
    const same = prev.levels && prev.levels[modelDraft.level] && next.levels.indexOf(prev.levels[modelDraft.level]);
    if (same >= 0) modelDraft.level = same;
    else { modelDraft.level = Math.floor((next.levels.length - 1) / 2); modelDraft.note = '已改用默认档'; }
  } else modelDraft.level = 0;
  renderModel();
}
document.addEventListener('pointerdown', e => {
  const lv = e.target.closest('.lv');
  if (!lv) return;
  e.preventDefault(); lv.focus();
  const n = +getComputedStyle(lv).getPropertyValue('--n');
  const at = ev => { const r = lv.getBoundingClientRect(); setLevel(Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left - 10) / (r.width - 20))) * n)); };
  at(e);
  lv.classList.add('dragging');
  const up = () => { lv.classList.remove('dragging'); removeEventListener('pointermove', at); removeEventListener('pointerup', up); };
  addEventListener('pointermove', at); addEventListener('pointerup', up);
});
document.addEventListener('keydown', e => {
  if (!e.target.classList?.contains('lv')) return;
  if (['ArrowRight', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setLevel(modelDraft.level + 1); }
  if (['ArrowLeft', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setLevel(modelDraft.level - 1); }
});

/* ---------------------------------------------------------------- 首页 */
function renderHome() {
  const r = state.route;
  const home = $('#home');
  if (r.page === 'chat-home') {
    home.innerHTML = `<h1>想完成什么？</h1><div class="sub">独立对话不读写任何工作区的文件和记忆。</div>${composerHTML('描述目标，或拖入材料', false)}`;
    bindMagnetic(home);
    return;
  }
  const ws = wsById(r.ws);
  const notice = ws.state === 'missing'
    ? `<div class="soft-link" style="background:var(--wait-soft);color:var(--wait);margin-bottom:18px">${icon('alert', 'sm')}原位置找不到这个文件夹，对话仍可继续，文件工具暂停 <button class="btn line" style="height:24px;margin-left:6px">重新定位</button></div>`
    : ws.state === 'archived' ? `<div class="soft-link" style="margin-bottom:18px">已归档，只读</div>` : '';
  const pend = pendingCount();
  home.innerHTML = `${notice}<h1>${esc(ws.name)}</h1><div class="sub">${esc(ws.folder)}</div>
    ${ws.state === 'archived' ? '' : composerHTML(`在${ws.name}里开始一个任务`, false)}
    <div class="home-links">
      ${pend && ws.id === 'review' ? `<button class="soft-link" data-href="#/ws/${ws.id}/context"><span class="dot"></span>背景有 ${pend} 项待处理</button>` : ''}
      ${ws.id === 'review' ? `<button class="soft-link" data-open-file="竞品对比表.xlsx">${fileGlyph('x.xlsx')}竞品对比表.xlsx</button>` : ''}
    </div>
    <div class="recent"><div class="list-label">最近对话</div>
      ${ws.sessions.map(s => `<button class="row" data-href="#/ws/${ws.id}/${s.id}"><span class="row-title">${esc(s.title)}</span><span class="row-meta">${s.time}</span></button>`).join('')}
    </div>`;
  bindMagnetic(home);
}

/* ---------------------------------------------------------------- 右侧检查器 */
function inspectorShell(independent) {
  return `<section class="sheet inspector ${state.insp.open ? '' : 'closed'}" id="insp" aria-label="右侧面板">
    <div class="resize" id="resize" role="separator" aria-label="调整宽度"></div>
    <div class="insp-head"><div class="seg on-sheet" role="tablist" id="insp-seg">
      ${independent ? '' : segBtn('folder', 'folder', '文件夹')}
      ${segBtn('output', 'inbox', '成果')}
      ${segBtn('view', 'eye', '查看')}
      ${independent ? '' : segBtn('changes', 'history', '修改')}
    </div><div class="top-spacer"></div>
    <button class="ghost-btn" data-tip="在 Finder 中显示" aria-label="在 Finder 中显示">${icon('finder', 'sm')}</button></div>
    <div class="insp-body" id="insp-body"></div>
    <div id="insp-foot"></div></section>`;
}
function renderInspector() {
  const insp = $('#insp');
  if (!insp) return;
  insp.classList.toggle('closed', !state.insp.open);
  const independent = state.route.page === 'chat';
  if (independent && ['folder', 'changes'].includes(state.insp.tab)) state.insp.tab = 'output';
  $$('#insp-seg .seg-btn').forEach(b => {
    b.dataset.view = b.dataset.view; b.setAttribute('aria-selected', b.dataset.view === state.insp.tab);
  });
  const body = $('#insp-body');
  const foot = $('#insp-foot');
  foot.innerHTML = '';
  if (state.insp.preview) { body.innerHTML = previewHTML(state.insp.preview); return; }
  const tab = state.insp.tab;
  if (tab === 'folder') {
    body.innerHTML = state.tree.map((d, di) => `
      <button class="tree-row dir ${d.open ? 'open' : ''}" data-dir="${di}">${icon('chevronRight', 'chev')}${icon(d.open ? 'folderOpen' : 'folder', 'sm')}<span class="nm">${d.name}</span></button>
      <div class="collapse ${d.open ? 'open' : ''}"><div>${d.children.filter(f => !(f.name === '竞品对比表.xlsx' && state.route.page === 'session' && state.scenario !== 'done')).map(f => `
        <button class="tree-row child" data-open-file="${f.name}">${fileGlyph(f.name)}<span class="nm">${esc(f.name)}</span>
          ${f.used && state.route.page === 'session' ? '<span class="used">本次读取</span>' : ''}${f.fresh ? '<span class="fresh">新</span>' : ''}
          <span class="idx ${f.index}" title="${{ready: '可检索', ocr: '待文字识别', pending: '处理中'}[f.index]}"></span></button>`).join('')}</div></div>`).join('');
    const files = state.tree.flatMap(d => d.children);
    const ready = files.filter(f => f.index === 'ready').length;
    foot.innerHTML = `<div class="insp-foot" data-tip="索引详情在「知识」"><span class="num">可检索 ${ready}/${files.length}</span><span class="meter"><span style="width:${ready / files.length * 100}%"></span></span><span>${files.length - ready} 份处理中</span></div>`;
  } else if (tab === 'output') {
    body.innerHTML = state.route.page === 'chat'
      ? `<div class="section-cap">本次对话</div><div class="change-row">${fileGlyph('a.md')}<span>周会纪要.md</span><span class="op">交付</span></div>`
      : `<div class="section-cap">本次交付</div><button class="change-row" style="width:100%" data-open-file="竞品对比表.xlsx">${fileGlyph('x.xlsx')}<span>竞品对比表.xlsx</span><span class="op">交付版本</span></button>`;
  } else if (tab === 'view') {
    const i = state.insp.step ?? 4;
    const s = DATA.steps[i];
    body.innerHTML = `<div class="section-cap">${s.verb} · ${esc(s.obj)}</div>
      <div class="preview-paper mono" style="background:var(--sheet-2);white-space:pre-wrap">${i === 4 ? '$ python build_table.py --out 成果/竞品对比表.xlsx\n读取 2 份材料 … 完成\n写入 4 行 × 3 列\n已保存 成果/竞品对比表.xlsx (9.1 KB)' : i === 3 ? '命中 4 处\n· 竞品-A.pdf 第 5 页\n· 竞品-B.pdf 第 3 页\n· 渠道访谈纪要.md 第 2 节\n· 会话摘要：定价策略讨论' : '已读取，共 ' + (i === 1 ? 9 : 6) + ' 页文本'}</div>`;
  } else {
    body.innerHTML = `<div class="section-cap">最近修改</div>
      <div class="change-row">${icon('pencil', 'sm')}<div><div>整理竞品表</div><div style="color:var(--ink-3);font-size:12px">新建 1 个文件 · 14:34</div></div><button class="btn quiet" style="margin-left:auto" data-action="undo-run">撤销</button></div>`;
  }
}
function previewHTML(name) {
  const cite = Object.values(DATA.citations).find(c => c.file === name);
  const body = cite
    ? `<div class="pg">${cite.loc}</div><p>……本节说明价格结构与渠道合作条款。</p><p class="hl">${cite.text}</p><p>其余条款与上一版本一致，合作伙伴等级每年复核一次……</p>`
    : name.endsWith('.xlsx')
      ? `<div class="table-wrap" style="margin:0;background:var(--sheet)"><table><tr><th>维度</th><th>A</th><th>B</th></tr><tr><td>价格</td><td>¥4,800/年</td><td>¥420/月</td></tr><tr><td>返点</td><td>12%</td><td>未公开</td></tr></table></div>`
      : `<p>（${esc(name)} 的预览样张）</p>`;
  return `<div class="preview-pane">
    <div style="display:flex;align-items:center;gap:8px">
      <button class="ghost-btn" data-action="close-preview" aria-label="返回" data-tip="返回">${icon('chevronRight', 'sm')}</button>
      ${fileGlyph(name)}<b style="font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</b>
      <button class="ghost-btn" data-tip="放大" aria-label="放大">${icon('maximize', 'sm')}</button></div>
    <div class="preview-paper">${body}</div></div>`;
}

/* ---------------------------------------------------------------- 背景页 */
function orderedMemories() {
  return [...state.memories].sort((a, b) => (a.pinned ? 0 : 1) - (b.pinned ? 0 : 1) || TYPE_RANK[a.type] - TYPE_RANK[b.type] || a.rank - b.rank);
}
function memHTML(m, i) {
  return `<div class="mem" data-mem="${m.id}" data-flip="${m.id}">
    <span class="handle" data-tip="拖到上方钉住" aria-label="拖动">${icon('grip', 'sm')}</span>
    <div class="mem-body"><div class="mem-text">${esc(m.text)}</div>
      <div class="mem-meta">${m.pinned ? `<span class="tag pin">${icon('pin')}钉住</span>` : ''}<span class="tag">${m.type}</span>
        <button class="src-link">${m.source === '你添加' ? '你添加' : '来自 ' + esc(m.source)}</button><span>${m.when}</span></div></div>
    <div class="mem-acts">
      <button class="ghost-btn" data-pin="${m.id}" data-tip="${m.pinned ? '取消钉住' : '钉住'}" aria-label="钉住">${icon('pin')}</button>
      <button class="ghost-btn" data-tip="编辑" aria-label="编辑">${icon('pencil')}</button>
      <button class="ghost-btn" data-retract="${m.id}" data-tip="撤回" aria-label="撤回">${icon('x')}</button>
    </div></div>`;
}
function renderContext() {
  const el = $('#ctx');
  const ordered = orderedMemories();
  const pinned = ordered.filter(m => m.pinned);
  const rest = ordered.filter(m => !m.pinned);
  const residentN = Math.min(RESIDENT_LIMIT, ordered.length);
  const cutIndex = RESIDENT_LIMIT - pinned.length; // rest 中第几条之后不再常驻
  const restHTML = rest.map((m, i) => (i === cutIndex ? `<div class="cutline" data-flip="cutline"><span>以下 ${rest.length - cutIndex} 条不常驻，任务相关时检索召回</span></div>` : '') + memHTML(m, i)).join('');
  const S = state.style;
  const p = state.proposal;
  el.innerHTML = `
    <div class="ctx-head"><div><h1>背景</h1><p>在这个工作区开始新任务时，Agent 会先带上这些。</p></div>
      <div class="ctx-sum"><div><b>v${S.version}</b>工作方式</div><div><b>${residentN}/${RESIDENT_LIMIT}</b>常驻记忆</div><div><b style="color:${pendingCount() ? 'var(--wait)' : 'inherit'}">${pendingCount()}</b>待处理</div></div></div>

    <section class="block" id="style-block">
      <div class="block-head"><h2>工作方式</h2><span class="ver">v${S.version}</span>
        <div class="tools"><button class="ghost-btn" data-action="style-history" data-tip="版本历史" aria-label="版本历史">${icon('history', 'sm')}</button>
        <button class="ghost-btn" data-action="edit-style" data-tip="编辑" aria-label="编辑">${icon('pencil', 'sm')}</button></div></div>
      <div class="style-doc" id="style-doc">${S.html || esc(S.text)}</div>
      <div class="style-meta"><span>${S.updated}</span><span>修改从下一次运行生效，进行中的任务保留原版本</span></div>
      ${p ? `<div class="proposal" id="proposal">
        <div class="proposal-head">${icon('wand', 'sm')}<span><b>Agent 建议补充</b> · 来自「${esc(p.from)}」</span></div>
        <div class="diff">${diffHTML(p.before, p.after)}</div>
        <div class="proposal-acts"><button class="btn primary magnetic" data-action="accept-proposal">接受</button><button class="btn quiet" data-action="edit-proposal">改一下再接受</button><button class="btn quiet" data-action="dismiss-proposal">忽略</button></div>
      </div>` : ''}
    </section>

    <section class="block" id="mem-block">
      <div class="block-head"><h2>记忆</h2><span class="ver">${state.memories.length} 条</span>
        <div class="tools">
          <button class="switch" role="switch" aria-checked="${state.autoMemory}" data-action="auto-memory"><span>任务结束后自动记住</span><span class="knob"></span></button>
          <button class="ghost-btn" data-tip="添加一条" aria-label="添加">${icon('plus', 'sm')}</button></div></div>

      ${state.candidates.map(c => {
        const old = state.memories.find(m => m.id === c.conflictWith);
        return `<div class="candidate" data-cand="${c.id}">
          <div class="candidate-head">${icon('alert', 'sm')}${esc(c.reason)}</div>
          <div class="versus"><div><div class="lab">已保存</div><div class="txt">${esc(old ? old.text : '')}</div></div>
            <div class="new"><div class="lab">「${esc(c.source)}」里新发现</div><div class="txt">${esc(c.text)}</div></div></div>
          <div class="proposal-acts"><button class="btn primary" data-cand-accept="${c.id}">采用新的</button><button class="btn quiet" data-cand-reject="${c.id}">保留原来的</button></div></div>`;
      }).join('')}

      <div class="lane" data-lane="pinned"><div class="lane-head"><h3>钉住</h3><span class="hint">每次都带上，排在最前</span><span class="cap"><b>${pinned.length}</b> 条</span></div>
        <div class="lane-slot"></div>
        ${pinned.map(memHTML).join('') || '<div class="lane-empty">把常用的记忆拖到这里</div>'}</div>
      <div class="lane" data-lane="rest"><div class="lane-head"><h3>其余</h3><span class="hint">按 约束 → 偏好 → 决定 → 事实、再按最近使用排序，前 ${RESIDENT_LIMIT} 条常驻</span></div>
        <div class="lane-slot"></div>
        ${restHTML}</div>
    </section>`;
  bindMagnetic(el);
}

// 只标出真正变化的片段：公共前后缀保持原样
function diffHTML(a, b) {
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  let j = 0; while (j < a.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const del = a.slice(i, a.length - j), ins = b.slice(i, b.length - j);
  return `<span style="color:var(--ink-3)">…</span>${esc(a.slice(0, i))}${del ? `<del>${esc(del)}</del>` : ''}${ins ? `<ins>${esc(ins)}</ins>` : ''}${esc(a.slice(a.length - j))}<span style="color:var(--ink-3)">…</span>`;
}

/* ================================================================ 动作 */
function render() {
  state.route = parseHash();
  if (state.route.ws) state.expanded[state.route.ws] = true;
  renderList(); renderTop(); renderStage(); syncRail();
  $$('[data-scenario]').forEach(b => b.classList.toggle('on', b.dataset.scenario === state.scenario || (state.scenario === 'resume' && b.dataset.scenario === 'running')));
}
function setScenario(s) {
  state.scenario = s;
  state.approved = false;
  if (state.route.page !== 'session' || state.route.session !== 's1') go('#/ws/review/s1');
  renderList(); refreshStage();
  render();
}

const narrow = matchMedia('(max-width: 1100px)');
if (narrow.matches) state.list = 'closed';
if (matchMedia('(max-width: 1180px)').matches) state.insp.open = false;
narrow.addEventListener('change', () => { state.list = narrow.matches ? 'closed' : 'open'; renderList(); renderTop(); });
document.addEventListener('click', e => {
  // 窄窗口里列表是抽屉：点列表以外或在列表里导航后收起
  if (narrow.matches && state.list === 'open' && (!e.target.closest('.list, [data-action="toggle-list"]') || e.target.closest('.list [data-href], .list .ws-row'))) {
    setTimeout(() => { state.list = 'closed'; renderList(); renderTop(); }, e.target.closest('.list') ? 120 : 0);
  }
  if (!e.target.closest('#model-pop, .model')) closeModel();
  if (!e.target.closest('.slash, #composer-input, [data-action="slash-open"]')) closeSlash();
  const row = e.target.closest('.slash-item');
  if (row) return pickSlash(+row.dataset.slash);
  const t = e.target.closest('button, [data-open-file], [data-href], .cite, .step');
  if (!t) { closePopover(); return; }
  hideTip();
  if (!t.closest('#popover') && !t.classList.contains('cite')) closePopover();
  if (t.dataset.scenario) return setScenario(t.dataset.scenario);
  if (t.dataset.reviewAction === 'theme' || t.dataset.action === 'theme') return toggleTheme();
  if (t.dataset.reviewAction === 'hide') return $('#review-bar').classList.toggle('hidden');
  if (t.dataset.reviewAction === 'drop') return simulateDrop();
  if (t.classList.contains('cite')) return openCite(t);
  if (t.classList.contains('step')) { state.insp.open = true; state.insp.tab = 'view'; state.insp.step = +t.dataset.step; state.insp.preview = null; renderInspector(); renderTop(); return; }
  if (t.dataset.view && t.closest('#ws-seg')) {
    const ws = state.route.ws;
    return go(t.dataset.view === 'chat' ? `#/ws/${ws}/${state.lastSession?.[ws] || 's1'}` : `#/ws/${ws}/${t.dataset.view}`);
  }
  if (t.dataset.view && t.closest('#insp-seg')) { state.insp.tab = t.dataset.view; state.insp.preview = null; return renderInspector(); }
  if (t.dataset.wsToggle) {
    const id = t.dataset.wsToggle;
    if (state.route.ws === id && state.route.page === 'ws-home') { state.expanded[id] = !state.expanded[id]; return renderList(); }
    state.expanded[id] = true;
    return go(`#/ws/${id}`);
  }
  if (t.dataset.dir !== undefined) {
    const d = state.tree[+t.dataset.dir]; d.open = !d.open;
    t.classList.toggle('open', d.open); t.nextElementSibling.classList.toggle('open', d.open);
    t.querySelector('.ic:nth-of-type(2)').outerHTML = icon(d.open ? 'folderOpen' : 'folder', 'sm');
    return;
  }
  if (t.dataset.openFile) { e.stopPropagation(); return openFile(t.dataset.openFile); }
  if (t.dataset.href) { closePopover(); return go(t.dataset.href); }
  if (t.dataset.pin) return togglePin(t.dataset.pin);
  if (t.dataset.retract) return retract(t.dataset.retract);
  if (t.dataset.candAccept || t.dataset.candReject) return resolveCandidate(t.dataset.candAccept || t.dataset.candReject, !!t.dataset.candAccept);
  if (t.dataset.dropTarget) return finishDrop(t.dataset.dropTarget, ['竞品-C 报价单.pdf']);
  if (t.dataset.dirPick) { $$('[data-dir-pick]').forEach(x => x.classList.toggle('on', x === t)); e.stopPropagation(); return; }
  if (t.dataset.model) return chooseModel(t.dataset.model);
  switch (t.dataset.action) {
    case 'model': return $('#model-pop').hidden ? openModel(t) : closeModel();
    case 'think-toggle': modelDraft.think = !modelDraft.think; modelDraft.note = ''; return renderModel();
    case 'toggle-plan': {
      state.planOpen = !state.planOpen;
      const p = $('#plan'); p.classList.toggle('open', state.planOpen);
      p.querySelector('.plan-pop').toggleAttribute('inert', !state.planOpen);
      t.setAttribute('aria-expanded', state.planOpen); t.setAttribute('aria-label', state.planOpen ? '收起计划' : '展开计划');
      return;
    }
    case 'plan-history': return toast('演示：打开只读的历史清单', 'history');
    case 'slash-open': { const ta = $('#composer-input'); ta.focus(); if (!/(^|\s)$/.test(ta.value)) ta.value += ' '; ta.value += '/'; return openSlash(''); }
    case 'clear-skill': state.composerSkill = null; refreshAttach(); return;
    case 'toggle-plan-mode': state.planMode = !state.planMode; refreshAttach(); return toast(state.planMode ? '计划模式：先制定方案，不执行写入和命令' : '已退出计划模式', 'listChecks');
    case 'attach': return simulateDrop();
    case 'new': return go(railOf(state.route) === 'workspaces' ? `#/ws/${state.route.ws || 'review'}` : '#/chat');
    case 'new-chat': return go('#/chat');
    case 'add-ws': return toast('演示：选择新建文件夹或打开已有文件夹', 'folder');
    case 'skill-add': return openSkillAdd();
    case 'toggle-list': state.list = state.list === 'open' ? 'closed' : 'open'; renderList(); renderTop(); return;
    case 'toggle-insp': state.insp.open = !state.insp.open; renderInspector(); renderTop(); return;
    case 'toggle-process': state.processOpen = !state.processOpen; animateToggle($('#process'), state.processOpen); return;
    case 'toggle-refs': state.refsOpen = !state.refsOpen; t.setAttribute('aria-expanded', state.refsOpen); $('#refs').classList.toggle('open', state.refsOpen);
      if (state.refsOpen) setTimeout(() => $('#refs').scrollIntoView({behavior: reduced ? 'auto' : 'smooth', block: 'nearest'}), 260); return;
    case 'show-remembered': return openRemembered(t);
    case 'undo-run': return openUndo();
    case 'settings': return openSettings();
    case 'style-history': return openStyleHistory();
    case 'edit-proposal': return editProposal();
    case 'approve': return approve();
    case 'deny': state.scenario = 'done'; refreshStage(); return toast('已拒绝，理由会交回 Agent', 'x');
    case 'close-preview': state.insp.preview = null; return renderInspector();
    case 'accept-proposal': return acceptProposal();
    case 'dismiss-proposal': return dismissProposal();
    case 'edit-style': return editStyle(t);
    case 'auto-memory': state.autoMemory = !state.autoMemory; t.setAttribute('aria-checked', state.autoMemory); return toast(state.autoMemory ? '已开启自动记住' : '已关闭；已保存的记忆不受影响', 'bookmark');
    case 'quote': state.quotes.push(t.dataset.q); closePopover(); renderDock(); return;
  }
});
window.addEventListener('hashchange', () => { if (state.route.page === 'session') (state.lastSession ||= {})[state.route.ws] = state.route.session; render(); });

function animateToggle(el, open) {
  el.classList.toggle('open', open);
  el.querySelector('.collapse').classList.toggle('open', open);
  el.querySelector('.process-head').setAttribute('aria-expanded', open);
}
function approve() {
  state.scenario = 'resume';
  refreshStage(); renderList();
  toast('已批准这一次调用', 'check');
  setTimeout(() => { if (state.scenario !== 'resume') return; state.scenario = 'done'; state.processOpen = false; refreshStage(); renderList(); render(); }, 2600);
}
function openFile(name) {
  state.insp.open = true; state.insp.preview = name;
  if (!$('#insp')) return toast('预览 ' + name, 'eye');
  renderInspector(); renderTop();
}

/* ---------------------------------------------------------------- 引用浮层 */
function openCite(el) {
  const c = DATA.citations[el.dataset.cite];
  $$('.cite.active').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  const pop = $('#popover');
  pop.innerHTML = `<div class="pop-head">${fileGlyph(c.file)}<b style="font-weight:500">${c.file}</b><span class="loc">${c.loc}</span></div>
    <div class="pop-snippet">${c.text}</div>
    <div class="pop-acts"><button class="btn line" data-open-file="${c.file}">${icon('eye', 'sm')}打开原文</button><button class="btn quiet" data-action="quote" data-q="${c.file} ${c.loc}">${icon('quote', 'sm')}引用到输入</button></div>`;
  placePopover(pop, el);
}
function openRemembered(el) {
  const pop = $('#popover');
  pop.innerHTML = `<div class="pop-head">${icon('bookmark', 'sm')}<b style="font-weight:500">这次记住了</b><span class="loc">自动记住</span></div>
    ${state.remembered.map(id => { const m = state.memories.find(x => x.id === id); return m ? `<div class="mem" style="padding:8px 0"><div class="mem-body"><div class="mem-text" style="font-size:13px">${esc(m.text)}</div></div><button class="btn quiet" data-retract="${m.id}">撤回</button></div>` : ''; }).join('')}
    <div class="pop-acts" style="margin-top:6px"><button class="btn line" data-href="#/ws/review/context">在背景中查看</button></div>`;
  placePopover(pop, el);
}
function placePopover(pop, anchor) {
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = 340;
  let left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
  pop.style.left = left + 'px';
  pop.style.top = '0px';
  const h = pop.offsetHeight;
  pop.style.top = (r.bottom + 8 + h > innerHeight - 12 ? r.top - h - 8 : r.bottom + 8) + 'px';
  pop.style.animation = 'none'; pop.offsetHeight; pop.style.animation = '';
}
function closePopover() { $('#popover').hidden = true; $$('.cite.active').forEach(x => x.classList.remove('active')); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closePopover(); hideDrop(); closeModel(); if (state.planOpen) $('[data-action="toggle-plan"]')?.click(); } });

/* ---------------------------------------------------------------- 背景页动作 */
function withFlip(fn) {
  const before = new Map($$('[data-flip]').map(el => [el.dataset.flip, el.getBoundingClientRect()]));
  fn();
  if (reduced) return;
  $$('[data-flip]').forEach(el => {
    const b = before.get(el.dataset.flip);
    const a = el.getBoundingClientRect();
    if (!b) { el.animate([{opacity: 0, transform: 'scale(.98)'}, {opacity: 1, transform: 'none'}], {duration: 320, easing: 'cubic-bezier(.22,.8,.3,1)'}); return; }
    const dy = b.top - a.top;
    if (Math.abs(dy) < 1) return;
    el.animate([{transform: `translateY(${dy}px)`}, {transform: 'none'}], {duration: 520, easing: 'cubic-bezier(.34,1.3,.55,1)'});
  });
}
function togglePin(id, force) {
  const m = state.memories.find(x => x.id === id);
  const next = force ?? !m.pinned;
  if (m.pinned === next) return;
  withFlip(() => { m.pinned = next; renderContext(); });
  toast(next ? '已钉住，下次运行排在最前' : '已取消钉住', 'pin', () => withFlip(() => { m.pinned = !next; renderContext(); }));
}
function retract(id) {
  const m = state.memories.find(x => x.id === id);
  if (!m) return;
  closePopover();
  const el = $(`.mem[data-mem="${id}"]`);
  const doIt = () => {
    const idx = state.memories.indexOf(m);
    withFlip(() => { state.memories = state.memories.filter(x => x !== m); state.remembered = state.remembered.filter(x => x !== id); refreshStage(); });
    toast('已撤回这条记忆', 'x', () => withFlip(() => { state.memories.splice(idx, 0, m); refreshStage(); }));
  };
  if (el && !reduced) { el.classList.add('retracting'); setTimeout(doIt, 220); } else doIt();
}
function resolveCandidate(id, accept) {
  const c = state.candidates.find(x => x.id === id);
  const card = $(`[data-cand="${id}"]`);
  card.classList.add('proposal', 'leaving');
  setTimeout(() => withFlip(() => {
    state.candidates = state.candidates.filter(x => x !== c);
    if (accept) { const old = state.memories.find(m => m.id === c.conflictWith); if (old) { old.text = c.text; old.when = '刚刚'; old.source = c.source; } }
    renderContext(); renderTop(); syncRail();
  }), 220);
  toast(accept ? '已采用新的，旧条目被替代' : '已保留原来的', 'check');
}
function acceptProposal() {
  const card = $('#proposal');
  card.classList.add('leaving');
  setTimeout(() => withFlip(() => {
    const p = state.proposal;
    state.style.version += 1;
    state.style.text = state.style.text.replace(p.before, p.after);
    state.style.html = esc(state.style.text).replace(esc(p.after), `<span class="ins">${esc(p.after)}</span>`);
    state.style.updated = '刚刚 · 接受了 Agent 的建议';
    state.proposal = null;
    renderContext(); renderTop(); syncRail();
  }), 220);
  toast(`工作方式已更新到 v${state.style.version + 1}`, 'check');
}
function dismissProposal() {
  $('#proposal').classList.add('leaving');
  setTimeout(() => withFlip(() => { state.proposal = null; renderContext(); renderTop(); syncRail(); }), 220);
}
function editStyle(btn) {
  const doc = $('#style-doc');
  const on = doc.getAttribute('contenteditable') === 'true';
  if (on) {
    doc.removeAttribute('contenteditable');
    state.style.text = doc.innerText.trim(); state.style.html = null;
    state.style.version += 1; state.style.updated = '刚刚 · 你编辑';
    renderContext(); toast(`已保存为 v${state.style.version}`, 'check');
  } else {
    doc.setAttribute('contenteditable', 'true'); doc.focus();
    btn.innerHTML = icon('check', 'sm'); btn.dataset.tip = '保存';
  }
}

/* ---------------------------------------------------------------- 记忆拖拽：拖进「钉住」即钉住 */
let drag = null;
document.addEventListener('pointerdown', e => {
  const h = e.target.closest('.mem .handle');
  if (!h) return;
  e.preventDefault();
  const mem = h.closest('.mem');
  const m = state.memories.find(x => x.id === mem.dataset.mem);
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = m.text;
  document.body.append(ghost);
  mem.classList.add('dragging-src');
  $$('.lane').forEach(l => l.classList.add('drop-ready'));
  drag = {m, mem, ghost, from: m.pinned ? 'pinned' : 'rest', lane: null};
  moveGhost(e);
});
document.addEventListener('pointermove', e => { if (drag) moveGhost(e); });
function moveGhost(e) {
  const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest('.lane');
  const target = lane && lane.dataset.lane !== drag.from ? lane : null;
  if (target !== drag.lane) {
    $$('.lane').forEach(l => l.classList.toggle('drop-over', l === target));
    drag.lane = target;
  }
  // 进入可放置区域时，幽灵块吸向落点并回正
  let x = e.clientX + 14, y = e.clientY - 18, rot = -1.5, sc = 1;
  if (target) {
    const slot = target.querySelector('.lane-slot').getBoundingClientRect();
    x = x + (slot.left + 8 - x) * .35; y = y + (slot.top - y) * .25; rot = 0; sc = 1.02;
  }
  drag.ghost.style.left = x + 'px';
  drag.ghost.style.top = y + 'px';
  drag.ghost.style.transform = `rotate(${rot}deg) scale(${sc})`;
}
document.addEventListener('pointerup', () => {
  if (!drag) return;
  const {m, mem, ghost, lane} = drag;
  drag = null;
  ghost.remove(); mem.classList.remove('dragging-src');
  $$('.lane').forEach(l => l.classList.remove('drop-ready', 'drop-over'));
  if (lane) togglePin(m.id, lane.dataset.lane === 'pinned');
});

/* ---------------------------------------------------------------- 拖入文件：两个磁吸落点 */
function dropzoneHTML() {
  const isWs = state.route.page !== 'chat' && state.route.page !== 'chat-home';
  return `<div class="dropzone" id="dropzone" style="${isWs ? '' : 'grid-template-columns:1fr'}">
    <button class="drop-target" data-drop-target="attach">${icon('clip')}<b>随这条消息发给 Agent</b><span class="hint">${isWs ? '复制进工作区文件夹，作为这条消息的附件' : '放进本次对话的工作目录'}</span></button>
    ${isWs ? `<button class="drop-target" data-drop-target="folder">${icon('folder')}<b>只加入文件夹</b><span class="hint">之后的任务都能检索到</span>
      <span class="dir-pick">${state.tree.map((d, i) => `<span data-dir-pick="${i}" class="${i === 0 ? 'on' : ''}">${d.name}/</span>`).join('')}</span></button>` : ''}
  </div>`;
}
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (![...e.dataTransfer.types].includes('Files')) return; dragDepth++; showDrop(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; hideDrop(); } });
window.addEventListener('dragover', e => {
  e.preventDefault();
  const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.drop-target');
  $$('.drop-target').forEach(x => x.classList.toggle('over', x === t));
  const pick = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dir-pick]');
  if (pick) $$('[data-dir-pick]').forEach(x => x.classList.toggle('on', x === pick));
});
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0;
  const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('.drop-target');
  const names = [...e.dataTransfer.files].map(f => f.name);
  if (t && names.length) finishDrop(t.dataset.dropTarget, names); else hideDrop();
});
function showDrop() { const dz = $('#dropzone'); if (dz) dz.classList.add('show'); }
function hideDrop() { const dz = $('#dropzone'); if (dz) { dz.classList.remove('show'); $$('.drop-target').forEach(x => x.classList.remove('over')); } }
function simulateDrop() {
  if (!$('#dropzone')) go('#/ws/review/s1');
  setTimeout(() => {
    showDrop();
    // 演示磁吸：指针滑过第一个落点
    const first = $('.drop-target');
    setTimeout(() => first && first.classList.add('over'), 500);
  }, 60);
}
function finishDrop(target, names) {
  const dirIdx = +($('[data-dir-pick].on')?.dataset.dirPick ?? 0);
  hideDrop();
  if (target === 'attach') {
    names.forEach(name => {
      const u = {id: Math.random().toString(36).slice(2), name, stage: 0};
      state.uploads.push(u);
      [700, 1500, 2400].forEach((ms, i) => setTimeout(() => { u.stage = i + 1; updateUpChip(u); }, ms));
    });
    renderDock(); renderHomeIfAny();
  } else {
    const dir = state.tree[dirIdx];
    dir.open = true;
    names.forEach(name => dir.children.push({name, index: 'pending', fresh: true}));
    state.insp.open = true; state.insp.tab = 'folder'; state.insp.preview = null;
    renderInspector(); renderTop();
    toast(`已加入 ${dir.name}/，正在建立索引`, 'folder');
    setTimeout(() => { names.forEach(n => { const f = dir.children.find(c => c.name === n); if (f) f.index = 'ready'; }); renderInspector(); }, 2600);
  }
}
function renderHomeIfAny() { if ($('#home')) renderHome(); }
function updateUpChip(u) {
  const el = $(`[data-up="${u.id}"]`);
  if (!el) return;
  el.classList.toggle('ready', u.stage === 3);
  el.querySelector('.stage-txt').textContent = ['上传中', '解析中', '建立索引', '可检索'][u.stage];
  el.querySelector('.bar').style.width = [30, 60, 85, 100][u.stage] + '%';
}

/* ================================================================ 微交互：提示、磁吸、拖宽、提示条 */
let tipTimer = null;
const tipEl = $('#tooltip');
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]');
  if (!t || drag) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    tipEl.textContent = t.dataset.tip;
    const r = t.getBoundingClientRect();
    const side = t.closest('.rail') ? 'right' : 'bottom';
    tipEl.style.transform = side === 'right' ? 'translateX(-4px)' : 'translateY(-3px)';
    tipEl.classList.remove('show');
    tipEl.style.left = '0px'; tipEl.style.top = '0px';
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    if (side === 'right') { tipEl.style.left = r.right + 10 + 'px'; tipEl.style.top = r.top + r.height / 2 - h / 2 + 'px'; }
    else {
      tipEl.style.left = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)) + 'px';
      tipEl.style.top = (r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
    }
    requestAnimationFrame(() => { tipEl.classList.add('show'); tipEl.style.transform = ''; });
  }, t.closest('.rail') ? 260 : 480);
});
document.addEventListener('mouseout', e => { if (e.target.closest('[data-tip]')) hideTip(); });
function hideTip() { clearTimeout(tipTimer); tipEl.classList.remove('show'); }

function bindMagnetic(root = document) {
  if (reduced) return;
  $$('.magnetic', root).forEach(el => {
    if (el._mag) return; el._mag = true;
    el.addEventListener('mousemove', e => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - r.left - r.width / 2) / r.width, dy = (e.clientY - r.top - r.height / 2) / r.height;
      el.style.transform = `translate(${dx * 6}px, ${dy * 5}px)`;
    });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; });
  });
}

document.addEventListener('pointerdown', e => {
  const h = e.target.closest('#resize');
  if (!h) return;
  e.preventDefault();
  h.classList.add('dragging');
  const insp = $('#insp');
  insp.style.transition = 'none';
  const startX = e.clientX, startW = insp.offsetWidth;
  const move = ev => document.documentElement.style.setProperty('--inspector-w', Math.min(560, Math.max(260, startW + startX - ev.clientX)) + 'px');
  const up = () => { h.classList.remove('dragging'); insp.style.transition = ''; removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});

function toast(text, ic = 'check', undo) {
  const host = $('#toast-host');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${icon(ic, 'sm')}<span>${esc(text)}</span>${undo ? '<button>撤销</button>' : '<span style="width:8px"></span>'}`;
  if (undo) el.querySelector('button').onclick = () => { undo(); dismiss(); };
  host.append(el);
  while (host.children.length > 2) host.firstChild.remove();
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  setTimeout(dismiss, undo ? 5200 : 2800);
}

function toggleTheme() {
  document.documentElement.classList.toggle('dark');
  renderRail(); syncRail();
}

/* ================================================================ 启动 */
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); $('.rail-new').click(); }
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); $('[data-action="toggle-list"]')?.click(); }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
});
if (new URLSearchParams(location.search).get('theme') === 'dark') document.documentElement.classList.add('dark');
const sc = new URLSearchParams(location.search).get('state');
if (sc) state.scenario = sc;
renderRail();
bindMagnetic(document);
render();

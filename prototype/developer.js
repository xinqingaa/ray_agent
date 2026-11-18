// 会话技术观察。所有记录与请求均来自原型夹具。
// 沿用早期原型的存储键，保留浏览器中已有的展示偏好。
const DEVELOPER_KEY = 'rayagent-v5:developer-mode';
let developerEnabled = false;
try { developerEnabled = localStorage.getItem(DEVELOPER_KEY) === 'true'; } catch {}

const LOG_SECTIONS = [['events', '事件'], ['turns', '轮次'], ['compaction', '压缩']];
const EVENT_TYPES = {message: '消息', model: '模型', tool: '工具', approval: '审批', compaction: '压缩', run: '运行'};
const logViews = new Map();
const tokenNumber = new Intl.NumberFormat('zh-CN');
const tokens = value => tokenNumber.format(value);
const isSession = () => ['session', 'chat'].includes(state.route.page);
const sessionKey = () => state.route.page === 'session' ? `${state.route.ws}/${state.route.session}` : state.route.chat;
const isReviewSession = () => sessionKey() === 'review/s1';

function logView() {
  const key = sessionKey();
  if (!logViews.has(key)) {
    logViews.set(key, {mode: 'chat', section: 'events', filter: 'all', scroll: {}, expanded: new Set(), request: null, compactions: []});
  }
  return logViews.get(key);
}

function setPrototypeDeveloperMode(enabled) {
  developerEnabled = enabled;
  try { localStorage.setItem(DEVELOPER_KEY, String(enabled)); } catch {}
  if (!enabled) {
    saveLogScroll();
    logViews.forEach(view => { view.mode = 'chat'; });
    closePopover();
  }
  if (isSession()) {
    const shellLabel = $('.step[data-step="4"] .step-obj');
    if (shellLabel) shellLabel.textContent = developerEnabled ? DATA.steps[4].obj : '生成对比表';
    syncSessionView();
    renderInspector();
    renderTop();
  }
}

function sessionViewsHTML() {
  return `<div class="session-head" id="session-head" hidden>
    <div class="seg on-sheet" role="group" aria-label="会话视图">
      <button class="seg-btn txt" data-session-mode="chat" aria-controls="chat-surface">${icon('chat', 'sm')}聊天</button>
      <button class="seg-btn txt" data-session-mode="logs" aria-controls="log-surface">${icon('list', 'sm')}日志</button>
    </div>
  </div>`;
}

function syncSessionView() {
  const head = $('#session-head');
  if (!head) return;
  const view = logView();
  const logs = developerEnabled && view.mode === 'logs';
  head.hidden = !developerEnabled;
  $$('[data-session-mode]', head).forEach(button => button.setAttribute('aria-pressed', button.dataset.sessionMode === view.mode));
  $('#chat-surface').hidden = logs;
  $('#log-surface').hidden = !logs;
  if (logs) renderLogs();
  renderContextAccessory();
}

function diagnosticRun() {
  const review = isReviewSession();
  if (!review && sessionKey() !== 'c1') return null;
  const scenario = review ? state.scenario : 'done';
  const count = {done: review ? 6 : 3, running: 4, approval: 4, resume: 5, denied: 4}[scenario];
  const task = review ? '对比竞品-A、B 的价格结构和渠道差异，写入成果文件夹。' : '把周会录音整理成纪要，按决定、待办和风险分组。';
  const summaries = review ? DATA.steps.map(step => `${step.verb} ${step.obj}`) : ['读取录音转写', '提取决定、待办和风险', '交付周会纪要'];
  const total = review ? 1_000_000 : 200_000;
  const model = review ? DATA.models[0].items[0] : DATA.models[0].items[2];
  const start = review ? 14 * 3600 + 32 * 60 : 14 * 3600 + 20 * 60;
  const time = elapsed => [Math.floor((start + elapsed) / 3600), Math.floor((start + elapsed) / 60) % 60, (start + elapsed) % 60].map(part => String(part).padStart(2, '0')).join(':');
  const status = {done: '已完成', running: '运行中', approval: '待批准', resume: '运行中', denied: '调用已拒绝'}[scenario];
  const rounds = Array.from({length: count}, (_, index) => ({
    id: index + 1, time: time(index * (review ? 17 : 15) + 1), model: model.name,
    used: (review ? [614200, 623500, 645300, 658000, 662000, 381600] : [21400, 28800, 32600])[index],
    output: (review ? [324, 256, 174, 712, 283, 1270] : [340, 417, 828])[index],
    duration: (review ? [3.4, 2.1, 2.8, 8.4, 2.6, 16.2] : [6.2, 5.5, 13.1])[index],
    pending: ['running', 'resume'].includes(scenario) && index === count - 1,
    summary: summaries[index],
  }));
  const compactions = [
    ...(review && scenario === 'done' ? [{id: 'auto', time: time(82), before: 662000, after: 367200, limit: total, kind: '自动压缩', summary: '已读取两份竞品材料，渠道分类沿用工作区约定。保留三处引用及脚本写入结果，下一轮核对数字并交付表格。'}] : []),
    ...logView().compactions.filter(record => record.scenario === scenario),
  ];
  const events = [{id: 'user', time: time(0), type: 'message', summary: task}];
  rounds.forEach((round, i) => {
    events.push({id: `model-${round.id}`, time: round.time, type: 'model', summary: `第 ${round.id} 轮模型请求`, round: round.id});
    if (review && i === 4) events.push({id: 'approved', time: time(73), type: 'approval', summary: '已批准运行脚本'});
    if (review && !round.pending) events.push({id: `step-${i}`, time: time(i * 17 + (i === 4 ? 9 : 7)), type: 'tool', summary: summaries[i], step: i});
  });
  if (scenario === 'approval') events.push({id: 'approval', time: time(64), type: 'approval', summary: '等待批准运行脚本'});
  if (scenario === 'denied') events.push({id: 'denied', time: time(73), type: 'approval', summary: '已拒绝运行脚本'});
  if (scenario === 'done') {
    const finish = time(review ? 102 : 48);
    events.push({id: 'reply', time: finish, type: 'message', summary: review ? '已回复并交付竞品对比表' : '已回复并交付周会纪要'});
    events.push({id: 'end', time: finish, type: 'run', summary: '运行完成'});
  }
  compactions.forEach(record => events.push({id: record.id, time: record.time, type: 'compaction', summary: record.kind}));
  events.sort((a, b) => a.time.localeCompare(b.time));
  const latest = rounds.at(-1);
  return {scenario, task, model, total, status, rounds, compactions, events, latest};
}

function saveLogScroll() {
  const pane = $('#log-surface');
  const scroll = $('#log-scroll');
  if (pane && !pane.hidden && scroll) {
    const view = logViews.get(pane.dataset.session);
    view.scroll[view.section] = scroll.scrollTop;
  }
}

function logEventsHTML(run, view) {
  const events = run?.events || [];
  const shown = events.filter(event => view.filter === 'all' || event.type === view.filter);
  return `<div class="log-filter">
      <label for="log-filter">事件类型</label>
      <span class="select-wrap">${icon('chevronDown', 'xs')}<select class="sheet-select" id="log-filter">
        <option value="all">全部事件</option>
        ${Object.entries(EVENT_TYPES).map(([type, label]) => `<option value="${type}" ${view.filter === type ? 'selected' : ''}>${label}</option>`).join('')}
      </select></span>
      <span class="faint num" role="status">${shown.length} 条事件</span>
    </div>
    ${shown.map(event => `<details class="log-entry" data-log-entry="${event.id}" ${view.expanded.has(event.id) ? 'open' : ''}>
      <summary><time class="mono">${event.time}</time><span class="log-category">${EVENT_TYPES[event.type]}</span><span class="log-summary">${esc(event.summary)}</span>${icon('chevronRight', 'sm')}</summary>
      <div class="log-detail"><div class="log-detail-head"><span>原始 JSON</span>
        ${event.round !== undefined ? `<button class="btn quiet" data-log-request="${event.round}">查看请求</button>` : ''}
        ${event.step === 4 ? '<button class="btn quiet" data-inspect-step="4">查看终端</button>' : ''}
      </div><pre class="log-code">${esc(JSON.stringify(event, null, 2))}</pre></div>
    </details>`).join('') || `<p class="log-empty">${events.length ? '没有符合筛选的事件。' : '这个会话还没有可查看的事件。'}</p>`}`;
}

function logRoundsHTML(run, view) {
  if (!run) return '<p class="log-empty">这个会话还没有可查看的模型轮次。</p>';
  return `<div class="log-filter"><span class="faint">${run.status}</span><span class="faint num">${run.rounds.length} 轮模型请求</span></div>
    ${run.rounds.map(round => `<div class="log-entry">
      <button class="log-round" data-log-request="${round.id}" aria-expanded="${view.request === round.id}" aria-controls="request-${round.id}">
        <span>第 ${round.id} 轮</span><span class="log-summary">${esc(round.model)}</span><span class="log-metrics mono">${round.pending ? '请求中' : `${round.duration} s · ${tokens(round.output)} 输出 Token`}</span>${icon('chevronRight', 'sm')}
      </button>
      <div class="log-detail" id="request-${round.id}" ${view.request === round.id ? '' : 'hidden'}>
        <div class="log-detail-head">重建的请求原文</div>
        <pre class="log-code">${esc(JSON.stringify({
          model: round.model, turn: round.id, contextTokens: round.used,
          messages: [{role: 'user', content: run.task}, ...(round.id > 1 ? [{role: 'tool', content: run.rounds[round.id - 2].summary}] : [])],
        }, null, 2))}</pre>
      </div>
    </div>`).join('')}`;
}

function logCompactionsHTML(run, view) {
  return run?.compactions.map(record => `<article class="log-compaction">
    <div class="log-compaction-head"><h3>${record.kind}</h3><time class="mono faint">${record.time}</time></div>
    <div class="log-comparison">
      ${[['压缩前', record.before], ['压缩后', record.after]].map(([label, value]) => `<div><span>${label}</span><div class="log-meter" aria-hidden="true"><span style="width:${value / record.limit * 100}%"></span></div><span class="mono">${tokens(value)} Token</span></div>`).join('')}
    </div>
    <details class="log-entry" data-log-entry="summary-${record.id}" ${view.expanded.has('summary-' + record.id) ? 'open' : ''}>
      <summary><span class="log-summary">压缩摘要</span>${icon('chevronRight', 'sm')}</summary><p class="log-detail">${esc(record.summary)}</p></details>
  </article>`).join('') || '<p class="log-empty">这个会话还没有上下文压缩记录。</p>';
}

function renderLogs({save = true} = {}) {
  const pane = $('#log-surface');
  const view = logView();
  const run = diagnosticRun();
  const signature = JSON.stringify([sessionKey(), view.section, view.filter, view.request, run?.scenario, run?.compactions.length]);
  if (pane.dataset.signature === signature) return;
  if (save) saveLogScroll();
  pane.dataset.signature = signature;
  pane.dataset.session = sessionKey();
  const content = view.section === 'events' ? logEventsHTML(run, view) : view.section === 'turns' ? logRoundsHTML(run, view) : logCompactionsHTML(run, view);
  pane.innerHTML = `<div class="log-toolbar"><div class="log-width">
    <div class="seg on-sheet" role="group" aria-label="日志类别">
      ${LOG_SECTIONS.map(([id, label]) => `<button class="seg-btn txt" data-log-section="${id}" aria-pressed="${view.section === id}">${label}</button>`).join('')}
    </div>
    <button class="ghost-btn" data-log-export aria-label="导出会话日志" data-tip="导出会话日志 · JSON" ${run ? '' : 'disabled'}>${icon('download', 'sm')}</button>
  </div></div>
  <div class="scroll" id="log-scroll"><div class="log-width log-body">${content}</div></div>`;
  $('#log-scroll').scrollTop = view.scroll[view.section] || 0;
  $$('[data-log-entry]', pane).forEach(entry => entry.addEventListener('toggle', () => {
    if (!entry.isConnected) return;
    if (entry.open) view.expanded.add(entry.dataset.logEntry);
    else view.expanded.delete(entry.dataset.logEntry);
  }));
}

function contextUsage() {
  if (!isSession()) return null;
  const run = diagnosticRun();
  if (!run) return null;
  const last = run.compactions.at(-1);
  const estimated = last?.kind === '手动压缩';
  const model = currentModel();
  return {used: estimated ? last.after : run.latest.used, limit: run.total, latest: run.latest.used,
    estimated, currentLimit: Number.parseFloat(model.ctx) * (model.ctx.endsWith('M') ? 1_000_000 : 1_000),
    input: run.rounds.reduce((total, round) => total + round.used, 0),
    output: run.rounds.reduce((total, round) => total + round.output, 0)};
}
const contextPercent = usage => `${Math.round(usage.used / usage.limit * 100)}%`;
const contextLabel = usage => usage ? `上下文占用 ${contextPercent(usage)}${usage.estimated ? '（估算）' : ''}` : '上下文占用未知';

function ringSVG(usage) {
  const circumference = 2 * Math.PI * 7;
  const fraction = usage ? Math.min(1, usage.used / usage.limit) : 0;
  return `<svg class="ctx-ring ${usage?.estimated ? 'estimated' : ''}" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="9" cy="9" r="7" class="bg"/><circle cx="9" cy="9" r="7" class="fg" stroke-dasharray="${circumference * fraction} ${circumference}"/>
  </svg>`;
}

function renderContextAccessory() {
  const accessory = $('#context-accessory');
  if (!accessory) return;
  if (!developerEnabled) { accessory.replaceChildren(); return; }
  const usage = contextUsage();
  const label = contextLabel(usage);
  const open = !$('#popover').hidden && !!$('.context-detail', $('#popover'));
  accessory.innerHTML = `<button class="ghost-btn context-button" id="context-button" data-action="context-details"
    aria-label="${label}" aria-expanded="${open}" aria-controls="popover" data-tip="${label}">${ringSVG(usage)}</button>`;
}

function openContextDetails(button) {
  const usage = contextUsage();
  const pop = $('#popover');
  const rows = usage ? [
    ['最近请求', `${tokens(usage.latest)} / ${tokens(usage.limit)} Token`],
    ...(usage.estimated ? [['压缩后估算', `${tokens(usage.used)} Token`]] : []),
    ['当前模型预算', `${tokens(usage.currentLimit)} Token`],
    ['会话累计输入', `${tokens(usage.input)} Token`],
    ['会话累计输出', `${tokens(usage.output)} Token`],
  ] : [];
  pop.innerHTML = `<div class="context-detail" role="region" aria-label="上下文详情">
    <div class="context-detail-head">${ringSVG(usage)}<b>${contextLabel(usage)}</b></div>
    ${usage ? `<dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd class="mono">${value}</dd></div>`).join('')}</dl>` : '<p class="faint">尚无可用的模型请求记录。</p>'}
  </div>`;
  button.setAttribute('aria-expanded', 'true');
  placePopover(pop, button);
}

function canCompactContext() {
  return diagnosticRun()?.scenario === 'done';
}

function compactContext() {
  const usage = contextUsage();
  const run = diagnosticRun();
  const record = {id: `manual-${logView().compactions.length + 1}`, time: new Date().toLocaleTimeString('zh-CN', {hour12: false}),
    before: usage.used, after: Math.round(usage.used * .57), limit: usage.limit, kind: '手动压缩', scenario: run.scenario,
    summary: isReviewSession() ? '保留价格和渠道结论、引用位置及本次交付文件。' : '保留会议决定、待办、风险及本次交付文件。'};
  logView().compactions.push(record);
  renderContextAccessory();
  toast('已压缩上下文，会话历史已保留', 'layers');
}

function exportLogs() {
  const run = diagnosticRun();
  if (!run) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({prototype: true, session: sessionKey(), ...run}, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'rayagent-prototype-session-log.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button || !developerEnabled || !isSession()) return;
  if (button.dataset.sessionMode) {
    saveLogScroll();
    logView().mode = button.dataset.sessionMode;
    return syncSessionView();
  }
  const view = logViews.get(sessionKey());
  if (button.dataset.logSection) {
    saveLogScroll();
    view.section = button.dataset.logSection;
    renderLogs({save: false});
    return $(`[data-log-section="${view.section}"]`).focus({preventScroll: true});
  }
  if (button.dataset.logRequest) {
    const round = Number(button.dataset.logRequest);
    const fromEvents = view.section === 'events';
    saveLogScroll();
    view.section = 'turns';
    view.request = !fromEvents && view.request === round ? null : round;
    renderLogs({save: false});
    const row = $(`[data-log-request="${round}"]`);
    return row?.focus({preventScroll: !fromEvents});
  }
  if (button.hasAttribute('data-log-export')) exportLogs();
});

document.addEventListener('change', e => {
  if (e.target.id !== 'log-filter') return;
  const view = logView();
  view.filter = e.target.value;
  view.scroll.events = 0;
  renderLogs({save: false});
  $('#log-filter').focus({preventScroll: true});
});

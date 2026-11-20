// 设置的扩展分区：用量、可编辑的模型提供商、语音转文字。依赖 pages.js 的 setRow/openDialog 与 charts.js、usage.js。

/* ---------------------------------------------------------------- 本机展示偏好 */
const PREFS = (() => {
  const read = (k, d) => { try { const v = localStorage.getItem('rayagent.proto.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem('rayagent.proto.' + k, JSON.stringify(v)); } catch { /* 预览或隐私模式下不保存 */ } };
  const state = {costInChat: read('costInChat', true), voice: read('voice2', 'local')};
  return {get: k => state[k], set(k, v) { state[k] = v; write(k === 'voice' ? 'voice2' : k, v); }};
})();

/* ================================================================ 用量 */
// 分区骨架只渲染一次；筛选、下钻与悬停只就地更新各区域内容，区域尺寸固定，避免页面跳动。
// range 为预设键或 'custom'；custom 为 {start, end}（end 不含）。
const U = {range: '7d', provider: 'all', heat: 'calendar', custom: null, picker: null, peak: false, anchorDay: null,
  heatSel: null, heatFocus: null, heatLevel: null, barFocus: null, barWidth: 0, ro: null};
const HEAT_FILL = level => `var(--heat-${level})`;
const PROVIDER_COLOR = key => USAGE.PROVIDERS.find(p => p.key === key)?.color || 'var(--ink-3)';
const WEEK_MON = ['一', '二', '三', '四', '五', '六', '日'];
const pad2 = n => String(n).padStart(2, '0');
const mdOf = d => `${d.getMonth() + 1}月${d.getDate()}日`;
const weekOf = d => `周${'日一二三四五六'[d.getDay()]}`;
const rangeArg = () => (U.range === 'custom' ? U.custom : U.range);
const dayRange = day => { const s = new Date(day); s.setHours(0, 0, 0, 0); const e = new Date(s); e.setDate(e.getDate() + 1); return {start: s, end: e > USAGE.NOW ? new Date(USAGE.NOW) : e}; };

/** 自定义时段的文字：整天只写日期，跨天写起止，带小时时写到整点。 */
function customLabel(c, short = false) {
  const end = new Date(c.end - 1);
  const whole = !c.hours && c.start.getHours() === 0 && ((c.end.getHours() === 0 && c.end.getMinutes() === 0) || +c.end === +USAGE.NOW);
  const sameDay = c.start.toDateString() === end.toDateString();
  const day = d => (short ? `${d.getMonth() + 1}/${d.getDate()}` : mdOf(d));
  if (whole) return sameDay ? day(c.start) : `${day(c.start)} – ${day(end)}`;
  const endTime = `${pad2(c.end.getHours() || 24)}:${pad2(c.end.getMinutes())}`;
  const startTime = `${pad2(c.start.getHours())}:00`;
  return sameDay ? `${day(c.start)} ${startTime}–${endTime}` : `${day(c.start)} ${startTime} – ${day(end)} ${endTime}`;
}
const rangeLabel = () => (U.range === 'custom' ? customLabel(U.custom) : USAGE.RANGES.find(r => r[0] === U.range)[1]);

function usageBody() {
  return `<h2>用量</h2>
    <p class="set-lead">按请求记录 Token，并按官方标价估算费用。</p>
    ${setRow('在对话中显示费用', '回复下方显示本次运行的估算费用，悬停查看明细与本对话累计。', `<button class="switch" role="switch" aria-label="在对话中显示费用" aria-checked="${PREFS.get('costInChat')}" data-cost-toggle><span class="knob"></span></button>`)}
    <div class="use-filters" id="use-filters">${filtersHTML()}</div>
    <div class="use-kpis" id="use-kpis"></div>
    <section class="use-card" aria-labelledby="use-trend-h">
      <header><h3 id="use-trend-h">费用趋势</h3><span class="use-unit" id="use-trend-unit"></span><span class="grow"></span><div class="use-legend" id="use-legend"></div></header>
      <div class="use-readout" id="use-readout" aria-live="polite"></div>
      <div class="use-chart" id="use-bars"></div>
    </section>
    <section class="use-card use-heat-card" aria-labelledby="use-heat-h" data-heat-view="${U.heat}">
      <header><div class="use-heat-title"><h3 id="use-heat-h">使用热力</h3><span class="use-unit" id="use-heat-unit"></span></div>
        <div class="use-heat-controls"><button class="chip use-peak" data-use-peak aria-pressed="${U.peak}">标出 DeepSeek 高峰</button>
          <div class="seg on-sheet" role="radiogroup" aria-label="热力图视角"><button class="seg-btn txt" role="radio" data-use-heat="calendar" aria-checked="${U.heat === 'calendar'}" aria-selected="${U.heat === 'calendar'}">日历</button><button class="seg-btn txt" role="radio" data-use-heat="hours" aria-checked="${U.heat === 'hours'}" aria-selected="${U.heat === 'hours'}">时段</button></div></div></header>
      <div class="use-heat"><div class="use-heat-plot" id="use-heat"></div><div class="use-heat-side"><div class="use-side-body" id="use-heat-side" aria-live="polite"></div><div id="use-heat-scale"></div></div></div>
      <div class="use-hint"><span data-heat-hint="calendar">点击日期查看当天，Shift 点击选一段。方向键移动，Enter 选择。</span>
        <span data-heat-hint="hours">点击格子或按 Enter 固定明细。方向键移动，Esc 取消。</span></div>
    </section>
    <section class="use-card" aria-labelledby="use-table-h"><header><h3 id="use-table-h">按提供商与模型</h3></header><div id="use-table"></div></section>
    <section class="use-card" aria-labelledby="use-purpose-h"><header><h3 id="use-purpose-h">按用途</h3><span class="use-unit">辅助请求同样计入</span></header><div id="use-purposes"></div></section>
    <p class="use-note">费用按 ${USAGE.PRICING_UPDATED} 的官方标价估算：DeepSeek 按请求时刻区分高峰与低谷价，法定节假日的低谷价、缓存写入、账单折扣与赠送额度未计入；未填写单价的自定义模型只统计 Token；本机语音转写不产生费用。实际金额以服务商账单为准。价格来源：${USAGE.SOURCES.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join('、')}。</p>`;
}

function filtersHTML() {
  const providers = [['all', '全部'], ...USAGE.BILLED.map(x => [x.key, x.label])];
  return `<div class="seg on-sheet" role="radiogroup" aria-label="时间范围">${USAGE.RANGES.map(([k, l]) => `<button class="seg-btn txt" role="radio" data-use-range="${k}" aria-selected="${U.range === k}" aria-checked="${U.range === k}">${l}</button>`).join('')}
      <button class="seg-btn txt use-custom-btn" role="radio" data-use-custom aria-haspopup="dialog" aria-controls="use-picker" aria-expanded="false">${icon('clock', 'xs')}<span>自定义</span></button></div>
    <div class="seg on-sheet" role="radiogroup" aria-label="提供商">${providers.map(([k, l]) => `<button class="seg-btn txt" role="radio" data-use-provider="${k}" aria-selected="${U.provider === k}" aria-checked="${U.provider === k}">${k === 'all' ? '' : `<span class="use-dot" style="background:${PROVIDER_COLOR(k)}"></span>`}${l}</button>`).join('')}</div>
    <div class="use-picker" id="use-picker" role="dialog" aria-label="自定义时段" hidden></div>`;
}
/** 只同步筛选按钮的选中态与自定义标签，不替换节点。 */
function syncFilters(dlg) {
  $$('[data-use-range]', dlg).forEach(b => { const on = U.range === b.dataset.useRange; b.setAttribute('aria-selected', on); b.setAttribute('aria-checked', on); });
  const c = $('[data-use-custom]', dlg);
  if (c) {
    const on = U.range === 'custom';
    c.setAttribute('aria-selected', on);
    c.setAttribute('aria-checked', on);
    $('span', c).textContent = on ? customLabel(U.custom, true) : '自定义';
    c.title = on ? customLabel(U.custom) : '自定义时段';
  }
  $$('[data-use-provider]', dlg).forEach(b => { const on = U.provider === b.dataset.useProvider; b.setAttribute('aria-selected', on); b.setAttribute('aria-checked', on); });
}

function kpisHTML(v) {
  const t = v.total, p = v.prev;
  const hit = t.input ? Math.round(t.cached / t.input * 100) : 0;
  const prevHit = p.input ? Math.round(p.cached / p.input * 100) : 0;
  const transcribes = v.purposes.find(x => x.key === 'transcribe');
  const kpi = (label, value, sub, d) => `<div class="use-kpi"><div class="use-kpi-label"><span>${label}</span>${d ? `<span class="use-delta" data-tip="对比${v.window.prevLabel}">${d}</span>` : ''}</div>
    <div class="use-kpi-value num">${value}</div><div class="use-kpi-sub" title="${esc(sub)}">${sub}</div></div>`;
  return kpi('估算费用', USAGE.money(t.cost, {approx: false}), t.priced ? '美元' : '部分模型未填单价', USAGE.delta(t.cost, p.cost))
    + kpi('Token', USAGE.tokens(t.input + t.output), `输入 ${USAGE.tokens(t.input)} · 输出 ${USAGE.tokens(t.output)}`, USAGE.delta(t.input + t.output, p.input + p.output))
    + kpi('模型请求', t.requests.toLocaleString(), transcribes ? `含 ${transcribes.requests} 次本机转写` : '次', USAGE.delta(t.requests, p.requests))
    + kpi('缓存命中', `${hit}%`, `命中 ${USAGE.tokens(t.cached)} 输入`, p.input ? (hit === prevHit ? '持平' : `${hit > prevHit ? '↑' : '↓'} ${Math.abs(hit - prevHit)} 点`) : null);
}

function usageTable(v) {
  const total = v.total.cost || 1;
  const cell = (m, isProvider) => {
    if (!m.requests) return '<td class="num faint">0</td><td class="num faint">—</td><td class="num faint">—</td><td class="num faint">—</td><td class="num faint">—</td><td><span class="use-share"></span></td>';
    const audio = m.model === 'gpt-transcribe' || m.model === 'whisper-local' || (isProvider && m.free);
    const cost = m.priced ? m.cost : null;
    return `<td class="num">${m.requests.toLocaleString()}</td>
      <td class="num">${audio ? `音频 ${Math.round(m.audioSec / 60)} 分钟` : USAGE.tokens(m.input)}</td>
      <td class="num">${audio ? '—' : m.input ? `${Math.round(m.cached / m.input * 100)}%` : '—'}</td>
      <td class="num">${audio ? '—' : USAGE.tokens(m.output)}</td>
      <td class="num ${isProvider ? 'strong' : ''}">${m.free ? '<span class="faint">免费</span>' : cost == null ? '<span class="faint" data-tip="未填写单价">—</span>' : USAGE.money(cost, {approx: false})}</td>
      <td><span class="use-share"><span style="width:${cost == null || m.free ? 0 : Math.max(1, cost / total * 100)}%"></span></span></td>`;
  };
  return `<div class="use-table-wrap"><table class="use-table">
    <thead><tr><th>提供商 / 模型</th><th class="num">请求</th><th class="num">输入</th><th class="num" data-tip="输入中命中缓存的比例">缓存</th><th class="num">输出</th><th class="num">费用</th><th>占比</th></tr></thead>
    <tbody>${v.byProvider.map(p => `<tr class="use-prov"><th scope="row"><span class="use-dot" style="background:${p.color}"></span>${p.label}${p.free ? '<span class="tag">语音转写组件</span>' : ''}</th>${cell(p, true)}</tr>
      ${p.modelsUsed.map(m => `<tr class="use-model"><th scope="row"><span class="mono">${m.model}</span>${USAGE.PRICES[m.model] === null ? '<span class="tag">未填单价</span>' : ''}</th>${cell({...m, free: p.free})}</tr>`).join('')}`).join('')}</tbody>
  </table></div>`;
}

function usagePurposes(v) {
  const max = Math.max(...v.purposes.map(p => p.cost), 0.000001);
  return `<div class="use-purposes">${v.purposes.map(p => `<div class="use-purpose">
      <span class="use-purpose-label">${p.label}</span>
      <span class="use-bar"><span style="width:${p.cost ? Math.max(1, p.cost / max * 100) : 0}%"></span></span>
      <span class="num">${!p.requests ? '—' : p.key === 'transcribe' && !p.cost ? '本机 · 免费' : USAGE.money(p.cost, {approx: false})}</span><span class="num faint">${p.requests.toLocaleString()} 次</span></div>`).join('')}</div>`;
}

/* ---------------------------------------------------------------- 入口：设置分区绘制后调用 */
function paintUsageCharts(dlg) {
  U.picker = null;
  $('.set-main > .use-picker', dlg)?.remove();
  const bars = $('#use-bars', dlg);
  if (!bars) { U.ro?.disconnect(); U.ro = null; return; }
  // 聚焦浮层控件时，只滚动浮层本身。
  bars.closest('.set-main').append($('#use-picker', dlg));
  bindUsage(dlg);
  U.barWidth = 0;
  updateUsage(dlg);
  U.ro?.disconnect();
  U.ro = new ResizeObserver(() => {
    if (Math.max(260, bars.clientWidth) !== U.barWidth) drawBars(dlg);
    if (U.picker) positionPicker(dlg);
  });
  U.ro.observe(bars);
  U.ro.observe($('#set-body', dlg));
}

/** 按当前筛选就地刷新各区域。 */
function updateUsage(dlg) {
  const v = U.lastView = USAGE.view(rangeArg(), U.provider);
  U.barFocus = null;
  syncFilters(dlg);
  $('#use-kpis', dlg).innerHTML = kpisHTML(v);
  $('#use-trend-unit', dlg).textContent = `${rangeLabel()} · ${{hour: '按小时', '3h': '每 3 小时', day: '按天'}[v.window.unit]}`;
  $('#use-legend', dlg).innerHTML = USAGE.BILLED.filter(x => U.provider === 'all' || x.key === U.provider).map(x => `<span><span class="use-dot" style="background:${x.color}"></span>${x.label}</span>`).join('');
  $('#use-table', dlg).innerHTML = usageTable(v);
  $('#use-purposes', dlg).innerHTML = usagePurposes(v);
  drawBars(dlg);
  paintReadout(dlg);
  paintHeat(dlg);
}

/* ---------------------------------------------------------------- 柱状图：悬停高亮与读数、点击下钻、键盘移动 */
const canDrill = () => U.lastView.window.unit !== 'hour';
function drawBars(dlg) {
  const host = $('#use-bars', dlg), v = U.lastView;
  const width = U.barWidth = Math.max(260, host.clientWidth);
  const series = USAGE.BILLED.filter(p => U.provider === 'all' || p.key === U.provider);
  const L = U.barLayout = RayChart.stackedBars({buckets: v.buckets, series, width, height: 188, format: x => x === 0 ? '0' : `$${+x.toPrecision(3)}`});
  host.innerHTML = RayChart.renderStackedBars(L, {colorOf: PROVIDER_COLOR, focusable: true, className: canDrill() ? 'drill' : '',
    classOf: (b, i) => (U.barFocus === i ? 'on' : ''), ariaLabel: `费用趋势，${rangeLabel()}共 ${USAGE.money(v.total.cost)}，方向键逐段查看`})
    + (v.total.requests ? '' : '<p class="use-empty">这段时间没有模型请求。</p>');
  if (U.barFocus != null) $('svg', host).classList.add('hovering');
}
function paintReadout(dlg, i = U.barFocus) {
  const el = $('#use-readout', dlg), v = U.lastView;
  if (!el) return;
  if (i == null) {
    el.innerHTML = `<span class="faint">${esc(rangeLabel())}共</span> <b class="num">${USAGE.money(v.total.cost)}</b> <span class="faint">· ${v.total.requests} 次请求 · 悬停柱子查看每段${canDrill() ? '，点击查看当天按小时' : ''}</span>`;
    return;
  }
  const b = v.buckets[i];
  const parts = USAGE.BILLED.map(p => [p, b.values[p.key] || 0]).filter(([, x]) => x > 0);
  el.innerHTML = `<b>${esc(b.label)}</b> <b class="num">${b.records.length ? USAGE.money(USAGE.BILLED.reduce((s, p) => s + (b.values[p.key] || 0), 0)) : '—'}</b>
    <span class="faint">· ${b.records.length} 次请求</span>${parts.map(([p, x]) => ` <span class="use-readout-part"><span class="use-dot" style="background:${p.color}"></span>${p.label} <span class="num">${USAGE.money(x)}</span></span>`).join('')}
    ${canDrill() && b.records.length ? '<span class="faint">· 点击查看当天</span>' : ''}`;
}
function hoverBar(dlg, i) {
  const svg = $('#use-bars svg', dlg);
  if (!svg) return;
  svg.classList.toggle('hovering', i != null);
  $$('.rc-bar', svg).forEach(g => g.classList.toggle('on', +g.dataset.i === i));
  paintReadout(dlg, i);
  linkCalendar(dlg, i);
}
/** 按天的柱子与日历热力图联动：悬停柱子时在日历上标出同一天。 */
function linkCalendar(dlg, i) {
  $$('#use-heat .rc-cell.link', dlg).forEach(el => el.classList.remove('link'));
  if (i == null || U.heat !== 'calendar' || U.lastView.window.unit !== 'day') return;
  const day = U.lastView.buckets[i].start.toDateString();
  const idx = U.heatLayout?.cells.findIndex(c => c.date.toDateString() === day);
  if (idx >= 0) $(`#use-heat .rc-cell[data-i="${idx}"]`, dlg)?.classList.add('link');
}
function drillBar(dlg, i) {
  const b = U.lastView.buckets[i];
  if (!canDrill() || !b.records.length) return;
  U.custom = dayRange(b.start); U.range = 'custom'; U.anchorDay = new Date(U.custom.start);
  updateUsage(dlg);
  $('#use-bars svg', dlg)?.focus({preventScroll: true});
}

/* ---------------------------------------------------------------- 热力图：两种视角共用固定尺寸的侧栏 */
const topModels = models => Object.entries(models).sort((a, b) => b[1] - a[1]).slice(0, 3);
function heatTokenRow(input, output) {
  const breakdown = `输入 ${input.toLocaleString()} · 输出 ${output.toLocaleString()}`;
  return `<div><dt>Token 用量</dt><dd class="num" title="${breakdown}">${USAGE.tokens(input + output)}</dd></div>`;
}
function cellDetail(c) {
  const models = topModels(c.models || {});
  const title = U.heat === 'calendar' ? `${mdOf(c.date)} ${weekOf(c.date)}` : `周${WEEK_MON[c.row]} ${pad2(c.col)}:00–${pad2(c.col + 1)}:00`;
  const extra = U.heat === 'hours' ? `<div><dt>DeepSeek 计价</dt><dd>${USAGE.peakAt(c.row, c.col) ? '高峰 · 原价' : '低谷 · 半价'}</dd></div>` : '';
  return `<b class="use-side-title">${title}</b>
    <dl><div><dt>估算费用</dt><dd class="num">${c.requests ? USAGE.money(c.value) : '—'}</dd></div><div><dt>请求</dt><dd class="num">${c.requests} 次</dd></div>${heatTokenRow(c.input, c.output)}${extra}
    </dl><div class="use-side-models"><div class="faint">主要模型</div>${models.length ? `<ul>${models.map(([m, n]) => `<li><span class="mono" title="${esc(m)}">${esc(m)}</span><span class="num faint">${n}</span></li>`).join('')}</ul>` : '—'}</div>`;
}
function heatSummary() {
  const d = U.heatData;
  if (U.heat === 'calendar') {
    const active = d.days.filter(x => x.requests);
    const top = d.days.reduce((a, b) => (b.value > a.value ? b : a), d.days[0]);
    const input = active.reduce((total, day) => total + day.input, 0);
    const output = active.reduce((total, day) => total + day.output, 0);
    return `<b class="use-side-title">近 13 周</b><dl><div><dt>日均</dt><dd class="num">${USAGE.money(active.reduce((s, x) => s + x.value, 0) / Math.max(1, active.length))}</dd></div>
      <div><dt>最高</dt><dd class="num">${mdOf(top.date)} · ${USAGE.money(top.value)}</dd></div><div><dt>有用量</dt><dd class="num">${active.length} / ${d.days.length} 天</dd></div>${heatTokenRow(input, output)}</dl>`;
  }
  const busiest = d.hours.reduce((a, b) => (b.requests > a.requests ? b : a), d.hours[0]);
  return `<b class="use-side-title">${esc(rangeLabel())}</b><dl><div><dt>最忙时段</dt><dd class="num">${busiest.requests ? `周${WEEK_MON[busiest.row]} ${busiest.col}:00` : '—'}</dd></div>
    <div><dt>有请求的时段</dt><dd class="num">${d.hours.filter(h => h.requests).length} / 168</dd></div>${heatTokenRow(U.lastView.total.input, U.lastView.total.output)}</dl>`;
}
function paintHeat(dlg) {
  const host = $('#use-heat', dlg);
  if (!host) return;
  const win = U.lastView.window;
  $('#use-heat-unit', dlg).textContent = U.heat === 'calendar' ? '近 13 周 · 所选时段高亮' : `${rangeLabel()} · 星期 × 小时`;
  host.closest('.use-heat-card').dataset.heatView = U.heat;
  let L, classOf;
  if (U.heat === 'calendar') {
    const days = USAGE.calendar(U.provider), cal = RayChart.calendarCells(days);
    U.heatData = {days};
    L = RayChart.matrix({cells: cal.cells, rows: 7, cols: cal.cols, cell: 17, gap: 4, rowLabels: WEEK_MON.map((label, row) => ({row, label})).filter(l => l.row % 2 === 0), colLabels: cal.colLabels});
    const inWin = c => { const e = new Date(c.date); e.setDate(e.getDate() + 1); return e > win.start && c.date < win.end; };
    classOf = (c, i) => [inWin(c) ? '' : 'dim', U.heatFocus === i ? 'focus' : '', U.heatLevel != null && c.level !== U.heatLevel ? 'lvl-off' : ''].join(' ');
  } else {
    U.heatData = {hours: U.lastView.hours};
    L = RayChart.matrix({cells: U.lastView.hours, rows: 7, cols: 24, cell: 13, gap: 2, rowLabels: WEEK_MON.map((label, row) => ({row, label})), colLabels: [0, 6, 12, 18].map(col => ({col, label: `${col}时`}))});
    classOf = (c, i) => [U.peak && USAGE.peakAt(c.row, c.col) ? 'peak' : '', U.heatSel === i ? 'sel' : '', U.heatFocus === i ? 'focus' : '', U.heatLevel != null && c.level !== U.heatLevel ? 'lvl-off' : ''].join(' ');
  }
  U.heatLayout = L;
  host.innerHTML = RayChart.renderMatrix(L, {fillOf: HEAT_FILL, classOf, focusable: true,
    ariaLabel: U.heat === 'calendar' ? `近 13 周每天的费用热力图，所选时段为${rangeLabel()}，方向键逐格查看` : `${rangeLabel()}星期与小时的费用热力图，方向键逐格查看`});
  const scale = $('#use-heat-scale', dlg);
  if (!scale.firstChild) scale.innerHTML = RayChart.renderLegendScale(L.levels, HEAT_FILL, {interactive: true});
  paintHeatSide(dlg);
}
function paintHeatSide(dlg, hover = null) {
  const side = $('#use-heat-side', dlg), L = U.heatLayout;
  if (!side || !L) return;
  const index = hover ?? U.heatFocus ?? (U.heat === 'hours' ? U.heatSel : null);
  const content = index != null ? cellDetail(L.cells[index]) : heatSummary();
  if (side.firstElementChild && content === U.heatReadout) return;
  U.heatReadout = content;
  side.innerHTML = `<div class="use-side-content">${content}</div>`;
}
/** 只切换格子的状态类，不重绘整张图。 */
function restyleHeat(dlg) {
  const L = U.heatLayout;
  $$('#use-heat .rc-cell', dlg).forEach(el => {
    const i = +el.dataset.i;
    el.classList.toggle('focus', U.heatFocus === i);
    el.classList.toggle('sel', U.heat === 'hours' && U.heatSel === i);
    el.classList.toggle('lvl-off', U.heatLevel != null && L.cells[i].level !== U.heatLevel);
  });
}
function heatLabels(dlg, row, col) {
  $$('#use-heat .rc-axis', dlg).forEach(t => t.classList.toggle('hl', (row != null && t.dataset.row === String(row)) || (col != null && t.dataset.col === String(col))));
}
function pickDay(dlg, i, extend) {
  const hadFocus = document.activeElement === $('#use-heat svg', dlg);
  const day = new Date(U.heatLayout.cells[i].date);
  let first = day, last = day;
  if (extend && U.anchorDay) { first = U.anchorDay < day ? U.anchorDay : day; last = U.anchorDay < day ? day : U.anchorDay; } else U.anchorDay = day;
  U.custom = {start: dayRange(first).start, end: dayRange(last).end}; U.range = 'custom';
  updateUsage(dlg);
  if (hadFocus) $('#use-heat svg', dlg)?.focus({preventScroll: true});
  U.heatFocus = i; restyleHeat(dlg); paintHeatSide(dlg);
}

function bindUsage(dlg) {
  if (dlg.dataset.usageBound) return;
  dlg.dataset.usageBound = '1';
  $('#set-body', dlg).addEventListener('scroll', () => { if (U.picker) positionPicker(dlg); });
  dlg.addEventListener('change', e => {
    const k = e.target.dataset?.pkH;
    if (k && U.picker) { U.picker[k] = +e.target.value; updatePickerFooter($('#use-picker', dlg)); }
  });
  dlg.addEventListener('mouseover', e => {
    const hit = e.target.closest('#use-bars .rc-hit');
    if (hit) return hoverBar(dlg, +hit.dataset.i);
    const cell = e.target.closest('#use-heat .rc-cell');
    if (cell) { heatLabels(dlg, cell.dataset.row, U.heat === 'hours' ? cell.dataset.col : null); return paintHeatSide(dlg, +cell.dataset.i); }
    const sw = e.target.closest('#use-heat-scale .rc-swatch');
    if (sw && U.heatLevel !== +sw.dataset.level) { U.heatLevel = +sw.dataset.level; restyleHeat(dlg); }
  });
  dlg.addEventListener('mouseout', e => {
    const to = e.relatedTarget;
    if (e.target.closest('#use-bars .rc-hit') && !to?.closest?.('#use-bars .rc-hit')) hoverBar(dlg, U.barFocus);
    if (e.target.closest('#use-heat .rc-cell') && !to?.closest?.('#use-heat .rc-cell')) { heatLabels(dlg, null, null); paintHeatSide(dlg); }
    if (e.target.closest('.rc-swatch') && !to?.closest?.('.rc-swatch')) { U.heatLevel = null; restyleHeat(dlg); }
  });
  dlg.addEventListener('keydown', e => {
    const move = {ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0]}[e.key];
    if (e.target.closest?.('#use-bars svg')) {
      const n = U.lastView.buckets.length;
      if (move && move[0] === 0) { e.preventDefault(); U.barFocus = Math.max(0, Math.min(n - 1, (U.barFocus ?? (move[1] > 0 ? -1 : n)) + move[1])); hoverBar(dlg, U.barFocus); }
      else if (e.key === 'Enter' && U.barFocus != null) { e.preventDefault(); drillBar(dlg, U.barFocus); }
      else if (e.key === 'Escape' && U.barFocus != null) { e.stopPropagation(); U.barFocus = null; hoverBar(dlg, null); }
      return;
    }
    if (!e.target.closest?.('#use-heat svg')) return;
    const L = U.heatLayout;
    const at = (row, col) => L.cells.findIndex(c => c.row === row && c.col === col);
    if (move) {
      e.preventDefault();
      const cur = L.cells[U.heatFocus ?? (U.heat === 'calendar' ? L.cells.length - 1 : 0)];
      const next = U.heatFocus == null ? L.cells.indexOf(cur) : at(cur.row + move[0], cur.col + move[1]);
      if (next >= 0) { U.heatFocus = next; restyleHeat(dlg); paintHeatSide(dlg); heatLabels(dlg, L.cells[next].row, U.heat === 'hours' ? L.cells[next].col : null); }
    } else if (e.key === 'Enter' && U.heatFocus != null) {
      e.preventDefault();
      if (U.heat === 'calendar') return pickDay(dlg, U.heatFocus, e.shiftKey);
      U.heatSel = U.heatSel === U.heatFocus ? null : U.heatFocus; restyleHeat(dlg); paintHeatSide(dlg);
    } else if (e.key === 'Escape' && (U.heatSel != null || U.heatFocus != null)) {
      e.stopPropagation(); U.heatSel = U.heatFocus = null; restyleHeat(dlg); paintHeatSide(dlg); heatLabels(dlg, null, null);
    }
  });
  dlg.addEventListener('focusout', e => {
    if (e.target.closest?.('#use-heat svg') && !e.relatedTarget?.closest?.('#use-heat')) { U.heatFocus = null; restyleHeat(dlg); paintHeatSide(dlg); heatLabels(dlg, null, null); }
    if (e.target.closest?.('#use-bars svg') && !e.relatedTarget?.closest?.('#use-bars')) { U.barFocus = null; hoverBar(dlg, null); }
  });
}

/* ---------------------------------------------------------------- 自定义时段：日期区间 + 可选的整点 */
function openPicker() {
  // 从当前范围起步：预设范围取其起止日期，便于在它的基础上微调
  const base = U.range === 'custom' ? U.custom : null, win = U.lastView?.window;
  const end = base ? new Date(base.end - 1) : new Date(USAGE.NOW);
  const a = base ? new Date(base.start) : win ? new Date(Math.max(win.start, USAGE.DATA_START)) : new Date(USAGE.NOW);
  a.setHours(0, 0, 0, 0); end.setHours(0, 0, 0, 0);
  const hours = base?.hours ?? false;
  U.picker = {month: new Date(end.getFullYear(), end.getMonth(), 1), a, b: end, hours,
    h1: hours ? base.start.getHours() : 0, h2: hours ? base.h2 : 24};
}
function pickerRange(pk) {
  const b = pk.b || pk.a, first = pk.a <= b ? pk.a : b, last = pk.a <= b ? b : pk.a;
  const start = new Date(first); if (pk.hours) start.setHours(pk.h1);
  const end = new Date(last); if (pk.hours) end.setHours(pk.h2); else end.setDate(end.getDate() + 1);
  return {start, end: end > USAGE.NOW ? new Date(USAGE.NOW) : end, first, last};
}
function pickerHTML() {
  const pk = U.picker, m = pk.month;
  const startDow = (new Date(m.getFullYear(), m.getMonth(), 1).getDay() + 6) % 7;
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const {first, last} = pickerRange(pk);
  const today = new Date(USAGE.NOW); today.setHours(0, 0, 0, 0);
  // 固定 6 行，翻月时浮层高度不变
  const cells = Array.from({length: 42}, (_, k) => {
    const n = k - startDow + 1;
    if (n < 1 || n > days) return '<span class="pk-blank"></span>';
    const d = new Date(m.getFullYear(), m.getMonth(), n);
    const off = d < USAGE.DATA_START || d > today;
    const inR = d >= first && d <= last, edge = +d === +first || +d === +last;
    return `<button class="pk-day ${inR ? 'in' : ''} ${edge ? 'edge' : ''} ${+d === +today ? 'today' : ''}" data-pk-day="${+d}" ${off ? 'disabled' : ''} aria-pressed="${edge}" aria-label="${mdOf(d)}">${n}</button>`;
  }).join('');
  const canPrev = new Date(m.getFullYear(), m.getMonth(), 0) >= USAGE.DATA_START;
  const canNext = new Date(m.getFullYear(), m.getMonth() + 1, 1) <= today;
  const hourOpts = (sel, from, to) => Array.from({length: to - from + 1}, (_, k) => from + k).map(h => `<option value="${h}" ${h === sel ? 'selected' : ''}>${pad2(h)}:00</option>`).join('');
  return `<div class="pk-head"><button class="ghost-btn" data-pk="prev" aria-label="上个月" ${canPrev ? '' : 'disabled'}>${icon('chevronRight', 'sm flip')}</button>
      <b>${m.getFullYear()} 年 ${m.getMonth() + 1} 月</b><button class="ghost-btn" data-pk="next" aria-label="下个月" ${canNext ? '' : 'disabled'}>${icon('chevronRight', 'sm')}</button></div>
    <div class="pk-grid" role="group" aria-label="选择起止日期">${WEEK_MON.map(w => `<span class="pk-dow">${w}</span>`).join('')}${cells}</div>
    <div class="pk-time">
      <fieldset class="pk-hours" aria-label="起止时间" ${pk.hours ? '' : 'disabled'}>
        <label class="pk-hour"><span class="sr">开始时间</span><select class="field pk-sel" data-pk-h="h1">${hourOpts(pk.hours ? pk.h1 : 0, 0, 23)}</select>${icon('chevronDown', 'xs')}</label>
        <span class="faint">至</span>
        <label class="pk-hour"><span class="sr">结束时间</span><select class="field pk-sel" data-pk-h="h2">${hourOpts(pk.hours ? pk.h2 : 24, 1, 24)}</select>${icon('chevronDown', 'xs')}</label>
      </fieldset>
      <div class="seg on-sheet" role="group" aria-label="时间精度">
        <button class="seg-btn txt" data-pk="all-day" aria-pressed="${!pk.hours}">全天</button><button class="seg-btn txt" data-pk="hours" aria-pressed="${pk.hours}">按小时</button>
      </div>
    </div>
    <div class="pk-foot"><span class="pk-sum faint" aria-live="polite"></span>
      <button class="btn quiet sm" data-pk="cancel">取消</button><button class="btn primary sm" data-pk="apply">应用</button></div>`;
}
function updatePickerFooter(el) {
  const {start, end} = pickerRange(U.picker);
  const valid = end > start;
  const summary = $('.pk-sum', el);
  summary.textContent = valid ? customLabel({start, end, hours: U.picker.hours}) : '结束时间需晚于开始时间';
  summary.title = summary.textContent;
  summary.classList.toggle('bad-txt', !valid);
  $('[data-pk="apply"]', el).disabled = !valid;
}
function positionPicker(dlg) {
  const el = $('#use-picker', dlg), btn = $('[data-use-custom]', dlg), scroll = $('#set-body', dlg);
  if (!el || el.hidden) return;
  const anchor = btn.getBoundingClientRect(), viewport = scroll.getBoundingClientRect(), origin = el.offsetParent.getBoundingClientRect();
  const gap = 8;
  if (anchor.bottom <= viewport.top || anchor.top >= viewport.bottom) { closePicker(dlg, false); return; }
  const right = viewport.left + scroll.clientWidth - gap;
  el.style.maxWidth = `${scroll.clientWidth - gap * 2}px`;
  const left = Math.max(viewport.left + gap, Math.min(anchor.right, right) - el.offsetWidth);
  const below = viewport.bottom - anchor.bottom - gap * 2, above = anchor.top - viewport.top - gap * 2;
  const openAbove = el.scrollHeight > below && above > below;
  el.style.maxHeight = `${Math.max(0, openAbove ? above : below)}px`;
  el.style.left = `${left - origin.left}px`;
  el.style.top = `${(openAbove ? anchor.top - gap - el.offsetHeight : anchor.bottom + gap) - origin.top}px`;
}
function paintPicker(dlg, focusSelector) {
  const el = $('#use-picker', dlg);
  el.innerHTML = pickerHTML();
  updatePickerFooter(el);
  positionPicker(dlg);
  ($(focusSelector, el) || $('.pk-day.edge:not(:disabled), .pk-day:not(:disabled)', el))?.focus({preventScroll: true});
}
function closePicker(dlg, focusBack = true) {
  U.picker = null;
  const el = $('#use-picker', dlg); if (el) { el.hidden = true; el.innerHTML = ''; }
  const btn = $('[data-use-custom]', dlg); btn?.setAttribute('aria-expanded', 'false'); if (focusBack) btn?.focus({preventScroll: true});
}

function usageClick(e, dlg) {
  const pkd = e.target.closest('[data-pk-day]');
  if (pkd) { const d = new Date(+pkd.dataset.pkDay), pk = U.picker; if (pk.b) { pk.a = d; pk.b = null; } else pk.b = d; paintPicker(dlg, `[data-pk-day="${+d}"]`); return true; }
  const pkb = e.target.closest('[data-pk]');
  if (pkb) {
    const pk = U.picker;
    switch (pkb.dataset.pk) {
      case 'prev': pk.month = new Date(pk.month.getFullYear(), pk.month.getMonth() - 1, 1); break;
      case 'next': pk.month = new Date(pk.month.getFullYear(), pk.month.getMonth() + 1, 1); break;
      case 'all-day':
      case 'hours': {
        pk.hours = pkb.dataset.pk === 'hours';
        const el = $('#use-picker', dlg);
        $('[data-pk="all-day"]', el).setAttribute('aria-pressed', !pk.hours);
        $('[data-pk="hours"]', el).setAttribute('aria-pressed', pk.hours);
        $('.pk-hours', el).disabled = !pk.hours;
        $('[data-pk-h="h1"]', el).value = pk.hours ? pk.h1 : 0;
        $('[data-pk-h="h2"]', el).value = pk.hours ? pk.h2 : 24;
        updatePickerFooter(el);
        return true;
      }
      case 'cancel': closePicker(dlg); return true;
      case 'apply': { const {start, end} = pickerRange(pk); U.custom = {start, end, hours: pk.hours, h2: pk.h2}; U.range = 'custom'; U.heatSel = null; closePicker(dlg); updateUsage(dlg); return true; }
    }
    paintPicker(dlg, `[data-pk="${pkb.dataset.pk}"]:not(:disabled)`); return true;
  }
  if (e.target.closest('#use-picker')) return true;
  const customBtn = e.target.closest('[data-use-custom]');
  if (U.picker && !customBtn) closePicker(dlg, false);
  if (customBtn) {
    if (U.picker) { closePicker(dlg); return true; }
    openPicker(); $('#use-picker', dlg).hidden = false;
    customBtn.setAttribute('aria-expanded', 'true'); paintPicker(dlg, '.pk-day.edge:not(:disabled)'); return true;
  }
  const r = e.target.closest('[data-use-range]'); if (r) { U.range = r.dataset.useRange; U.heatSel = null; updateUsage(dlg); return true; }
  const p = e.target.closest('[data-use-provider]'); if (p) { U.provider = p.dataset.useProvider; U.heatSel = null; updateUsage(dlg); return true; }
  const h = e.target.closest('[data-use-heat]');
  if (h) { U.heat = h.dataset.useHeat; U.heatSel = U.heatFocus = null; $$('[data-use-heat]', dlg).forEach(b => { b.setAttribute('aria-selected', b === h); b.setAttribute('aria-checked', b === h); }); paintHeat(dlg); return true; }
  const pk = e.target.closest('[data-use-peak]');
  if (pk) { U.peak = !U.peak; pk.setAttribute('aria-pressed', U.peak); paintHeat(dlg); return true; }
  const hit = e.target.closest('#use-bars .rc-hit'); if (hit) { drillBar(dlg, +hit.dataset.i); return true; }
  const cell = e.target.closest('#use-heat .rc-cell');
  if (cell) {
    const i = +cell.dataset.i;
    if (U.heat === 'calendar') { pickDay(dlg, i, e.shiftKey); return true; }
    U.heatSel = U.heatSel === i ? null : i; restyleHeat(dlg); paintHeatSide(dlg, i); return true;
  }
  const c = e.target.closest('[data-cost-toggle]');
  if (c) { PREFS.set('costInChat', !PREFS.get('costInChat')); c.setAttribute('aria-checked', PREFS.get('costInChat')); if (typeof refreshStage === 'function') refreshStage(); return true; }
  return false;
}
/** Esc 依次退出：时段浮层 → 柱状图当前柱 → 热力图选择；都没有时交还对话框关闭。 */
function usageEscape(e) {
  const dlg = $('.dlg-settings');
  if (!dlg || !$('#use-bars', dlg) || dlgStack[dlgStack.length - 1]?.el !== dlg.parentElement) return false;
  if (U.picker) { closePicker(dlg); return true; }
  if (e.target.closest?.('#use-bars svg') && U.barFocus != null) { U.barFocus = null; hoverBar(dlg, null); return true; }
  if (e.target.closest?.('#use-heat svg') && (U.heatSel != null || U.heatFocus != null)) {
    U.heatSel = U.heatFocus = null; restyleHeat(dlg); paintHeatSide(dlg); heatLabels(dlg, null, null); return true;
  }
  return false;
}

/** 对话内的费用：回复底部一项，悬停看明细。关闭偏好时不显示。 */
function costChip() {
  if (!PREFS.get('costInChat')) return '';
  const s = USAGE.SESSION, r = s.run;
  const tip = [`估算费用 · ${s.model} · ${s.peak ? '高峰价' : '低谷价'}`, `输入 ${USAGE.tokens(r.input)}（缓存命中 ${USAGE.tokens(r.cached)}）· 输出 ${USAGE.tokens(r.output)}`,
    `本对话累计 ${USAGE.money(s.sessionCost)}`, '按官方标价估算，以账单为准'].join('\n');
  return `<span class="cost-chip" data-tip="${esc(tip)}" tabindex="0" aria-label="${esc(tip.replace(/\n/g, '，'))}">${icon('coin')}${USAGE.money(r.cost).replace('≈ ', '≈')}</span>`;
}
const runningCost = () => PREFS.get('costInChat') ? ` · ${USAGE.money(0.038)}` : '';

/* ================================================================ 模型提供商（可编辑） */
const CATALOG = {
  deepseek: [['deepseek-flash', '1M · 384K 输出 · 图片'], ['deepseek-v4-pro', '1M · 384K 输出']],
  openai: [['gpt-6.1-sol', '200K · 128K 输出 · 图片'], ['gpt-6-luna', '200K · 128K 输出 · 图片'], ['gpt-6-astra', '200K · 128K 输出 · 图片']],
  compat: [],
};
const PRESETS = {
  deepseek: {label: 'DeepSeek', mark: 'wave', base: 'https://api.deepseek.com', proto: 'chat_completions'},
  openai: {label: 'OpenAI', mark: 'hex', base: 'https://api.openai.com/v1', proto: 'responses'},
  compat: {label: 'OpenAI 兼容', mark: 'box', base: '', proto: 'chat_completions'},
};
const PROTOCOLS = [['responses', 'Responses'], ['chat_completions', 'Chat Completions']];
const PROVIDER_CFG = [
  {name: 'deepseek', preset: 'deepseek', base: 'https://api.deepseek.com', proto: 'chat_completions', key: 'sk-•••• 7c1e', models: ['deepseek-flash', 'deepseek-v4-pro'], custom: []},
  {name: 'openai', preset: 'openai', base: 'https://api.openai.com/v1', proto: 'responses', key: 'sk-•••• 41aa', models: ['gpt-6.1-sol', 'gpt-6-luna'], custom: [], voice: 'gpt-transcribe'},
  {name: 'gateway', preset: 'compat', base: 'http://127.0.0.1:8080/v1', proto: 'chat_completions', key: '', models: [],
    custom: [{id: 'gateway-qwen', ctx: '128K', out: '8K', tools: true, vision: false, think: false, price: null}]},
];
const PROV_TEST = {};

function providerIssue(p) {
  if (!p.key && p.preset !== 'compat') return '缺少密钥：编辑后填写';
  if (!p.models.length && !p.custom.length) return '没有选择模型';
  return '';
}
function providersBody() {
  return `<h2>模型提供商</h2><p class="set-lead">连接保存在本机配置文件，密钥只显示末尾几位。修改后新运行使用新值，进行中的运行不受影响。</p>
    <div class="cfg-file">${icon('fileText', 'sm')}<span class="mono">~/.config/rayagent/config.toml</span><span class="grow"></span><button class="btn line" data-prov-file>打开配置文件</button><button class="ghost-btn" data-tip="重新读取" aria-label="重新读取" data-prov-reload>${icon('repeat', 'sm')}</button></div>
    ${PROVIDER_CFG.map((p, i) => {
      const pre = PRESETS[p.preset], issue = providerIssue(p), test = PROV_TEST[p.name];
      const count = p.models.length + p.custom.length;
      return `<div class="prov"><span class="comp-ic">${icon(pre.mark, 'sm')}</span><div class="comp-main">
          <div class="comp-name">${esc(p.preset === 'compat' ? p.name : pre.label)}${issue ? '<span class="state-pill wait">不可用</span>' : `<span class="faint" style="font-weight:400">${count} 个模型${p.voice ? ' · 语音转写' : ''}</span>`}</div>
          <div class="comp-desc"><span class="mono">${esc(p.base.replace(/^https?:\/\//, ''))}</span> · ${PROTOCOLS.find(x => x[0] === p.proto)[1]}${p.key ? ` · <span class="mono">${p.key}</span>` : p.preset === 'compat' ? ' · 无密钥' : ''}</div>
          ${issue ? `<div class="comp-err">${icon('alert', 'xs')}${issue}</div>` : ''}
          ${p.custom.some(c => !c.price) ? `<div class="comp-desc faint prov-note">${icon('coin', 'xs')}自定义模型未填写单价，用量只统计 Token</div>` : ''}
          ${test ? `<div class="prov-test ${test.ok ? 'ok' : 'bad'}" role="status">${icon(test.ok ? 'check' : 'alert', 'xs')}${esc(test.text)}</div>` : ''}</div>
        <button class="btn quiet sm" data-prov-test="${i}" ${issue ? 'disabled' : ''}>测试</button>
        <button class="ghost-btn" data-prov-edit="${i}" data-tip="编辑" aria-label="编辑 ${esc(pre.label)}">${icon('pencil', 'sm')}</button></div>`;
    }).join('')}
    <button class="btn line prov-add" data-prov-add>${icon('plus', 'sm')}添加提供商</button>`;
}

/** 模拟连接测试：上游不支持时原样报出上游错误，不替用户猜测或回退。 */
function simulateTest(p) {
  if (!/^https?:\/\/[^\s/]+/.test(p.base)) return {ok: false, text: '地址需以 http:// 或 https:// 开头'};
  if (!p.key && p.preset !== 'compat') return {ok: false, text: '填写密钥后再测试'};
  if (p.preset === 'compat' && p.proto === 'responses') return {ok: false, text: '上游返回 404 Not Found：POST /v1/responses。该服务可能只支持 Chat Completions。'};
  if (p.keyChanged && /bad/i.test(p.keyChanged)) return {ok: false, text: '上游返回 401 Unauthorized：密钥无效或已停用。'};
  const n = {deepseek: 2, openai: 14, compat: 3}[p.preset];
  return {ok: true, text: `连接正常 · 上游返回 ${n} 个模型 · ${180 + Math.round(Math.random() * 240)} ms`};
}

function providersClick(e, dlg, repaint) {
  const t = e.target.closest('[data-prov-test]');
  if (t) {
    const p = PROVIDER_CFG[+t.dataset.provTest];
    t.disabled = true; t.textContent = '测试中…';
    setTimeout(() => { PROV_TEST[p.name] = simulateTest(p); repaint(); }, 700);
    return true;
  }
  const ed = e.target.closest('[data-prov-edit]'); if (ed) { openProviderDialog(+ed.dataset.provEdit, repaint); return true; }
  if (e.target.closest('[data-prov-add]')) { openProviderDialog(null, repaint); return true; }
  if (e.target.closest('[data-prov-file]')) { toast('演示：用默认编辑器打开配置文件', 'fileText'); return true; }
  if (e.target.closest('[data-prov-reload]')) { toast('已重新读取配置文件', 'repeat'); return true; }
  return false;
}

function openProviderDialog(index, onSaved) {
  const editing = index != null;
  const src = editing ? PROVIDER_CFG[index] : {name: '', preset: 'deepseek', base: PRESETS.deepseek.base, proto: PRESETS.deepseek.proto, key: '', models: [], custom: []};
  const d = JSON.parse(JSON.stringify(src));
  d.keyChanged = null; d.replacingKey = !d.key;
  let test = null, adding = false, fetched = null, busy = false;
  const dlg = openDialog(`<div class="dlg-head">${icon('spark')}<div><h2>${editing ? '编辑提供商' : '添加提供商'}</h2><div class="faint">保存后写入配置文件，新运行生效</div></div><span class="grow"></span><button class="ghost-btn" data-close aria-label="关闭">${icon('x', 'sm')}</button></div>
    <div class="dlg-body prov-form" id="pf"></div>
    <div class="dlg-foot"><span class="prov-test-slot" id="pf-test" role="status"></span><span class="grow"></span>
      ${editing ? '<button class="btn quiet danger" data-pf="delete">删除</button>' : ''}
      <button class="btn line" data-pf="test">测试连接</button><button class="btn quiet" data-close>取消</button><button class="btn primary" data-pf="save">保存</button></div>`, 'dlg-mid', null, true);

  const field = (label, html, hint = '') => `<label class="pf-field"><span class="pf-label">${label}</span>${html}${hint ? `<span class="pf-hint">${hint}</span>` : ''}</label>`;
  const paint = () => {
    const catalog = CATALOG[d.preset];
    $('#pf', dlg).innerHTML = `
      ${editing ? '' : `<div class="pf-field"><span class="pf-label">类型</span><div class="seg on-sheet" role="radiogroup" aria-label="提供商类型">${Object.entries(PRESETS).map(([k, x]) => `<button class="seg-btn txt" role="radio" data-pf-preset="${k}" aria-selected="${d.preset === k}">${icon(x.mark, 'sm')}<span>${x.label}</span></button>`).join('')}</div></div>`}
      ${d.preset === 'compat' ? field('名称', `<input class="field mono" data-pf-in="name" value="${esc(d.name)}" placeholder="例如 gateway" ${editing ? 'readonly' : ''}/>`, '字母、数字、下划线或连字符，用作配置里的键名') : ''}
      ${field('地址', `<input class="field mono" data-pf-in="base" value="${esc(d.base)}" placeholder="https://…/v1" spellcheck="false"/>`)}
      <div class="pf-field"><span class="pf-label">协议</span><div class="seg on-sheet" role="radiogroup" aria-label="协议">${PROTOCOLS.map(([k, l]) => `<button class="seg-btn txt" role="radio" data-pf-proto="${k}" aria-selected="${d.proto === k}">${l}</button>`).join('')}</div><span class="pf-hint">按上游文档选择；上游不支持时测试会直接给出上游的错误</span></div>
      <div class="pf-field"><span class="pf-label">密钥</span>${d.replacingKey
        ? `<input class="field mono" type="password" data-pf-in="keyChanged" value="${esc(d.keyChanged || '')}" placeholder="${d.preset === 'compat' ? '无需密钥可留空' : 'sk-…'}" autocomplete="off"/>${d.key ? '<button class="btn quiet sm" data-pf="keep-key">保留原密钥</button>' : ''}`
        : `<span class="pf-key mono">${icon('key', 'xs')}${d.key}</span><button class="btn quiet sm" data-pf="replace-key">更换</button>`}<span class="pf-hint">只保存在本机配置文件，不进入日志与业务数据</span></div>
      <div class="pf-field pf-models"><span class="pf-label">模型</span><div>
        ${catalog.length ? `<div class="pf-group">目录中的模型</div>${catalog.map(([id, caps]) => `<button class="pf-model" data-pf-model="${id}" aria-pressed="${d.models.includes(id)}"><span class="check ${d.models.includes(id) ? 'on' : ''}">${icon('check', 'xs')}</span><span class="mono">${id}</span><span class="faint">${caps}</span></button>`).join('')}` : ''}
        <div class="pf-group">自定义模型 <span class="faint">目录外的模型，能力按你填写的使用</span></div>
        ${d.custom.map((c, i) => `<div class="pf-custom"><span class="mono">${esc(c.id)}</span><span class="faint">${c.ctx} · ${c.out} 输出${c.tools ? ' · 工具' : ''}${c.vision ? ' · 图片' : ''}${c.think ? ' · 思考' : ''}</span><span class="grow"></span><span class="faint">${c.price ? `$${c.price.in} / $${c.price.out}` : '未填写单价'}</span><button class="ghost-btn" data-pf-rm="${i}" aria-label="移除 ${esc(c.id)}">${icon('x', 'xs')}</button></div>`).join('') || '<div class="faint pf-none">没有自定义模型</div>'}
        ${adding ? customForm() : `<div class="pf-acts"><button class="btn quiet sm" data-pf="add-custom">${icon('plus', 'xs')}添加自定义模型</button><button class="btn quiet sm" data-pf="fetch" ${busy ? 'disabled' : ''}>${icon('download', 'xs')}${busy ? '读取中…' : '从服务读取模型列表'}</button></div>`}
        ${fetched ? `<div class="pf-fetched"><span class="faint">上游返回：</span>${fetched.map(id => `<button class="chip" data-pf-pick="${id}">${esc(id)}</button>`).join('')}</div>` : ''}
      </div></div>`;
    $('#pf-test', dlg).innerHTML = test ? `<span class="prov-test ${test.ok ? 'ok' : 'bad'}">${icon(test.ok ? 'check' : 'alert', 'xs')}${esc(test.text)}</span>` : '';
  };
  const customForm = () => `<div class="pf-new">
      <div class="pf-row">${field('模型 id', `<input class="field mono" data-cm="id" placeholder="与上游请求里的 model 一致" value="${esc(d.pendingId || '')}"/>`)}</div>
      <div class="pf-row">${field('上下文窗口', '<input class="field mono" data-cm="ctx" value="128K"/>')}${field('输出上限', '<input class="field mono" data-cm="out" value="8K"/>')}</div>
      <div class="pf-row pf-caps"><span class="pf-label">能力</span>${[['tools', '工具调用', true], ['vision', '图片输入', false], ['think', '思考', false]].map(([k, l, on]) => `<button class="chip" data-cm-cap="${k}" aria-pressed="${on}">${l}</button>`).join('')}</div>
      <div class="pf-row">${field('输入单价', '<input class="field mono" data-cm="pin" placeholder="可选"/>')}${field('缓存命中', '<input class="field mono" data-cm="pcached" placeholder="可选"/>')}${field('输出单价', '<input class="field mono" data-cm="pout" placeholder="可选"/>')}</div>
      <div class="pf-acts"><span class="pf-hint">单价按美元 / 百万 Token；不填则只统计 Token。能力填错时上游会直接报错</span><span class="grow"></span><button class="btn quiet sm" data-pf="cancel-custom">取消</button><button class="btn line sm" data-pf="confirm-custom">添加</button></div></div>`;

  dlg.addEventListener('input', e => { const k = e.target.dataset.pfIn; if (k) { d[k] = e.target.value; test = null; $('#pf-test', dlg).innerHTML = ''; } });
  dlg.addEventListener('click', e => {
    const pre = e.target.closest('[data-pf-preset]');
    if (pre) { d.preset = pre.dataset.pfPreset; Object.assign(d, {base: PRESETS[d.preset].base, proto: PRESETS[d.preset].proto, models: [], name: d.preset === 'compat' ? '' : d.preset}); fetched = null; test = null; return paint(); }
    const pr = e.target.closest('[data-pf-proto]'); if (pr) { d.proto = pr.dataset.pfProto; test = null; return paint(); }
    const m = e.target.closest('[data-pf-model]');
    if (m) { const id = m.dataset.pfModel; d.models = d.models.includes(id) ? d.models.filter(x => x !== id) : [...d.models, id]; return paint(); }
    const rm = e.target.closest('[data-pf-rm]'); if (rm) { d.custom.splice(+rm.dataset.pfRm, 1); return paint(); }
    const pick = e.target.closest('[data-pf-pick]'); if (pick) { d.pendingId = pick.dataset.pfPick; adding = true; return paint(); }
    const cap = e.target.closest('[data-cm-cap]'); if (cap) { cap.setAttribute('aria-pressed', cap.getAttribute('aria-pressed') !== 'true'); return; }
    const a = e.target.closest('[data-pf]');
    if (!a) return;
    switch (a.dataset.pf) {
      case 'replace-key': d.replacingKey = true; paint(); return $('[data-pf-in="keyChanged"]', dlg)?.focus();
      case 'keep-key': d.replacingKey = false; d.keyChanged = null; return paint();
      case 'add-custom': adding = true; return paint();
      case 'cancel-custom': adding = false; d.pendingId = ''; return paint();
      case 'confirm-custom': {
        const val = k => $(`[data-cm="${k}"]`, dlg).value.trim();
        const id = val('id');
        if (!id) return toast('填写模型 id', 'alert');
        if ([...d.models, ...d.custom.map(c => c.id)].includes(id)) return toast('这个模型已在列表中', 'alert');
        const on = k => $(`[data-cm-cap="${k}"]`, dlg).getAttribute('aria-pressed') === 'true';
        const price = val('pin') && val('pout') ? {in: +val('pin'), cached: +(val('pcached') || val('pin')), out: +val('pout')} : null;
        d.custom.push({id, ctx: val('ctx') || '128K', out: val('out') || '8K', tools: on('tools'), vision: on('vision'), think: on('think'), price});
        adding = false; d.pendingId = ''; return paint();
      }
      case 'fetch':
        busy = true; paint();
        return setTimeout(() => { busy = false; fetched = {deepseek: ['deepseek-flash', 'deepseek-v4-pro'], openai: ['gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna'], compat: ['qwen3-coder', 'qwen3-max', 'glm-5']}[d.preset]; paint(); }, 600);
      case 'test':
        a.disabled = true; a.textContent = '测试中…';
        return setTimeout(() => { test = simulateTest(d); a.disabled = false; a.textContent = '测试连接'; paint(); }, 700);
      case 'delete':
        PROVIDER_CFG.splice(index, 1); closeDialog(true); toast('已从配置文件移除，使用它的会话下次运行需换模型', 'check'); return onSaved();
      case 'save': {
        if (d.preset === 'compat' && !/^[A-Za-z0-9_-]{1,64}$/.test(d.name)) return toast('名称只能包含字母、数字、下划线与连字符', 'alert');
        if (!/^https?:\/\/[^\s/]+/.test(d.base)) return toast('地址需以 http:// 或 https:// 开头', 'alert');
        if (!editing && PROVIDER_CFG.some(p => p.name === d.name)) return toast('已有同名提供商', 'alert');
        if (d.keyChanged) d.key = `${d.keyChanged.slice(0, 3)}•••• ${d.keyChanged.slice(-4)}`;
        delete d.keyChanged; delete d.replacingKey; delete d.pendingId;
        if (editing) PROVIDER_CFG[index] = d; else PROVIDER_CFG.push(d);
        PROV_TEST[d.name] = test;
        closeDialog(true); toast('已写入配置文件，新运行生效', 'check');
        return onSaved();
      }
    }
  });
  paint();
}

/* ================================================================ 语音转文字（设置项） */
const VOICE_DESC = {
  local: '在本机离线转写，不产生费用；需要「语音转写」组件，首次使用时提示安装。',
  openai: '录音发送到 OpenAI（gpt-transcribe）转写，按音频时长计费，计入用量。',
  off: '输入框不显示麦克风。',
};
function voiceRow() {
  const v = PREFS.get('voice');
  return setRow('语音转文字', `<span id="voice-desc">文字填入输入框，发送前可以修改。${VOICE_DESC[v]}</span>`,
    `<div class="seg on-sheet" role="radiogroup" aria-label="语音转文字">${[['local', '本机'], ['openai', 'OpenAI'], ['off', '关闭']].map(([k, l]) => `<button class="seg-btn txt" role="radio" data-voice-pref="${k}" aria-selected="${v === k}">${l}</button>`).join('')}</div>`);
}
function voiceClick(e, dlg) {
  const b = e.target.closest('[data-voice-pref]');
  if (!b) return false;
  PREFS.set('voice', b.dataset.voicePref);
  $$('[data-voice-pref]', dlg).forEach(x => x.setAttribute('aria-selected', x === b));
  const d = $('#voice-desc', dlg); if (d) d.textContent = `文字填入输入框，发送前可以修改。${VOICE_DESC[b.dataset.voicePref]}`;
  if (typeof renderDock === 'function') renderDock();
  return true;
}

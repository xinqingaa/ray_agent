// 知识与索引、Skill、运行组件、设置，以及撤销、版本历史等对话框。
// 依赖 app.js 中的 $、$$、esc、state、toast、go 等（调用时才取用，因此本文件可以先加载）。

const P = {
  know: {tab: 'search', q: '返点', scope: 'all', pick: 0, paused: false},
  skills: {
    filter: 'all', q: '',
    items: [
      {id: 'compete', name: '竞品分析', desc: '按维度整理竞品材料，表格中的数字标注出处。', src: '工作区', where: '季度复盘/.agents/skills/compete', ver: 'a1f3c2', on: true, inc: false, kind: 'external'},
      {id: 'minutes', name: '会议纪要', desc: '从录音或笔记整理决定、待办与风险。', src: '应用', where: '应用管理库', ver: 'v3', on: true, inc: true, kind: 'managed'},
      {id: 'table-u', name: '表格整理', desc: '清洗、合并与校验表格数据。', src: '用户', where: '~/.codex/skills/table', ver: '7be901', on: true, inc: false, kind: 'external', dup: 'table'},
      {id: 'table-a', name: '表格整理', desc: '清洗、合并与校验表格数据（旧版）。', src: '应用', where: '应用管理库', ver: 'v1', on: true, inc: true, kind: 'managed', dup: 'table'},
      {id: 'deck', name: '汇报提纲', desc: '把结论整理成两页以内的汇报结构。', src: '应用', where: '应用管理库', ver: 'v2', on: true, inc: true, kind: 'managed'},
      {id: 'pdf', name: 'pdf-tools', desc: '拆分、合并与提取 PDF 页面。', src: '额外目录', where: '~/tools/skills/pdf-tools', ver: '—', on: false, inc: false, kind: 'external', missing: true},
      {id: 'find', name: 'find-skills', desc: '寻找、核对并推荐可安装的 Skill。', src: '内置', where: '随应用发布', ver: '1.4', on: true, inc: true, kind: 'builtin'},
    ],
    prefer: null,
  },
  comps: [
    {id: 'browser', name: '自动化浏览器', icon: 'globe', size: 162, enables: '打开网页、点击与截图', without: '只能读取无需登录的公开网页正文', state: 'ready', ver: 'Chromium 131'},
    {id: 'semantic', name: '语义检索', icon: 'compass', size: 486, enables: '按意思检索材料，换一种说法也能找到', without: '知识检索只用全文匹配', state: 'none'},
    {id: 'ocr', name: '文字识别', icon: 'fileText', size: 94, enables: '读出扫描件和图片里的文字', without: '扫描件与图片不进入检索', state: 'failed', error: '校验失败：下载的文件不完整'},
  ],
  settings: {section: 'general', dirty: false, policy: null},
  styleVersions: [
    {v: 3, who: '你编辑', when: '11月12日', text: '先给结论，再给依据。数字和引述需要能回到原文；材料不足时明确说明缺了什么，不用推测补齐。\n交付表格放在「成果/」，文件名用中文。'},
    {v: 2, who: '接受了 Agent 的建议', when: '11月6日', text: '先给结论，再给依据。数字和引述需要能回到原文；材料不足时明确说明。\n交付表格放在「成果/」。'},
    {v: 1, who: '你创建', when: '10月28日', text: '先给结论，再给依据。'},
  ],
};

const CORPUS = [
  {kind: 'file', file: '竞品-A.pdf', loc: '第 5 页', text: '标准版年费 ¥4,800，渠道合作伙伴可获得 12% 返点，按季度结算。', via: '全文'},
  {kind: 'file', file: '渠道访谈纪要.md', loc: '第 2 节', text: '代理商反馈 A 的返点到账慢，平均滞后一个季度；B 的线上渠道占比已超过六成。', via: '全文'},
  {kind: 'memory', file: '记忆 · 事实', loc: '来自 上季结论.txt', text: '上季复盘里渠道返点按 8% 估算。', via: '全文'},
  {kind: 'summary', file: '定价策略讨论', loc: '会话摘要 · 11月11日', text: '讨论了渠道返点与直营折扣的取舍，决定对外报价先经市场部确认。', via: '全文'},
  {kind: 'file', file: '上季结论.txt', loc: '第 14 行', text: '渠道收入占比 31%，返点支出低于预算。', via: '全文'},
  {kind: 'file', file: '竞品-B.pdf', loc: '第 3 页', text: '自 2026 年第三季度起，不再提供年付折扣，统一按月计费 ¥420。', via: '全文'},
  {kind: 'file', file: '竞品-A.pdf', loc: '第 2 页', text: '产品分为标准版与企业版，企业版按席位报价，需要联系销售。', via: '全文'},
];

const INDEX = [
  {dir: '材料', files: [
    {name: '竞品-A.pdf', st: 'ready', meta: '9 页'}, {name: '竞品-B.pdf', st: 'ready', meta: '6 页'},
    {name: '渠道访谈纪要.md', st: 'ready', meta: '4 节'}, {name: '白板照片.png', st: 'ocr', meta: '需要文字识别'},
    {name: '上季结论.txt', st: 'stale', meta: '外部修改，等待重新索引'},
  ]},
  {dir: '合同', files: [{name: '扫描合同.pdf', st: 'failed', meta: '扫描件，需要文字识别'}, {name: '合作协议.pdf', st: 'failed', meta: 'PDF 已加密，无法读取'}]},
  {dir: '成果', files: [{name: '竞品对比表.xlsx', st: 'ready', meta: '3 个工作表'}]},
  {dir: '归档', excluded: true, count: 214, size: '1.2 GB'},
];
const ST_LABEL = {ready: '可检索', stale: '处理中', ocr: '待文字识别', failed: '失败'};

/* ================================================================ 知识 */
function renderKnowledge(stage) {
  const K = P.know;
  stage.innerHTML = `<section class="sheet">
    <div class="know-head">
      <div class="seg on-sheet" role="tablist" id="know-seg">
        <button class="seg-btn" role="tab" data-p="know-tab" data-v="search" aria-selected="${K.tab === 'search'}">${icon('search', 'sm')}<span class="seg-label">检索</span></button>
        <button class="seg-btn" role="tab" data-p="know-tab" data-v="index" aria-selected="${K.tab === 'index'}">${icon('layers', 'sm')}<span class="seg-label">索引</span></button>
      </div>
      <div class="avail" id="avail"></div>
    </div>
    <div class="know-body" id="know-body"></div></section>`;
  renderAvail();
  renderKnowBody();
}
function compState(id) { return P.comps.find(c => c.id === id).state; }
function renderAvail() {
  const el = $('#avail');
  if (!el) return;
  const sem = compState('semantic') === 'ready', ocr = compState('ocr') === 'ready';
  el.innerHTML = `<span class="av on" data-tip="全文检索随应用提供">${icon('check', 'xs')}全文</span>
    <span class="av ${sem ? 'on' : ''}" data-tip="${sem ? '语义检索已就绪' : '安装语义检索组件后可用'}">${icon(sem ? 'check' : 'dot', 'xs')}语义${sem ? '' : ' 未安装'}</span>
    <span class="av ${ocr ? 'on' : ''}">${icon(ocr ? 'check' : 'dot', 'xs')}文字识别${ocr ? '' : ' 未安装'}</span>
    ${sem && ocr ? '' : `<button class="btn line sm" data-href="#/components">安装组件</button>`}`;
}
function renderKnowBody() {
  const K = P.know;
  const body = $('#know-body');
  $$('#know-seg .seg-btn').forEach(b => b.setAttribute('aria-selected', b.dataset.v === K.tab));
  if (K.tab === 'search') {
    body.className = 'know-body split';
    body.innerHTML = `<div class="know-main">
        <label class="search-field">${icon('search')}<input id="know-q" value="${esc(K.q)}" placeholder="在 季度复盘 的材料、记忆和会话摘要里检索" autocomplete="off"/>${K.q ? `<button class="ghost-btn" data-p="know-clear" aria-label="清除">${icon('x', 'sm')}</button>` : ''}</label>
        <div class="scope" id="know-scope">${[['all', '全部'], ['file', '文件'], ['memory', '记忆'], ['summary', '会话摘要']].map(([v, l]) => `<button data-p="know-scope" data-v="${v}" aria-pressed="${K.scope === v}">${l}</button>`).join('')}</div>
        <div id="know-results"></div>
      </div>
      <aside class="know-preview" id="know-preview"></aside>`;
    renderResults();
    const q = $('#know-q');
    q.addEventListener('input', () => { K.q = q.value; K.pick = 0; renderResults(); });
    q.focus(); q.setSelectionRange(q.value.length, q.value.length);
  } else {
    body.className = 'know-body';
    body.innerHTML = indexHTML();
  }
}
function hl(text, q) {
  const t = esc(text);
  if (!q) return t;
  const terms = q.split(/\s+/).filter(Boolean).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return terms.length ? t.replace(new RegExp(`(${terms.join('|')})`, 'g'), '<mark>$1</mark>') : t;
}
function results() {
  const K = P.know;
  const terms = K.q.split(/\s+/).filter(Boolean);
  return CORPUS.filter(r => (K.scope === 'all' || r.kind === K.scope) && terms.length && terms.some(t => (r.text + r.file).includes(t)));
}
function renderResults() {
  const K = P.know;
  const list = results();
  const el = $('#know-results');
  if (!K.q.trim()) {
    el.innerHTML = `<div class="know-empty">${icon('search')}<p>输入关键词检索。Agent 在任务里用的是同一套检索，结果会出现在回复的「本次参考」里。</p>
      <div class="home-links">${['返点', '年付折扣', '线上渠道'].map(x => `<button class="soft-link" data-p="know-try" data-v="${x}">${x}</button>`).join('')}</div></div>`;
    $('#know-preview').innerHTML = '';
    return;
  }
  if (!list.length) {
    el.innerHTML = `<div class="know-empty"><p>没有找到「${esc(K.q)}」。</p><p class="faint">${compState('semantic') === 'ready' ? '换个说法试试。' : '目前只有全文匹配；安装语义检索后，换一种说法也能找到。'}</p></div>`;
    $('#know-preview').innerHTML = '';
    return;
  }
  K.pick = Math.min(K.pick, list.length - 1);
  el.innerHTML = `<div class="res-count num">${list.length} 条结果</div>` + list.map((r, i) => `
    <button class="res ${i === K.pick ? 'on' : ''}" data-p="know-pick" data-v="${i}" data-flip="r${CORPUS.indexOf(r)}">
      <span class="res-ic">${r.kind === 'file' ? fileGlyph(r.file) : icon(r.kind === 'memory' ? 'bookmark' : 'chat', 'sm')}</span>
      <span class="res-main"><span class="res-top"><b>${esc(r.file)}</b><span class="loc">${esc(r.loc)}</span></span>
        <span class="res-snip">${hl(r.text, K.q)}</span></span>
    </button>`).join('');
  renderKnowPreview(list[K.pick]);
}
function renderKnowPreview(r) {
  const el = $('#know-preview');
  if (!r) { el.innerHTML = ''; return; }
  const isFile = r.kind === 'file';
  el.innerHTML = `<div class="kp-head">${isFile ? fileGlyph(r.file) : icon(r.kind === 'memory' ? 'bookmark' : 'chat', 'sm')}<b>${esc(r.file)}</b><span class="loc">${esc(r.loc)}</span></div>
    <div class="preview-paper kp-paper">${isFile ? `<div class="pg">${esc(r.loc)}</div><p>……前文略。</p><p class="hl">${hl(r.text, P.know.q)}</p><p>……后文略。</p>` : `<p class="hl">${hl(r.text, P.know.q)}</p>`}</div>
    <div class="kp-acts">
      <button class="btn primary" data-p="know-quote">${icon('quote', 'sm')}引用到新任务</button>
      ${isFile ? `<button class="btn quiet" data-p="know-open" data-v="${esc(r.file)}">在文件夹中打开</button>` : `<button class="btn quiet" data-href="${r.kind === 'memory' ? '#/ws/review/context' : '#/ws/review/s3'}">${r.kind === 'memory' ? '在背景中查看' : '打开对话'}</button>`}
    </div>
    <p class="kp-note">${r.via === '全文' ? '全文匹配' : '语义相近'} · 文件按当前版本显示</p>`;
}
function indexHTML() {
  const files = INDEX.flatMap(d => d.files || []);
  const count = st => files.filter(f => f.st === st).length;
  const K = P.know;
  return `<div class="index-wrap">
    <div class="index-sum">
      ${[['ready', 'ok'], ['stale', 'run'], ['ocr', 'wait'], ['failed', 'bad']].map(([st, c]) => `<div class="isum ${c}"><b class="num">${count(st)}</b>${ST_LABEL[st]}</div>`).join('')}
      <div class="isum-meter" aria-hidden="true">${files.map(f => `<span class="seg-${f.st}"></span>`).join('')}</div>
      <div class="isum-scope">范围：${files.length} 个文件 · 38 MB，排除 1 个目录（214 个文件）</div>
    </div>
    <div class="index-tools">
      <button class="switch" role="switch" aria-checked="${!K.paused}" data-p="index-pause"><span>${K.paused ? '索引已暂停' : '后台索引中'}</span><span class="knob"></span></button>
      <button class="btn quiet" data-p="index-rescan">${icon('repeat', 'sm')}重新扫描</button>
      <span class="grow"></span>
      <button class="btn quiet" data-p="index-retry-all">${icon('undo', 'sm')}全部重试</button>
    </div>
    ${INDEX.map((d, di) => d.excluded ? `
      <div class="idx-dir excluded"><span class="ic-wrap">${icon('folder', 'sm')}</span><b>${d.dir}/</b><span class="meta">已排除 · ${d.count} 个文件 · ${d.size}</span>
        <button class="btn quiet sm" data-p="index-include" data-v="${di}">重新纳入</button></div>` : `
      <div class="idx-dir"><span class="ic-wrap">${icon('folderOpen', 'sm')}</span><b>${d.dir}/</b><span class="meta">${d.files.length} 个文件</span>
        <button class="btn quiet sm" data-p="index-exclude" data-v="${di}" data-tip="不再索引这个目录，文件本身不受影响">排除</button></div>
      ${d.files.map(f => `<div class="idx-row">${fileGlyph(f.name)}<span class="nm">${esc(f.name)}</span><span class="meta">${esc(f.meta)}</span>
        <span class="st st-${f.st}">${f.st === 'stale' && !K.paused ? '<span class="spin"></span>' : ''}${K.paused && f.st === 'stale' ? '已暂停' : ST_LABEL[f.st]}</span>
        ${f.st === 'failed' && f.meta.includes('加密') ? `<button class="btn quiet sm" data-p="index-retry" data-v="${esc(f.name)}">重试</button>`
          : f.st === 'ocr' || f.meta.includes('文字识别') ? `<button class="btn quiet sm" data-href="#/components">安装文字识别</button>` : '<span class="act-gap"></span>'}
      </div>`).join('')}`).join('')}
  </div>`;
}

/* ================================================================ Skill */
const SKILL_FILTERS = [['all', '全部'], ['工作区', '工作区'], ['用户', '用户目录'], ['额外目录', '额外目录'], ['应用', '应用安装'], ['内置', '内置']];
function skillListHTML() {
  const S = P.skills;
  const n = f => f === 'all' ? S.items.length : S.items.filter(x => x.src === f).length;
  const dup = S.items.some(x => x.dup) && !S.prefer;
  return `<div class="list-label">来源</div>${SKILL_FILTERS.map(([v, l]) =>
    `<button class="row" data-p="skill-filter" data-v="${v}" aria-current="${S.filter === v}"><span class="row-title">${l}</span><span class="row-meta">${n(v)}</span></button>`).join('')}
    ${dup ? `<div class="list-label">需要处理</div><button class="row" data-p="skill-filter" data-v="dup" aria-current="${S.filter === 'dup'}"><span class="row-title">同名冲突</span><span class="state-pill wait">1</span></button>` : ''}
    <div class="list-label">社区</div><button class="row" data-p="skills-sh"><span class="row-title">在 skills.sh 浏览</span>${icon('globe', 'sm')}</button>`;
}
function renderSkills(stage) {
  stage.innerHTML = `<section class="sheet"><div class="scroll"><div class="page" id="skills-page"></div></div></section>`;
  renderSkillPage();
}
function renderSkillPage() {
  const S = P.skills;
  const el = $('#skills-page');
  if (!el) return;
  let items = S.items.filter(x => S.filter === 'all' || (S.filter === 'dup' ? x.dup : x.src === S.filter));
  if (S.q) items = items.filter(x => (x.name + x.desc).includes(S.q));
  const dup = S.items.filter(x => x.dup);
  el.innerHTML = `
    <div class="page-head"><div><h1>Skill</h1><p>可复用的方法、参考资料和脚本。启用后能在输入框 <kbd>/</kbd> 里选择；「每次带上」的会出现在每次运行的目录里，Agent 按需加载。</p></div>
      <button class="btn primary magnetic" data-p="skill-add">${icon('plus', 'sm')}添加 Skill</button></div>
    <label class="search-field slim">${icon('search', 'sm')}<input id="skill-q" value="${esc(S.q)}" placeholder="搜索名称或描述"/></label>
    ${dup.length && !S.prefer ? `<div class="candidate" style="margin-top:16px">
      <div class="candidate-head">${icon('alert', 'sm')}「表格整理」有 2 份，选择时用哪一份？</div>
      <div class="versus">${dup.map(x => `<button class="pick-card" data-p="skill-prefer" data-v="${x.id}"><div class="lab">${x.src} · ${esc(x.where)}</div><div class="txt">${esc(x.desc)}</div><div class="lab">版本 ${x.ver}</div></button>`).join('')}</div>
      <div class="faint" style="font-size:12px">选择只影响同名时的默认解析；两份都会保留，输入框里仍会标出来源。</div></div>` : ''}
    <div class="skill-list">${items.map(x => `
      <div class="skill-row ${x.on ? '' : 'off'}" data-flip="${x.id}">
        <button class="skill-open" data-p="skill-open" data-v="${x.id}">
          <span class="slash-ic">${icon('spark', 'sm')}</span>
          <span class="skill-main"><span class="skill-name">${esc(x.name)}${x.missing ? '<span class="state-pill wait">目录缺失</span>' : ''}${x.dup && S.prefer === x.id ? '<span class="src-tag on">同名时优先</span>' : ''}</span>
            <span class="skill-desc">${esc(x.desc)}</span></span>
          <span class="src-tag">${x.src}</span><span class="ver num">${x.ver}</span>
        </button>
        <button class="chip-toggle" data-p="skill-inc" data-v="${x.id}" aria-pressed="${x.inc}" ${x.on ? '' : 'disabled'} data-tip="${x.inc ? '每次运行都放进目录' : '只在 / 里手动选择'}">${icon('layers', 'xs')}每次带上</button>
        <button class="switch" role="switch" aria-checked="${x.on}" data-p="skill-on" data-v="${x.id}" ${x.missing ? 'disabled' : ''} aria-label="启用 ${esc(x.name)}"><span class="knob"></span></button>
      </div>`).join('') || '<div class="lane-empty">没有符合条件的 Skill</div>'}</div>`;
  const q = $('#skill-q');
  q.addEventListener('input', () => { S.q = q.value; const pos = q.selectionStart; renderSkillPage(); const n = $('#skill-q'); n.focus(); n.setSelectionRange(pos, pos); });
  bindMagnetic(el);
}
const SKILL_FILES = {
  'SKILL.md': `<h2>竞品分析</h2><p>按固定维度整理竞品材料，所有数字都要能回到原文。</p><h3>步骤</h3><ol><li>列出要比较的维度（价格、渠道、返点、备注）。</li><li>逐份读取材料，记录出处页码。</li><li>运行 <code>scripts/score.py</code> 汇总成表。</li></ol><h3>注意</h3><p>材料里没有的数据写“未公开”，不要推测。</p>`,
  'references/维度说明.md': `<h2>维度说明</h2><p>渠道统一分为直营、渠道、线上三类；返点按合同口径记录。</p>`,
  'scripts/score.py': `<pre class="code">import pandas as pd\n\ndef build(rows):\n    df = pd.DataFrame(rows)\n    return df.pivot(index="维度", columns="竞品")</pre>`,
  'assets/模板.xlsx': `<div class="faint">表格文件 · 12 KB · 运行时可由脚本读取</div>`,
};
function openSkill(id) {
  const x = P.skills.items.find(s => s.id === id);
  let file = 'SKILL.md', source = false;
  const dlg = openDialog(`
    <div class="dlg-head">${icon('spark')}<div><h2>${esc(x.name)}</h2><div class="faint mono">${esc(x.where)}</div></div>
      <span class="src-tag">${x.src}</span><span class="ver num">${x.ver}</span><span class="grow"></span>
      ${x.kind === 'managed' ? `<button class="btn quiet" data-p="skill-edit">${icon('pencil', 'sm')}编辑正文</button>` : ''}
      <button class="ghost-btn" data-close aria-label="关闭" data-tip="关闭  esc">${icon('x', 'sm')}</button></div>
    <div class="reader"><nav class="reader-tree">${Object.keys(SKILL_FILES).map(f => `<button class="tree-row ${f === file ? 'sel' : ''}" data-file="${f}">${f.endsWith('.md') ? icon('fileText', 'sm') : f.endsWith('.py') ? icon('terminal', 'sm') : fileGlyph(f)}<span class="nm">${f}</span></button>`).join('')}</nav>
      <div class="reader-body"><div class="reader-tools"><span class="mono faint" id="reader-path">${file}</span><span class="grow"></span>
        <div class="seg on-sheet" id="reader-seg"><button class="seg-btn" data-mode="r" aria-selected="true">${icon('eye', 'sm')}<span class="seg-label">渲染</span></button><button class="seg-btn" data-mode="s" aria-selected="false">${icon('terminal', 'sm')}<span class="seg-label">源码</span></button></div></div>
        <article class="reply md" id="reader-doc"></article></div></div>
    <div class="dlg-foot"><span class="faint">${x.kind === 'external' ? '外部目录只读引用；移除引用不会删除你的文件。' : x.kind === 'builtin' ? '内置 Skill 可以停用，随应用升级更新。' : '已有运行固定使用当时的版本，修改影响之后的运行。'}</span><span class="grow"></span>
      ${x.kind === 'builtin' ? '' : `<button class="btn quiet danger" data-close>${x.kind === 'external' ? '移除引用' : '删除'}</button>`}
      <button class="btn line" data-close>完成</button></div>`, 'dlg-wide');
  const paint = () => {
    const html = SKILL_FILES[file];
    $('#reader-doc', dlg).innerHTML = source && file.endsWith('.md') ? `<pre class="code">${esc(html.replace(/<[^>]+>/g, m => m.startsWith('</') ? '\n' : m === '<li>' ? '- ' : m === '<h2>' ? '# ' : m === '<h3>' ? '## ' : ''))}</pre>` : html;
    $('#reader-path', dlg).textContent = file;
    $$('.reader-tree .tree-row', dlg).forEach(b => b.classList.toggle('sel', b.dataset.file === file));
    $$('#reader-seg .seg-btn', dlg).forEach(b => b.setAttribute('aria-selected', (b.dataset.mode === 's') === source));
  };
  dlg.addEventListener('click', e => {
    const f = e.target.closest('[data-file]'); if (f) { file = f.dataset.file; paint(); }
    const m = e.target.closest('[data-mode]'); if (m) { source = m.dataset.mode === 's'; paint(); }
  });
  paint();
}
function openSkillAdd() {
  let mode = 'gh', step = 'input';
  const dlg = openDialog(`<div class="dlg-head"><h2>添加 Skill</h2><span class="grow"></span><button class="ghost-btn" data-close aria-label="关闭">${icon('x', 'sm')}</button></div>
    <div class="dlg-body"><div class="seg on-sheet" id="add-seg">
      <button class="seg-btn" data-m="gh" aria-selected="true">${icon('globe', 'sm')}<span class="seg-label">GitHub</span></button>
      <button class="seg-btn" data-m="local" aria-selected="false">${icon('folder', 'sm')}<span class="seg-label">本地文件</span></button>
      <button class="seg-btn" data-m="write" aria-selected="false">${icon('pencil', 'sm')}<span class="seg-label">直接编写</span></button></div>
      <div id="add-body" class="add-body"></div></div>
    <div class="dlg-foot"><span class="faint" id="add-note">安装只表示包已校验并登记，依赖要在使用时核对。</span><span class="grow"></span><button class="btn quiet" data-close>取消</button><button class="btn primary" id="add-go">获取</button></div>`, 'dlg-mid');
  const paint = () => {
    $$('#add-seg .seg-btn', dlg).forEach(b => b.setAttribute('aria-selected', b.dataset.m === mode));
    const body = $('#add-body', dlg), go = $('#add-go', dlg);
    if (mode === 'gh') {
      body.innerHTML = step === 'input' ? `<label class="search-field slim">${icon('globe', 'sm')}<input placeholder="https://github.com/用户/仓库/tree/main/skills/…" value="https://github.com/acme/skills/tree/main/deck-builder"/></label><p class="faint">公开仓库即可，获取后直接打开内容，确认再安装。</p>`
        : step === 'loading' ? `<div class="fetching"><span class="spin"></span>正在获取并校验…</div>`
        : `<div class="found">${icon('spark')}<div><b>deck-builder</b><div class="faint">把要点整理成演示提纲 · 4 个文件 · 18 KB</div></div><span class="src-tag">GitHub</span></div>
           <div class="found-files">${['SKILL.md', 'references/结构.md', 'scripts/outline.py', 'assets/封面.png'].map(f => `<span>${f}</span>`).join('')}</div>`;
      go.textContent = step === 'ready' ? '安装' : '获取'; go.disabled = step === 'loading';
    } else if (mode === 'local') {
      body.innerHTML = `<div class="drop-target local-drop">${icon('inbox')}<b>拖入文件夹、ZIP 或 Markdown</b><span class="hint">也可以点这里从磁盘选择；缺少名称和描述时会补上</span></div>`;
      go.textContent = '选择文件'; go.disabled = false;
    } else {
      body.innerHTML = `<input class="field" placeholder="名称" value="周报整理"/><input class="field" placeholder="一句话描述：什么时候用" value="把一周的对话和成果整理成周报"/><textarea class="field" rows="6" placeholder="正文（Markdown）">## 步骤\n1. 列出本周完成的任务与成果\n2. 标出未完成项与原因</textarea>`;
      go.textContent = '保存'; go.disabled = false;
    }
  };
  dlg.addEventListener('click', e => {
    const m = e.target.closest('[data-m]'); if (m) { mode = m.dataset.m; step = 'input'; paint(); }
    if (e.target.closest('#add-go')) {
      if (mode === 'gh' && step === 'input') { step = 'loading'; paint(); setTimeout(() => { step = 'ready'; paint(); }, 1100); return; }
      const name = mode === 'gh' ? 'deck-builder' : mode === 'write' ? '周报整理' : '本地 Skill';
      P.skills.items.splice(P.skills.items.length - 1, 0, {id: 'new' + Date.now(), name, desc: mode === 'gh' ? '把要点整理成演示提纲。' : '把一周的对话和成果整理成周报。', src: '应用', where: '应用管理库', ver: 'v1', on: true, inc: true, kind: 'managed'});
      closeDialog(); withFlip(renderSkillPage); toast(`已安装「${name}」，可以在 / 里选择`, 'spark');
    }
  });
  paint();
}

/* ================================================================ 运行组件 */
function renderComponents(stage) {
  stage.innerHTML = `<section class="sheet"><div class="scroll"><div class="page" id="comp-page"></div></div></section>`;
  renderCompPage();
}
function renderCompPage() {
  const el = $('#comp-page');
  if (!el) return;
  el.innerHTML = `<div class="page-head"><div><h1>运行组件</h1><p>按需下载的本机组件。安装在后台进行，离开这个页面或重启应用都不会中断。</p></div></div>
    <div class="comp-list">${P.comps.map(c => `
      <div class="comp ${c.state}" id="comp-${c.id}">
        <span class="comp-ic">${icon(c.icon)}</span>
        <div class="comp-main"><div class="comp-name">${c.name}${c.state === 'ready' ? `<span class="tag ok">${icon('check')}就绪</span>` : ''}</div>
          <div class="comp-desc">${c.enables}</div>
          ${c.state === 'installing' ? `<div class="comp-prog"><span class="track"><span class="fill" style="width:${c.pct}%"></span></span><span class="num">${c.phase} ${c.phase === '下载' ? `${Math.round(c.size * c.pct / 100)} / ${c.size} MB` : ''}</span></div>`
            : c.state === 'failed' ? `<div class="comp-err">${icon('alert', 'xs')}${esc(c.error)}</div>`
            : c.state === 'none' ? `<div class="comp-without">未安装时：${c.without}</div>`
            : `<div class="comp-without">${c.ver}</div>`}
        </div>
        <div class="comp-side"><span class="faint num">${c.size} MB</span>
          ${c.state === 'none' ? `<button class="btn primary" data-p="comp-install" data-v="${c.id}">安装</button>`
            : c.state === 'installing' ? `<button class="btn quiet" data-p="comp-cancel" data-v="${c.id}">取消</button>`
            : c.state === 'failed' ? `<button class="btn line" data-p="comp-install" data-v="${c.id}">${icon('repeat', 'sm')}重试</button>`
            : `<button class="ghost-btn" data-tip="更多" aria-label="更多">${icon('more', 'sm')}</button>`}</div>
      </div>`).join('')}</div>`;
}
function installComp(id) {
  const c = P.comps.find(x => x.id === id);
  c.state = 'installing'; c.pct = 0; c.phase = '下载';
  renderCompPage();
  const tick = () => {
    if (c.state !== 'installing') return;
    c.pct = Math.min(100, c.pct + 7 + Math.random() * 9);
    if (c.pct >= 100 && c.phase === '下载') { c.phase = '校验'; c.pct = 100; }
    else if (c.phase === '校验') { c.state = 'ready'; c.ver = id === 'semantic' ? 'E5 多语言 · LanceDB' : 'PaddleOCR 中英文'; renderCompPage(); renderAvail(); toast(`${c.name}已就绪`, 'check'); return; }
    const row = $(`#comp-${id}`);
    if (row) { row.querySelector('.fill').style.width = c.pct + '%'; row.querySelector('.comp-prog .num').textContent = `${c.phase} ${c.phase === '下载' ? `${Math.round(c.size * c.pct / 100)} / ${c.size} MB` : ''}`; }
    setTimeout(tick, c.phase === '校验' ? 900 : 260);
  };
  setTimeout(tick, 300);
}

/* ================================================================ 设置（覆盖应用的弹层，底层页面保持） */
const SECTIONS = [
  ['general', '通用', 'settings'], ['workspace', '工作区', 'folder'], ['appearance', '外观', 'sun'],
  ['llm', '模型提供商', 'spark'], ['policy', '工具策略', 'shield'], ['mcp', 'MCP 服务器', 'box'],
  ['a2a', '远程 Agent', 'globe'], ['data', '数据管理', 'inbox'],
];
const POLICY = [
  ['读取与搜索文件', '内置', 'auto'], ['写入文件', '内置', 'auto'], ['运行命令', '本机执行', 'ask'],
  ['操作浏览器', '自动化浏览器', 'ask'], ['飞书文档 · 创建文档', 'MCP', 'ask'], ['数据分析 Agent', '远程委派', 'ask'], ['删除文件', '内置', 'ask'],
];
function openSettings(section) {
  const S = P.settings;
  if (section) S.section = section;
  S.policy = POLICY.map(p => p[2]);
  S.dirty = false;
  const dlg = openDialog(`<div class="settings">
      <nav class="set-nav">${SECTIONS.map(([k, l, ic]) => `<button class="row" data-sec="${k}" aria-current="${S.section === k}">${icon(ic, 'sm')}<span class="row-title">${l}</span></button>`).join('')}
        <div class="rail-sep" style="margin:10px 8px;width:auto"></div>
        <button class="row" data-goto="#/skills">${icon('spark', 'sm')}<span class="row-title">Skill</span>${icon('chevronRight', 'xs')}</button>
        <button class="row" data-goto="#/components">${icon('box', 'sm')}<span class="row-title">运行组件</span>${icon('chevronRight', 'xs')}</button></nav>
      <div class="set-main"><div class="set-scroll" id="set-body"></div>
        <div class="savebar" id="savebar"><span>${icon('alert', 'sm')}有未保存的修改</span><span class="grow"></span><button class="btn quiet" data-save="revert">撤销</button><button class="btn primary" data-save="save">保存</button></div></div>
      <button class="ghost-btn set-close" data-close aria-label="关闭" data-tip="关闭  esc">${icon('x', 'sm')}</button></div>`, 'dlg-settings', () => {
    if (!S.dirty) return true;
    const bar = $('#savebar'); bar.classList.remove('shake'); bar.offsetWidth; bar.classList.add('shake');
    toast('先保存或撤销修改再关闭', 'alert');
    return false;
  });
  const paint = () => { $$('.set-nav [data-sec]', dlg).forEach(b => b.setAttribute('aria-current', b.dataset.sec === S.section)); $('#set-body', dlg).innerHTML = settingsBody(S.section); $('#set-body', dlg).scrollTop = 0; };
  dlg.addEventListener('click', e => {
    const sec = e.target.closest('[data-sec]'); if (sec) { S.section = sec.dataset.sec; return paint(); }
    const g = e.target.closest('[data-goto]'); if (g) { if (S.dirty) return toast('先保存或撤销修改', 'alert'); closeDialog(true); return go(g.dataset.goto); }
    const pol = e.target.closest('[data-pol]');
    if (pol) {
      const [i, v] = pol.dataset.pol.split(':');
      S.policy[+i] = v;
      S.dirty = S.policy.some((x, k) => x !== POLICY[k][2]);
      $$(`[data-pol^="${i}:"]`, dlg).forEach(b => b.setAttribute('aria-selected', b.dataset.pol === pol.dataset.pol));
      $('#savebar', dlg).classList.toggle('show', S.dirty);
      return;
    }
    const sv = e.target.closest('[data-save]');
    if (sv) {
      if (sv.dataset.save === 'save') { POLICY.forEach((p, k) => { p[2] = S.policy[k]; }); toast('工具策略已保存，新运行生效', 'check'); }
      else S.policy = POLICY.map(p => p[2]);
      S.dirty = false; $('#savebar', dlg).classList.remove('show'); return paint();
    }
    const th = e.target.closest('[data-theme]');
    if (th) { document.documentElement.classList.toggle('dark', th.dataset.theme === 'dark'); renderRail(); syncRail(); $$('[data-theme]', dlg).forEach(b => b.setAttribute('aria-selected', b === th)); return; }
    const sz = e.target.closest('[data-size]');
    if (sz) { document.documentElement.style.setProperty('--read-scale', sz.dataset.size); $$('[data-size]', dlg).forEach(b => b.setAttribute('aria-selected', b === sz)); return; }
    const sw = e.target.closest('.switch'); if (sw && !sw.disabled) { sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') !== 'true'); return; }
    if (e.target.closest('[data-wipe]')) return openWipe();
  });
  paint();
}
function setRow(title, desc, control) { return `<div class="set-row"><div><div class="set-title">${title}</div>${desc ? `<div class="set-desc">${desc}</div>` : ''}</div><div class="set-ctl">${control}</div></div>`; }
function settingsBody(k) {
  const sw = on => `<button class="switch" role="switch" aria-checked="${on}"><span class="knob"></span></button>`;
  const dark = document.documentElement.classList.contains('dark');
  switch (k) {
    case 'general': return `<h2>通用</h2>${setRow('开发者模式', '显示日志、终端、上下文容量与请求原文。只改变展示，不改变执行。', sw(false))}${setRow('任务完成时通知', '你不在这个对话时，用系统通知告诉你结果。', sw(true))}${setRow('退出前确认', '有任务在运行时，退出应用前先确认。', sw(true))}`;
    case 'workspace': return `<h2>工作区</h2>${setRow('新建工作区的位置', '<span class="mono">~/Documents/RayAgent</span>', '<button class="btn line">更改</button>')}${setRow('本机执行', '运行命令与脚本按工作区单独开启，在工作区菜单里设置。', '<span class="faint">按工作区</span>')}`;
    case 'appearance': return `<h2>外观</h2>${setRow('主题', '', `<div class="seg on-sheet"><button class="seg-btn" data-theme="light" aria-selected="${!dark}">${icon('sun', 'sm')}<span class="seg-label">浅色</span></button><button class="seg-btn" data-theme="dark" aria-selected="${dark}">${icon('moon', 'sm')}<span class="seg-label">深色</span></button></div>`)}${setRow('阅读字号', '只放大文字，间距和图标不变。', `<div class="seg on-sheet">${[['0.93', '小'], ['1', '标准'], ['1.1', '大']].map(([v, l]) => `<button class="seg-btn txt" data-size="${v}" aria-selected="${v === '1'}">${l}</button>`).join('')}</div>`)}`;
    case 'llm': return `<h2>模型提供商</h2><p class="set-lead">地址、密钥和可用模型写在配置文件里，这里只读展示。保存文件后新运行即用新值。</p>
      <div class="cfg-file">${icon('fileText', 'sm')}<span class="mono">~/.rayagent/models.toml</span><span class="grow"></span><button class="btn line">打开配置文件</button><button class="ghost-btn" data-tip="重新读取" aria-label="重新读取">${icon('repeat', 'sm')}</button></div>
      ${[['Anthropic', 'spark', 'api.anthropic.com', 'Messages', 'sk-ant-•••• 9f2c', 3, ''], ['OpenAI', 'hex', 'api.openai.com', 'Responses', 'sk-•••• 41aa', 1, ''], ['DeepSeek', 'wave', 'api.deepseek.com', 'Chat Completions', '', 1, '缺少密钥：在配置文件里填写 api_key']].map(([n, ic, host, proto, key, cnt, err]) => `
        <div class="prov"><span class="comp-ic">${icon(ic, 'sm')}</span><div class="comp-main"><div class="comp-name">${n}${err ? '<span class="state-pill wait">不可用</span>' : `<span class="faint" style="font-weight:400">${cnt} 个模型</span>`}</div>
          <div class="comp-desc"><span class="mono">${host}</span> · ${proto}${key ? ` · <span class="mono">${key}</span>` : ''}</div>${err ? `<div class="comp-err">${icon('alert', 'xs')}${err}</div>` : ''}</div></div>`).join('')}`;
    case 'policy': return `<h2>工具策略</h2><p class="set-lead">具体规则优先于整类规则。批准只针对那一次调用。</p>
      <div class="policy">${POLICY.map(([n, src], i) => `<div class="pol-row"><div><div class="set-title">${n}</div><div class="set-desc">${src}</div></div>
        <div class="seg on-sheet">${[['auto', '直接执行'], ['ask', '先问我'], ['deny', '禁止']].map(([v, l]) => `<button class="seg-btn txt" data-pol="${i}:${v}" aria-selected="${P.settings.policy[i] === v}">${l}</button>`).join('')}</div></div>`).join('')}</div>`;
    case 'mcp': return `<h2>MCP 服务器</h2>${[['飞书文档', '已连接 · 12 个工具', 'ok'], ['内部知识库', '连接失败：服务未响应', 'bad']].map(([n, s, c]) => `<div class="prov"><span class="comp-ic">${icon('box', 'sm')}</span><div class="comp-main"><div class="comp-name">${n}</div><div class="comp-desc ${c === 'bad' ? 'bad-txt' : ''}">${s}</div></div>${c === 'bad' ? '<button class="btn line">重试</button>' : sw(true)}</div>`).join('')}<p class="faint" style="margin-top:14px">连接的添加与编辑在开发者模式中提供。</p>`;
    case 'a2a': return `<h2>远程 Agent</h2><div class="prov"><span class="comp-ic">${icon('globe', 'sm')}</span><div class="comp-main"><div class="comp-name">数据分析 Agent</div><div class="comp-desc">可用 · 委派前先问你</div></div>${sw(true)}</div>`;
    case 'data': return `<h2>数据管理</h2>${setRow('数据位置', '<span class="mono">~/Library/Application Support/RayAgent</span>', '<button class="btn line">在 Finder 中显示</button>')}
      <div class="danger-zone"><div><div class="set-title">清空全部数据</div><div class="set-desc">删除全部对话、附件和工作区登记；不删除工作区文件夹和其中的文件，保留模型、服务配置与 Skill。不可恢复。</div></div><button class="btn line danger" data-wipe>清空…</button></div>`;
  }
}
function openWipe() {
  const dlg = openDialog(`<div class="dlg-head"><h2>清空全部数据？</h2></div>
    <div class="dlg-body"><p>将删除 <b>12 个对话</b>、<b>3 个工作区登记</b> 与全部附件。工作区文件夹和其中的文件不会被删除。</p>
      <p class="faint">输入「清空全部数据」以确认：</p><input class="field" id="wipe-in" autocomplete="off"/></div>
    <div class="dlg-foot"><span class="grow"></span><button class="btn line" data-close id="wipe-cancel">取消</button><button class="btn primary danger-fill" id="wipe-go" disabled>清空</button></div>`, 'dlg-small', null, true);
  const inp = $('#wipe-in', dlg);
  $('#wipe-cancel', dlg).focus();
  inp.addEventListener('input', () => { $('#wipe-go', dlg).disabled = inp.value !== '清空全部数据'; });
  $('#wipe-go', dlg).addEventListener('click', () => { closeDialog(); toast('原型：不会真的清空', 'alert'); });
}

/* ================================================================ 撤销本次修改 */
const UNDO_ITEMS = [
  {path: '成果/竞品对比表.xlsx', op: '新建', st: 'ok', note: '撤销后移除这个文件', size: '9 KB', bin: true},
  {path: '材料/渠道访谈纪要.md', op: '修改', st: 'conflict', note: '运行之后又被改动过（14:52，外部程序）', force: true,
    diff: [['-', '代理商反馈 A 的返点到账慢，平均滞后一个季度；'], ['+', '代理商反馈 A 的返点到账慢，平均滞后一个季度，6 家中有 4 家提到；'], [' ', 'B 的线上渠道占比已超过六成。']]},
  {path: '成果/build_table.py', op: '新建', st: 'same', note: '已经是运行前的状态'},
  {path: '材料/白板照片.png', op: '修改', st: 'ok', note: '二进制文件 · 2.1 MB，不显示差异', bin: true},
];
function openUndo() {
  const sel = UNDO_ITEMS.map(x => x.st === 'ok');
  const force = UNDO_ITEMS.map(() => false);
  const open = UNDO_ITEMS.map(() => false);
  let done = false;
  const dlg = openDialog(`<div class="dlg-head">${icon('undo')}<div><h2>撤销「整理竞品表」的修改</h2><div class="faint">只恢复文件内容，不改变对话和记忆</div></div><span class="grow"></span><button class="ghost-btn" data-close aria-label="关闭">${icon('x', 'sm')}</button></div>
    <div class="dlg-body undo-list" id="undo-list"></div>
    <div class="dlg-foot"><span class="faint" id="undo-note"></span><span class="grow"></span><button class="btn quiet" data-close>取消</button><button class="btn primary" id="undo-go"></button></div>`, 'dlg-mid');
  const paint = () => {
    $('#undo-list', dlg).innerHTML = UNDO_ITEMS.map((x, i) => {
      const canPick = x.st === 'ok' || (x.st === 'conflict' && x.force);
      const res = done && sel[i] ? `<span class="tag ok">${icon('check')}已恢复</span>` : '';
      return `<div class="undo-item ${x.st}">
        <div class="undo-row">
          <button class="check ${sel[i] ? 'on' : ''}" data-u="sel:${i}" ${canPick && !done && (x.st !== 'conflict' || force[i]) ? '' : 'disabled'} aria-label="选择">${icon('check', 'xs')}</button>
          ${fileGlyph(x.path)}<div class="undo-main"><div><span class="mono">${esc(x.path)}</span><span class="tag">${x.op}</span>${res}</div>
            <div class="undo-note ${x.st === 'conflict' ? 'wait-txt' : ''}">${esc(x.note)}</div></div>
          ${x.diff ? `<button class="ghost-btn" data-u="diff:${i}" aria-expanded="${open[i]}" data-tip="查看撤销后的差异">${icon('chevronDown', 'sm')}</button>` : '<span class="act-gap"></span>'}
        </div>
        ${x.st === 'conflict' && !done ? `<label class="force"><button class="check ${force[i] ? 'on' : ''}" data-u="force:${i}" aria-label="仍要覆盖">${icon('check', 'xs')}</button>仍要覆盖：会丢掉运行之后的改动</label>` : ''}
        ${x.diff ? `<div class="collapse ${open[i] ? 'open' : ''}"><div><div class="code diffcode">${x.diff.map(([s, t]) => `<div class="dl ${s === '-' ? 'del' : s === '+' ? 'add' : ''}"><span>${s}</span>${esc(t)}</div>`).join('')}</div></div></div>` : ''}
      </div>`;
    }).join('');
    const n = sel.filter(Boolean).length;
    const btn = $('#undo-go', dlg);
    btn.textContent = done ? '完成' : `撤销选中的 ${n} 项`;
    btn.disabled = !done && !n;
    $('#undo-note', dlg).textContent = done ? '这次撤销记在「最近修改」里，可以撤回' : '';
  };
  dlg.addEventListener('click', e => {
    const u = e.target.closest('[data-u]');
    if (u && !u.disabled) {
      const [k, i] = u.dataset.u.split(':');
      if (k === 'sel') sel[i] = !sel[i];
      if (k === 'force') { force[i] = !force[i]; sel[i] = force[i]; }
      if (k === 'diff') { open[i] = !open[i]; u.setAttribute('aria-expanded', open[i]); u.closest('.undo-item').querySelector('.collapse').classList.toggle('open', open[i]); return; }
      paint();
    }
    if (e.target.closest('#undo-go')) {
      if (done) return closeDialog();
      const b = $('#undo-go', dlg); b.innerHTML = '<span class="spin"></span>正在恢复'; b.disabled = true;
      setTimeout(() => { done = true; paint(); }, 800);
    }
  });
  paint();
}

/* ================================================================ 工作方式：版本历史与「改一下再接受」 */
function openStyleHistory() {
  let pick = 1;
  const versions = () => [{...P.styleVersions[0], v: state.style.version, text: state.style.text, who: state.style.updated.split(' · ')[1] || '当前', when: state.style.updated.split(' · ')[0]}, ...P.styleVersions.filter(x => x.v < state.style.version)];
  const dlg = openDialog(`<div class="dlg-head">${icon('history')}<h2>工作方式的版本</h2><span class="grow"></span><button class="ghost-btn" data-close aria-label="关闭">${icon('x', 'sm')}</button></div>
    <div class="hist"><nav class="hist-list" id="hist-list"></nav><div class="hist-body" id="hist-body"></div></div>
    <div class="dlg-foot"><span class="faint">恢复会另存为一个新版本，不删除任何历史。已开始的任务保留原版本。</span><span class="grow"></span><button class="btn line" id="hist-restore">以这个版本另存</button></div>`, 'dlg-wide');
  const paint = () => {
    const vs = versions();
    pick = Math.min(pick, vs.length - 1);
    $('#hist-list', dlg).innerHTML = vs.map((x, i) => `<button class="row" data-h="${i}" aria-current="${i === pick}"><span class="row-title">v${x.v}${i === 0 ? '<span class="src-tag on" style="margin-left:6px">当前</span>' : ''}</span><span class="row-meta">${x.when}</span></button>`).join('');
    const cur = vs[0], sel = vs[pick];
    $('#hist-body', dlg).innerHTML = `<div class="faint" style="margin-bottom:8px">v${sel.v} · ${esc(sel.who)}${pick ? ` · 与当前 v${cur.v} 的差异` : ''}</div>
      <div class="diff hist-doc">${pick ? lineDiff(sel.text, cur.text) : esc(cur.text)}</div>`;
    $('#hist-restore', dlg).disabled = pick === 0;
  };
  dlg.addEventListener('click', e => {
    const h = e.target.closest('[data-h]'); if (h) { pick = +h.dataset.h; paint(); }
    if (e.target.closest('#hist-restore')) {
      const sel = versions()[pick];
      P.styleVersions.unshift({v: state.style.version, who: '你编辑', when: '刚刚', text: state.style.text});
      state.style.version += 1; state.style.text = sel.text; state.style.html = null; state.style.updated = `刚刚 · 从 v${sel.v} 恢复`;
      closeDialog(); renderContext(); toast(`已另存为 v${state.style.version}`, 'check');
    }
  });
  paint();
}
function lineDiff(oldT, newT) {
  // 选中版本 → 当前版本：被当前版本删去的标红，新增的标绿
  const a = oldT.split('\n'), b = newT.split('\n');
  return b.map((line, i) => {
    const o = a[i] ?? '';
    if (o === line) return esc(line);
    return diffHTML(o, line).replace(/^<span[^>]*>…<\/span>|<span[^>]*>…<\/span>$/g, '');
  }).join('\n');
}
function editProposal() {
  const card = $('#proposal');
  const p = state.proposal;
  card.querySelector('.diff').outerHTML = `<textarea class="field prop-edit" rows="2">${esc(p.after)}</textarea>`;
  card.querySelector('.proposal-acts').innerHTML = `<button class="btn primary" data-p="prop-save">接受改过的</button><button class="btn quiet" data-p="prop-cancel">取消</button>`;
  const ta = card.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* ================================================================ 对话框基础：遮罩、焦点、Esc、关闭保护 */
let dlgStack = [];
function openDialog(inner, cls = '', guard = null, stacked = false) {
  if (!stacked) dlgStack.forEach(d => d.el.remove()), dlgStack = [];
  const back = document.activeElement;
  const el = document.createElement('div');
  el.className = 'scrim';
  el.innerHTML = `<div class="dialog ${cls}" role="dialog" aria-modal="true" tabindex="-1">${inner}</div>`;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const dlg = el.firstElementChild;
  dlg.focus();
  dlgStack.push({el, back, guard});
  dlg.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDialog(); });
  // 点击遮罩不关闭，避免误触丢失内容
  return dlg;
}
function closeDialog(force = false) {
  const top = dlgStack[dlgStack.length - 1];
  if (!top) return false;
  if (!force && top.guard && !top.guard()) return true;
  dlgStack.pop();
  top.el.classList.remove('show');
  top.el.classList.add('hide');
  setTimeout(() => top.el.remove(), 220);
  top.back?.focus?.();
  return true;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && dlgStack.length) { e.stopImmediatePropagation(); closeDialog(); }
}, true);

/* ================================================================ 页面级点击 */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-p]');
  if (!t || t.disabled) return;
  const v = t.dataset.v;
  const K = P.know, S = P.skills;
  switch (t.dataset.p) {
    case 'know-tab': K.tab = v; return renderKnowBody();
    case 'know-scope': K.scope = v; K.pick = 0; $$('#know-scope button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v)); return withFlip(renderResults);
    case 'know-pick': K.pick = +v; $$('.res').forEach((r, i) => r.classList.toggle('on', i === K.pick)); return renderKnowPreview(results()[K.pick]);
    case 'know-clear': K.q = ''; return renderKnowBody();
    case 'know-try': K.q = v; return renderKnowBody();
    case 'know-quote': { const r = results()[K.pick]; state.quotes.push(`${r.file} ${r.loc}`); toast('已引用，回到对话即可带上发送', 'quote'); return; }
    case 'know-open': state.insp.preview = v; state.insp.open = true; return go(`#/ws/${state.route.ws}/${state.lastSession?.[state.route.ws] || 's1'}`);
    case 'index-pause': K.paused = !K.paused; renderKnowBody(); return toast(K.paused ? '已暂停后台索引，已完成的仍可检索' : '已继续索引', 'layers');
    case 'index-rescan': return toast('正在重新扫描文件夹', 'repeat');
    case 'index-retry-all': case 'index-retry': {
      INDEX.forEach(d => (d.files || []).forEach(f => { if (f.st === 'failed' && f.meta.includes('加密') && (!v || f.name === v)) { f.st = 'stale'; f.meta = '重新读取中'; } }));
      renderKnowBody();
      setTimeout(() => { INDEX.forEach(d => (d.files || []).forEach(f => { if (f.meta === '重新读取中') { f.st = 'failed'; f.meta = 'PDF 已加密，无法读取'; } })); if (K.tab === 'index' && $('#know-body')) renderKnowBody(); toast('仍然失败：PDF 已加密', 'alert'); }, 1600);
      return;
    }
    case 'index-exclude': { const d = INDEX[+v]; const files = d.files; INDEX[+v] = {dir: d.dir, excluded: true, count: files.length, size: '—', files: undefined, _files: files}; withFlip(renderKnowBody); return toast(`已排除 ${d.dir}/，文件本身不受影响`, 'folder', () => { INDEX[+v] = {dir: d.dir, files}; withFlip(renderKnowBody); }); }
    case 'index-include': { const d = INDEX[+v]; if (d._files) INDEX[+v] = {dir: d.dir, files: d._files}; else toast('重新纳入后会在后台索引 214 个文件', 'layers'); return withFlip(renderKnowBody); }
    case 'skill-filter': S.filter = v; renderList(); return withFlip(renderSkillPage);
    case 'skill-on': { const x = S.items.find(s => s.id === v); x.on = !x.on; if (!x.on) x.inc = false; renderSkillPage(); return toast(x.on ? `已启用「${x.name}」` : `已停用「${x.name}」，已开始的运行不受影响`, 'spark'); }
    case 'skill-inc': { const x = S.items.find(s => s.id === v); x.inc = !x.inc; return renderSkillPage(); }
    case 'skill-prefer': S.prefer = v; renderList(); withFlip(renderSkillPage); return toast('同名时优先使用这一份', 'check');
    case 'skill-open': return openSkill(v);
    case 'skill-add': return openSkillAdd();
    case 'skill-edit': return toast('演示：进入编辑，保存后生成新版本', 'pencil');
    case 'skills-sh': return toast('在系统浏览器打开 skills.sh', 'globe');
    case 'comp-install': return installComp(v);
    case 'comp-cancel': { const c = P.comps.find(x => x.id === v); c.state = 'none'; renderCompPage(); return toast(`已取消安装${c.name}`, 'x'); }
    case 'prop-save': { const ta = $('.prop-edit'); state.proposal.after = ta.value; return acceptProposal(); }
    case 'prop-cancel': return renderContext();
  }
});

// 换页时关闭所有对话框
window.addEventListener('hashchange', () => { while (dlgStack.length) closeDialog(true); });

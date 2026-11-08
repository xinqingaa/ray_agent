const body = document.body;
const html = document.documentElement;

const FILES = `
  <button class="dir">材料</button>
  <button class="file" data-preview="1"><span class="tick pdf"></span><span class="fn">竞品-A.pdf</span><span class="st ok">可检索</span></button>
  <button class="file"><span class="tick pdf"></span><span class="fn">竞品-B.pdf</span><span class="st ok">可检索</span></button>
  <button class="file"><span class="tick doc"></span><span class="fn">纪要.md</span><span class="st work">解析中</span></button>
  <button class="file"><span class="tick pdf"></span><span class="fn">扫描合同.pdf</span><span class="st wait">待 OCR</span></button>
  <button class="dir">成果</button>
  <button class="file"><span class="tick sheet"></span><span class="fn">对比表.xlsx</span><span class="st">本次写入</span></button>
  <button class="file"><span class="tick img"></span><span class="fn">白板.jpg</span><span class="st fail">解析失败</span></button>
`;

const FILES_INDEXING = `
  <button class="dir">材料</button>
  <button class="file"><span class="tick pdf"></span><span class="fn">竞品-A.pdf</span><span class="st work">索引中</span></button>
  <button class="file"><span class="tick pdf"></span><span class="fn">竞品-B.pdf</span><span class="st work">排队</span></button>
  <button class="file"><span class="tick doc"></span><span class="fn">纪要.md</span><span class="st">已登记</span></button>
`;

const EMPTY_FILES = `
  <div class="empty-files">
    <strong>这个文件夹还是空的</strong>
    把文件拖进来，或从访达打开后放进去。复制完成后会进入索引，不会另存一份云端库。
  </div>
`;

const THREAD_SESSION = `
  <article class="msg me"><p>把这个文件夹里的竞品表整理成一页要点，标出我们和对方在定价上的差别。</p></article>
  <div class="tool"><span class="spin"></span>正在读 材料/竞品-A.pdf</div>
  <article class="msg">
    <p>公开价目上，对方基础版 99、团队版 199；我们是按年席位。教育渠道折扣写在<cite class="cite">竞品-A 第 2 页</cite>，不进价目表。</p>
    <p>对比表已经写回 <cite class="cite">成果/对比表.xlsx</cite>。白板照片还不能检索，解析失败了。</p>
    <details class="refs">
      <summary>本次参考 · 工作方式 v3 · 2 条记忆 · 3 个文件</summary>
      <ul>
        <li><b>工作方式</b> 只根据文件夹里的材料下结论，价格以原件为准</li>
        <li><b>记忆</b> 对外报价必须经市场确认</li>
        <li><b>文件</b> 竞品-A.pdf（可检索）· 纪要.md（解析中，未引用新版）</li>
      </ul>
    </details>
  </article>
`;

const THREAD_HOME = `
  <div class="intro">
    <h2>季度复盘</h2>
    <p>上次把竞品表写成了要点。文件在原位，新对话会带上这里的工作方式和记忆。</p>
  </div>
`;

const THREAD_INDEPENDENT = `
  <div class="intro">
    <h2>独立对话</h2>
    <p>不绑定文件夹，也不写入任何工作区的记忆。需要长期材料时，打开一个工作区。</p>
  </div>
`;

const THREAD_EMPTY_APP = `
  <div class="intro">
    <h2>从一件事开始</h2>
    <p>打开已有文件夹作为工作区，或先进行一次不绑定文件夹的对话。</p>
  </div>
`;

const THREAD_ARCHIVED = `
  <div class="intro">
    <h2>产品评审</h2>
    <p>已归档，只能阅读。取消归档后可以继续对话和写入。</p>
  </div>
`;

const THREAD_UNAVAILABLE = `
  <div class="intro">
    <h2>出差报销</h2>
    <p>文件夹暂时找不到。已有对话仍可阅读和发送；文件工具会等到文件夹回来，或你重新定位。</p>
  </div>
`;

const MOBILE_LIST = `
  <div class="sect"><h2>独立对话</h2></div>
  <button class="row chat"><span class="name">把这段会议录音转成纪要</span><span class="meta">昨天</span></button>
  <button class="row chat"><span class="name">这张图里的表格怎么读</span><span class="meta">周一</span></button>
  <button class="row chat"><span class="name">润色这封拒绝信</span><span class="meta">3/12</span></button>
  <button class="row chat"><span class="name">解释这条报错</span><span class="meta">3/9</span></button>
  <button class="row chat"><span class="name">临时翻译合同第 4 条</span><span class="meta">3/2</span></button>
  <button class="more">还有 3 条独立对话</button>
  <div class="sect"><h2>工作区</h2></div>
  <button class="row ws" data-go="session"><span class="name">季度复盘</span><span class="badge">索引 18/22</span></button>
  <button class="row ws"><span class="name">课程笔记</span><span class="badge mute">12 个文件</span></button>
  <button class="row ws unavailable"><span class="name">出差报销</span><span class="badge warn">找不到文件夹</span></button>
  <p class="hint">材料在桌面上。手机用来阅读、发送和审批。</p>
`;

const MOBILE_OFFLINE = `
  <div class="offline">
    <h2>桌面不在线</h2>
    <p>草稿还在这。配对恢复后不会重复发送已经送出的消息，也不会再次批准。</p>
  </div>
`;

const MOBILE_PLAN = `
  <div class="offline"><h2>桌面端计划能力</h2><p>工作方式、记忆、全文知识、OCR、语义组件和 Skill 来源管理在桌面端完成。手机端只接收结果、引用和审批。</p></div>
`;

const HOME_VIEW = `
  <div class="home-head">
    <div>
      <p class="home-kicker">RayAgent / 工作区</p>
      <h1>你的工作空间</h1>
      <p>每个工作区都绑定本机文件夹。对话、记忆和检索围绕这里的材料持续工作。</p>
    </div>
    <div class="home-actions">
      <button class="home-button" data-open="scan">打开文件夹</button>
      <button class="home-button solid" data-open="create">新建工作区</button>
    </div>
  </div>
  <div class="home-grid">
    <article class="workspace-card current">
      <div class="workspace-card-top"><span class="folder-mark"></span><div><h2>季度复盘</h2><p>最后活动 · 3 小时前</p></div><span class="card-status">可检索</span></div>
      <div class="workspace-card-bottom"><span>22 个文件</span><span>18 项可检索</span><button data-go="session">打开工作区 →</button></div>
    </article>
    <article class="workspace-card">
      <div class="workspace-card-top"><span class="folder-mark"></span><div><h2>课程笔记</h2><p>最后活动 · 昨天</p></div><span class="card-status work">索引中</span></div>
      <div class="workspace-card-bottom"><span>12 个文件</span><span>4 项已完成</span><button data-go="workspace-home">打开工作区 →</button></div>
    </article>
    <article class="workspace-card unavailable">
      <div class="workspace-card-top"><span class="folder-mark"></span><div><h2>出差报销</h2><p>对话仍可继续，文件夹暂时不可用</p></div><span class="card-status warn">找不到文件夹</span></div>
      <div class="workspace-card-bottom"><span>上次位置 · ~/Documents/出差报销</span><button data-go="unavailable">重新定位 →</button></div>
    </article>
    <article class="workspace-card archived">
      <div class="workspace-card-top"><span class="folder-mark"></span><div><h2>产品评审</h2><p>只读工作区 · 归档于 3/18</p></div><span class="card-status muted">已归档</span></div>
      <div class="workspace-card-bottom"><span>38 个文件</span><span>只读</span><button data-go="archived">查看工作区 →</button></div>
    </article>
  </div>
  <div class="home-secondary"><span><b>独立对话</b> 不绑定文件夹，不写入工作区记忆</span><button data-go="independent">开始独立对话 →</button></div>
`;

const CAPABILITY_VIEWS = {
  "p5-memory": `
    <div class="cap-head"><div><p class="cap-kicker">P5 · 已规划</p><h1>工作方式与记忆</h1><p>工作方式决定这里怎么做事；记忆保存已经确认、可追溯的事实。</p></div><button class="cap-button">工作区设置</button></div>
    <div class="cap-tabs"><button class="cap-tab is-on">工作方式</button><button class="cap-tab">记忆 <span>12</span></button><button class="cap-tab">本次参考</button></div>
    <div class="cap-grid cap-grid-two"><article class="cap-panel"><div class="cap-panel-head"><div><h2>工作方式 <span class="version">v3</span></h2><p>每次新运行都会带上这段要求。</p></div><button class="cap-link">编辑</button></div><div class="method-copy">只根据工作区文件夹里的材料下结论。价格以原件为准；对外报价必须经过市场确认。长文放回文件夹，不在记忆里重复维护。</div><div class="cap-panel-foot"><span class="state-pill ok">当前生效</span><span>上次修改 · 2 天前</span><button class="cap-link">查看版本</button></div></article><article class="cap-panel"><div class="cap-panel-head"><div><h2>待确认的提议</h2><p>Agent 不能直接修改工作方式。</p></div><span class="state-pill wait">待处理</span></div><div class="diff"><del>价格以模型回复为准。</del><ins>价格以原件为准，必要时请求市场确认。</ins></div><div class="cap-panel-foot"><button class="cap-link">查看来源</button><button class="cap-button">确认并发布</button></div></article></div>
    <div class="cap-section-head"><h2>记忆状态</h2><span>自动提炼已开启</span></div><div class="memory-strip"><div><b>8</b><span>常驻记忆</span></div><div><b>4</b><span>可检索记忆</span></div><div><b>2</b><span>待确认候选</span></div><button class="cap-button secondary">打开记忆面板</button></div>
  `,
  "p6-knowledge": `
    <div class="cap-head"><div><p class="cap-kicker">P6 · 已规划</p><h1>全文知识</h1><p>在当前工作区内搜索文件、记忆和会话摘要，并跳回原文位置。</p></div><button class="cap-button secondary">索引设置</button></div>
    <div class="knowledge-search"><span class="search-glyph">⌕</span><input placeholder="搜索工作区材料、记忆和对话" value="教育渠道 折扣"><kbd>⌘K</kbd></div>
    <div class="knowledge-meta"><span>在季度复盘中搜索</span><span>3 个来源 · 42 个片段</span></div>
    <div class="knowledge-results"><article class="knowledge-result"><div class="result-type pdf">PDF</div><div class="result-main"><h2>竞品-A.pdf <span class="state-pill ok">可全文检索</span></h2><p>第 2 页 · 教育渠道折扣不进入公开价目表</p><small>匹配“教育渠道”“折扣” · 版本 2026-11-05</small></div><button class="cap-link">打开原文</button></article><article class="knowledge-result"><div class="result-type mem">记忆</div><div class="result-main"><h2>对外报价必须经市场确认 <span class="state-pill ok">已确认</span></h2><p>来源：工作方式 v3 · 整理竞品表</p><small>常驻记忆 · 最近使用 3 小时前</small></div><button class="cap-link">查看来源</button></article><article class="knowledge-result muted-result"><div class="result-type doc">MD</div><div class="result-main"><h2>纪要.md <span class="state-pill wait">解析中</span></h2><p>已登记，解析完成后才能参与全文检索</p><small>队列位置 2 · 可取消</small></div><button class="cap-link">查看任务</button></article></div>
  `,
  "p7-components": `
    <div class="cap-head"><div><p class="cap-kicker">P7 · 已规划</p><h1>OCR 与语义组件</h1><p>组件在本机准备，缺失或失败时全文检索继续可用。</p></div><button class="cap-button secondary">组件设置</button></div>
    <div class="component-banner"><span class="component-dot wait"></span><div><b>语义索引等待组件</b><p>当前仍可使用全文检索；扫描件需要 OCR 组件。</p></div><button class="cap-button">查看组件</button></div>
    <div class="component-grid"><article class="component-card"><div class="component-card-head"><div><h2>OCR 组件</h2><p>扫描 PDF 与图片文字识别</p></div><span class="state-pill wait">待安装</span></div><div class="component-progress"><span style="width:0%"></span></div><div class="component-card-foot"><span>未影响已登记文件</span><button class="cap-link">安装</button></div></article><article class="component-card"><div class="component-card-head"><div><h2>语义索引</h2><p>多语言向量召回与混合排序</p></div><span class="state-pill work">准备中</span></div><div class="component-progress"><span style="width:62%"></span></div><div class="component-card-foot"><span>索引代次 2 · 62%</span><button class="cap-link">暂停</button></div></article><article class="component-card"><div class="component-card-head"><div><h2>全文索引</h2><p>中文分词与精确名称匹配</p></div><span class="state-pill ok">可用</span></div><div class="component-card-foot"><span>42 个文件 · 18,204 个片段</span><button class="cap-link">重建</button></div></article></div>
  `,
  "p8-skills": `
    <div class="cap-head"><div><p class="cap-kicker">P8 · 已有实现</p><h1>Skills</h1><p>从已有来源发现、阅读和启用 Skill；运行时冻结实际使用的版本。</p></div><button class="cap-button">新增 Skill</button></div>
    <div class="skills-search"><span class="search-glyph">⌕</span><input placeholder="搜索 Skill" value=""><button class="cap-link">刷新</button></div>
    <div class="skill-list"><article class="skill-row"><span class="skill-mark">文</span><div class="skill-main"><h2>文件整理助手 <span class="source-badge">工作区</span></h2><p>整理、重命名和归档工作区内的材料。</p></div><span class="state-pill ok">已启用</span><button class="switch on" aria-label="停用文件整理助手"></button></article><article class="skill-row"><span class="skill-mark">研</span><div class="skill-main"><h2>竞品研究 <span class="source-badge">用户目录</span></h2><p>对比来源、标记引用并生成研究摘要。</p></div><span class="state-pill ok">已启用</span><button class="switch on" aria-label="停用竞品研究"></button></article><article class="skill-row"><span class="skill-mark">表</span><div class="skill-main"><h2>表格清理 <span class="source-badge muted">GitHub</span></h2><p>清理 CSV 与 XLSX 的表头、空行和重复项。</p></div><span class="state-pill muted">已停用</span><button class="switch" aria-label="启用表格清理"></button></article></div>
    <div class="skill-source-note"><span>来源范围</span><b>工作区 · 用户目录 · 应用管理 · 内置</b><button class="cap-link">管理来源</button></div>
  `,
};

const scenes = {
  home: {
    title: "工作区",
    sub: "",
    thread: "",
    files: "",
    index: "",
    placeholder: "",
    home: true,
    mobile: MOBILE_LIST,
    hideComposer: true,
  },
  session: {
    title: "整理竞品表",
    sub: "季度复盘",
    thread: THREAD_SESSION,
    files: FILES,
    index: "索引 18/22",
    placeholder: "补充或继续",
    banner: null,
  },
  "workspace-home": {
    title: "季度复盘",
    sub: "",
    thread: THREAD_HOME,
    files: FILES,
    index: "索引 18/22",
    placeholder: "在这个工作区里接着做",
    start: true,
    banner: null,
  },
  "empty-folder": {
    title: "家庭旧照整理",
    sub: "",
    thread: `<div class="intro"><h2>家庭旧照整理</h2><p>文件夹是空的。先放进材料，或直接说明你想怎么整理。</p></div>`,
    files: EMPTY_FILES,
    index: "尚未索引",
    placeholder: "在这个工作区里接着做",
    start: true,
    banner: null,
  },
  indexing: {
    title: "季度复盘",
    sub: "正在建立全文索引",
    thread: THREAD_HOME,
    files: FILES_INDEXING,
    index: "索引 4/22",
    placeholder: "对话可用，检索会随索引补齐",
    start: true,
    banner: null,
  },
  unavailable: {
    title: "出差报销",
    sub: "",
    thread: THREAD_UNAVAILABLE,
    files: `<div class="empty-files"><strong>文件夹暂时不可用</strong>上次位置 ~/Documents/出差报销</div>`,
    index: "已暂停",
    placeholder: "先继续对话，文件工具会暂停",
    start: true,
    banner: { kind: "warn", text: "文件夹暂时找不到。对话仍可继续。", action: "重新定位" },
  },
  archived: {
    title: "产品评审",
    sub: "已归档",
    thread: THREAD_ARCHIVED,
    files: FILES,
    index: "只读",
    placeholder: "",
    start: true,
    archived: true,
    banner: null,
  },
  lease: {
    title: "整理竞品表",
    sub: "季度复盘",
    thread: THREAD_SESSION,
    files: FILES,
    index: "索引 18/22",
    placeholder: "可以阅读，写入要等占用结束",
    banner: { kind: "danger", text: "「写纪要给市场」正在写入这个文件夹。", action: "打开那个对话" },
  },
  drop: {
    title: "家庭旧照整理",
    sub: "",
    thread: `<div class="intro"><h2>家庭旧照整理</h2><p>把文件放进这个文件夹，不要另建一份上传库。</p></div>`,
    files: EMPTY_FILES,
    index: "尚未索引",
    placeholder: "在这个工作区里接着做",
    start: true,
    drop: true,
  },
  independent: {
    title: "独立对话",
    sub: "",
    thread: THREAD_INDEPENDENT,
    files: "",
    index: "",
    placeholder: "描述你想完成的事",
    start: true,
  },
  "empty-app": {
    title: "RayAgent",
    sub: "",
    thread: THREAD_EMPTY_APP,
    files: "",
    index: "",
    placeholder: "不绑定文件夹的对话",
    start: true,
  },
  "mobile-list": {
    title: "RayAgent",
    mobile: MOBILE_LIST,
    hideComposer: true,
  },
  "mobile-offline": {
    title: "RayAgent",
    mobile: MOBILE_OFFLINE,
    hideComposer: true,
  },
  "p5-memory": {title: "工作方式与记忆", sub: "P5 · 已规划", capability: "p5-memory", mobile: MOBILE_PLAN, hideComposer: true},
  "p6-knowledge": {title: "全文知识", sub: "P6 · 已规划", capability: "p6-knowledge", mobile: MOBILE_PLAN, hideComposer: true},
  "p7-components": {title: "OCR 与语义组件", sub: "P7 · 已规划", capability: "p7-components", mobile: MOBILE_PLAN, hideComposer: true},
  "p8-skills": {title: "Skills", sub: "P8 · 已有实现", capability: "p8-skills", mobile: MOBILE_PLAN, hideComposer: true},
};

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function setScene(name) {
  if (!scenes[name]) name = "session";
  body.dataset.scene = name;
  body.dataset.drop = scenes[name].drop ? "1" : "";
  body.dataset.preview = "";
  $("#scene").value = name;

  const s = scenes[name];
  const homeView = $(`[data-slot='home-view']`);
  if (homeView) {
    homeView.innerHTML = s.home ? HOME_VIEW : "";
  }
  body.classList.toggle("is-home", !!s.home);
  const capabilityView = $(`[data-slot='capability-view']`);
  if (capabilityView) capabilityView.innerHTML = s.capability ? CAPABILITY_VIEWS[s.capability] : "";
  body.classList.toggle("is-capability", !!s.capability);
  const head = $("[data-slot='chat-head']");
  if (head) {
    head.querySelector("h1").textContent = s.title || "";
    head.querySelector(".sub").textContent = s.sub || "";
  }
  const thread = $("[data-slot='thread']");
  if (thread) {
    thread.classList.toggle("start", !!s.start);
    thread.innerHTML = s.thread || "";
  }
  const files = $("[data-slot='file-list']");
  if (files) files.innerHTML = s.files || "";
  const badge = $("[data-slot='index-badge']");
  if (badge) badge.textContent = s.index || "";
  const banner = $("[data-slot='banner']");
  if (banner) {
    if (s.banner) {
      banner.hidden = false;
      banner.className = `banner ${s.banner.kind}`;
      banner.innerHTML = `${s.banner.text}<button class="link">${s.banner.action}</button>`;
    } else {
      banner.hidden = true;
      banner.textContent = "";
    }
  }
  const ta = $("[data-slot='composer'] textarea");
  if (ta) {
    ta.placeholder = s.placeholder || "";
    ta.disabled = !!s.archived;
  }
  $("[data-slot='composer']")?.classList.toggle("is-off", !!s.archived);

  const mobileTitle = $("[data-slot='mobile-title']");
  if (mobileTitle) mobileTitle.textContent = s.title || "RayAgent";
  const mobileBody = $("[data-slot='mobile-body']");
  if (mobileBody) {
    if (s.mobile) mobileBody.innerHTML = s.mobile;
    else mobileBody.innerHTML = s.thread || THREAD_SESSION;
  }
  const mobileComposer = $("[data-slot='mobile-composer']");
  if (mobileComposer) mobileComposer.hidden = !!s.hideComposer;
  const mobileFiles = $("[data-slot='mobile-files']");
  if (mobileFiles) mobileFiles.innerHTML = s.files || FILES;

  const emptyHint = $("#ws-empty");
  const empty = name === "empty-app";
  $all(".ws-block").forEach((el) => { el.hidden = empty; });
  if (emptyHint) emptyHint.hidden = !empty;
}

function setDialog(name) {
  body.dataset.dialog = name || "";
}

function setDevice(device) {
  body.dataset.device = device;
  $all(".chip[data-device]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.device === device));
  });
}

document.querySelector(".proto").addEventListener("click", (event) => {
  const device = event.target.closest(".chip[data-device]");
  if (device) {
    setDevice(device.dataset.device);
    body.dataset.view = "app";
    fitDesktop();
    return;
  }
  if (event.target.closest("[data-theme-toggle]")) {
    const next = html.dataset.theme === "dark" ? "light" : "dark";
    html.dataset.theme = next;
    event.target.closest("[data-theme-toggle]").textContent = next === "dark" ? "浅色" : "深色";
    return;
  }
  if (event.target.closest("[data-view-toggle]")) {
    const next = body.dataset.view === "components" ? "app" : "components";
    body.dataset.view = next;
    event.target.closest("[data-view-toggle]").textContent = next === "components" ? "回到界面" : "组件墙";
    fitDesktop();
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open) setDialog(open.dataset.open);
});

$("#scene").addEventListener("change", (event) => setScene(event.target.value));

document.addEventListener("click", (event) => {
  const closeBtn = event.target.closest("button[data-close-dialog], .choice[data-close-dialog]");
  if (closeBtn || event.target.classList.contains("veil")) setDialog("");
  const open = event.target.closest("[data-open]");
  if (open && !open.closest(".proto")) setDialog(open.dataset.open);
  const go = event.target.closest("[data-go]");
  if (go) {
    setScene(go.dataset.go);
    body.dataset.view = "app";
  }
  const wsToggle = event.target.closest(".row.ws");
  if (wsToggle && !event.target.closest(".grip") && !event.target.closest(".row-action")) {
    const block = wsToggle.closest(".ws-block");
    if (block && block.querySelector(".ws-children")) {
      const open = !block.classList.contains("is-open");
      $all(".ws-block").forEach((item) => {
        item.classList.remove("is-open");
        item.querySelector(".row.ws")?.setAttribute("aria-expanded", "false");
      });
      if (open) {
        block.classList.add("is-open");
        wsToggle.setAttribute("aria-expanded", "true");
      }
    }
  }
  if (event.target.closest("[data-preview='1']")) body.dataset.preview = "1";
  if (event.target.closest("[data-preview-back]")) body.dataset.preview = "";
  if (event.target.closest("[data-open-files]")) body.dataset.mobileSheet = "files";
  if (event.target.closest("[data-close-files]")) body.dataset.mobileSheet = "";
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setDialog("");
    body.dataset.mobileSheet = "";
    body.dataset.preview = "";
  }
});

const extra = $("#independent-extra");
const more = $("#independent-more");
more.addEventListener("click", () => {
  const open = extra.hidden;
  extra.hidden = !open;
  more.textContent = open ? "收起独立对话" : "还有 3 条独立对话";
});

const list = $("#workspace-list");
let dragging = null;
list.addEventListener("dragstart", (event) => {
  dragging = event.target.closest(".ws-block");
  if (dragging) dragging.style.opacity = "0.5";
});
list.addEventListener("dragend", () => {
  if (dragging) dragging.style.opacity = "";
  dragging = null;
});
list.addEventListener("dragover", (event) => {
  event.preventDefault();
  const over = event.target.closest(".ws-block");
  if (!dragging || !over || over === dragging) return;
  const rect = over.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  list.insertBefore(dragging, before ? over : over.nextSibling);
});

const filesCol = $("[data-slot='files']");
if (filesCol) {
  ["dragenter", "dragover"].forEach((type) => {
    filesCol.addEventListener(type, (event) => {
      if (![...event.dataTransfer.types].includes("Files")) return;
      event.preventDefault();
      body.dataset.drop = "1";
    });
  });
  filesCol.addEventListener("dragleave", (event) => {
    if (!filesCol.contains(event.relatedTarget)) body.dataset.drop = "";
  });
  filesCol.addEventListener("drop", (event) => {
    event.preventDefault();
    body.dataset.drop = "";
  });
}

function fitDesktop() {
  const stage = document.querySelector(".stage");
  const frame = document.querySelector(".desktop-frame");
  const app = document.querySelector(".app.desktop");
  if (!stage || !frame || !app || body.dataset.device !== "desktop" || body.dataset.view !== "app") {
    return;
  }
  const pad = 24;
  const scale = Math.min(1, (stage.clientWidth - pad) / 1280, (stage.clientHeight - pad) / 800);
  frame.style.width = `${1280 * scale}px`;
  frame.style.height = `${800 * scale}px`;
  app.style.transform = `scale(${scale})`;
}
window.addEventListener("resize", fitDesktop);
new ResizeObserver(fitDesktop).observe(document.querySelector(".stage"));

setScene("home");
fitDesktop();

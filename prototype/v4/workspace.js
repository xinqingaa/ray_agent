/* V4 工作区视图与规划能力交互；全部使用 app.js 内的示例数据。 */
Object.assign(paths,{
  refresh:'M13 6a5 5 0 1 0 0 5M13 2v4H9', edit:'m3 11 7-7 3 3-7 7-4 1Zm7-7 1-1 3 3-1 1',
  pin:'m6 2 6 6-3 1-2 3-3-3-2-3 3-1ZM5 11l-3 3', history:'M3 4a6 6 0 1 1-1 6M2 2v4h4M8 4v4l3 2',
  pause:'M5 3v10M11 3v10', play:'m5 3 8 5-8 5Z', stop:'M4 4h8v8H4Z', download:'M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3',
  book:'M2 3h5l1 1 1-1h5v10H9l-1 1-1-1H2Zm6 1v9', code:'m5 4-4 4 4 4M11 4l4 4-4 4', trash:'M3 4h10M6 2h4M4 4l1 10h6l1-10M7 6v5M9 6v5'
});
const fileIcon = (type,open=false) => {
  const kind=({pdf:'pdf',doc:'word',docx:'word',xlsx:'sheet',xls:'sheet',csv:'sheet',pptx:'slides',ppt:'slides',md:'markdown',txt:'text',png:'image',jpg:'image',jpeg:'image',js:'code',py:'code',json:'code',zip:'archive',folder:open?'folder-open':'folder'})[type]||'unknown';
  return `<svg class="file-type ${kind}" viewBox="0 0 24 24" aria-hidden="true"><use href="file-icons.svg#${kind}"/></svg>`;
};
Object.assign(S,{view:'overview',currentSessions:{review:'review-1',course:'course-1'},searches:{},scrolls:{},knowledgeTab:'search',skillQuery:'',skillScope:'全部',skillTab:'library',skillRead:'SKILL.md',skillSourceView:false});
filesByWorkspace.review.find(f=>f.id==='sheet').state='可检索';
memories.review[0].resident=true; memories.review[1].resident=true;
baseFiles.forEach((f,i)=>{f.revision='r'+(i+1);});
Object.values(filesByWorkspace).flat().forEach(f=>{f.revision||='r1';});
filesByWorkspace.review.push({id:'brief',name:'复盘提纲.docx',folder:'材料',type:'docx',state:'已登记',size:'24 KB',revision:'r1'}, {id:'old',name:'上季结论.txt',folder:'材料',type:'txt',state:'过时',size:'4 KB',revision:'r2'});
skills.forEach(k=>{k.version='v1';});
skills.push({id:'docs-claude',name:'文档处理',description:'另一份同名方法，整理正式文档与校对格式。',source:'.claude/skills',scope:'用户级',enabled:true,conflict:true,version:'v2'}, {id:'builtin',name:'查找 Skill',description:'寻找与当前任务匹配的可用方法。',source:'内置',scope:'内置',enabled:true,version:'v1'}, {id:'broken',name:'资料归档',description:'原目录已移动，暂时无法读取。',source:'.agents/skills',scope:'用户级',enabled:false,unavailable:true,version:'v1'});
skills.find(k=>k.id==='docs').conflict=true;
const sourceNames=()=>['.agents/skills','.codex/skills','.claude/skills','应用管理','内置','GitHub',...(S.extraSources||[])];
const inScope=k=>!k.workspace||k.workspace===S.workspace;
const availableSkill=k=>inScope(k)&&k.enabled&&!k.unavailable&&!k.conflict&&!S.disabledSources?.has(k.source);
function rememberView(){
  const content=$('.content');if(content&&S.renderKey)S.scrolls[S.renderKey]=content.scrollTop;
  if(S.workspace)S.searches[S.workspace]={query:S.query,filter:S.filter,tab:S.knowledgeTab};
}
function applyRoute(){
  rememberView();
  const parts=location.hash.slice(1).split('/'),old=S.workspace;
  if(parts[0]==='session'){
    const s=sessions.find(x=>x.id===parts[1]);
    if(!s){S.workspace=null;S.session=null;S.view='start';}
    else {S.workspace=s.workspace;S.session=s.id;S.view='chat';if(s.workspace)S.currentSessions[s.workspace]=s.id;}
  }else if(parts[0]==='home'){S.workspace=null;S.session=null;S.view='home';}
  else if(parts[0]==='independent'){S.workspace=null;S.session=null;S.view='start';}
  else{
    S.workspace=workspaces.some(w=>w.id===parts[1])?parts[1]:'review';
    S.view=['overview','chat','background','knowledge'].includes(parts[2])?parts[2]:'overview';
    S.session=S.currentSessions[S.workspace]||null;
  }
  if(old!==S.workspace){const saved=S.searches[S.workspace]||{};S.query=saved.query||'';S.filter=saved.filter||'全部';S.knowledgeTab=saved.tab||'search';S.memoryFilter='全部';}
  document.body.classList.remove('show-sidebar');render();
}
function renderSidebar(){
  $('#sidebar').innerHTML=`<button class="brand" data-action="home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V5h7l5 5-5 4H8m4 0 6 5"/></svg>RayAgent</button><div class="sidebar-scroll">
  <button class="nav-row ${S.view==='home'?'active':''}" data-action="home">${icon('folder')}<span>工作区首页</span></button>
  <div class="nav-section"><h2>独立对话</h2>${ib('independent','plus','新建独立对话')}</div>
  ${wsSessions(null).map(s=>`<button class="nav-row child ${S.session===s.id?'active':''}" data-action="session" data-id="${s.id}"><span class="nav-name">${esc(s.title)}</span></button>`).join('')}
  <div class="nav-section"><h2>工作区</h2>${ib('add-workspace','plus','添加工作区')}</div>
  ${workspaces.filter(w=>w.status!=='archived'||S.workspace===w.id).map(w=>`<div class="workspace-group"><div class="workspace-row">
  <button class="nav-row" data-action="expand" data-id="${w.id}" aria-expanded="${S.expanded.has(w.id)}">${icon(S.expanded.has(w.id)?'down':'right')}<span class="nav-name">${esc(w.name)}</span>${w.status==='offline'?'<span class="status-dot wait" title="文件夹失联"></span>':''}</button>
  ${ib('new-workspace-chat','plus','在'+esc(w.name)+'新建对话',`data-id="${w.id}" ${w.status==='archived'?'disabled':''}`)}${ib('workspace-menu','more',esc(w.name)+'的更多操作',`data-id="${w.id}"`)}</div>
  ${S.expanded.has(w.id)?`<button class="nav-row child ${S.workspace===w.id&&S.view==='overview'?'active':''}" data-action="workspace" data-id="${w.id}">${icon('panel')}<span>工作区概览</span></button>${wsSessions(w.id).map(s=>`<button class="nav-row child ${S.session===s.id&&S.view==='chat'?'active':''}" data-action="session" data-id="${s.id}"><span class="nav-name">${esc(s.title)}</span></button>`).join('')}`:''}</div>`).join('')}
  </div><div class="sidebar-foot">${btn('skills',icon('skill')+'Skills')}${btn('settings',icon('settings')+'设置')}</div>`;
}
function header(){
  const w=workspace();
  return `<header class="main-head">${btn('navigation',icon('menu'),'icon mobile-nav','aria-label="打开导航" title="打开导航"')}<div class="head-title">${w?fileIcon('folder'):icon(S.view==='home'?'folder':'chat')}<h1>${esc(w?.name||(S.view==='home'?'工作区':'独立对话'))}</h1></div>
  ${w?`${ib('search','search','搜索工作区 · ⌘K')}${ib('workspace-config','settings','工作区设置')}${ib('toggle-panel','panel','显示或收起材料')}`:S.view==='home'?btn('add-workspace',icon('plus')+'添加工作区','btn'):ib('session-menu','more','对话设置',S.session?'':'disabled')}</header>
  ${w?`<nav class="workspace-tabs" aria-label="工作区视图">${[['overview','概览'],['chat','对话'],['background','背景'],['knowledge','知识']].map(([id,label])=>btn('view',label,S.view===id?'active':'',`data-id="${id}" aria-current="${S.view===id?'page':'false'}"`)).join('')}</nav>`:''}${banners()}`;
}
function startView(){
  const w=workspace(),list=w?wsSessions(w.id):wsSessions(null);
  if(w&&S.view==='chat')return `<div class="content start-content"><div class="reading"><div class="start-intro"><h1>开始一个新对话</h1><p>材料和背景来自「${esc(w.name)}」。</p></div>${!isArchived()?composer(true):''}</div></div>`;
  if(!w)return `<div class="content start-content"><div class="reading"><div class="start-intro"><h1>有什么需要一起完成？</h1><p>从一个问题，或一件具体的事开始。</p></div>${composer(true)}${list.length?`<section class="recent"><div class="section-label"><h2>最近对话</h2></div>${recentRows(list)}</section>`:''}</div></div>`;
  const candidates=(memories[w.id]||[]).filter(m=>m.candidate&&m.active).length, pending=wsFiles().filter(f=>!['可检索','本次写入'].includes(f.state)).length;
  return `<div class="content overview"><div class="reading overview-reading"><div class="overview-heading"><div><h1>在这里，继续推进</h1><p class="muted">${esc(w.name)}<span class="subtle-dot">·</span>${list.length} 个对话</p></div>${ib('finder','folder','在 Finder 中显示工作区')}</div>
  ${!isArchived()?composer(true):''}
  ${(candidates||S.proposal&&w.id==='review'||pending)?`<div class="attention-list">${candidates||S.proposal&&w.id==='review'?`<button data-action="view" data-id="background">${icon('memory')}<span>背景有 ${candidates+(S.proposal&&w.id==='review'?1:0)} 项待确认</span>${icon('right')}</button>`:''}${pending?`<button data-action="knowledge-index">${icon('book')}<span>${pending} 份材料需要处理</span>${icon('right')}</button>`:''}</div>`:''}
  <section class="overview-section"><div class="section-label"><h2>最近对话</h2>${ib('new-workspace-chat','plus','在当前工作区新建对话',`data-id="${w.id}" ${isArchived()?'disabled':''}`)}</div>${list.length?recentRows(list.slice(0,3)):'<p class="quiet-empty">还没有对话。在上方描述第一件要完成的事。</p>'}</section>
  <section class="overview-section"><div class="section-label"><h2>最近成果</h2></div>${wsFiles().some(f=>f.folder==='成果')?wsFiles().filter(f=>f.folder==='成果').map(f=>`<button class="artifact-row" data-action="delivery" data-id="${f.id}">${fileIcon(f.type)}<span><strong>${esc(f.name)}</strong><small>整理竞品表 · 今天</small></span><span class="badge">交付版本</span>${icon('right')}</button>`).join(''):'<p class="quiet-empty">任务交付的文件会出现在这里。</p>'}</section>
  <div class="workspace-summary"><button data-action="view" data-id="background">${icon('memory')}<span>工作方式 v${w.version} · ${activeMemories().length} 条记忆</span>${icon('right')}</button><button data-action="view" data-id="knowledge">${icon('book')}<span>${wsFiles().length} 份材料 · ${wsFiles().filter(f=>f.state==='可检索').length} 份可检索</span>${icon('right')}</button></div>
  </div></div>`;
}
function homeView(){
  return `<div class="content"><div class="home-reading"><div class="page-heading"><h1>工作区</h1><p class="muted">材料、对话与积累的背景，放在一起。</p></div><div class="workspace-cards">${workspaces.map(w=>`<button class="workspace-card" data-action="workspace" data-id="${w.id}"><div class="card-heading">${fileIcon('folder')}<strong>${esc(w.name)}</strong>${w.status!=='ready'?`<span class="badge ${w.status==='offline'?'wait':''}">${w.status==='offline'?'文件夹失联':'已归档'}</span>`:''}</div><p>${esc(w.method||'还没有设置工作方式')}</p><small>${wsSessions(w.id).length} 个对话 · ${(filesByWorkspace[w.id]||[]).length} 份材料</small><div class="card-path">${esc(w.path)}</div></button>`).join('')}</div></div></div>`;
}
function referenceBlock(s){
  const snapshot=s.snapshot,runAttr=`data-run="${s.kind?'initial':s.id||'initial'}"`;
  return `<details class="references"><summary>本次参考 · ${snapshot?'工作方式、记忆与来源':'来源与 Skill'}</summary><div class="ref-list">${snapshot?`<button class="ref-row" data-action="run-method" ${runAttr}>${icon('memory')}<span>工作方式 v${snapshot.version} · 运行快照</span>${icon('right')}</button>${snapshot.memory?`<button class="ref-row" data-action="run-memory" ${runAttr}>${icon('memory')}<span>${esc(snapshot.memory)}</span>${icon('right')}</button>`:''}`:''}${(s.runSkills||[]).map(k=>`<button class="ref-row" data-action="run-skill" ${runAttr} data-id="${k.id}">${icon('skill')}<span>${esc(k.name)} · ${esc(k.source)} · ${k.version}（运行快照）</span>${icon('right')}</button>`).join('')}${s.kind==='comparison'?'<button class="ref-row" data-action="cite-file" data-id="a">'+fileIcon('pdf')+'<span>竞品-A.pdf · r1 · 第 2 页</span>'+icon('right')+'</button>':''}${(s.runCitations||[]).map(c=>`<div class="ref-row">${icon('book')}<span>${esc(c.title)} · ${esc(c.location)} · ${esc(c.revision||'v1')}</span></div>`).join('')}</div></details>`;
}
function backgroundView(){
  const w=workspace();
  return `<div class="content"><div class="reading background-reading"><div class="page-heading"><h1>工作区背景</h1><p class="muted">在这里如何协作，以及需要持续记住的事。</p></div>
  <section class="background-section"><div class="section-label"><h2>工作方式 <span class="badge">v${w.version}</span></h2>${ib('method','edit','编辑工作方式',isArchived()?'disabled':'')}</div><p class="method-text">${esc(w.method||'还没有设置工作方式。')}</p><small>修改用于下一次运行，已开始的任务保留原版本。</small>
  ${S.proposal&&w.id==='review'?`<div class="proposal-box"><div class="section-label"><h3>Agent 提议补充工作方式</h3>${ib('proposal-source','history','查看提议来源')}</div><div class="diff"><del>数字和引述需要能回到原文。</del><ins>数字和引述需要能回到原文；缺少出处时标明待核验。</ins></div><div class="approval-actions">${btn('proposal-accept','接受修改','btn',isArchived()?'disabled':'')}${btn('proposal-reject','忽略','ghost',isArchived()?'disabled':'')}</div></div>`:''}</section>
  <section class="background-section"><div class="section-label"><h2>记忆</h2>${ib('memory-new','plus','添加记忆',isArchived()?'disabled':'')}</div><div class="settings-row auto-memory"><div class="row-copy"><strong>自动积累</strong><small>新发现直接保存；对已确认内容的修改等你确认。</small></div><input type="checkbox" data-setting="auto-memory" aria-label="自动积累记忆" ${w.autoMemory?'checked':''} ${isArchived()?'disabled':''}></div>
  <div class="search-filters">${['全部','待确认','置顶','常驻','已撤回'].map(t=>btn('memory-filter',t,'tab '+(t===S.memoryFilter?'active':''),`data-id="${t}"`)).join('')}</div><div id="memory-list">${memoryList()}</div><p class="footnote">置顶只改变列表顺序；常驻由运行背景选择，其他记忆可按需检索。</p></section></div></div>`;
}
function memoryList(){
  const all=memories[S.workspace]||[], f=S.memoryFilter;
  const list=all.filter(m=>f==='已撤回'?!m.active:m.active&&(f==='待确认'?m.candidate:f==='置顶'?m.pinned:f==='常驻'?m.resident&&!m.candidate:true)).sort((a,b)=>!!b.pinned-!!a.pinned);
  return list.length?list.map(m=>`<article class="memory-row"><div class="section-label"><p>${esc(m.text)}</p>${m.pinned?'<span class="pin-mark" title="已置顶">'+icon('pin')+'</span>':''}</div><div class="memory-meta"><span>${esc(m.type)}</span><span class="badge ${m.candidate?'wait':m.confirmed?'':'blue'}">${m.candidate?'待确认更新':m.confirmed?'已确认':'自动新增 · 已生效'}</span>${m.resident&&!m.candidate?'<span>常驻</span>':''}<span class="grow"></span>${ib('memory-source','history','查看记忆来源',`data-id="${m.id}"`)}${m.active&&!isArchived()?`${ib('memory-edit','edit','编辑记忆',`data-id="${m.id}"`)}${ib('memory-pin','pin',m.pinned?'取消置顶':'置顶记忆',`data-id="${m.id}"`)}${!m.candidate?ib('memory-retract','close','撤回记忆',`data-id="${m.id}"`):''}`:''}</div>
  ${m.candidate&&m.active?`<div class="candidate-context"><small>拟更新「对外报价需要经过市场确认。」</small><div class="approval-actions">${btn('memory-confirm','接受更新','btn',`data-id="${m.id}" ${isArchived()?'disabled':''}`)}${btn('memory-reject','忽略','ghost',`data-id="${m.id}" ${isArchived()?'disabled':''}`)}</div></div>`:''}${!m.active?btn('memory-restore','恢复记忆','ghost',`data-id="${m.id}" ${isArchived()?'disabled':''}`):''}</article>`).join(''):'<div class="quiet-empty">这里没有'+(f==='全部'?'记忆':esc(f)+'的记忆')+'。</div>';
}
function searchResults(){
  const target=$('#search-results');if(!target)return;
  const q=S.query.trim().toLowerCase();
  let list=knowledgeEntries().filter(e=>(S.filter==='全部'||e.type===S.filter)&&(!q||(e.title+' '+e.excerpt).toLowerCase().includes(q)));
  list=list.map(e=>({...e,revision:e.type==='文件'?(e.stale?'r1':wsFiles().find(f=>f.id===e.id)?.revision):'v1',location:e.type==='文件'?(e.id==='sheet'?'工作表1 · A1:C4':wsFiles().find(f=>f.id===e.id)?.type==='pdf'?'第 2 页':'第 3 段'):e.location}));
  S.resultEntries=list;
  target.innerHTML=S.searchFailure?`<div class="empty"><strong>检索暂时失败</strong><p>当前工作区索引暂不可读，材料仍可直接打开。</p>${btn('retry-search','重试','btn')}</div>`:list.length?`<small>${q?'找到':'当前工作区'} ${list.length} 个结果</small>`+list.map(e=>`<article class="search-result"><button class="result-open" data-action="search-open" data-id="${e.id}" data-type="${e.type}"><strong>${e.type==='文件'?fileIcon(wsFiles().find(f=>f.id===e.id)?.type):icon(e.type==='记忆'?'memory':'chat')}${esc(e.title)}</strong><p>${esc(e.excerpt)}</p><small>${e.type} · ${esc(e.revision)} · ${esc(e.location)}${e.stale?' · 旧版 r1（更新中）':''}</small></button>${ib('cite-result','plus','引用到下一条消息',`data-id="${e.id}" data-type="${e.type}"`)}</article>`).join(''):`<div class="empty"><strong>${q?'没有找到相关来源':'还没有可检索的来源'}</strong><p>${q?'换一个关键词，或检查材料的索引状态。':'文件完成索引后会出现在这里。'}</p>${btn('knowledge-index','查看索引状态','btn')}</div>`;
}
function searchView(){
  return `<div class="content"><div class="reading knowledge-reading"><div class="page-heading"><h1>工作区知识</h1><p class="muted">查找材料、记忆和过往对话，并读回依据。</p></div><div class="knowledge-tabs">${[['search','搜索'],['index','索引状态']].map(([id,label])=>btn('knowledge-tab',label,'tab '+(S.knowledgeTab===id?'active':''),`data-id="${id}"`)).join('')}<span class="grow"></span>${ib('add-files','plus','添加材料')}${ib('components','settings','管理检索组件')}</div>
  ${S.knowledgeTab==='index'?indexBody():`<div class="search-field">${icon('search')}<input id="knowledge-query" aria-label="搜索工作区知识" placeholder="搜索当前工作区" value="${esc(S.query)}">${S.query?ib('clear-query','close','清除搜索'):''}</div>${components.find(c=>c.id==='embedding').state!=='可用'?'<div class="notice">语义组件未就绪，仍可使用全文检索。</div>':''}<div class="search-filters">${['全部','文件','记忆','会话'].map(t=>btn('search-filter',t,'tab '+(S.filter===t?'active':''),`data-id="${t}"`)).join('')}<span class="grow"></span>${ib('retry-search','refresh','刷新搜索结果')}</div><div id="search-results"></div>`}</div></div>`;
}
function render(){
  rememberView();renderSidebar();
  const key=[S.workspace,S.view,S.view==='chat'?S.session:''].join(':');S.renderKey=key;
  $('#main').innerHTML=header()+(S.view==='home'?homeView():S.view==='background'?backgroundView():S.view==='knowledge'?searchView():S.view==='chat'&&session()?`<div class="session-subhead"><span>${esc(session().title)}</span>${ib('session-menu','more','对话设置')}</div>`+chatView():startView());
  searchResults();renderPanel();if($('.content'))$('.content').scrollTop=S.scrolls[key]||0;
  const input=$('#composer-input');if(input&&S.citations?.[scope()]?.length)input.insertAdjacentHTML('beforebegin',`<div class="citation-chips">${S.citations[scope()].map((c,i)=>`<span>${icon('book')}${esc(c.title)}${ib('remove-citation','close','移除引用',`data-id="${i}"`)}</span>`).join('')}</div>`);
  $$('.input-actions [data-action="add-files"],.input-actions [data-action="attach"]').forEach(b=>{b.innerHTML=icon('attach');b.className='icon';b.title=b.ariaLabel='添加附件';});
  $$('.delivery>svg:first-child').forEach(s=>s.outerHTML=fileIcon('xlsx'));
}
function fileRow(f,nested=false){return `<button class="file-row ${nested?'nested':''}" data-action="file" data-id="${f.id}">${fileIcon(f.type)}<span class="filename">${esc(f.name)}</span>${!['可检索','本次写入'].includes(f.state)?`<span class="file-state" title="${esc(f.state)}" aria-label="${esc(f.state)}">${icon(f.state.includes('失败')?'close':f.state==='待 OCR'?'download':'history')}</span>`:''}</button>`;}
function fileTree(){
  const groups=[...new Set(wsFiles().map(f=>f.folder))];
  return groups.map(folder=>{const closed=S.closedFolders.has(S.workspace+folder);return (folder?`<button class="file-row folder" data-action="folder" data-id="${esc(folder)}" aria-expanded="${!closed}">${icon(closed?'right':'down')}${fileIcon('folder',!closed)}<span class="filename">${esc(folder)}</span></button>`:'')+(!closed||!folder?wsFiles().filter(f=>f.folder===folder).map(f=>fileRow(f,!!folder)).join(''):'');}).join('');
}
function renderPanel(){
  const p=panel(),host=$('#materials');host.hidden=!p.open||!S.workspace||(['background','knowledge'].includes(S.view)&&!p.preview);host.classList.toggle('wide',!!p.expanded);if(host.hidden)return;
  if(p.preview){host.innerHTML=previewContent(p.preview);$$('[data-action="finder"]',host).forEach(b=>{b.className='icon';b.innerHTML=icon('folder');b.title=b.ariaLabel='在 Finder 中显示';});return;}
  host.innerHTML=`<div class="panel-head"><h2>工作材料</h2>${ib('add-files','plus','添加材料',isArchived()?'disabled':'')}${ib('knowledge-index','settings','查看索引状态')}${ib('toggle-panel','close','收起材料')}</div><div class="panel-tabs">${[['files','文件夹'],['deliveries','本次成果'],['changes','最近修改']].map(([id,label])=>btn('panel-tab',label,'tab '+(p.tab===id?'active':''),`data-id="${id}"`)).join('')}</div><div class="panel-body">${p.tab==='files'?fileTree()||'<div class="empty">文件夹还是空的。添加第一份材料开始工作。</div>':p.tab==='deliveries'?session()?.kind==='comparison'?`<button class="artifact-row" data-action="delivery" data-id="sheet">${fileIcon('xlsx')}<span><strong>对比表.xlsx</strong><small>本次交付版本 · 28 KB</small></span>${icon('right')}</button>`:'<div class="empty">当前对话还没有交付文件。</div>':S.workspace==='review'?`<div class="change-note">整理竞品表 · 本次运行</div>${fileRow(wsFiles().find(f=>f.id==='sheet'))}${btn('undo',S.undoDone?'查看撤销结果':'撤销本次修改','ghost')}`:'<div class="empty">还没有文件修改记录。</div>'}</div><div class="panel-foot">${icon('book')}<span>${wsFiles().filter(f=>f.state==='可检索').length} / ${wsFiles().length} 份可检索</span><span class="grow"></span>${ib('finder','folder','在 Finder 中显示工作区')}</div>`;
}
function indexBody(){
  const w=workspace(),excluded=w.excluded||[];
  return `<div class="index-top"><div><strong>材料处理</strong><small>${w.indexPaused?'已暂停后台索引':'按文件夹增量更新'} · 原文件随时可读</small></div>${ib('index-toggle',w.indexPaused?'play':'pause',w.indexPaused?'继续索引':'暂停索引',isArchived()?'disabled':'')}${ib('rescan','refresh','重新扫描材料',isArchived()?'disabled':'')}</div><div class="index-rows">${wsFiles().map(f=>`<div class="index-row">${fileIcon(f.type)}<div class="row-copy"><strong>${esc(f.name)}</strong><small>${esc(f.folder||'根目录')} · ${esc(f.revision)}${f.state==='过时'?' · 旧版 r1 仍可检索':''}</small></div><span class="badge ${f.state.includes('失败')||f.state==='待 OCR'?'wait':f.state==='可检索'?'ok':''}">${excluded.includes(f.folder)?'已排除':esc(f.state)}</span>${f.state==='待 OCR'?ib('ocr-component','download','准备文字识别组件'):['索引中','解析中','排队中'].includes(f.state)?ib('cancel-index','stop','取消处理',`data-id="${f.id}"`):!['可检索','本次写入'].includes(f.state)?ib('retry-index','refresh','重新处理',`data-id="${f.id}" ${excluded.includes(f.folder)||isArchived()?'disabled':''}`):''}</div>`).join('')||'<div class="quiet-empty">没有已登记材料。</div>'}</div><details class="index-exclusions"><summary>索引范围与排除</summary>${[...new Set(wsFiles().map(f=>f.folder))].map(folder=>`<label class="check-row"><input type="checkbox" data-index-folder="${esc(folder)}" ${excluded.includes(folder)?'':'checked'} ${isArchived()?'disabled':''}>${esc(folder||'根目录')}</label>`).join('')}<small>凭据、数据库、依赖缓存、版本目录与 .rayagent/ 始终排除。</small></details>`;
}
function componentRows(){
  return `<p class="dialog-lead">组件全局共用，材料按各工作区的索引范围处理。</p>${components.map(c=>`<div class="settings-row"><div class="row-copy"><strong>${esc(c.name)} <span class="badge ${c.state==='可用'?'ok':''}">${esc(c.state)}</span></strong><small>${esc(c.purpose)}${c.id==='browser'?' · 浏览器执行':c.id==='ocr'?' · 扫描材料':' · 未就绪时保留全文搜索'}</small></div>${['下载中','校验中'].includes(c.state)?ib('cancel-component','close','取消准备',`data-id="${c.id}"`):c.state==='可用'?'<span class="muted">已就绪</span>':btn('install',c.state==='准备失败'?'重试':'安装','btn',`data-id="${c.id}"`)}</div>`).join('')}`;
}
function skillsBody(picker=false){
  const list=skills.filter(k=>inScope(k)&&(S.skillScope==='全部'||k.scope===S.skillScope)&&(!S.skillQuery||(k.name+k.description+k.source).toLowerCase().includes(S.skillQuery.toLowerCase())));
  return `<div class="skill-manager-tools"><div class="search-field">${icon('search')}<input id="skill-query" aria-label="搜索 Skill" placeholder="搜索名称、用途或来源" value="${esc(S.skillQuery)}"></div>${!picker?ib('import-skill','plus','导入到应用管理库'):''}</div><div class="search-filters">${['全部','当前工作区','用户级','内置'].map(t=>btn('skill-scope',t,'tab '+(S.skillScope===t?'active':''),`data-id="${t}"`)).join('')}</div><div id="skill-list">${list.length?list.map(k=>`<button class="skill-list-row" data-action="skill-detail" data-id="${k.id}">${icon('skill')}<span><strong>${esc(k.name)}</strong><small>${esc(k.description)}</small><small>${esc(k.source)} · ${esc(k.scope)} · ${esc(k.version)}</small></span><span class="badge ${k.conflict?'wait':''}">${k.unavailable?'目录不可用':k.conflict?'同名待选择':S.disabledSources?.has(k.source)?'来源已停用':k.enabled?'已启用':'已停用'}</span>${icon('right')}</button>`).join(''):'<div class="empty">没有匹配的 Skill。</div>'}</div>`;
}
function sourceBody(){return `<div class="section-label"><small>移除引用保留原目录；启停影响新运行。</small><span class="grow"></span>${ib('add-source','plus','添加 Skill 来源')}</div>${sourceNames().map(source=>`<div class="settings-row"><div class="row-copy"><strong>${esc(source)}</strong><small>${source==='应用管理'?'应用管理的安装包':source==='内置'?'随应用提供':source==='GitHub'?'获取后安装到应用管理库':'本地目录 · 只读引用'}${S.disabledSources?.has(source)?' · 已停用':''}</small></div>${ib('source-details','settings','管理 '+esc(source),`data-id="${esc(source)}"`)}</div>`).join('')}`;}
function skillReader(k,snapshot=false){
  const read=S.skillRead||'SKILL.md',editable=k.source==='应用管理'&&!snapshot;
  const markdown=read==='SKILL.md'?`---\nname: ${k.name}\ndescription: ${k.description}\n---\n\n# ${k.name}\n\n${k.body||'先确认目标和输入材料，再完成任务并核对交付结果。'}\n\n## 工作流程\n\n1. 阅读输入材料，确认需要交付的成果。\n2. 按任务需要使用参考资料或脚本。\n3. 检查结果，并说明尚待确认的部分。\n\n参考：[检查清单](references/checklist.md)` :read==='references/checklist.md'?'# 检查清单\n\n- 依据可定位到原文\n- 缺失材料明确标记\n- 交付内容与任务一致':'# 示例脚本\n# 阅读包不会运行脚本或安装依赖。\nprint("prototype example")';
  return `<div class="skill-detail-meta"><span class="badge">${esc(k.source)}${k.origin?' / '+esc(k.origin):''}</span><span>${esc(k.scope)} · ${esc(k.version)}</span><span class="grow"></span>${snapshot?'<span class="badge blue">运行快照</span>':`<label class="switch-label">启用<input type="checkbox" data-setting="skill-enabled" data-id="${k.id}" aria-label="启用这个 Skill" ${k.enabled?'checked':''} ${k.unavailable||S.disabledSources?.has(k.source)?'disabled':''}></label>`}</div>
  ${k.conflict&&!snapshot?`<div class="notice warn">同一范围有同名包，需要明确选择。${btn('resolve-skill','使用这一份','btn',`data-id="${k.id}"`)}</div>`:''}${k.unavailable?'<div class="notice warn">原目录不可读。重新扫描或在来源中定位目录。</div>':''}
  <div class="skill-reader"><nav aria-label="Skill 文件"><div class="skill-root">${fileIcon('folder',true)}${esc(k.name)}</div>${['SKILL.md','references/checklist.md','scripts/check.py'].map(f=>`<button data-action="skill-file" data-id="${f}" class="${read===f?'active':''}">${fileIcon(f.endsWith('.py')?'py':'md')}<span>${f}</span></button>`).join('')}</nav><div class="skill-document"><div class="reader-toolbar"><strong>${esc(read)}</strong><span class="grow"></span>${ib('skill-source-view',S.skillSourceView?'book':'code',S.skillSourceView?'阅读 Markdown':'查看源码')}${snapshot?'':editable?ib('edit-skill','edit','编辑应用管理包'):ib('finder','folder','在原位置编辑')}</div>${S.editingSkill?`<form id="edit-skill-form"><label class="field">Skill 正文<textarea name="body">${esc(k.body||'先确认目标和输入材料，再完成任务并核对交付结果。')}</textarea></label><button class="btn primary" type="submit">保存新版本</button></form>`:S.skillSourceView||read.endsWith('.py')?`<pre class="skill-code">${esc(markdown)}</pre>`:`<article class="skill-markdown"><h1>${esc(read==='SKILL.md'?k.name:'检查清单')}</h1><p>${esc(k.description)}</p><h2>${read==='SKILL.md'?'工作流程':'交付前检查'}</h2><p>${esc(k.body||'先确认目标和输入材料，再完成任务并核对交付结果。')}</p><ol><li>阅读输入材料，确认需要交付的成果。</li><li>按任务需要使用参考资料或脚本。</li><li>检查结果，说明尚待确认的部分。</li></ol><button class="text-link" data-action="skill-file" data-id="references/checklist.md">阅读参考清单</button></article>`}</div></div>
  <p class="footnote">${editable?'应用管理包可以在此编辑，保存产生新版本。':'外部包只读引用，停用或移除引用会保留原文件。'} 标准正文、参考和脚本可阅读；客户端 hooks 与专用命令不自动执行。</p>`;
}
function buildDialog(){
  const m=S.modal,p=m.props,w=workspace(),close=btn('dialog-close','关闭','btn');
  $('#dialog').classList.toggle('skill-wide',['skill-detail','run-skill'].includes(m.type));
  if(['add-workspace','create','open-folder'].includes(m.type)){
    const mode=formValue('mode','new'),folder=formValue('path',mode==='new'?'~/Documents/RayAgent':'');
    return {title:'添加工作区',compact:true,body:`<form id="unified-workspace-form"><label class="field">工作区名称<input name="name" required value="${esc(formValue('name'))}" placeholder="例如：季度复盘" autofocus></label><div class="field">工作区文件夹<div class="folder-mode">${btn('folder-mode','新建文件夹',mode==='new'?'active':'',`data-id="new"`)}${btn('folder-mode','使用已有文件夹',mode==='existing'?'active':'',`data-id="existing"`)}</div><input type="hidden" name="mode" value="${mode}"></div><label class="field">${mode==='new'?'创建位置':'本地文件夹'}<div class="folder-picker">${fileIcon('folder')}<span>${esc(folder||'选择一个文件夹')}</span>${ib('choose-workspace-folder','folder','选择本地文件夹')}</div><input type="hidden" name="path" value="${esc(folder)}"></label><small>${mode==='new'?'在所选位置创建同名文件夹，用于材料和成果。':'材料留在原位置，对话和记忆归这个工作区。'}</small>${mode==='existing'&&folder?'<div class="notice scan-summary">发现 6 份示例材料 · 扫描件等待文字识别<br><label class="check-row"><input name="index" type="checkbox" '+(formValue('index',true)?'checked':'')+'>在后台建立索引</label></div>':''}</form>`,footer:btn('dialog-close','取消','btn')+`<button form="unified-workspace-form" type="submit" class="btn primary" ${mode==='existing'&&!folder?'disabled':''}>${mode==='new'?'创建工作区':'打开工作区'}</button>`};
  }
  if(m.type==='choose-workspace-folder')return {title:'选择文件夹',compact:true,body:`<div class="notice">使用示例目录代替系统选择器。</div>${[['project','项目资料','~/Documents/项目资料'],['root','Documents','~/Documents'],['copy','季度复盘 copy','~/Desktop/季度复盘 copy'],['moved','出差报销','~/Desktop/出差报销']].map(([id,name,path])=>`<button class="split-choice" data-action="workspace-folder-choice" data-id="${id}" data-path="${path}" data-name="${name}"><strong>${fileIcon('folder')}${name}</strong><small>${path}</small></button>`).join('')}`,footer:btn('dialog-back','返回','btn')};
  if(m.type==='method'||m.type==='workspace-config'&&p.tab==='method')return {title:'编辑工作方式',body:`<form id="method-form" data-form="method"><label class="field">工作方式<textarea name="method" ${isArchived()?'disabled':''}>${esc(formValue('method',w.method))}</textarea></label><small>当前 v${w.version}；保存后用于下一次运行。</small></form>`,footer:btn('dialog-close','取消','btn')+`<button class="btn primary" type="submit" form="method-form" ${isArchived()?'disabled':''}>保存工作方式</button>`};
  if(m.type==='workspace-config'){
    const d=baseDialog(),tab=p.tab||'general';d.body=dialogTabs([['general','基本信息'],['execution','本机执行']],tab,'workspace-tab')+d.body.slice(d.body.indexOf('</div>')+6);return d;
  }
  if(m.type==='settings'){
    const tab=p.tab||'general';if(tab==='general'){const d=baseDialog();d.body=dialogTabs([['general','通用'],['components','组件'],['skills','Skills']],tab,'settings-tab')+d.body.slice(d.body.indexOf('</div>')+6);return d;}
    return {title:'设置',body:dialogTabs([['general','通用'],['components','组件'],['skills','Skills']],tab==='sources'?'skills':tab,'settings-tab')+(tab==='components'?componentRows():`<div class="knowledge-tabs">${[['library','可用 Skill'],['sources','来源']].map(([id,label])=>btn('skill-manager-tab',label,'tab '+(S.skillTab===id?'active':''),`data-id="${id}"`)).join('')}</div>${S.skillTab==='sources'?sourceBody():skillsBody()}`),footer:close};
  }
  if(m.type==='skill-detail'||m.type==='run-skill'){
    const k=m.type==='run-skill'?p.snapshot:skills.find(k=>k.id===p.id);if(!k)return {title:'来源不可用',body:'这个 Skill 已移除。',footer:close};
    return {title:k.name,body:skillReader(k,m.type==='run-skill'),footer:btn('dialog-back','返回','btn')+(availableSkill(k)&&m.type!=='run-skill'?btn('use-skill','用于下一条任务','btn primary',`data-id="${k.id}"`):'')};
  }
  if(m.type==='source-details')return {title:'管理来源',compact:true,body:`<div class="setting-text mono">${esc(p.id)}</div><p>停用或移除引用只影响之后的运行，原目录和文件保留。</p>`,footer:btn('dialog-back','返回','btn')+btn('toggle-source',S.disabledSources?.has(p.id)?'启用来源':'停用来源','btn')+(p.id.includes('skills')||S.extraSources?.includes(p.id)?btn('remove-source','移除引用','btn danger'):'')};
  if(m.type==='import-skill')return {title:'添加到应用管理库',compact:true,body:`<form id="import-skill-form"><label class="field">来源<select name="source"><option>GitHub</option><option>本地压缩包</option></select></label><label class="field">包地址或文件名<input name="location" required placeholder="https://github.com/example/skills"></label></form><div class="notice">原型模拟获取、校验和安装，不连接远程仓库。</div>`,footer:btn('dialog-back','返回','btn')+'<button class="btn primary" type="submit" form="import-skill-form">获取并安装</button>'};
  if(m.type==='run-method'){const snapshot=p.snapshot||session()?.snapshot;return {title:'本次运行的工作方式',body:`<p class="dialog-lead">工作方式 ${snapshot?'v'+snapshot.version:'未记录'} · 受理时保存</p><div class="setting-text">${esc(snapshot?.method||'本次没有记录工作方式。')}</div><small>后来修改的内容不会改写这个版本。</small>`,footer:btn('dialog-back','返回','btn')};}
  if(m.type==='run-memory')return {title:'本次运行的记忆',body:`<div class="setting-text">${esc(p.snapshot?.memory||'本次没有常驻记忆。')}</div><small>受理时保存的内容；之后修改或撤回不会改写此处的历史记录。</small>`,footer:btn('dialog-back','返回','btn')};
  if(m.type==='proposal-origin')return {title:'修改提议的来源',body:'<p>来自「整理竞品表」</p><div class="setting-text">材料中的价格缺少原始出处时，请标明待核验，不要把它当成确认结论。</div><small>这是待确认提议，尚未改变工作方式。</small>',footer:btn('dialog-back','返回','btn')};
  if(m.type==='workspace-menu'){
    const target=workspaces.find(x=>x.id===(p.id||S.workspace));
    return {title:target.name,compact:true,body:`<p class="mono muted">${esc(target.path)}</p>${[['target-config','工作区设置'],['target-rename','重命名'],['target-archive',target.status==='archived'?'取消归档':'归档工作区'],['target-delete','删除工作区']].map(([a,t])=>btn(a,t,'split-choice',`data-id="${target.id}"`)).join('')}`,footer:''};
  }
  if(m.type==='rename-workspace')return {title:'重命名工作区',compact:true,body:`<form id="rename-workspace-form"><label class="field">名称<input name="name" required value="${esc(workspaces.find(w=>w.id===p.id).name)}"></label></form><small>文件夹名称保持原样。</small>`,footer:btn('dialog-back','取消','btn')+'<button class="btn primary" form="rename-workspace-form">保存</button>'};
  if(m.type==='target-delete')return {title:'删除工作区',compact:true,body:'<p>移除这个工作区的对话、记忆与索引。文件夹和用户文件保留。</p>',footer:btn('dialog-back','取消','btn')+btn('target-delete-confirm','确认删除','btn danger',`data-id="${p.id}"`)};
  if(m.type==='review')return {title:'V4 交互评审',body:'<p>沿用 V1 视觉，补齐工作区概览、背景、知识与多来源 Skill。</p><ol><li>工作区名称只展开或收起；子项进入概览或会话，标题加号新建对话。</li><li>从概览开始任务，切换背景或知识后返回，检查草稿与阅读位置。</li><li>处理修改提议、编辑或撤回记忆，查看运行快照。</li><li>搜索来源并引用到草稿，处理扫描材料的组件与索引。</li><li>在 Skills 中查看同名来源、包目录、Markdown 与运行版本。</li></ol><div class="notice">本原型使用静态夹具。P4–P8 新能力仅为拟议交互，不代表产品已实现；不操作真实文件、模型、终端或浏览器。</div>',footer:close};
  return baseDialog();
}
function referenceRun(b){return b.dataset.run==='initial'?session():session()?.messages.find(m=>m.run?.id===b.dataset.run)?.run;}
function refreshSurfaces(){saveDraft();render();if(S.modal)renderDialog();}
const memoryConfirm=actions['memory-confirm'];
Object.assign(actions,{
  'add-workspace':()=>openDialog('add-workspace'),create:()=>openDialog('add-workspace'),'open-folder':()=>openDialog('add-workspace'),
  'folder-mode':b=>{updateModalDraft($('#unified-workspace-form'));S.modal.draft.mode=b.dataset.id;S.modal.draft.path=b.dataset.id==='new'?'~/Documents/RayAgent':'';renderDialog();},
  'choose-workspace-folder':()=>{updateModalDraft($('#unified-workspace-form'));openDialog('choose-workspace-folder');},
  'workspace-folder-choice':b=>{const choice=b.dataset;backDialog(true);S.modal.draft.path=choice.path;S.modal.draft.choice=choice.id;if(S.modal.draft.mode==='existing')S.modal.draft.name=choice.name;renderDialog();},
  view:b=>route('#workspace/'+S.workspace+'/'+b.dataset.id),
  'new-workspace-chat':b=>{const id=b.dataset.id||S.workspace;S.currentSessions[id]=null;S.expanded.add(id);route('#workspace/'+id+'/chat');$('#composer-input')?.focus();},
  'workspace-menu':b=>openDialog('workspace-menu',{id:b.dataset.id||S.workspace}),
  'target-config':b=>{closeDialog(true);route('#workspace/'+b.dataset.id+'/overview');openDialog('workspace-config');},
  'target-rename':b=>openDialog('rename-workspace',{id:b.dataset.id}),
  'target-archive':b=>{const w=workspaces.find(w=>w.id===b.dataset.id);w.status=w.status==='archived'?'ready':'archived';closeDialog(true);render();},
  'target-delete':b=>openDialog('target-delete',{id:b.dataset.id}),
  'target-delete-confirm':b=>{const id=b.dataset.id;workspaces.splice(workspaces.findIndex(w=>w.id===id),1);for(let i=sessions.length-1;i>=0;i--)if(sessions[i].workspace===id)sessions.splice(i,1);delete memories[id];delete filesByWorkspace[id];closeDialog(true);if(S.workspace===id)route('#home');else render();toast('已移除示例登记，未操作真实文件。');},
  search:()=>{route('#workspace/'+S.workspace+'/knowledge');S.knowledgeTab='search';render();$('#knowledge-query')?.focus();},
  'knowledge-index':()=>{route('#workspace/'+S.workspace+'/knowledge');S.knowledgeTab='index';render();},
  'knowledge-tab':b=>{S.knowledgeTab=b.dataset.id;saveDraft();render();},
  index:()=>actions['knowledge-index'](),
  'search-filter':b=>{S.filter=b.dataset.id;render();$('#knowledge-query')?.focus();},
  'clear-query':()=>{S.query='';render();$('#knowledge-query')?.focus();},
  'search-failure':()=>{S.searchFailure=true;searchResults();},
  'retry-search':()=>{S.searchFailure=false;searchResults();},
  'cite-result':b=>{const e=S.resultEntries.find(e=>e.id===b.dataset.id&&e.type===b.dataset.type);if(!e)return;const current=S.currentSessions[S.workspace];const key=current?'session:'+current:'start:'+S.workspace;S.citations||={};S.citations[key]||=[];if(!S.citations[key].some(c=>c.id===e.id))S.citations[key].push({...e});route('#workspace/'+S.workspace+'/chat');$('#composer-input')?.focus();toast('来源已加入草稿；发送时使用所选版本。');},
  'remove-citation':b=>{S.citations[scope()].splice(Number(b.dataset.id),1);saveDraft();render();},
  'memory-filter':b=>{S.memoryFilter=b.dataset.id;if(S.modal)renderDialog();else render();},
  'memory-confirm':b=>{
    const candidate=memories[S.workspace].find(m=>m.id===b.dataset.id),original=memories[S.workspace].find(m=>m.id==='m1');
    if(candidate?.candidate&&original){const previous={...original};changeMemory(candidate.id,m=>{original.active=false;m.candidate=false;m.confirmed=true;m.source='用户确认';m.resident=previous.resident;},'更新已生效，原记忆已替代。');const undo=S.toastUndo;S.toastUndo=()=>{undo?.();Object.assign(original,previous);refreshSurfaces();};}else memoryConfirm(b);
  },
  'proposal-source':()=>openDialog('proposal-origin'),
  'proposal-accept':()=>{if(isArchived())return;if(S.modal?.dirty){toast('先保存或放弃当前编辑。');return;}const w=workspace();w.method='先给结论，再给依据。数字和引述需要能回到原文；缺少出处时标明待核验。';w.version++;S.proposal=false;refreshSurfaces();toast('已发布工作方式 v'+w.version+'，下一次运行生效。');},
  'proposal-reject':()=>{if(!isArchived()){S.proposal=false;refreshSurfaces();toast('已忽略工作方式提议。');}},
  'run-method':b=>openDialog('run-method',{snapshot:referenceRun(b)?.snapshot}),
  'run-memory':b=>openDialog('run-memory',{snapshot:referenceRun(b)?.snapshot}),
  'run-skill':b=>{const k=referenceRun(b)?.runSkills?.find(k=>k.id===b.dataset.id);if(k){S.skillRead='SKILL.md';openDialog('run-skill',{snapshot:k});}},
  'index-toggle':()=>{if(!isArchived()){workspace().indexPaused=!workspace().indexPaused;refreshSurfaces();}},
  'cancel-index':b=>{const f=wsFiles().find(f=>f.id===b.dataset.id);if(f&&!isArchived()){clearTimeout(f.timer);f.state='已取消';refreshSurfaces();}},
  'retry-index':b=>{const f=wsFiles().find(f=>f.id===b.dataset.id);if(f&&!isArchived())processFile(f,S.workspace);},
  rescan:()=>{if(isArchived())return;wsFiles().filter(f=>['已登记','过时','已取消'].includes(f.state)).forEach(f=>processFile(f,S.workspace));toast('已模拟重新扫描，待处理材料进入队列。');},
  'ocr-component':()=>{S.componentContext={workspace:S.workspace};openDialog('settings',{tab:'components'});},
  'cancel-component':b=>{const c=components.find(c=>c.id===b.dataset.id);clearTimeout(S.componentTimers.get(c.id));c.state='未安装';refreshSurfaces();},
  'component-failure':b=>{components.find(c=>c.id===b.dataset.id).state='准备失败';refreshSurfaces();},
  install:b=>{
    const c=components.find(c=>c.id===b.dataset.id);if(!c||['下载中','校验中'].includes(c.state))return;
    c.state='下载中';refreshSurfaces();
    const finish=()=>{c.state='可用';S.componentTimers.delete(c.id);if(c.id==='ocr')Object.entries(filesByWorkspace).forEach(([id,files])=>files.filter(f=>f.state==='待 OCR').forEach(f=>processFile(f,id,true)));refreshSurfaces();toast(c.name+'准备完成；材料处理状态单独更新。');};
    S.componentTimers.set(c.id,setTimeout(()=>{c.state='校验中';refreshSurfaces();S.componentTimers.set(c.id,setTimeout(finish,1100));},1200));
  },
  'skill-manager-tab':b=>{S.skillTab=b.dataset.id;renderDialog();},
  'settings-tab':b=>{if(b.dataset.id==='sources')S.skillTab='sources';openDialog('settings',{tab:b.dataset.id==='sources'?'skills':b.dataset.id},true);},
  'skill-scope':b=>{S.skillScope=b.dataset.id;renderDialog();},
  'skill-detail':b=>{S.skillRead='SKILL.md';S.editingSkill=false;S.skillSourceView=false;openDialog('skill-detail',{id:b.dataset.id});},
  'skill-file':b=>{if(S.modal.dirty){openDialog('unsaved-switch');return;}S.skillRead=b.dataset.id;S.editingSkill=false;renderDialog();},
  'skill-source-view':()=>{S.skillSourceView=!S.skillSourceView;renderDialog();},
  'edit-skill':()=>{S.editingSkill=true;renderDialog();},
  'import-skill':()=>openDialog('import-skill'),
  'resolve-skill':b=>{const k=skills.find(k=>k.id===b.dataset.id);skills.filter(other=>other.name===k.name&&other.scope===k.scope).forEach(other=>{other.conflict=false;other.enabled=other.id===k.id;});renderDialog();toast('已明确选择来源，新运行采用这一份。');},
  'use-skill':b=>{const k=skills.find(k=>k.id===b.dataset.id);if(!availableSkill(k)){toast('请先处理来源、同名冲突或启用状态。');return;}const target=['background','knowledge','home'].includes(S.view);const key=target?(S.currentSessions[S.workspace]?'session:'+S.currentSessions[S.workspace]:'start:'+(S.workspace||'independent')):scope();S.selection[key]=k.id;closeDialog(true);if(target)route(S.workspace?'#workspace/'+S.workspace+'/chat':'#independent');else render();},
  'toggle-source':()=>{S.disabledSources||=new Set();const source=S.modal.props.id;S.disabledSources.has(source)?S.disabledSources.delete(source):S.disabledSources.add(source);backDialog(true);toast('来源已更新，原文件保留。');},
  'source-confirm':()=>{S.extraSources||=[];const source='agent-skills';if(!S.extraSources.includes(source))S.extraSources.push(source);S.disabledSources?.delete(source);let k=skills.find(k=>k.id==='custom');if(k){k.unavailable=false;k.enabled=true;}else skills.push({id:'custom',name:'本地资料整理',description:'使用已有目录中的方法整理材料。',source,scope:'用户级',enabled:true,version:'v1'});backDialog(true);toast('已添加示例目录引用，原文件保留。');},
  'remove-source':()=>{S.disabledSources||=new Set();S.disabledSources.add(S.modal.props.id);skills.filter(k=>k.source===S.modal.props.id).forEach(k=>k.unavailable=true);backDialog(true);toast('已移除引用，原目录和文件保留。');}
});
function processFile(f,workspaceId,ocr=false){
  const owner=workspaces.find(w=>w.id===workspaceId);if(!owner||(owner.excluded||[]).includes(f.folder))return;
  clearTimeout(f.timer);f.state=owner.indexPaused?'排队中':ocr?'文字识别中':'解析中';refreshSurfaces();
  const tick=()=>{
    if(owner.indexPaused){f.timer=setTimeout(tick,900);return;}
    if(f.state==='已取消')return;
    if(['解析中','文字识别中','排队中'].includes(f.state)){f.state='索引中';f.timer=setTimeout(tick,1400);}
    else {f.state='可检索';f.revision=f.revision==='r2'?'r3':f.revision;}
    refreshSurfaces();
  };f.timer=setTimeout(tick,1400);
}
/* 捕获新增表单，使底层旧表单处理器不会重复提交。 */
document.addEventListener('submit',e=>{
  const form=e.target;
  if(!['unified-workspace-form','rename-workspace-form','import-skill-form','edit-skill-form'].includes(form.id))return;
  e.preventDefault();const data=Object.fromEntries(new FormData(form));
  if(form.id==='unified-workspace-form'){
    updateModalDraft(form);const d=S.modal.draft;if(!d.name?.trim())return;
    if(d.mode==='existing'&&d.choice==='copy'){openDialog('conflict');return;}
    if(d.mode==='existing'&&d.choice==='moved'){S.workspace='expense';openDialog('relocate');return;}
    const id=createWorkspace(d.name.trim(),d.mode==='existing'?d.path:d.path+'/'+d.name.trim(),'',d.mode==='existing'?baseFiles:[]);
    workspaces.find(w=>w.id===id).indexPaused=d.mode==='existing'&&!d.index;
    closeDialog(true);goWorkspace(id);toast(d.mode==='existing'?'已登记示例文件夹，材料索引独立处理。':'已创建示例工作区。');
  }
  if(form.id==='rename-workspace-form'){workspaces.find(w=>w.id===S.modal.props.id).name=data.name.trim();closeDialog(true);render();}
  if(form.id==='import-skill-form'){
    const id=newId('import-');skills.push({id,name:'资料整理',description:'从示例包导入的方法。',source:'应用管理',origin:data.source,scope:'用户级',enabled:true,version:'v1'});S.skillRead='SKILL.md';openDialog('skill-detail',{id},true);toast('已模拟获取、校验与安装。');
  }
  if(form.id==='edit-skill-form'){const k=skills.find(k=>k.id===S.modal.props.id);k.body=data.body;k.version='v'+(Number(k.version.slice(1))+1);S.editingSkill=false;S.modal.dirty=false;renderDialog();toast('已保存新版本，已发送运行保留原快照。');}
},true);
document.addEventListener('input',e=>{
  if(e.target.id==='skill-query'){S.skillQuery=e.target.value;const pos=e.target.selectionStart;renderDialog();$('#skill-query')?.focus();$('#skill-query')?.setSelectionRange(pos,pos);}
  if(e.target.closest('#edit-skill-form'))S.modal.dirty=true;
});
document.addEventListener('change',e=>{
  if(e.target.hasAttribute('data-index-folder'))refreshSurfaces();
  if(e.target.dataset.setting==='auto-memory')refreshSurfaces();
});
document.addEventListener('keydown',e=>{
  if(e.target.id==='composer-input'&&e.key==='/'&&!e.target.value&&!$('#dialog').open){e.preventDefault();actions['choose-skill']();}
});
/* 发送前冻结本次使用的来源、版本与正文。 */
const originalSend=sendMessage;
sendMessage=function(){
  const input=$('#composer-input');if(!input?.value.trim())return;
  const key=scope(),skill=skills.find(k=>k.id===S.selection[key]);
  if(skill&&!availableSkill(skill)){toast('所选 Skill 已不可用，请重新选择。');return;}
  const refs=(S.citations?.[key]||[]).map(c=>({...c}));
  if(refs.some(c=>c.type==='记忆'&&!(memories[S.workspace]||[]).some(m=>m.id===c.id&&m.active&&!m.candidate)||c.type==='文件'&&!wsFiles().some(f=>f.id===c.id)||c.type==='会话'&&!sessions.some(s=>s.id===c.id&&s.workspace===S.workspace))){toast('所选来源已撤回或不可用，请移除引用后发送。');return;}
  const oldSession=S.view==='chat'?session():null;
  originalSend();const s=session();if(!s)return;
  const run={id:newId('run-'),snapshot:workspace()?{method:workspace().method,version:workspace().version,memory:activeMemories().filter(m=>m.resident).map(m=>m.text).join('；')}:null,runSkills:skill?[{...skill}]:[],runCitations:refs};
  const reply=s.messages[s.messages.length-1];reply.run=run;
  if(S.citations)delete S.citations[key];
  render();

};
applyRoute();

$('#scenario').addEventListener('change',e=>{
  if(['search-failure','semantic-missing','ocr-failure'].includes(e.target.value)){
    route('#workspace/review/knowledge');S.knowledgeTab=e.target.value==='ocr-failure'?'index':'search';
    if(e.target.value==='search-failure')S.searchFailure=true;
    if(e.target.value==='semantic-missing')components.find(c=>c.id==='embedding').state='未安装';
    if(e.target.value==='ocr-failure'){components.find(c=>c.id==='ocr').state='准备失败';openDialog('settings',{tab:'components'});}
    render();
  }
});

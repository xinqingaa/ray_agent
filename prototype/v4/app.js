/* 独立静态交互夹具：不调用核心，不读取或写入真实文件。 */
const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => [...root.querySelectorAll(q)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  plus:'M8 3v10M3 8h10', down:'m4 6 4 4 4-4', right:'m6 4 4 4-4 4', close:'m4 4 8 8M12 4l-8 8',
  folder:'M2 13V4h4l2 2h6v7Z', search:'M11 11l3 3M12 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  settings:'M2 4h12M2 8h12M2 12h12M5 2v4M11 6v4M6 10v4', arrow:'M8 13V3m-4 4 4-4 4 4',
  back:'m9 3-5 5 5 5M4 8h10', file:'M4 2h5l3 3v9H4Zm5 0v4h3', memory:'M3 3h10v10H3ZM6 6h4M6 9h4',
  panel:'M2 3h12v10H2Zm8 0v10', more:'M3 8h.1M8 8h.1M13 8h.1', attach:'m5 8 5-5a2 2 0 0 1 3 3l-6 6a3 3 0 0 1-4-4l6-6',
  check:'m3 8 3 3 7-7', link:'M6 4H3v9h10v-3M8 8l5-5M9 3h4v4', menu:'M3 4h10M3 8h10M3 12h10',
  chat:'M2 3h12v8H7l-4 3v-3H2Z', skill:'m8 2 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z'
};
const icon = name => `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const btn = (action, label, cls='ghost', data='') => `<button type="button" class="${cls}" data-action="${action}" ${data}>${label}</button>`;
const ib = (action, name, label, data='') => `<button type="button" class="icon" data-action="${action}" aria-label="${label}" title="${label}" ${data}>${icon(name)}</button>`;
const workspaces = [
  {id:'review',name:'季度复盘',path:'~/Documents/季度复盘',method:'先给结论，再给依据。数字和引述需要能回到原文；材料不足时明确说明。',version:3,autoMemory:true,execution:false,status:'ready',indexPaused:false},
  {id:'course',name:'课程笔记',path:'~/Documents/课程笔记',method:'用循序渐进的方式解释，先建立概念之间的联系。',version:1,autoMemory:true,execution:false,status:'ready',indexPaused:false},
  {id:'expense',name:'出差报销',path:'~/Documents/出差报销',method:'核对票据与日期，缺少材料时列出待补项。',version:1,autoMemory:true,execution:false,status:'offline',indexPaused:false},
  {id:'photos',name:'家庭旧照整理',path:'~/Documents/家庭旧照整理',method:'',version:1,autoMemory:true,execution:false,status:'ready',indexPaused:false},
  {id:'archived',name:'产品评审',path:'~/Documents/产品评审',method:'先列影响，再讨论解决方式。',version:1,autoMemory:false,execution:false,status:'archived',indexPaused:false}
];
const baseFiles = [
  {id:'a',name:'竞品-A.pdf',folder:'材料',type:'pdf',state:'可检索',size:'2.4 MB'},
  {id:'b',name:'竞品-B.pdf',folder:'材料',type:'pdf',state:'可检索',size:'1.8 MB'},
  {id:'notes',name:'纪要.md',folder:'材料',type:'md',state:'可检索',size:'12 KB'},
  {id:'scan',name:'扫描合同.pdf',folder:'合同',type:'pdf',state:'待 OCR',size:'5.1 MB'},
  {id:'sheet',name:'对比表.xlsx',folder:'成果',type:'xlsx',state:'本次写入',size:'28 KB'},
  {id:'board',name:'白板.png',folder:'材料',type:'png',state:'解析失败',size:'1.2 MB'}
];
const filesByWorkspace = {
  review:baseFiles.map(f=>({...f})),
  course:[{id:'reading',name:'阅读清单.md',folder:'',type:'md',state:'可检索',size:'8 KB'},{id:'chapter',name:'学习笔记.pdf',folder:'',type:'pdf',state:'索引中',size:'3.2 MB'}],
  expense:[{id:'receipt',name:'差旅清单.xlsx',folder:'',type:'xlsx',state:'上次读取',size:'16 KB'}],
  photos:[],archived:[{id:'report',name:'评审结论.md',folder:'',type:'md',state:'可检索',size:'14 KB'}]
};
const memories = {
  review:[
    {id:'m1',text:'对外报价需要经过市场确认。',type:'约束',source:'用户明确要求',confirmed:true,pinned:true,active:true},
    {id:'m2',text:'汇报中先写结论，再展开依据。',type:'偏好',source:'自动提炼',confirmed:false,pinned:false,active:true},
    {id:'m3',text:'教育渠道折扣需要单独确认口径。',type:'决定',source:'待确认更新',candidate:true,active:true}
  ],
  course:[{id:'c1',text:'学习新概念时希望先看到直观例子。',type:'偏好',source:'用户明确要求',confirmed:true,pinned:true,active:true}],
  expense:[],photos:[],archived:[]
};
const sessions = [
  {id:'review-1',workspace:'review',title:'整理竞品表',summary:'已整理价格结构和渠道差异，交付对比表。',time:'今天',kind:'comparison',status:'done',remember:true,messages:[],snapshot:{method:workspaces[0].method,version:3,memory:'对外报价需要经过市场确认。'}},
  {id:'review-2',workspace:'review',title:'写纪要给市场',summary:'整理需要进一步确认的问题。',time:'昨天',kind:'note',status:'done',remember:true,messages:[]},
  {id:'review-3',workspace:'review',title:'定价策略讨论',summary:'讨论定价结构与后续材料。',time:'周一',kind:'note',status:'done',remember:true,messages:[]},
  {id:'course-1',workspace:'course',title:'整理学习路径',summary:'从基础概念到实践练习的学习顺序。',time:'昨天',kind:'note',status:'done',remember:true,messages:[]},
  {id:'loose-1',workspace:null,title:'把会议录音整理成纪要',summary:'已整理要点和待办。',time:'昨天',kind:'loose',status:'done',remember:false,messages:[]},
  {id:'loose-2',workspace:null,title:'润色一封邮件',summary:'调整措辞和段落。',time:'周一',kind:'loose',status:'done',remember:false,messages:[]}
];
const skills = [
  {id:'slides',name:'制作演示文稿',description:'组织叙事、生成演示文稿，并检查排版。',source:'应用管理',scope:'用户级',enabled:true},
  {id:'docs',name:'文档处理',description:'阅读、整理和修改文档，核对最终呈现。',source:'.agents/skills',scope:'用户级',enabled:true},
  {id:'review',name:'评审准备',description:'整理材料、核对论据并形成评审提纲。',source:'.codex/skills',scope:'当前工作区',enabled:true,workspace:'review'},
  {id:'tables',name:'表格分析',description:'整理数据、比较差异和生成工作簿。',source:'GitHub',scope:'用户级',enabled:false}
];
const components = [{id:'browser',name:'浏览器',purpose:'访问需要交互的网页',state:'未安装'}, {id:'ocr',name:'文字识别',purpose:'读取扫描件和图片文字',state:'未安装'}, {id:'embedding',name:'语义检索',purpose:'按含义查找相关材料',state:'可用'}];
const S = {
  workspace:'review',session:null,view:'start',expanded:new Set(['review']),panels:{},
  drafts:{},selection:{},closedFolders:new Set(),query:'',filter:'全部',memoryFilter:'全部',
  modal:null,history:[],toastTimer:null,toastUndo:null,dialogReturn:null,models:{},
  searchBack:null,lease:false,proposal:true,external:false,undoDone:false,
  globalExecution:false,componentTimers:new Map(),nextId:20,plan:false
};
try { S.drafts = JSON.parse(sessionStorage.getItem('rayagent-prototype-v4-drafts') || '{}'); } catch {}
const workspace = () => workspaces.find(w=>w.id===S.workspace);
const session = () => sessions.find(s=>s.id===S.session);
const scope = () => S.session && S.view==='chat' ? 'session:'+S.session : 'start:'+(S.workspace || 'independent');
const panel = () => S.panels[S.workspace || 'independent'] ||= {open:!!S.workspace&&innerWidth>900,tab:'files',preview:null};
const wsSessions = id => sessions.filter(s=>s.workspace===id);
const wsFiles = () => filesByWorkspace[S.workspace] || [];
const activeMemories = () => (memories[S.workspace] || []).filter(m=>m.active&&!m.candidate);
const isArchived = () => workspace()?.status==='archived';
const newId = prefix => prefix+(S.nextId++);
function toast(text, undo) {
  clearTimeout(S.toastTimer); S.toastUndo=undo || null;
  $('#toast').innerHTML = `<span>${esc(text)}</span>${undo?btn('toast-undo','撤销',''):''}`; $('#toast').hidden=false;
  S.toastTimer=setTimeout(()=>{$('#toast').hidden=true;S.toastUndo=null;},6500);
}
function saveDraft() {
  const input=$('#composer-input');
  if(input) S.drafts[scope()]=input.value;
  try { sessionStorage.setItem('rayagent-prototype-v4-drafts',JSON.stringify(S.drafts)); } catch {}
}
function route(hash) { saveDraft(); if(location.hash!==hash)history.pushState(null,'',hash); applyRoute(); }
function goWorkspace(id) { route('#workspace/'+id); }
function banners() {
  const w=workspace();if(!w)return '';
  if(w.status==='offline')return `<div class="banner"><span>文件夹暂时找不到。对话仍可继续，文件操作已暂停。</span>${btn('relocate','重新定位','')}</div>`;
  if(w.status==='archived')return `<div class="banner info"><span>工作区已归档，只能阅读。</span>${btn('unarchive','取消归档','')}</div>`;
  if(S.lease&&w.id==='review')return `<div class="banner"><span>「写纪要给市场」正在修改文件夹。</span>${btn('lease-owner','查看占用对话','')}</div>`;
  return '';
}
function composer(inline=false) {
  const selected=S.selection[scope()];
  return `<form id="composer-form" class="composer ${inline?'inline':''}"><div class="reading"><div class="input-box">
    ${S.attachments?.[scope()]?'<div class="selection">'+icon('file')+esc(S.attachments[scope()])+ib('remove-attachment','close','移除附件')+'</div>':''}
    ${selected?`<div class="selection">${icon('skill')}${esc(skills.find(k=>k.id===selected)?.name || '已选 Skill')}${ib('clear-skill','close','移除所选 Skill')}</div>`:''}
    <textarea id="composer-input" aria-label="输入任务" placeholder="${S.session&&S.view==='chat'?'补充或继续':S.workspace?'在这个工作区里描述你想完成的事':'描述你想完成的任务'}" rows="2">${esc(S.drafts[scope()]||'')}</textarea>
    <div class="input-actions">${btn(S.workspace?'add-files':'attach','附件')}${btn('plan',S.plan?'计划已开启':'计划')}${btn('choose-skill','Skills')}<span class="grow"></span>
      ${btn('model',esc(S.models[scope()]||'Claude 4.5')+' · 思考','ghost model-label')}
      <button class="send" type="submit" aria-label="发送">${icon('arrow')}</button>
    </div></div></div></form>`;
}
function recentRows(list) {
  return list.map(s=>`<button class="recent-row" data-action="session" data-id="${s.id}"><span class="recent-main"><span class="recent-title">${esc(s.title)}</span><span class="recent-summary">${esc(s.summary)}</span></span><small>${esc(s.time)}</small>${icon('right')}</button>`).join('');
}
function chatView() {
  const s=session(),comparison=s.kind==='comparison';
  let body='';
  if(comparison) {
    body=`<article class="message user"><p>把这个文件夹里的竞品资料整理成一页要点，标出我们和对方在定价上的差别。结论先写，再列依据。</p></article>
    <div class="status-line">${s.status==='running'?'<span class="spin"></span>':'<span>'+icon('check')+'</span>'}<span>${s.status==='running'?'正在对比价格与渠道差异':'已读取 3 份资料'}</span></div>
    <details class="process"><summary>查看执行细节</summary>
      <div class="process-row"><span>读取 材料/竞品-A.pdf</span><span>完成</span></div><div class="process-row"><span>读取 材料/竞品-B.pdf</span><span>完成</span></div><div class="process-row"><span>读取 材料/纪要.md</span><span>完成</span></div>
      <div class="process-row"><span>生成对比表</span>${btn('execution-detail','查看执行记录','text-link')}</div>
      <div class="process-row"><span>网页核对</span>${btn('browser-detail','查看页面记录','text-link')}</div>
      <div class="process-row"><span>计划：核对材料 → 比较差异 → 交付文件</span><span>${s.status==='done'?'3 / 3':'2 / 3'}</span></div></details>
    <article class="message" style="margin-top:24px"><p>主要差别在计费方式和教育渠道折扣：对方公开价目按月分档，我们的材料按年、按席位报价，不能直接按标价比较。</p>
    <p>教育渠道折扣另列在 ${btn('cite-file','竞品-A 第 2 页','citation','data-id="a"')}，不进入公开价目表。扫描合同尚未解析，未作为这次结论的依据。</p>
    ${s.status==='done'?`<p>对比表已整理完成，文件保存在工作区的「成果」文件夹。</p><button class="delivery" data-action="delivery" data-id="sheet">${icon('file')}<span><strong>对比表.xlsx</strong><small>本次交付 · 28 KB</small></span>${icon('right')}</button>`:''}
    ${referenceBlock(s)}</article>
    ${s.status==='approval'?`<section class="approval"><h2>允许执行这条命令？</h2><p>生成工作簿，需要在本机运行脚本并写入「成果/对比表.xlsx」。</p><div class="setting-text mono">python build_comparison.py</div><p>运行位置：${esc(workspace().path)}。本机命令以当前用户权限运行。</p><div class="approval-actions">${btn('approve','允许这一次','btn primary')}${btn('deny','拒绝','btn')}${btn('execution-detail','查看详情')}</div></section>`:''}
    ${s.status==='stopped'?'<div class="notice">已停止生成。可以补充要求后继续。</div>':''}
    <div class="run-foot"><span>${s.status==='running'?'正在处理':s.status==='approval'?'等待批准':s.status==='stopped'?'已停止':'已完成'}</span><span class="grow"></span><span>12 秒 · 3 轮</span>${s.status==='done'?btn('undo',S.undoDone?'查看撤销结果':'撤销本次修改'):s.status==='running'?btn('stop','停止生成'):''}</div>`;
  } else if(s.kind==='demo') {
    body='';
  } else {
    body=`<article class="message user"><p>${esc(s.title)}。</p></article><article class="message"><p>${esc(s.summary)}</p><p>可以继续补充要求，或另开一次对话。</p></article>`;
  }
  body+=(s.messages||[]).map(m=>`<article class="message ${m.role==='user'?'user':''}"><p>${esc(m.text).replace(/\n/g,'<br>')}</p>${m.run?referenceBlock(m.run):''}</article>`).join('');
  return `<div class="content" id="chat-scroll"><div class="reading">${body}</div></div>${!isArchived()?composer():''}`;
}
const knowledgeEntries = () => [
  ...wsFiles().filter(f=>['可检索','本次写入','过时'].includes(f.state)&&!(workspace()?.excluded||[]).includes(f.folder)).map(f=>({id:f.id,type:'文件',title:f.name,excerpt:({a:'教育渠道折扣不进入公开价目表，需要单独确认。',b:'基础版与团队版按月计费，年付有单独折扣。',sheet:'价格结构、折扣和席位差异汇总。',notes:'会议决定：整理对比表并核对材料出处。',reading:'课程阅读顺序：基础概念、方法练习与延伸阅读。',chapter:'学习笔记：概念之间的联系与实践练习。',report:'产品评审结论与后续行动。',old:'上季度定价讨论与待确认项。'})[f.id]||f.name+' 的示例内容。',location:f.type==='pdf'?'第 2 页':'第 3 段',stale:f.state==='过时'})),
  ...activeMemories().map(m=>({id:m.id,type:'记忆',title:m.text,excerpt:m.source,location:m.resident?'常驻记忆':'可检索记忆'})),
  ...wsSessions(S.workspace).map(s=>({id:s.id,type:'会话',title:s.title,excerpt:s.summary,location:s.time}))
];
function previewContent(preview) {
  const f=wsFiles().find(f=>f.id===preview.id);
  if(!f)return '<div class="empty">这个来源已不可用。</div>';
  let doc='';
  if(f.type==='xlsx')doc=`<h2>竞品定价对比</h2><p>${preview.version==='delivery'?'交付时保存的版本':'文件夹中的当前版本'}</p><div class="table-wrap"><table><thead><tr><th>对象</th><th>计费方式</th><th>渠道折扣</th></tr></thead><tbody><tr><td>竞品 A</td><td>按月分档</td><td>教育渠道单独约定</td></tr><tr><td>竞品 B</td><td>按月 / 年付</td><td>年付折扣</td></tr><tr><td>我们的材料</td><td>按年、按席位</td><td>待市场确认</td></tr></tbody></table></div>`;
  if(f.type==='xlsx'&&preview.version==='current'&&S.undoDone&&(S.undoNames||[]).includes('成果/对比表.xlsx'))doc='<h2>价格结构清单</h2><p>文件夹当前版本 · 已恢复运行前内容</p><table><tr><th>对象</th><th>计费方式</th></tr><tr><td>竞品 A</td><td>按月分档</td></tr><tr><td>竞品 B</td><td>按月 / 年付</td></tr></table>';
  else if(f.type==='pdf')doc=`<h2>${esc(f.name.replace('.pdf',''))}</h2><p>材料原文 · 第 ${preview.page||2} 页</p><h3>价格与渠道</h3><p>公开价目按基础版和团队版划分。按年签约与按席位采购的条款另行说明。</p><p class="${preview.version==='citation'?'source-highlight':''}">教育渠道折扣不进入公开价目表，需要根据合同与市场确认口径。</p><p>本页保留原材料的阅读顺序，引用定位到这一段。</p>`;
  else if(f.type==='png')doc='<h2>白板记录</h2><p>图片预览占位 · 未接入真实文件</p><div class="notice">这份材料暂未完成文字识别。</div>';
  else if(f.type!=='xlsx')doc=`<h2>${esc(f.name.replace('.md',''))}</h2><h3>讨论要点</h3><p>先比较价格结构，再核对渠道折扣和席位口径。</p><p>数字需要能回到来源材料，缺少依据的部分保留待确认标记。</p><h3>后续工作</h3><p>整理对比表，列出需要向市场确认的问题。</p>`;
  if(S.workspace!=='review')doc=`<h2>${esc(f.name)}</h2><p>当前工作区的示例材料 · ${esc(preview.version==='citation'?'引用版本':'当前版本')}</p><p>${esc(knowledgeEntries().find(e=>e.id===f.id)?.excerpt||'这份材料尚未完成解析，可在文件夹中打开原文件。')}</p>`;
  return `<div class="panel-head">${ib('preview-back','back','返回材料列表')}<h2>${esc(f.name)}</h2>${ib('preview-expand','panel','放大预览')}${ib('toggle-panel','close','关闭材料')}</div>
  <div class="preview-toolbar"><span>${preview.version==='delivery'?'本次交付版本':preview.version==='citation'?'本次引用版本':'文件夹当前版本'}</span><span class="grow"></span>${f.type==='pdf'?btn('preview-page','第 '+(preview.page||2)+' 页 · 切换','ghost'):''}</div>
  ${S.external&&preview.version==='current'?'<div class="banner"><span>文件在外部发生了修改。</span>'+btn('reload-preview','重新载入','')+'</div>':''}
  ${preview.version==='delivery'?'<div class="notice" style="margin:10px 12px">文件夹里的内容可能已更新。'+btn('current-version','查看当前文件','text-link')+'</div>':''}
  <div class="preview-canvas"><article class="document-page">${doc}</article></div>
  <div class="panel-foot"><span>${esc(f.size)}${preview.version==='citation'?' · 引用已定位':''}</span><span class="grow"></span>${preview.version!=='delivery'?btn('finder','在 Finder 中显示','text-link'):''}</div>`;
}
function showFile(id,version='current') { const p=panel();p.listScroll=$('.panel-body')?.scrollTop||0;const origin=document.activeElement;p.returnTarget=origin?.dataset?.action?{action:origin.dataset.action,id:origin.dataset.id}:null;p.preview={id,version,page:2};p.open=true;renderPanel(); }

/* 弹层统一保留返回关系；编辑草稿挂在弹层状态，不因查看来源而丢失。 */
const formValue = (key,fallback='') => S.modal?.draft?.[key] ?? fallback;
function openDialog(type,props={},replace=false) {
  if(!$('#dialog').open) { saveDraft(); S.dialogReturn=document.activeElement;S.history=[]; }
  else if(!replace&&S.modal) S.history.push(S.modal);
  S.modal={type,props,draft:{},dirty:false};
  renderDialog();if(!$('#dialog').open)$('#dialog').showModal();
}
function backDialog(force=false) {
  if(S.modal?.dirty&&!force) {openDialog('discard',{intent:'back'});return;}
  if(S.history.length) {S.modal=S.history.pop();renderDialog();}
  else closeDialog(true);
}
function closeDialog(force=false) {
  if(S.modal?.dirty&&!force) {openDialog('discard',{intent:'close'});return;}
  $('#dialog').close();S.modal=null;S.history=[];
  if(S.dialogReturn?.isConnected)S.dialogReturn.focus();
}
function dialogTabs(items,current,action) {
  return `<div class="settings-tabs">${items.map(([key,label])=>btn(action,label,'tab '+(key===current?'active':''),`data-id="${key}" aria-pressed="${key===current}"`)).join('')}</div>`;
}
function baseDialog() {
  const m=S.modal,w=workspace(),p=m.props;
  let title='',body='',footer='',compact=false;
  const close=btn('dialog-close','关闭','btn');
  if(m.type==='review') {
    title='这版原型评审什么';
    body=`<p class="dialog-lead">视觉与简短过程展示沿用 V1。这版重点检查工作区和后续能力的交互。</p>
    <div class="settings-section"><h3>已确认</h3><p>独立对话与工作区共用左栏；工作区可展开会话。点工作区名称进入输入区与最近会话；点具体会话直接打开。</p></div>
    <div class="settings-section"><h3>建议这样试用</h3><ol><li>从季度复盘发送任务，切换独立对话，再返回检查草稿。</li><li>打开「整理竞品表」，点击引用和成果，试试预览返回。</li><li>从工作区入口修改工作方式、查看记忆、搜索材料。</li><li>从底部场景切到审批、失联、占用、撤销和组件准备。</li></ol></div>
    <div class="notice">所有数据与执行结果都是静态演示，不访问模型、文件夹、终端或浏览器。P3 已有实现；P4–P8 的新增能力仅表达拟议交互。</div>
    <p class="muted">底部深色条属于评审工具，不属于产品界面。新对话发送只产生占位回复。</p>`;
    footer=close;
  } else if(m.type==='workspace-menu') {
    title=w.name;compact=true;
    body=`<p class="mono muted">${esc(w.path)}</p>
      ${btn('workspace-config','工作区设置','split-choice')}${btn('memory','记忆','split-choice')}${btn('index','索引与材料','split-choice')}
      ${btn('archive',isArchived()?'取消归档':'归档工作区','split-choice')}${btn('delete-workspace','删除工作区','split-choice')}`;
  } else if(m.type==='workspace-config'||m.type==='method') {
    const tab=p.tab||(m.type==='method'?'method':'general');
    title='工作区设置';
    body=dialogTabs([['general','基本信息'],['method','工作方式'],['memory','记忆'],['execution','执行'],['index','索引']],tab,'workspace-tab');
    if(tab==='general')body+=`<form id="workspace-form" data-form="workspace"><label class="field">名称<input name="name" required value="${esc(formValue('name',w.name))}" ${isArchived()?'disabled':''}></label><label class="field">文件夹<span class="mono">${esc(w.path)}</span></label><div class="inline-actions">${btn('finder','在 Finder 中显示','btn')}${btn('relocate','重新定位','btn')}</div></form><div class="settings-row"><div class="row-copy"><strong>工作区模板</strong><small>只保存工作方式与执行建议，不包含文件、会话或记忆。</small></div>${btn('template','另存为模板','btn')}</div>`;
    if(tab==='method')body+=`<form id="method-form" data-form="method"><label class="field">这里的工作方式 <small>每次新运行生效，正在进行的任务沿用原版本。</small><textarea name="method" ${isArchived()?'disabled':''} placeholder="说明在这里如何协助你">${esc(formValue('method',w.method))}</textarea></label><small>当前版本 v${w.version}</small></form>
      ${S.proposal&&w.id==='review'?`<section class="approval"><h3>一条待确认的修改提议</h3><p>来自「整理竞品表」，确认后用于下一次运行。</p><div class="diff"><del>数字和引述需要能回到原文。</del><ins>数字和引述需要能回到原文；缺少出处时标明待核验。</ins></div><div class="approval-actions">${btn('proposal-source','查看来源')}${btn('proposal-accept','确认修改','btn',''+(isArchived()?'disabled':''))}${btn('proposal-reject','忽略','ghost',''+(isArchived()?'disabled':''))}</div></section>`:''}`;
    if(tab==='memory')body+=`<div class="settings-row"><div class="row-copy"><strong>自动积累记忆</strong><small>新增记忆会提示；涉及已确认内容的更新会等待你处理。</small></div><label><input type="checkbox" data-setting="auto-memory" ${w.autoMemory?'checked':''} ${isArchived()?'disabled':''} aria-label="自动积累记忆"></label></div><div class="settings-row"><div class="row-copy"><strong>查看和纠正记忆</strong><small>查看来源、修改、钉住或撤回。</small></div>${btn('memory','打开记忆','btn')}</div>`;
    if(tab==='execution')body+=`<div class="settings-row"><div class="row-copy"><strong>允许本机执行</strong><small>允许 Shell 与脚本以当前系统用户权限运行；工作目录是这个工作区。</small></div><input type="checkbox" data-setting="execution" ${w.execution?'checked':''} ${isArchived()?'disabled':''} aria-label="允许本机执行"></div><div class="notice">这个开关不限制普通文件阅读，也不代表命令被限制在工作区内。需要审批的动作仍会单独询问。</div><div class="settings-row"><div class="row-copy"><strong>执行所需组件</strong><small>缺少组件时可在任务中准备。</small></div>${btn('components','管理组件','btn')}</div>`;
    if(tab==='index')body+=indexBody();
    footer=(tab==='method'||tab==='general')&&!isArchived()?close+`<button type="submit" form="${tab==='method'?'method-form':'workspace-form'}" class="btn primary">保存</button>`:close;
  } else if(m.type==='memory') {
    title=w.name+' · 记忆';
    body=`<div class="section-label"><small>记忆仅用于这个工作区。</small><span class="grow"></span>${!isArchived()?btn('memory-new',icon('plus')+'添加记忆','btn'):''}</div>${dialogTabs(['全部','常驻','待确认','已撤回'].map(t=>[t,t]),S.memoryFilter,'memory-filter')}<div>${memoryList()}</div>`;footer=close;
  } else if(m.type==='memory-edit') {
    const memory=(memories[S.workspace]||[]).find(x=>x.id===p.id);
    title=memory?'修改记忆':'添加记忆';compact=true;
    body=`<form id="memory-form" data-form="memory"><label class="field">内容<textarea name="text" required>${esc(formValue('text',memory?.text||''))}</textarea></label><label class="field">类型<select name="type">${['事实','偏好','决定','约束'].map(t=>`<option ${formValue('type',memory?.type||'事实')===t?'selected':''}>${t}</option>`).join('')}</select></label></form>`;
    footer=btn('dialog-back','返回','btn')+'<button form="memory-form" class="btn primary" type="submit">保存记忆</button>';
  } else if(m.type==='memory-source'||m.type==='run-method') {
    title=m.type==='run-method'?'这次运行使用的工作方式':'记忆来源';
    const memory=(memories[S.workspace]||[]).find(x=>x.id===p.id);
    body=m.type==='run-method'?`<p class="dialog-lead">工作方式 v${session()?.snapshot?.version||w.version} · 本次运行受理时保存</p><div class="setting-text">${esc(session()?.snapshot?.method||w.method)}</div><small>之后修改工作区设置，不会改写这次运行的背景。</small>`:`<p class="dialog-lead">${esc(memory?.source||'本次运行使用的记忆版本')}</p><div class="setting-text">${esc(memory?.text||session()?.snapshot?.memory||'')}</div><p>来源会话：${esc(wsSessions(S.workspace)[0]?.title||'用户手动添加')}</p><small>来源记录与记忆条目分开保存；撤回记忆不会删除原会话。</small>`;
    footer=btn('dialog-back','返回','btn');
  } else if(m.type==='search-memory') {
    const memory=(memories[S.workspace]||[]).find(x=>x.id===p.id);title='记忆';
    body=`<div class="setting-text">${esc(memory?.text)}</div><small>${esc(memory?.source)}</small>`;footer=btn('memory','管理记忆','btn')+close;
  } else if(m.type==='index') {
    title=w.name+' · 索引';body=indexBody();footer=close;
  } else if(m.type==='create') {
    title='新建工作区';compact=true;
    body=`<form id="create-form" data-form="create"><label class="field">名称<input name="name" required autofocus placeholder="给这件事起个名字" value="${esc(formValue('name'))}"></label><label class="field">位置<span class="mono">~/Documents/RayAgent/</span></label>${S.templates?.length?'<label class="field">使用模板<select name="template"><option value="">不使用模板</option>'+S.templates.map(t=>'<option '+(formValue('template')===t.name?'selected':'')+'>'+esc(t.name)+'</option>').join('')+'</select></label>':''}<label class="field">工作方式（可选）<textarea name="method" placeholder="也可以稍后再设置">${esc(formValue('method'))}</textarea></label><small>创建同名文件夹，用来保存材料和成果。</small></form>`;
    footer=btn('dialog-close','取消','btn')+'<button form="create-form" type="submit" class="btn primary">创建工作区</button>';
  } else if(m.type==='open-folder') {
    title='打开已有文件夹';compact=true;
    body=`<p class="dialog-lead">选择本地文件夹作为工作区，文件保留在原位置。</p><div class="notice">原型使用以下示例代替系统文件夹选择器。</div>
    <button class="split-choice" data-action="pick-folder" data-id="new"><strong>${icon('folder')} 项目资料</strong><small>~/Documents/项目资料 · 尚未登记</small></button>
    <button class="split-choice" data-action="pick-folder" data-id="copy"><strong>${icon('folder')} 季度复盘 copy</strong><small>包含已有工作区标记</small></button>
    <button class="split-choice" data-action="pick-folder" data-id="moved"><strong>${icon('folder')} 出差报销</strong><small>~/Desktop/出差报销 · 已移动的位置</small></button>`;
    footer=btn('dialog-close','取消','btn');
  } else if(m.type==='scan') {
    title='打开「项目资料」';compact=true;
    body=`<p class="dialog-lead">发现 6 个文件，可检索材料会在后台处理。其他文件仍可在文件夹中查看。</p><div class="setting-text">材料/　4 个文件<br>合同/　1 个扫描件<br>成果/　1 个文件</div><form id="scan-form" data-form="scan"><label class="check-row"><input name="index" type="checkbox" ${formValue('index',true)?'checked':''}>开始建立索引</label><small>可以先开始对话，稍后调整索引范围。</small></form>`;
    footer=btn('dialog-back','返回','btn')+'<button form="scan-form" class="btn primary" type="submit">打开工作区</button>';
  } else if(m.type==='conflict') {
    title='这个文件夹带有已有工作区的标记';compact=true;
    body=`<p class="dialog-lead">原工作区「季度复盘」仍绑定在其他位置。</p><div class="setting-text mono">原位置：~/Documents/季度复盘<br>所选：~/Desktop/季度复盘 copy</div>
    <button class="split-choice" data-action="copy-new"><strong>作为新工作区</strong><small>文件保留，另建独立的对话和记忆。</small></button><button class="split-choice" data-action="copy-rebind"><strong>将原工作区改绑到这里</strong><small>保留原有对话和记忆，原位置解除绑定。</small></button>`;footer=btn('dialog-close','取消','btn');
  } else if(m.type==='relocate') {
    title='重新定位「'+w.name+'」';compact=true;
    body=`<p class="dialog-lead">选择移动后的文件夹，核对身份后恢复访问。</p><div class="setting-text mono">上次位置：${esc(w.path)}<br>所选位置：~/Desktop/${esc(w.name)}</div><div class="notice">原型模拟已通过工作区标记核对。</div>`;
    footer=btn('dialog-close','取消','btn')+btn('relocate-confirm','使用这个位置','btn primary');
  } else if(m.type==='add-files'||m.type==='attach') {
    const inWorkspace=m.type==='add-files';title=inWorkspace?'添加资料':'添加附件';compact=true;
    body=`<p class="dialog-lead">${inWorkspace?'文件将复制到这个工作区，同名文件另存，不覆盖原文件。':'附件只属于这次独立对话。'}</p>
    <form id="add-form" data-form="add">
    ${inWorkspace?`<label class="field">放入位置<select name="folder">${[...new Set(['',...wsFiles().map(f=>f.folder)])].map(f=>`<option value="${f}" ${formValue('folder')===f?'selected':''}>${f?f+'/':'工作区根目录'}</option>`).join('')}</select></label>`:''}
    <button class="split-choice" type="button" data-action="pick-files"><strong>${icon('file')} ${esc(formValue('filename','选择文件'))}</strong><small>${formValue('filename')?'已选择 · 原型示例文件':'原型模拟选择一份 PDF 材料'}</small></button><input type="hidden" name="filename" value="${esc(formValue('filename'))}"></form>`;
    footer=btn('dialog-close','取消','btn')+`<button form="add-form" type="submit" class="btn primary" ${!formValue('filename')?'disabled':''}>${inWorkspace?'添加到工作区':'添加到对话'}</button>`;
  } else if(m.type==='undo') {
    title='撤销这次对文件夹的修改';
    body=S.undoDone?'<div class="notice ok">已恢复所选文件运行前的内容。</div><p>'+esc((S.undoNames||['成果/对比表.xlsx']).join('、'))+'</p><p>对话、记忆和交付时保存的版本不变。</p>':`<p class="dialog-lead">只恢复选中的文件，对话和记忆不变。</p><form id="undo-form" data-form="undo"><label class="check-row"><input name="sheet" type="checkbox" ${formValue('sheet',true)?'checked':''}>成果/对比表.xlsx · 恢复运行前内容</label><details class="process"><summary>查看将恢复的内容</summary><div class="diff"><del>新增：渠道折扣对比与说明</del><ins>恢复：原有价格结构清单</ins></div></details><label class="check-row"><input name="notes" type="checkbox" ${formValue('notes',false)?'checked':''}>材料/纪要.md · 运行后又被外部修改</label><div class="notice warn">纪要存在冲突，默认不选。覆盖会一并丢弃之后的改动。</div>${formValue('notes',false)?'<label class="check-row"><input name="force" type="checkbox" '+(formValue('force',false)?'checked':'')+'>我仍要覆盖纪要的后续改动</label>':''}</form>`;
    footer=S.undoDone?close:btn('dialog-close','取消','btn')+`<button form="undo-form" class="btn primary" type="submit" ${isArchived()||workspace()?.status==='offline'?'disabled':''}>撤销所选修改</button>`;
  } else if(m.type==='settings') {
    const tab=p.tab||'general';title='设置';
    body=dialogTabs([['general','通用'],['components','组件'],['skills','Skills'],['sources','Skill 来源']],tab,'settings-tab');
    if(tab==='components')body+=componentRows();
    else if(tab==='skills')body+=skillsBody(false);
    else if(tab==='sources')body+=`<p class="dialog-lead">引用已有目录，移除引用不会删除原目录。</p>${['.agents/skills','.codex/skills','应用管理库','GitHub',...(S.extraSources||[])].map((source,i)=>`<div class="settings-row"><div class="row-copy"><strong>${source}${S.disabledSources?.has(source)?' · 已停用':''}</strong><small>${i<2?'本地目录 · 只读引用':'应用管理的内容'}</small></div>${btn('source-details','查看','btn',`data-id="${source}"`)}</div>`).join('')}${btn('add-source','添加目录来源','btn')}`;
    else body=`<div class="settings-row"><div class="row-copy"><strong>外观</strong><small>浅色与深色沿用 V1。</small></div>${btn('theme','切换深浅色','btn')}</div><div class="settings-row"><div class="row-copy"><strong>独立对话的本机执行</strong><small>仅影响独立对话；工作区单独设置。</small></div><input type="checkbox" data-setting="global-execution" aria-label="独立对话的本机执行" ${S.globalExecution?'checked':''}></div><div class="settings-row"><div class="row-copy"><strong>默认新建位置</strong><small class="mono">~/Documents/RayAgent</small></div></div><div class="settings-row"><div class="row-copy"><strong>模型连接</strong><small>从本地配置文件读取。</small></div>${btn('model-settings','查看连接','btn')}</div>`;
    footer=close;
  } else if(m.type==='skill-picker') {
    title='选择这次任务使用的 Skill';body=skillsBody(true);footer=close;
  } else if(m.type==='skill-detail') {
    const k=skills.find(x=>x.id===p.id);title=k.name;
    body=`<p class="dialog-lead">${k.source} · ${k.scope}</p><div class="setting-text"><h3>${k.name}</h3><p>${k.description}</p><p>先确认目标和输入材料，再完成任务并核对交付结果。</p></div><small>${k.source.includes('skills')?'外部目录以只读方式引用，可在原位置编辑。':'这里展示 Skill 内容的阅读方式。'}</small>
    <div class="settings-row"><div class="row-copy"><strong>启用这个 Skill</strong><small>影响新运行，已开始的运行沿用原版本。</small></div><input type="checkbox" data-setting="skill-enabled" data-id="${k.id}" aria-label="启用这个 Skill" ${k.enabled?'checked':''}></div>`;
    footer=btn('dialog-back','返回','btn')+(k.enabled?btn('use-skill','用于这次任务','btn primary',`data-id="${k.id}"`):'');
  } else if(m.type==='source-details'||m.type==='add-source') {
    title=m.type==='add-source'?'添加 Skill 目录':'Skill 来源';compact=true;
    body=m.type==='add-source'?'<p class="dialog-lead">选择包含 Skill 包的本地目录，作为只读来源。</p><div class="setting-text mono">~/Documents/agent-skills</div><div class="notice">原型模拟选择目录，不访问真实文件。</div>':`<div class="setting-text mono">${esc(p.id)}</div><p>停用来源后，新运行不再从这里选择 Skill。原目录及文件保留。</p>`;
    footer=btn('dialog-back','返回','btn')+btn('source-confirm',m.type==='add-source'?'添加来源':'停用来源','btn');
  } else if(m.type==='enable-execution') {
    title='开启这个工作区的本机执行？';compact=true;
    body='<p class="dialog-lead">这条命令需要运行本机脚本。开启后，这个工作区可以使用 Shell 与脚本，需要审批的动作仍会单独询问。</p><div class="notice warn">命令以当前系统用户权限运行，工作目录不构成文件访问隔离。</div>';
    footer=btn('dialog-back','返回审批','btn')+btn('enable-and-approve','开启并批准这一次','btn primary');
  } else if(m.type==='runtime') {
    title='这次任务需要浏览器组件';compact=true;
    const c=components[0];
    body=`<p class="dialog-lead">准备完成后可继续这次任务。普通对话仍可使用。</p><div class="settings-row"><div class="row-copy"><strong>浏览器 <span class="badge">${c.state}</span></strong><small>${c.state==='准备失败'?'下载中断，尚未执行网页操作。':'由应用管理，用于访问交互式网页。'}</small></div></div>`;
    footer=btn('dialog-close','稍后','btn')+(c.state==='可用'?btn('runtime-continue','继续任务','btn primary'):btn('install',['下载中','校验中'].includes(c.state)?c.state:c.state==='准备失败'?'重试准备':'安装并准备','btn primary',`data-id="browser" ${['下载中','校验中'].includes(c.state)?'disabled':''}`));
  } else if(m.type==='execution-detail') {
    title='执行记录';body='<p class="dialog-lead">生成对比表 · 本次执行的输出</p><pre class="terminal">$ python build_comparison.py\n读取 3 份材料\n整理价格结构、渠道折扣和席位差异\n等待本机执行批准</pre><p class="mono muted">工作目录：'+esc(w?.path||'本次会话工作目录')+'</p>';footer=btn('dialog-back','返回','btn');
  } else if(m.type==='browser-detail') {
    title='页面记录';body='<p class="dialog-lead">调用时的页面观察记录</p><div class="browser-demo"><div class="browser-url">https://example.com/pricing · 示例页面</div><div class="browser-page"><h3>产品与价格</h3><p>基础版、团队版与年度方案。</p><p>具体渠道条款另行约定。</p></div></div><small>这里只读展示观察结果。</small>';footer=btn('dialog-back','返回','btn');
  } else if(m.type==='session-menu') {
    title='对话设置';compact=true;
    body=`${S.workspace?`<div class="settings-row"><div class="row-copy"><strong>参与工作区记忆</strong><small>关闭后，这段会话不参与记忆提炼。</small></div><input type="checkbox" data-setting="session-memory" aria-label="参与工作区记忆" ${session().remember?'checked':''} ${isArchived()?'disabled':''}></div>`:'<p class="dialog-lead">这条独立对话不读取工作区材料或记忆。</p>'}${btn('delete-session','删除这条对话','split-choice')}`;footer=close;
  } else if(m.type==='delete-workspace'||m.type==='delete-session') {
    const isWs=m.type==='delete-workspace';title='删除'+(isWs?'工作区「'+w.name+'」':'对话「'+session().title+'」');compact=true;
    body=`<p class="dialog-lead">${isWs?'将清除工作区在应用中的对话、记忆、索引和备份。':'将清除这条对话的消息、运行记录与会话附件，不能恢复。'}</p><div class="notice ok">工作区文件夹及其中的用户文件保留。</div>`;footer=btn('dialog-close','取消','btn')+btn(isWs?'delete-workspace-confirm':'delete-session-confirm','确认删除','btn danger');
  } else if(m.type==='model') {
    title='这次任务使用的模型';compact=true;body=`<p class="dialog-lead">只影响下一次运行。</p>${['Claude 4.5','GPT-5.4','Gemini 3'].map(name=>btn('select-model',name,'split-choice',`data-id="${name}"`)).join('')}`;footer=close;
  } else if(m.type==='model-settings') {
    title='模型连接';compact=true;body='<label class="field">配置文件<span class="mono">~/.config/rayagent/models.json</span></label><p class="dialog-lead">当前原型仅提供模型选择样例，不读取真实配置或凭据。</p>';footer=btn('dialog-back','返回','btn');
  } else if(m.type==='template') {
    title='另存为工作区模板';compact=true;body=`<form id="template-form" data-form="template"><label class="field">模板名称<input name="name" value="${esc(formValue('name',w.name+'的工作方式'))}" required></label></form><p class="dialog-lead">只保存工作方式和执行建议，不带材料、记忆或对话。</p>`;footer=btn('dialog-back','返回','btn')+'<button form="template-form" type="submit" class="btn primary">保存模板</button>';
  } else if(m.type==='discard') {
    title='放弃未保存的修改？';compact=true;body='<p class="dialog-lead">返回编辑可以继续修改。</p>';footer=btn('keep-editing','返回编辑','btn')+btn('discard-confirm','放弃修改','btn danger');
  } else if(m.type==='unsaved-switch') {
    title='先保存当前修改';compact=true;body='<p class="dialog-lead">保存或取消修改后，再切换设置分区。</p>';footer=btn('dialog-back','返回编辑','btn');
  }
  return {title,body,footer,compact};
}
function renderDialog() {
  if(!S.modal)return;
  const d=buildDialog();$('#dialog').classList.toggle('compact',d.compact);
  $('#dialog-content').innerHTML=`<div class="dialog-head">${S.history.length?ib('dialog-back','back','返回上一层'):''}<h2 id="dialog-title">${esc(d.title)}</h2>${ib('dialog-close','close','关闭弹层')}</div><div class="dialog-body">${d.body}</div>${d.footer?`<div class="dialog-actions">${d.footer}</div>`:''}`;
}

function createWorkspace(name,path,method='',files=[]) {
  const id=newId('workspace-');
  workspaces.push({id,name,path,method,version:1,autoMemory:true,execution:false,status:'ready',indexPaused:false});
  filesByWorkspace[id]=files.map(f=>({...f,state:f.id==='sheet'?'可检索':f.state}));memories[id]=[];S.expanded.add(id);return id;
}
function updateModalDraft(form) {
  if(!S.modal||!form)return;
  for(const input of $$('input,textarea,select',form))if(input.name)S.modal.draft[input.name]=input.type==='checkbox'?input.checked:input.value;
}
function approveRun() {
  if(!workspace().execution) {openDialog('enable-execution');return;}
  session().status='done';closeDialog(true);render();toast('示例执行已完成，可查看本次成果。');
}
function changeMemory(id,fn,message) {
  if(isArchived())return;
  const item=(memories[S.workspace]||[]).find(x=>x.id===id);if(!item)return;
  const before={...item};fn(item);if(S.modal)renderDialog();render();
  toast(message,()=>{Object.assign(item,before);if(S.modal)renderDialog();render();});
}
const actions = {
  home:()=>{closeDialog(true);route('#home');},
  independent:()=>{closeDialog(true);route('#independent');},
  workspace:b=>{closeDialog(true);goWorkspace(b.dataset.id);},
  session:b=>{closeDialog(true);route('#session/'+b.dataset.id);},
  expand:b=>{const id=b.dataset.id;S.expanded.has(id)?S.expanded.delete(id):S.expanded.add(id);renderSidebar();},
  navigation:()=>document.body.classList.toggle('show-sidebar'),
  'toggle-panel':()=>{panel().open=!panel().open;render();},
  'panel-tab':b=>{panel().tab=b.dataset.id;panel().preview=null;renderPanel();},
  folder:b=>{const key=S.workspace+b.dataset.id;S.closedFolders.has(key)?S.closedFolders.delete(key):S.closedFolders.add(key);renderPanel();},
  file:b=>showFile(b.dataset.id),
  delivery:b=>showFile(b.dataset.id,'delivery'),
  'cite-file':b=>showFile(b.dataset.id,'citation'),
  'preview-back':()=>{const p=panel();p.preview=null;renderPanel();if($('.panel-body'))$('.panel-body').scrollTop=p.listScroll||0;const t=p.returnTarget;if(t){const q='[data-action="'+CSS.escape(t.action)+'"]'+(t.id?'[data-id="'+CSS.escape(t.id)+'"]':'');$(q)?.focus();}},
  'preview-expand':()=>{panel().expanded=!panel().expanded;renderPanel();},
  'preview-page':()=>{panel().preview.page=panel().preview.page===2?3:2;renderPanel();},
  'reload-preview':()=>{S.external=false;renderPanel();toast('已载入示例文件的新版本。');},
  'current-version':()=>{panel().preview.version='current';renderPanel();},
  finder:()=>toast('原型：这里会在 Finder 中显示所选文件或工作区文件夹。'),
  create:()=>openDialog('create'),
  'open-folder':()=>openDialog('open-folder'),
  'pick-folder':b=>{if(b.dataset.id==='copy')openDialog('conflict');else if(b.dataset.id==='moved'){S.workspace='expense';render();openDialog('relocate');}else openDialog('scan');},
  'copy-new':()=>{const id=createWorkspace('季度复盘副本','~/Desktop/季度复盘 copy','',baseFiles);closeDialog(true);goWorkspace(id);toast('示例副本已登记为新工作区，对话与记忆为空。');},
  'copy-rebind':()=>{workspaces[0].path='~/Desktop/季度复盘 copy';closeDialog(true);goWorkspace('review');toast('已模拟改绑，原有对话与记忆保留。');},
  relocate:()=>openDialog('relocate'),
  'relocate-confirm':()=>{const w=workspace();w.path='~/Desktop/'+w.name;w.status='ready';closeDialog(true);render();toast('已模拟重新定位，文件访问恢复。');},
  'workspace-menu':()=>openDialog('workspace-menu'),
  'workspace-config':()=>openDialog('workspace-config'),
  method:()=>openDialog('workspace-config',{tab:'method'}),
  memory:()=>{S.memoryFilter='全部';openDialog('memory');},
  index:()=>openDialog('index'),
  'workspace-tab':b=>{if(S.modal.dirty){openDialog('unsaved-switch');return;}openDialog('workspace-config',{tab:b.dataset.id},true);},
  'memory-filter':b=>{S.memoryFilter=b.dataset.id;renderDialog();},
  'memory-new':()=>openDialog('memory-edit'),
  'memory-edit':b=>openDialog('memory-edit',{id:b.dataset.id}),
  'memory-source':b=>openDialog('memory-source',{id:b.dataset.id}),
  'memory-pin':b=>changeMemory(b.dataset.id,m=>m.pinned=!m.pinned,'已更新记忆的置顶状态。'),
  'memory-confirm':b=>changeMemory(b.dataset.id,m=>{m.confirmed=true;m.candidate=false;m.source='用户确认';},'记忆已确认。'),
  'memory-retract':b=>changeMemory(b.dataset.id,m=>m.active=false,'记忆已撤回，后续运行不再使用。'),
  'memory-reject':b=>changeMemory(b.dataset.id,m=>m.active=false,'已忽略这条候选记忆。'),
  'memory-restore':b=>changeMemory(b.dataset.id,m=>m.active=true,'记忆已恢复。'),
  'run-method':()=>openDialog('run-method'),
  'reference-memory':()=>openDialog('memory-source',{id:S.workspace==='review'?'m1':'c1'}),
  'proposal-source':()=>openDialog('memory-source',{id:'m1'}),
  'proposal-accept':()=>{if(isArchived())return;if(S.modal.dirty){toast('先保存或放弃当前编辑，再处理提议。');return;}const w=workspace();w.method='先给结论，再给依据。数字和引述需要能回到原文；缺少出处时标明待核验。';w.version++;S.proposal=false;S.modal.draft={};S.modal.dirty=false;renderDialog();toast('工作方式已发布为新版本，下一次运行生效。');},
  'proposal-reject':()=>{if(!isArchived()){S.proposal=false;renderDialog();toast('已忽略修改提议。');}},
  search:()=>{saveDraft();S.searchBack={view:S.view};S.view='search';S.query='';S.filter='全部';render();$('#knowledge-query').focus();},
  'search-back':()=>{S.view=S.searchBack?.view||'start';render();},
  'search-filter':b=>{S.filter=b.dataset.id;render();$('#knowledge-query').focus();},
  'search-open':b=>{if(b.dataset.type==='文件')showFile(b.dataset.id,'citation');else if(b.dataset.type==='记忆')openDialog('search-memory',{id:b.dataset.id});else route('#session/'+b.dataset.id);},
  'add-files':()=>{if(!isArchived()&&workspace().status!=='offline')openDialog('add-files');else toast('当前工作区不可写。');},
  attach:()=>openDialog('attach'),
  'pick-files':()=>{updateModalDraft($('#add-form'));S.modal.draft.filename='补充材料.pdf';renderDialog();},
  plan:()=>{S.plan=!S.plan;saveDraft();render();toast(S.plan?'下一条任务先制定计划。':'已关闭计划模式。');},
  'choose-skill':()=>openDialog('skill-picker'),
  'remove-attachment':()=>{delete S.attachments[scope()];render();},
  'clear-skill':()=>{delete S.selection[scope()];render();},
  skills:()=>openDialog('settings',{tab:'skills'}),
  components:()=>openDialog('settings',{tab:'components'}),
  settings:()=>openDialog('settings'),
  'settings-tab':b=>openDialog('settings',{tab:b.dataset.id},true),
  'skill-detail':b=>openDialog('skill-detail',{id:b.dataset.id}),
  'pick-skill':b=>{S.selection[scope()]=b.dataset.id;closeDialog(true);render();$('#composer-input')?.focus();},
  'use-skill':b=>{S.selection[scope()]=b.dataset.id;closeDialog(true);render();toast('已选择 Skill，发送时用于下一次任务。');},
  'source-details':b=>openDialog('source-details',{id:b.dataset.id}),
  'add-source':()=>openDialog('add-source'),
  'source-confirm':()=>{if(S.modal.type==='add-source'){S.extraSources ||= [];if(!S.extraSources.includes('agent-skills'))S.extraSources.push('agent-skills');if(!skills.some(k=>k.id==='custom'))skills.push({id:'custom',name:'本地资料整理',description:'使用已有目录中的方法整理材料。',source:'agent-skills',scope:'用户级',enabled:true});}else{S.disabledSources ||= new Set();S.disabledSources.add(S.modal.props.id);skills.filter(k=>k.source===S.modal.props.id).forEach(k=>k.enabled=false);}backDialog(true);toast('已更新来源引用，原目录与文件保留。');},
  install:b=>{
    const c=components.find(x=>x.id===b.dataset.id);if(!c||c.state==='准备中')return;
    c.state='准备中';renderDialog();
    const timer=setTimeout(()=>{c.state='可用';S.componentTimers.delete(c.id);if(c.id==='ocr')Object.values(filesByWorkspace).flat().filter(f=>f.state==='待 OCR').forEach(f=>f.state='索引中');if(S.modal)renderDialog();renderPanel();toast(c.name+'已模拟准备完成。');},1000);S.componentTimers.set(c.id,timer);
  },
  'runtime-continue':()=>{closeDialog(true);session().status='running';render();toast('浏览器组件已就绪，示例任务继续。');},
  'execution-detail':()=>openDialog('execution-detail'),
  'browser-detail':()=>openDialog('browser-detail'),
  approve:approveRun,
  'enable-and-approve':()=>{workspace().execution=true;approveRun();},
  deny:()=>{session().status='stopped';render();toast('已拒绝执行，命令没有运行。');},
  stop:()=>{session().status='stopped';render();},
  undo:()=>openDialog('undo'),
  'index-toggle':()=>{if(!isArchived()){workspace().indexPaused=!workspace().indexPaused;renderDialog();renderPanel();}},
  'retry-index':b=>{if(isArchived())return;const f=wsFiles().find(x=>x.id===b.dataset.id);if(f)f.state='可检索';renderDialog();renderPanel();toast('示例材料已重新处理。');},
  archive:()=>{const w=workspace();w.status=isArchived()?'ready':'archived';closeDialog(true);render();},
  unarchive:()=>{workspace().status='ready';render();},
  template:()=>openDialog('template'),
  'delete-workspace':()=>openDialog('delete-workspace'),
  'delete-workspace-confirm':()=>{const id=S.workspace;workspaces.splice(workspaces.findIndex(w=>w.id===id),1);for(let i=sessions.length-1;i>=0;i--)if(sessions[i].workspace===id)sessions.splice(i,1);delete S.drafts['start:'+id];closeDialog(true);route('#home');toast('已移除原型中的工作区登记；未操作真实文件。');},
  'session-menu':()=>openDialog('session-menu'),
  'delete-session':()=>openDialog('delete-session'),
  'delete-session-confirm':()=>{const w=S.workspace,id=S.session;sessions.splice(sessions.findIndex(s=>s.id===id),1);delete S.drafts['session:'+id];closeDialog(true);route(w?'#workspace/'+w:'#independent');toast('已删除示例对话。');},
  'lease-owner':()=>{S.lease=false;route('#session/review-2');toast('已打开占用者对话；此原型模拟占用已结束。');},
  model:()=>openDialog('model'),
  'select-model':b=>{S.models[scope()]=b.dataset.id;closeDialog(true);render();},
  'model-settings':()=>openDialog('model-settings'),
  theme:()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';},
  review:()=>openDialog('review'),
  'dialog-close':()=>closeDialog(),
  'dialog-back':()=>backDialog(),
  'keep-editing':()=>backDialog(true),
  'discard-confirm':()=>{const intent=S.modal.props.intent;S.modal=S.history.pop();if(S.modal)S.modal.dirty=false;if(intent==='close')closeDialog(true);else backDialog(true);},
  'toast-undo':()=>{if(S.toastUndo){const fn=S.toastUndo;S.toastUndo=null;fn();toast('已撤销。');}}
};
function sendMessage() {
  const input=$('#composer-input'),text=input.value.trim();if(!text||isArchived())return;
  const previous=scope(),selected=S.selection[previous],model=S.models[previous];
  let s=S.view==='chat'?session():null;
  if(!s) {
    const w=workspace();s={id:newId('session-'),workspace:S.workspace,title:text.slice(0,22),summary:text,time:'刚刚',kind:'demo',status:'done',remember:!!S.workspace,messages:[],snapshot:w?{method:w.method,version:w.version,memory:activeMemories().filter(m=>m.resident).map(m=>m.text).join('；')}:null};
    sessions.unshift(s);
  }
  s.messages.push({role:'user',text:text+(S.attachments?.[previous]?'\n附件：'+S.attachments[previous]:'')},{role:'assistant',text:'已收到。这是一条用于检查对话交互的原型占位回复。'});
  if(S.attachments)delete S.attachments[previous];
  input.value='';S.drafts[previous]='';S.drafts['session:'+s.id]='';
  if(selected)S.selection['session:'+s.id]=selected;if(model)S.models['session:'+s.id]=model;
  if(S.session===s.id) {render();$('#chat-scroll').scrollTop=$('#chat-scroll').scrollHeight;}
  else route('#session/'+s.id);
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b||b.disabled)return;
  actions[b.dataset.action]?.(b);
});
document.addEventListener('input',e=>{
  if(e.target.id==='composer-input')saveDraft();
  if(e.target.id==='knowledge-query'){S.query=e.target.value;searchResults();}
  if(e.target.closest('#dialog')&&e.target.closest('form')){updateModalDraft(e.target.closest('form'));if(['method','workspace','memory','create','template'].includes(e.target.closest('form').dataset.form))S.modal.dirty=true;}
});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset.setting) {
    const w=workspace();
    if(isArchived()&&['auto-memory','execution','session-memory'].includes(t.dataset.setting))return;
    if(t.dataset.setting==='auto-memory')w.autoMemory=t.checked;
    if(t.dataset.setting==='execution')w.execution=t.checked;
    if(t.dataset.setting==='global-execution')S.globalExecution=t.checked;
    if(t.dataset.setting==='session-memory')session().remember=t.checked;
    if(t.dataset.setting==='skill-enabled')skills.find(k=>k.id===t.dataset.id).enabled=t.checked;
    toast('设置已保存，后续运行生效。');
  }
  if(t.hasAttribute('data-index-folder')){const w=workspace();w.excluded ||= [];w.excluded=w.excluded.filter(f=>f!==t.dataset.indexFolder);if(!t.checked)w.excluded.push(t.dataset.indexFolder);renderPanel();toast('索引范围已更新。');}
  if(t.closest('#undo-form')){updateModalDraft(t.closest('form'));renderDialog();}
  if(t.name==='template'&&S.modal?.type==='create'){const template=S.templates?.find(x=>x.name===t.value);if(template){updateModalDraft(t.closest('form'));S.modal.draft.method=template.method;S.modal.draft.template=template.name;renderDialog();}}
});
document.addEventListener('submit',e=>{
  if(e.defaultPrevented)return;
  e.preventDefault();const form=e.target;
  if(form.id==='composer-form'){sendMessage();return;}
  if(!S.modal)return;
  updateModalDraft(form);const d=S.modal.draft,w=workspace(),type=form.dataset.form;
  if(type==='method'){if(w.method!==d.method.trim()){w.method=d.method.trim();w.version++;}S.modal.dirty=false;renderDialog();render();toast('已保存工作方式 v'+w.version+'，下一次运行生效。');}
  if(type==='workspace'){if(!d.name.trim())return;w.name=d.name.trim();S.modal.dirty=false;renderDialog();render();toast('工作区名称已保存。');}
  if(type==='memory') {
    if(!d.text.trim())return;
    const owner=S.workspace,before=(memories[owner]||[]).map(m=>({...m}));
    let item=(memories[S.workspace]||[]).find(x=>x.id===S.modal.props.id);
    if(item)Object.assign(item,{text:d.text.trim(),type:d.type,confirmed:true,source:'用户编辑'});
    else memories[S.workspace].push({id:newId('memory-'),text:d.text.trim(),type:d.type,source:'用户添加',confirmed:true,pinned:false,active:true});
    S.modal.dirty=false;backDialog(true);render();toast('记忆已保存。',()=>{memories[owner]=before;render();});
  }
  if(type==='create'){if(!d.name.trim())return;const id=createWorkspace(d.name.trim(),'~/Documents/RayAgent/'+d.name.trim(),d.method.trim());S.modal.dirty=false;closeDialog(true);goWorkspace(id);}
  if(type==='scan'){const id=createWorkspace('项目资料','~/Documents/项目资料','',baseFiles);workspaces.find(w=>w.id===id).indexPaused=!d.index;closeDialog(true);goWorkspace(id);}
  if(type==='add') {
    if(!d.filename)return;
    const filename=d.filename;
    if(S.modal.type==='attach'){S.attachments ||= {};S.attachments[scope()]=filename;closeDialog(true);render();toast('示例附件已加入这份草稿。');return;}
    if(w.status==='offline'||isArchived()||S.lease){toast('文件夹当前不可写，请先处理占用或可用状态。');return;}
    let name=filename,n=2;while(wsFiles().some(f=>f.name===name&&f.folder===(d.folder||''))){const split=filename.lastIndexOf('.');name=split>0?filename.slice(0,split)+' ('+(n++)+')'+filename.slice(split):filename+' ('+(n++)+')';}
    wsFiles().push({id:newId('file-'),name,folder:d.folder||'',type:'pdf',state:'索引中',size:'128 KB'});closeDialog(true);renderPanel();toast(name===filename?'已模拟添加，等待索引。':'同名文件已另存为「'+name+'」。');
  }
  if(type==='undo') {
    if(!d.sheet&&!d.notes){toast('先选择要撤销的文件。');return;}
    if(d.notes&&!d.force){toast('纪要存在冲突，需要明确确认覆盖后续改动。');return;}
    S.undoDone=true;S.undoNames=[...(d.sheet?['成果/对比表.xlsx']:[]),...(d.notes?['材料/纪要.md']:[])];renderDialog();renderPanel();toast('所选示例文件已恢复，交付版本保留。');
  }
  if(type==='template'){S.templates ||= [];S.templates.push({name:d.name,method:w.method,execution:w.execution});S.modal.dirty=false;backDialog(true);toast('模板已保存，可在新建工作区时选择。');}
});
document.addEventListener('keydown',e=>{
  if(e.target.id==='composer-input'&&e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.isComposing){e.preventDefault();sendMessage();}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&S.workspace&&!$('#dialog').open){e.preventDefault();actions.search();}
  if(e.key==='Escape'&&!$('#dialog').open){if(document.body.classList.contains('show-sidebar'))document.body.classList.remove('show-sidebar');else if(panel().preview){panel().preview=null;renderPanel();}else if(innerWidth<=900&&panel().open){panel().open=false;renderPanel();}}
});
$('#dialog').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
window.addEventListener('hashchange',()=>applyRoute());
window.addEventListener('popstate',()=>applyRoute());
$('#scenario').addEventListener('change',e=>{
  closeDialog(true);const value=e.target.value;S.lease=false;S.external=false;
  if(['search-failure','semantic-missing','ocr-failure'].includes(value))return;
  if(['background','knowledge','skills'].includes(value)){route('#workspace/review/'+(value==='skills'?'chat':value));if(value==='skills')actions.skills();}
  else if(value==='start')goWorkspace('review');
  else if(value==='empty')goWorkspace('photos');
  else if(value==='offline'){workspaces.find(w=>w.id==='expense').status='offline';goWorkspace('expense');}
  else if(value==='archived'){workspaces.find(w=>w.id==='archived').status='archived';goWorkspace('archived');}
  else {
    const s=sessions.find(s=>s.id==='review-1');
    if(!s){toast('示例会话已删除，刷新页面可重新加载。');return;}
    s.status=['running','approval','done'].includes(value)?value:'done';route('#session/review-1');
    if(value==='lease')S.lease=true;
    if(value==='external'){S.external=true;panel().preview={id:'a',version:'current',page:2};panel().open=true;}
    if(value==='conflict')openDialog('conflict');
    if(value==='runtime'){components[0].state='准备失败';s.status='running';openDialog('runtime');}
    render();
  }
});

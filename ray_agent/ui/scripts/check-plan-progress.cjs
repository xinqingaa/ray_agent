/* eslint-disable @typescript-eslint/no-require-imports */
// 实际投影与组件，合成事件；不连接模型或浏览器。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const req = require('node:module').createRequire(path.join(root, 'package.json'));
const ts = req('typescript'), React = req('react'), {renderToStaticMarkup} = req('react-dom/server');
const cache = new Map();
let metrics = false;
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = {exports: {}}; cache.set(filename, m);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === '@/hooks/use-developer-mode') return {useDeveloperMode: () => ({visibility: {requestMetrics: metrics}})};
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load(path.relative(root, ['.ts', '.tsx'].map(ext => base + ext).find(f => fs.existsSync(f))));
    }
    return req(name);
  }, m, m.exports);
  return m.exports;
}
const {projectSession, planBarMode} = load('src/lib/session-projection.ts');
const {PlanBar, PlanContent} = load('src/components/run/plan-bar.tsx');
const {RunEndBar} = load('src/components/run/run-end-bar.tsx');
const {AttemptNotice} = load('src/components/run/notices.tsx');
const {RunStatus} = load('src/components/run/run-status.tsx');
const ev = (seq, event, data) => ({event, data: {seq, run_id: 'r', created_at: 1000 + seq, ...data}});
const markup = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const initial = [ev(1, 'run', {status: 'running'}), ev(2, 'plan', {plan_id: 'p', explanation: '初始安排', steps: [
  {id: 'a', description: '需求', status: 'completed'}, {id: 'b', description: '结构', status: 'running'},
  {id: 'c', description: '正文', status: 'pending'},
]})];
let view = projectSession({id: 's', events: initial});
let html = markup(PlanBar, {plan: view.plan, runStatus: 'running', defaultOpen: false});
assert.match(html, /第 2\/3 步/); assert.doesNotMatch(html, /<ol|初始安排/);
assert.match(markup(PlanContent, {plan: view.plan, active: true, ended: false}), /已完成 1\/3 项/);
const renamed = [...initial, ev(3, 'plan', {plan_id: 'p', explanation: '调整标题与顺序', steps: [
  {id: 'a', description: '需求', status: 'completed'}, {id: 'c', description: '编写页面', status: 'running'},
  {id: 'b', description: '结构', status: 'completed'},
]})];
view = projectSession({id: 's', events: renamed});
assert.ok(view.plan.changed.some(c => c.kind === 'text')); assert.ok(view.plan.changed.some(c => c.kind === 'order'));
assert.ok(!view.plan.changed.some(c => c.kind === 'added' || c.kind === 'removed'));
assert.equal(view.plan.items.find(i => i.id === 'b').startedAt, 1002);
const final = [...renamed, ev(4, 'plan', {plan_id: 'p', explanation: '', steps: [
  {id: 'a', description: '需求', status: 'completed'}, {id: 'c', description: '编写页面', status: 'completed'},
]}), ev(5, 'run', {status: 'completed'})];
view = projectSession({id: 's', events: final});
html = markup(PlanBar, {plan: view.plan, runStatus: 'completed', defaultOpen: false});
const mainList = markup(PlanContent, {plan: view.plan, active: false, ended: true});
assert.equal((mainList.match(/<li /g) || []).length, 2); assert.doesNotMatch(mainList, /已删除|新增|刚完成|结构/);
assert.match(html, /计划 2\/2 项已完成/); assert.doesNotMatch(mainList, /计划更新记录|第 .*版|<details/);
assert.equal(view.plan.explanation, null);
const reset = projectSession({id: 's', events: [...final, ev(6, 'plan', {plan_id: 'new', steps: [
  {id: 'new-step', description: '新任务', status: 'running'},
]})]});
assert.equal(reset.plan.version, 1); assert.deepEqual(reset.plan.changed, []);
// 计划条只在本次运行有自己的计划（live）或计划模式结束待确认（proposal）时出现
const active = (id) => ({id, status: 'running', mode: 'normal', activity: {kind: 'model'}});
const barMode = (extra) => planBarMode({runs: [], plan: view.plan, activeRun: null, ...extra});
const done = (over) => ({id: 'r', status: 'completed', mode: 'normal', startedAt: 1000, endedAt: 9000, ...over});
assert.equal(barMode({activeRun: active('r'), runs: [active('r')]}), 'live');
assert.equal(barMode({activeRun: active('r2'), runs: [done(), active('r2')]}), null, '新运行尚未写计划时不沿用上一次的清单');
assert.equal(barMode({runs: [done()]}), null, '普通模式运行结束后不显示');
assert.equal(barMode({runs: [done({status: 'cancelled'})]}), null, '停止后不显示');
assert.equal(barMode({activeRun: null, plan: null, runs: [done()]}), null);
const proposalView = projectSession({id: 'p', events: [ev(1, 'run', {status: 'running', mode: 'plan'}),
  ev(2, 'plan', {plan_id: 'q', steps: [{id: 'a', description: '分析', status: 'pending'}, {id: 'b', description: '方案', status: 'pending'}]}),
  ev(3, 'run', {status: 'completed', mode: 'plan'})]});
assert.equal(planBarMode(proposalView), 'proposal', '计划模式结束且有待执行清单时保留');
html = markup(PlanBar, {plan: proposalView.plan, runStatus: null, proposal: true});
assert.match(html, /计划 2 项/); assert.match(html, /确认后按计划执行/); assert.doesNotMatch(html, /未完成|上次计划|第 .*步/);
html = markup(RunEndBar, {status: 'cancelled', reasonText: '已停止生成'});
assert.equal((html.match(/已停止生成/g) || []).length, 1);
assert.doesNotMatch(html, /沙箱|你停止了|新的运行/); assert.match(html, /接着处理/);
assert.equal(markup(AttemptNotice, {attempt: 1, reason: 'cancelled', retried: false}), '');
assert.equal(markup(RunStatus, {place: 'headline', status: 'cancelled', compacting: false}), '');
metrics = true;
assert.match(markup(AttemptNotice, {attempt: 1, reason: 'cancelled', retried: false}), /第 1 次请求已停止/);
console.log('PASS: 当前步骤/完成数量、身份与重排、重置、最终有效清单、关闭时无清单 DOM、只显示最新快照、计划条出现条件和停止记录通过实际组件检查');

const adopted = projectSession({id:'s',events:[ev(1,'run',{status:'running'}), ev(2,'plan',{
  plan_id:'accepted', progress_state:'preparing', steps:[{id:'step',description:'执行',status:'pending'}]})]});
assert.equal(adopted.plan.sourceSeq,2);
assert.match(markup(PlanBar,{plan:adopted.plan,runStatus:'running'}),/准备执行/);
const reviewed = projectSession({id:'s',events:[...initial,ev(3,'plan',{plan_id:'p',review_only:true,progress_state:'confirmed',steps:initial[1].data.steps})]});
assert.equal(reviewed.plan.version,1);
const uncertain = {...adopted.plan,progressState:'unconfirmed'};
assert.match(markup(PlanBar,{plan:uncertain,runStatus:'running',defaultOpen:true}),/进度未确认/);
assert.doesNotMatch(markup(PlanBar,{plan:uncertain,runStatus:'running',defaultOpen:true}),/aria-current="step"/);
assert.equal(planBarMode({plan:{...uncertain,progressState:'not_needed'},activeRun:active('r'),runs:[]}),null);
console.log('PASS: 承接序号、准备执行、轻量核对不增版本、未确认不暗示当前步骤、无需计划隐藏');

// 后续阶段：later 投影、淡化与“后续”标注、本阶段完成的中性标题，旧状态不受影响。
const stagedSteps = [{id: 'a', description: '本阶段一', status: 'completed'}, {id: 'b', description: '本阶段二', status: 'completed'},
  {id: 'c', description: '后续一', status: 'later'}, {id: 'd', description: '后续二', status: 'later'}];
const stagedView = projectSession({id: 's', events: [ev(1, 'run', {status: 'running'}), ev(2, 'plan', {plan_id: 'g', steps: stagedSteps}), ev(3, 'run', {status: 'completed'})]});
assert.deepEqual(stagedView.plan.items.map(i => i.status), ['completed', 'completed', 'later', 'later']);
assert.equal(stagedView.plan.completedCount, 2);
html = markup(PlanBar, {plan: stagedView.plan, runStatus: 'completed'});
assert.match(html, /本阶段已完成 · 后续 2 项/); assert.doesNotMatch(html, /未完成|text-state-waiting/);
html = markup(PlanContent, {plan: stagedView.plan, active: false, ended: true});
assert.match(html, /本阶段已完成 · 后续 2 项/); assert.equal((html.match(/>后续</g) || []).length, 2); assert.doesNotMatch(html, /未完成/);
const stageOpen = projectSession({id: 's', events: [ev(1, 'run', {status: 'running'}), ev(2, 'plan', {plan_id: 'g', steps: [
  {id: 'a', description: '本阶段一', status: 'completed'}, {id: 'b', description: '本阶段二', status: 'running'}, {id: 'c', description: '后续一', status: 'later'}]})]});
assert.match(markup(PlanBar, {plan: stageOpen.plan, runStatus: 'running'}), /第 2\/2 步/);
assert.match(markup(PlanContent, {plan: stageOpen.plan, active: true, ended: false}), /已完成 1\/2 项 · 后续 1 项/);
assert.match(markup(PlanBar, {plan: stageOpen.plan, runStatus: 'failed'}), /1 项未完成/);
const {PlanChecklist: StagedChecklist} = load('src/components/run/plan-list-dialog.tsx');
assert.match(markup(StagedChecklist, {plans: stagedView.planHistory, runs: stagedView.runs}), /后续一/);
const onlyLater = projectSession({id: 's', events: [ev(1, 'run', {status: 'running'}), ev(2, 'plan', {plan_id: 'g2', steps: [
  {id: 'a', description: '阶段一', status: 'later'}, {id: 'b', description: '阶段二', status: 'later'}]}), ev(3, 'run', {status: 'completed'})]});
html = markup(PlanBar, {plan: onlyLater.plan, runStatus: 'completed'});
assert.match(html, /后续 2 项/); assert.doesNotMatch(html, /未完成|下一步|text-state-waiting/);
assert.match(markup(PlanContent, {plan: onlyLater.plan, active: false, ended: true}), /后续 2 项/);
console.log('PASS: 后续阶段投影、淡化标注、本阶段完成标题与计数、弹框清单');

// 历史跨运行承接、重复核对归并、新任务隔离和删除项回看。
const historyEvents = [
  ev(1, 'run', {status:'running', mode:'plan'}),
  ev(2, 'message', {role:'user', message:'准备旧任务'}),
  ev(3, 'plan', {plan_id:'old',steps:[{id:'a',description:'保留项',status:'pending'},{id:'b',description:'后来移除',status:'pending'}]}),
  ev(4, 'run', {status:'completed',mode:'plan'}),
  ev(5, 'run', {run_id:'execute',status:'running'}),
  ev(6, 'plan', {run_id:'execute',plan_id:'old',accepted_from:{source_run_id:'r'},progress_state:'preparing',steps:[{id:'a',description:'保留项',status:'pending'},{id:'b',description:'后来移除',status:'pending'}]}),
  ev(7, 'plan', {run_id:'execute',plan_id:'old',steps:[{id:'a',description:'改名后的项',status:'completed'}]}),
  ...Array.from({length:37},(_,i)=>ev(8+i,'plan',{run_id:'execute',plan_id:'old',review_only:true,progress_state:'confirmed',steps:[{id:'a',description:'改名后的项',status:'completed'}]})),
  ev(45,'run',{run_id:'execute',status:'completed'}),
  ev(46,'plan',{run_id:'question',plan_id:'old',review_only:true,progress_state:'not_needed',steps:[{id:'a',description:'改名后的项',status:'completed'}]}),
  ev(47,'plan',{run_id:'new-run',plan_id:'new',steps:[{id:'c',description:'新任务',status:'running'}]}),
  ev(48,'run',{run_id:'new-run',status:'cancelled'}),
];
const historyView = projectSession({id:'s',events:historyEvents});
assert.equal(historyView.planHistory.length,2);
const oldHistory = historyView.planHistory[0];
assert.equal(oldHistory.latest.sourceRunId,'execute','无需计划不覆盖旧计划归属');
assert.equal(oldHistory.latest.items.length,1);
assert.equal(oldHistory.latest.items[0].text,'改名后的项');
const {PlanChecklist} = load('src/components/run/plan-list-dialog.tsx');
html = markup(PlanChecklist,{plans:historyView.planHistory,runs:historyView.runs});
assert.match(html,/已停止/); assert.match(html,/未完成/);
assert.match(html,/上一份清单/);
assert.doesNotMatch(html,/按计划执行|调整与进展|最近核对|查看对应消息/);
const empty = markup(PlanChecklist,{plans:[],runs:[]});
assert.match(empty,/当前对话暂无计划清单/);
assert.doesNotMatch(empty,/<ol|<button/);
const single = markup(PlanChecklist,{plans:[oldHistory],runs:historyView.runs});
assert.doesNotMatch(single,/<button|上一份|下一份|初始安排|后来移除/);
console.log('PASS: 每份计划只保留最新清单、无需计划不覆盖历史、单份无导航、空态提示');

async function checkPinnedHistory() {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const {create, act} = req('react-test-renderer');
  let rendered;
  const props = {plans:[oldHistory],runs:historyView.runs};
  await act(async()=>{rendered=create(React.createElement(PlanChecklist,props))});
  await act(async()=>{rendered.update(React.createElement(PlanChecklist,{...props,plans:historyView.planHistory}))});
  assert.match(JSON.stringify(rendered.toJSON()),/改名后的项/);
  const next=()=>rendered.root.findAllByType('button').find(b=>b.props['aria-label']==='下一份清单');
  await act(async()=>next().props.onClick());
  assert.match(JSON.stringify(rendered.toJSON()),/新任务/);
  assert.equal(next().props.disabled,true);
  await act(async()=>rendered.root.findAllByType('button').find(b=>b.props['aria-label']==='上一份清单').props.onClick());
  assert.match(JSON.stringify(rendered.toJSON()),/改名后的项/);
  await act(async()=>rendered.unmount());
  console.log('PASS: 新计划到达保持当前选择、前后切换及边界禁用');
}
checkPinnedHistory().catch(error=>{console.error(error);process.exitCode=1});

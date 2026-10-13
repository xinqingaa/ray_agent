// 执行实际草稿/受理核对模块；传输与 sessionStorage 为受控替身。
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(root, 'package.json'));
const ts = localRequire('typescript');
const cache = new Map();
function load(relative) {
  const filename = path.join(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const loaded = {exports: {}};
  cache.set(filename, loaded.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename), name);
        const file = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
        return load(path.relative(root, file));
      }
      return localRequire(name);
    },
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const {ApiError} = load('src/lib/api/fetch.ts');
const {sessionApi} = load('src/lib/api/session.ts');
const {readDraft, writeDraft, checkAcceptance, clearDraft} = load('src/lib/drafts.ts');
const {sendRecoverably, recoverSubmission, UncertainSubmissionError} = load('src/lib/send-recovery.ts');
global.window = {};
const values = new Map();
global.sessionStorage = {getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key)};
const payload = {message: '继续检查', attachments: ['file-1'], mode: 'plan'};
const pending = {...payload, afterSeq: 5, state: 'unknown'};
const event = {event: 'message', data: {seq: 6, run_id: 'r1', role: 'user', message: payload.message, attachments: [{id: 'file-1'}]}};
const accepted = {last_seq: 7, events: [event], runs: [{run_id: 'r1', mode: 'plan', status: 'completed'}]};

async function main() {
  assert.deepEqual(checkAcceptance(accepted, pending), {kind: 'accepted', runId: 'r1', seq: 6});
  assert.equal(checkAcceptance({...accepted, events: [event, {...event, data: {...event.data, seq: 8}}]}, pending).kind, 'ambiguous');
  assert.equal(checkAcceptance({...accepted, events: [{...event, data: {...event.data, attachments: [{id: 'another'}]}}]}, pending).kind, 'absent');
  assert.equal(checkAcceptance({...accepted, events: [event], runs: []}, pending).kind, 'ambiguous');
  assert.equal(checkAcceptance({...accepted, events: [event]}, {...pending, afterSeq: 6}).kind, 'absent');
  console.log('PASS: seq/附件/run 受理核对，重复消息有歧义，不匹配旧历史');

  writeDraft('s', {text: payload.message, files: [{id: 'file-1'}], planMode: true, sessionId: 's1'});
  assert.equal(readDraft('s').planMode, true);
  assert.equal(readDraft('s').files[0].id, 'file-1');
  assert.equal(readDraft('s').sessionId, 's1');
  assert.equal(readDraft('another').text, '');
  let posts = 0;
  let gets = 0;
  sessionApi.getSessionDetail = async () => ++gets === 1 ? {last_seq: 5, events: []} : accepted;
  sessionApi.chat = async () => {posts++; throw new ApiError(408, 'lost response');};
  await sendRecoverably('s', 's1', payload);
  assert.equal(posts, 1);
  assert.equal(gets, 2);
  assert.equal(readDraft('s').submission, undefined);
  console.log('PASS: 已受理但响应丢失，读回后成功，不自动再发');

  writeDraft('s', {submission: pending});
  sessionApi.getSessionDetail = async () => accepted;
  await sendRecoverably('s', 's1', payload);
  assert.equal(posts, 1);
  console.log('PASS: 刷新后保留待核对提交，先核对已有运行，不重复 POST');

  clearDraft('s');
  sessionApi.getSessionDetail = async () => ({last_seq: 5, events: []});
  sessionApi.chat = async () => {posts++; throw new ApiError(502, 'gateway');};
  await assert.rejects(sendRecoverably('s', 's1', payload), UncertainSubmissionError);
  assert.equal(readDraft('s').submission.state, 'unknown');
  assert.equal(posts, 2);
  sessionApi.getSessionDetail = async () => {throw new Error('offline');};
  await assert.rejects(recoverSubmission('s', 's1'), /恢复连接/);
  assert.equal(posts, 2);
  console.log('PASS: 未发现受理/读回失败保留 unknown，不猜测重发');

  clearDraft('s');
  sessionApi.getSessionDetail = async () => ({last_seq: 5, events: []});
  sessionApi.chat = async () => {posts++; throw new ApiError(409, 'busy');};
  await assert.rejects(sendRecoverably('s', 's1', payload), /busy/);
  assert.equal(readDraft('s').submission, undefined);
  console.log('PASS: 明确 409 未受理，解除待核对状态，允许手动改稿重试');
  const reference = {source_run_id:'proposal', plan_id:'p', source_seq:4, request_id:'stable-request'};
  const planPending = {...pending, execute_plan:reference};
  assert.equal(checkAcceptance({...accepted, events:[event, {event:'plan',data:{seq:7,run_id:'r1',accepted_from:reference}}]}, planPending).kind, 'accepted');
  writeDraft('s', {submission: planPending});
  sessionApi.chat = async (id, body) => {assert.equal(body.execute_plan.request_id,'stable-request'); posts++};
  await sendRecoverably('s', 's1', {...payload, execute_plan:{...reference, request_id:'new-click'}});
  assert.equal(readDraft('s').submission, undefined);
  console.log('PASS: 计划响应丢失后沿用持久请求标识，结构化承接记录可读回');
}
main().catch((error) => {console.error(error); process.exitCode = 1;});

// 展示关联独立于受理记录，刷新后恢复。
const localValues = new Map();
global.localStorage = {getItem: key => localValues.get(key) ?? null, setItem: (key, value) => localValues.set(key, value)};
const {readRetryDisplay, writeRetryDisplay, retryEcho} = load('src/lib/retry-display.ts');
const retryPending = {text: '重新检查', fromRunId: 'failed-run', knownUserIds: ['original']};
const display = {hiddenRunIds: ['failed-run'], hiddenUserIds: ['retry-user'], pending: retryPending};
writeRetryDisplay('s', display);
assert.deepEqual(readRetryDisplay('s'), display);
assert.deepEqual(readRetryDisplay('another'), {hiddenRunIds: [], hiddenUserIds: [], pending: null});
const retryItems = [
  {kind: 'user', id: 'original', runId: 'failed-run', text: retryPending.text},
  {kind: 'user', id: 'retry-user', runId: 'new-run', text: retryPending.text},
  {kind: 'run_end', id: 'end', runId: 'new-run'},
  {kind: 'user', id: 'manual-repeat', runId: 'manual-run', text: retryPending.text},
];
assert.deepEqual(retryEcho(retryItems, retryPending), {userId: 'retry-user', settled: true});
assert.deepEqual(retryEcho(retryItems.slice(0, 2), retryPending), {userId: 'retry-user', settled: false});
writeRetryDisplay('s', {hiddenRunIds: [], hiddenUserIds: [], pending: null});
assert.equal(readRetryDisplay('s').pending, null);
localValues.set('rayagent:retry-display:s', '{invalid');
assert.deepEqual(readRetryDisplay('s').hiddenRunIds, []);
console.log('PASS: 重试展示关联可刷新恢复、会话隔离、回滚；仅隐藏一次重试回显，主动重复发送保留');

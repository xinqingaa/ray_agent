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
const accepted = {last_seq: 7, events: [event], runs: [{run_id: 'r1', status: 'completed'}]};

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
}
main().catch((error) => {console.error(error); process.exitCode = 1;});

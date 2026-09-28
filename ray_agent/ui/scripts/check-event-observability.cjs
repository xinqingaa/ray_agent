// 事件观察：转译并执行实际 UI 模块，不启动 Next.js，默认不连接服务。
// 覆盖 SSE 分块，以及 W4 投影：按 seq 去重、重连补齐、工具合并与成组、
// 失败轮次保留、activity、轮次用量、计划变化、终态原因。
// W6：增量累积与丢弃、速度估算。
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
const {parseSSEStream} = load('src/lib/api/fetch.ts');
const {mergeBySeq, projectSession, readEventSeq, reconnectDelayMs, resolveOutputRate} = load('src/lib/session-projection.ts');

async function parse(chunks) {
  const events = [];
  const errors = [];
  await parseSSEStream(new ReadableStream({start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  }}), (event) => events.push({type: event.type, data: event.data, id: event.lastEventId}), (event) => errors.push(event.message));
  return {events, errors};
}
const encode = (text) => new TextEncoder().encode(text);

function ev(seq, type, data = {}, runId = 'run-1') {
  return {
    event: type,
    data: {
      created_at: 1_700_000_000_000 + seq * 1000,
      ...data,
      seq,
      run_id: data.run_id ?? runId,
    },
  };
}

function summary(extra = {}) {
  return {
    duration_ms: 4000,
    turns: 1,
    model_requests: 1,
    tool_calls: 0,
    prompt_tokens: 10,
    completion_tokens: 4,
    cached_tokens: null,
    ...extra,
  };
}

function kinds(view) {
  return view.timeline.map((item) => item.kind);
}

(async () => {
  const payload = 'event: message\ndata: {"message":"读取中文文件"}\n\nevent: done\ndata: {}\n\n';
  const bytes = encode(payload);
  const fragmented = await parse([...bytes].map((byte) => Uint8Array.of(byte)));
  assert.deepEqual(fragmented.events.map(({type, data}) => ({type, data})), (await parse([bytes])).events.map(({type, data}) => ({type, data})));
  assert.equal(fragmented.events[0].data.message, '读取中文文件');
  assert.equal(fragmented.events[1].type, 'done');
  console.log('PASS: LF 分隔与逐字节 UTF-8 分块得到相同事件');

  const malformed = await parse([encode('event: tool\ndata: {broken}\n\n')]);
  assert.equal(malformed.events.length, 0);
  assert.equal(malformed.errors.length, 1);
  console.log('PASS: 非法 JSON 进入解析错误回调');

  const withId = await parse([encode('id: 7\nevent: message\ndata: {"message":"无 seq"}\n\n')]);
  assert.equal(withId.events[0].id, '7');
  console.log('PASS: SSE id 保留为 lastEventId，供订阅补上 seq');

  assert.equal(reconnectDelayMs(0), 500);
  assert.equal(reconnectDelayMs(1), 1000);
  assert.equal(reconnectDelayMs(2), 2000);
  assert.equal(reconnectDelayMs(3), 4000);
  assert.equal(reconnectDelayMs(8), 4000);
  console.log('PASS: 重连等待从 500ms 翻倍，上限 4 秒');

  const first = ev(1, 'message', {role: 'user', message: '先到'});
  const duplicate = ev(1, 'message', {role: 'user', message: '重复'});
  const deduped = projectSession({id: 's', events: [duplicate, first]});
  assert.equal(deduped.timeline.filter((item) => item.kind === 'user').length, 1);
  assert.equal(deduped.timeline.find((item) => item.kind === 'user').text, '重复');
  assert.equal(deduped.events.length, 1);
  assert.equal(deduped.events[0].seq, 1);
  console.log('PASS: 相同 seq 只保留先到的一条');

  const early = [ev(1, 'message', {role: 'user', message: '任务'}), ev(2, 'run', {status: 'running'})];
  const late = [ev(2, 'run', {status: 'running'}), ev(3, 'turn', {phase: 'started', index: 1, context_window: 65536})];
  const merged = mergeBySeq(early, late);
  assert.deepEqual(merged.map(readEventSeq), [1, 2, 3]);
  const resumed = projectSession({id: 's', events: merged});
  assert.equal(resumed.events.length, 3);
  assert.equal(resumed.timeline.filter((item) => item.kind === 'user').length, 1);
  assert.equal(resumed.runs[0].activity.kind, 'model');
  assert.equal(resumed.runs[0].activity.turnIndex, 1);
  console.log('PASS: 重连补齐按 seq 去重后接上，不重复用户消息');

  const toolRun = projectSession({
    id: 's',
    events: [
      ev(1, 'run', {status: 'running'}),
      ev(2, 'message', {role: 'user', message: '读一下'}),
      ev(3, 'turn', {phase: 'started', index: 1, context_window: 65536}),
      ev(4, 'message', {role: 'assistant', message: '先看文件。'}),
      ev(5, 'tool', {tool_call_id: 'c1', name: 'file', function: 'read_file', status: 'calling', args: {filepath: '/home/ubuntu/upload/source.csv'}}),
      ev(6, 'tool', {tool_call_id: 'c1', name: 'file', function: 'read_file', status: 'called', duration_ms: 3, args: {filepath: '/home/ubuntu/upload/source.csv'}, content: {content: 'item,amount\na,12\nb,18\nc,30\n'}}),
      ev(7, 'tool', {tool_call_id: 'c2', name: 'shell', function: 'shell_execute', status: 'calling', args: {command: 'wc -l source.csv'}}),
      ev(8, 'tool', {tool_call_id: 'c2', name: 'shell', function: 'shell_execute', status: 'called', duration_ms: 9, args: {command: 'wc -l source.csv'}, content: {console: [{output: '4 source.csv\n'}]}}),
      ev(9, 'turn', {phase: 'completed', index: 1, model_ms: 695, tools_ms: 12, finish_reason: 'tool_calls', tool_call_ids: ['c1', 'c2'], attempts: 1, usage: {prompt_tokens: 100, completion_tokens: 20, cached_tokens: null}}),
    ],
  });
  assert.deepEqual(kinds(toolRun).filter((kind) => kind === 'user' || kind === 'narration' || kind === 'tools'), ['user', 'narration', 'tools']);
  const group = toolRun.timeline.find((item) => item.kind === 'tools');
  assert.equal(group.calls.length, 2);
  assert.equal(group.turnIndex, 1);
  assert.equal(group.calls[0].status, 'succeeded');
  assert.equal(group.calls[0].durationMs, 3);
  assert.equal(group.calls[0].title, '读取文件 /home/ubuntu/upload/source.csv');
  assert.equal(group.calls[0].result.summary, '4 行');
  assert.equal(group.calls[0].result.rawChars, 'item,amount\na,12\nb,18\nc,30\n'.length);
  assert.equal(group.calls[1].title, '运行命令 wc -l source.csv');
  assert.equal(group.calls[1].family, 'shell');
  assert.equal(group.calls[1].result.summary, '1 行输出');
  assert.equal(toolRun.runs[0].activity.kind, 'idle');
  const turn = toolRun.runs[0].turns[0];
  assert.equal(turn.modelMs, 695);
  assert.equal(turn.toolsMs, 12);
  assert.equal(turn.usage.prompt, 100);
  assert.equal(turn.usage.completion, 20);
  assert.equal(turn.usage.total, 120);
  assert.equal(turn.finishReason, 'tool_calls');
  assert.deepEqual(turn.toolCallIds, ['c1', 'c2']);
  assert.equal(turn.attempts, 1);
  assert.equal(toolRun.usage.context.usedTokens, 100);
  assert.equal(toolRun.usage.context.windowTokens, 65536);
  assert.equal(toolRun.usage.context.lastTurnTokens, 120);
  assert.equal(toolRun.usage.watermarkRatio, null);
  console.log('PASS: calling/called 合并，同一轮两个调用成组，轮次用量与用时来自 turn 事件');

  const thinking = projectSession({
    id: 's',
    events: [
      ev(1, 'run', {status: 'running'}),
      ev(2, 'turn', {phase: 'started', index: 2, context_window: 32000}),
    ],
  });
  assert.equal(thinking.activeRun.activity.kind, 'model');
  assert.equal(thinking.activeRun.activity.turnIndex, 2);
  assert.equal(thinking.activeRun.activity.startedAt, 1_700_000_000_000 + 2000);

  const executing = projectSession({
    id: 's',
    events: [
      ...thinking.events.map((item) => ({event: item.type, data: {...item.payload, seq: item.seq, run_id: item.runId, created_at: item.createdAt}})),
      ev(3, 'tool', {tool_call_id: 'c9', name: 'shell', function: 'shell_execute', status: 'calling', args: {command: 'npm test'}}),
    ],
  });
  assert.equal(executing.activeRun.activity.kind, 'tool');
  assert.equal(executing.activeRun.activity.callId, 'c9');
  assert.equal(executing.activeRun.activity.title, '运行命令 npm test');
  assert.equal(executing.activeRun.activity.family, 'shell');

  const stopping = projectSession({
    id: 's',
    stoppingRequestedAt: 1_700_000_000_500,
    events: executing.events.map((item) => ({event: item.type, data: {...item.payload, seq: item.seq, run_id: item.runId, created_at: item.createdAt}})),
  });
  assert.equal(stopping.activeRun.activity.kind, 'stopping');
  assert.equal(stopping.activeRun.activity.requestedAt, 1_700_000_000_500);
  assert.deepEqual(stopping, projectSession({
    id: 's',
    stoppingRequestedAt: 1_700_000_000_500,
    events: executing.events.map((item) => ({event: item.type, data: {...item.payload, seq: item.seq, run_id: item.runId, created_at: item.createdAt}})),
  }));
  console.log('PASS: activity 在思考、执行工具、已请求停止时取对应值，且不读取时钟');

  const askEvents = [
    ev(1, 'run', {status: 'running'}),
    ev(2, 'message', {role: 'user', message: '做一份文件'}),
    ev(3, 'turn', {phase: 'started', index: 1}),
    ev(4, 'message', {role: 'assistant', message: '先确认名字。'}),
    ev(5, 'message', {role: 'assistant', message: '文件名用什么？'}),
    ev(6, 'turn', {phase: 'completed', index: 1, model_ms: 10, tool_call_ids: [], usage: {prompt_tokens: 5, completion_tokens: 5}}),
    ev(7, 'wait', {}),
    ev(8, 'run', {status: 'waiting', reason: null}),
  ];
  const waiting = projectSession({id: 's', events: askEvents});
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.activeRun.activity.kind, 'waiting_reply');
  assert.equal(waiting.activeRun.activity.question, '文件名用什么？');
  const ask = waiting.timeline.find((item) => item.kind === 'ask');
  assert.equal(ask.answered, false);
  assert.equal(waiting.timeline.find((item) => item.kind === 'narration').text, '先确认名字。');

  const answered = projectSession({
    id: 's',
    events: [
      ...askEvents,
      ev(9, 'run', {status: 'running'}),
      ev(10, 'message', {role: 'user', message: '用 a.json'}),
    ],
  });
  assert.equal(answered.timeline.find((item) => item.kind === 'ask').answered, true);
  const replies = answered.timeline.filter((item) => item.kind === 'user');
  assert.equal(replies[1].injected, false);
  assert.equal(replies[1].text, '用 a.json');
  console.log('PASS: 提问等待的 activity 是 waiting_reply；回复后条目标为已回复，且不是注入');

  const approval = projectSession({
    id: 's',
    events: [
      ev(1, 'run', {status: 'running'}),
      ev(2, 'tool', {tool_call_id: 'c-ok', name: 'shell', function: 'shell_execute', status: 'calling', args: {command: 'rm -rf build'}}),
      ev(3, 'run', {status: 'waiting', reason: 'approval'}),
    ],
  });
  assert.equal(approval.activeRun.activity.kind, 'waiting_approval');
  assert.equal(approval.activeRun.activity.callId, 'c-ok');
  console.log('PASS: reason=approval 时 activity 为 waiting_approval');

  const failed = projectSession({
    id: 's',
    events: [
      ev(1, 'run', {status: 'running'}, 'run-a'),
      ev(2, 'message', {role: 'user', message: '同样的任务'}, 'run-a'),
      ev(3, 'error', {error: '模型请求失败，运行已停止。（原因：model_error）'}, 'run-a'),
      ev(4, 'run', {status: 'failed', reason: 'model_error', summary: summary()}, 'run-a'),
      ev(5, 'run', {status: 'running'}, 'run-b'),
      ev(6, 'message', {role: 'user', message: '同样的任务'}, 'run-b'),
    ],
  });
  assert.equal(failed.timeline.filter((item) => item.kind === 'user').length, 2);
  const end = failed.timeline.find((item) => item.kind === 'run_end');
  assert.equal(end.status, 'failed');
  assert.equal(end.reasonText, '模型请求失败，运行已停止。');
  assert.equal(end.retryText, '同样的任务');
  assert.equal(failed.runs[0].reasonText, end.reasonText);
  console.log('PASS: 同内容再发一次仍保留失败轮次，不再裁掉');

  const stopped = projectSession({
    id: 's',
    events: [
      ev(1, 'run', {status: 'running'}),
      ev(2, 'message', {role: 'user', message: '跑着'}),
      ev(3, 'tool', {tool_call_id: 'c-stop', name: 'shell', function: 'shell_execute', status: 'calling', args: {command: 'sleep 30'}}),
      ev(4, 'run', {status: 'cancelled', reason: 'user_stop', summary: summary({tool_calls: 0})}),
    ],
  });
  assert.equal(stopped.runs[0].reasonText, '你停止了这次运行');
  assert.equal(stopped.timeline.find((item) => item.kind === 'run_end').reasonText, '你停止了这次运行');
  assert.equal(stopped.timeline.find((item) => item.kind === 'tools').calls[0].status, 'cancelled');
  assert.equal(stopped.activeRun, null);
  assert.equal(stopped.status, 'cancelled');

  const interrupted = projectSession({
    id: 's',
    events: [ev(1, 'run', {status: 'interrupted', reason: 'api_restart', summary: summary()})],
  });
  assert.equal(interrupted.runs[0].reasonText, '服务重启导致运行中断');

  const limited = projectSession({
    id: 's',
    maxTurns: 100,
    events: [ev(1, 'run', {status: 'failed', reason: 'max_iterations', summary: summary()})],
  });
  assert.match(limited.runs[0].reasonText, /上限 100 次/);
  assert.equal(limited.runs[0].maxTurns, 100);
  console.log('PASS: 已停止、服务重启中断、达到请求上限各有可读原因');

  const plan = projectSession({
    id: 's',
    events: [
      ev(1, 'run', {status: 'running'}),
      ev(2, 'tool', {
        tool_call_id: 'c-plan',
        name: 'plan',
        function: 'update_plan',
        status: 'called',
        duration_ms: 2,
        args: {
          explanation: '先读再写',
          plan: [
            {step: '读取', status: 'in_progress'},
            {step: '写入', status: 'pending'},
          ],
        },
      }),
      ev(3, 'plan', {steps: [
        {id: '1', description: '读取', status: 'running'},
        {id: '2', description: '写入', status: 'pending'},
      ]}),
      ev(4, 'plan', {steps: [
        {id: '1', description: '读取', status: 'completed'},
        {id: '2', description: '校验', status: 'running'},
      ]}),
    ],
  });
  assert.equal(plan.plan.version, 2);
  assert.equal(plan.plan.explanation, '先读再写');
  assert.equal(plan.plan.currentIndex, 1);
  assert.equal(plan.plan.completedCount, 1);
  assert.equal(plan.plan.items[0].startedAt, 1_700_000_000_000 + 3000);
  assert.equal(plan.plan.items[0].completedAt, 1_700_000_000_000 + 4000);
  assert.deepEqual(plan.plan.changed.map((change) => change.kind), ['status', 'added', 'removed']);
  assert.equal(plan.plan.changed[0].from, 'in_progress');
  assert.equal(plan.plan.changed[0].to, 'completed');
  assert.equal(plan.plan.changed[1].text, '校验');
  assert.equal(plan.plan.changed[2].text, '写入');
  assert.equal(plan.timeline.find((item) => item.kind === 'tools').calls[0].title, '更新计划 0/2 已完成');
  console.log('PASS: 计划第二版标出状态变化、新增和删除');

  const delivered = projectSession({
    id: 's',
    events: [
      ev(1, 'run', {status: 'running'}),
      ev(2, 'message', {role: 'user', message: '交给我', attachments: [{id: 'up-1', filename: 'source.csv', size: 27, extension: '.csv', mime_type: 'text/csv'}]}),
      ev(3, 'message', {role: 'user', message: '再补一句'}),
      ev(4, 'message', {role: 'assistant', message: '结果在这里', attachments: [{id: 'out-1', filename: 'summary.json', size: 12, extension: 'json', filepath: '/home/ubuntu/summary.json'}]}),
      ev(5, 'message', {role: 'assistant', message: '已经交付。'}),
      ev(6, 'turn', {phase: 'completed', index: 1, model_ms: 8, finish_reason: 'stop', tool_call_ids: [], usage: {prompt_tokens: 3, completion_tokens: 1}}),
      ev(7, 'done', {}),
      ev(8, 'run', {status: 'completed', summary: summary({turns: 1, tool_calls: 1, prompt_tokens: 3, completion_tokens: 1, duration_ms: 900})}),
    ],
  });
  assert.equal(delivered.timeline.find((item) => item.kind === 'delivery').note, '结果在这里');
  assert.equal(delivered.timeline.find((item) => item.kind === 'final').text, '已经交付。');
  assert.equal(delivered.timeline.find((item) => item.kind === 'final').summary.durationMs, 900);
  assert.equal(delivered.files.find((file) => file.id === 'up-1').source, 'upload');
  assert.equal(delivered.files.find((file) => file.id === 'out-1').source, 'delivery');
  assert.equal(delivered.files.find((file) => file.id === 'out-1').extension, '.json');
  assert.equal(delivered.timeline.filter((item) => item.kind === 'user')[1].injected, true);
  console.log('PASS: 交付与最终回复分开；运行中的后一条用户消息标为注入');

  const compact = projectSession({
    id: 's',
    events: [
      ev(1, 'context', {op: 'compact', message_count: 2, roles: ['assistant', 'tool']}),
      ev(2, 'compact', {before_tokens: 800, after_tokens: 120, summarized_turns: 3, summary: '前文已摘要'}),
    ],
  });
  assert.equal(compact.usage.compactions, 2);
  const compaction = compact.timeline.filter((item) => item.kind === 'compaction');
  assert.equal(compaction.length, 1);
  assert.equal(compaction[0].beforeTokens, 800);
  assert.equal(compaction[0].afterTokens, 120);
  assert.equal(compaction[0].summarizedTurns, 3);
  console.log('PASS: 没有估算量的压缩只计数；带前后 token 的压缩进入时间线');

  const mcp = projectSession({
    id: 's',
    events: [
      ev(1, 'tool', {
        tool_call_id: 'c-mcp',
        name: 'mcp_qiniu',
        function: 'upload_file',
        status: 'called',
        args: {bucket: 'reports', key: 'a.json'},
        content: {outcome: {success: false, message: '超时', data: null}},
      }),
      ev(2, 'attempt', {turn: 3, attempt: 2, reason: 'timeout', retried: true}),
    ],
  });
  const mcpCall = mcp.timeline.find((item) => item.kind === 'tools').calls[0];
  assert.equal(mcpCall.family, 'mcp');
  assert.equal(mcpCall.status, 'failed');
  assert.equal(mcpCall.result.error, '超时');
  assert.equal(mcpCall.verb, '调用 MCP 工具 qiniu / upload_file');
  const attempt = mcp.timeline.find((item) => item.kind === 'attempt');
  assert.equal(attempt.turnIndex, 3);
  assert.equal(attempt.attempt, 2);
  assert.equal(attempt.retried, true);
  console.log('PASS: 协议工具按 outcome 判失败；attempt 预留条目可投影');

  const streamingBase = [
    ev(1, 'run', {status: 'running'}),
    ev(2, 'turn', {phase: 'started', index: 1}),
  ];
  const deltas = [
    {run_id: 'run-1', turn: 1, attempt: 1, delta: '你'},
    {run_id: 'run-1', turn: 1, attempt: 1, delta: '好'},
  ];
  const accumulated = projectSession({id: 's', events: streamingBase, deltas, streamStartedAt: {'run-1:1:1': 1_700_000_000_000}});
  const draft = accumulated.timeline.find((item) => String(item.id).startsWith('stream:'));
  assert.equal(draft.kind, 'narration');
  assert.equal(draft.text, '你好');
  assert.equal(accumulated.streamingItemId, draft.id);
  assert.equal(accumulated.streaming.text, '你好');
  assert.equal(accumulated.streaming.startedAt, 1_700_000_000_000);
  assert.equal(accumulated.events.length, 2);
  assert.equal(accumulated.events.some((item) => item.type === 'delta'), false);
  const leaked = projectSession({
    id: 's',
    events: [...streamingBase, {event: 'delta', data: {seq: 9, run_id: 'run-1', turn: 1, attempt: 1, delta: '漏'}}],
  });
  assert.equal(leaked.events.some((item) => item.type === 'delta'), false);
  assert.equal(leaked.streamingItemId, null);
  console.log('PASS: 增量按 (run, turn, attempt) 累积，且不进入带 seq 的事件列表');

  const replaced = projectSession({
    id: 's',
    events: [...streamingBase, ev(3, 'message', {role: 'assistant', message: '你好，世界', attempt: 1})],
    deltas,
  });
  assert.equal(replaced.timeline.some((item) => String(item.id).startsWith('stream:')), false);
  assert.equal(replaced.streamingItemId, null);
  assert.equal(replaced.timeline.find((item) => item.kind === 'narration').text, '你好，世界');
  console.log('PASS: 同一 attempt 的助手消息替换临时条目');

  const bigger = projectSession({
    id: 's',
    events: streamingBase,
    deltas: [
      {run_id: 'run-1', turn: 1, attempt: 1, delta: '半截'},
      {run_id: 'run-1', turn: 1, attempt: 2, delta: '重来'},
    ],
  });
  const biggerDrafts = bigger.timeline.filter((item) => String(item.id).startsWith('stream:'));
  assert.equal(biggerDrafts.length, 1);
  assert.equal(biggerDrafts[0].text, '重来');
  const nextTurn = projectSession({
    id: 's',
    events: [...streamingBase, ev(3, 'turn', {phase: 'started', index: 2})],
    deltas: [
      {run_id: 'run-1', turn: 1, attempt: 1, delta: '上一轮'},
      {run_id: 'run-1', turn: 2, attempt: 1, delta: '这一轮'},
    ],
  });
  assert.equal(nextTurn.timeline.find((item) => String(item.id).startsWith('stream:')).text, '这一轮');
  const droppedTurn = projectSession({
    id: 's',
    events: [...streamingBase, ev(3, 'turn', {phase: 'started', index: 2})],
    deltas: [{run_id: 'run-1', turn: 1, attempt: 1, delta: '上一轮'}],
  });
  assert.equal(droppedTurn.streamingItemId, null);
  console.log('PASS: 更大的 attempt 或另一轮丢掉旧临时条目');

  const truncated = projectSession({
    id: 's',
    events: [...streamingBase, ev(3, 'turn', {phase: 'completed', index: 1, model_ms: 100, ttft_ms: 40, finish_reason: 'length', attempts: 1})],
    deltas: [{run_id: 'run-1', turn: 1, attempt: 1, delta: '被截断'}],
  });
  assert.equal(truncated.streamingItemId, null);
  const failedTry = projectSession({
    id: 's',
    events: [...streamingBase, ev(3, 'attempt', {turn: 1, attempt: 1, reason: 'cancelled', chars: 2, retried: false})],
    deltas: [{run_id: 'run-1', turn: 1, attempt: 1, delta: '半'}],
  });
  assert.equal(failedTry.streamingItemId, null);
  assert.equal(failedTry.timeline.find((item) => item.kind === 'attempt').chars, 2);
  const stoppedStream = projectSession({
    id: 's',
    events: [...streamingBase, ev(3, 'run', {status: 'cancelled', reason: 'user_stop', summary: summary()})],
    deltas: [{run_id: 'run-1', turn: 1, attempt: 1, delta: '停'}],
  });
  assert.equal(stoppedStream.streamingItemId, null);
  assert.equal(stoppedStream.timeline.some((item) => item.text === '停'), false);
  console.log('PASS: 轮次结束且没有同 attempt 助手消息、失败尝试或运行终态后没有临时条目');

  const noUsage = resolveOutputRate({text: '你好', elapsedMs: 1000, turnEnded: true, completionTokens: null, modelMs: 1000, ttftMs: 200});
  assert.equal(noUsage.estimated, true);
  assert.ok(Math.abs(noUsage.tokensPerSecond - 1.4) < 1e-9);
  const measured = resolveOutputRate({turnEnded: true, modelMs: 840, ttftMs: 210, completionTokens: 40});
  assert.equal(measured.estimated, false);
  assert.ok(Math.abs(measured.tokensPerSecond - (40 / ((840 - 210) / 1000))) < 1e-9);
  const reasoned = resolveOutputRate({turnEnded: true, modelMs: 840, ttftMs: 210, completionTokens: 26, reasoningTokens: 24});
  assert.equal(reasoned.estimated, false);
  assert.ok(Math.abs(reasoned.tokensPerSecond - (2 / ((840 - 210) / 1000))) < 1e-9);
  const liveOnly = resolveOutputRate({text: 'ab', elapsedMs: 1000, turnEnded: false, modelMs: 840, ttftMs: 210, completionTokens: 40});
  assert.equal(liveOnly.estimated, true);
  console.log('PASS: 无 usage 或仍在生成时速度标为估算；有 usage 时按交接公式，推理 token 从分子扣除');

  const eof = await parse([encode('event: message\ndata: {"message":"没有空行结尾"}')]);
  assert.equal(eof.events.length, 1);
  assert.ok(!eof.events.some((event) => event.type === 'done'));
  console.log('LIMITATION: EOF 时分派完整 JSON 尾段，不等于已收到 done');
  const crlf = await parse([encode('event: tool\r'), encode('\ndata: {"value":1}\r\n\r\n')]);
  assert.equal(crlf.events[0].type, 'message');
  assert.equal(crlf.events[0].data.value, 1);
  console.log('LIMITATION: CRLF 恰在 CR/LF 之间分块时，当前解析器丢失 tool 类型');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

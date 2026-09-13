// 第十章本地观察：转译并执行实际 UI 模块，不启动 Next.js 或连接服务。
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
  const module = {exports: {}};
  cache.set(filename, module.exports);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(
    (name) => name === '@/lib/utils' ? load('src/lib/utils.ts') : localRequire(name), module, module.exports);
  return module.exports;
}
const {parseSSEStream} = load('src/lib/api/fetch.ts');
const {normalizeEvents, eventsToTimeline} = load('src/lib/session-events.ts');
async function parse(chunks) {
  const events = [], errors = [];
  await parseSSEStream(new ReadableStream({start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  }}), e => events.push({type:e.type, data:e.data}), e => errors.push(e.message));
  return {events, errors};
}
const encode = s => new TextEncoder().encode(s);
(async () => {
  const payload = 'event: message\ndata: {"message":"读取中文文件"}\n\nevent: done\ndata: {}\n\n';
  const bytes = encode(payload);
  const fragmented = await parse([...bytes].map(b => Uint8Array.of(b)));
  assert.deepEqual(fragmented, await parse([bytes]));
  assert.equal(fragmented.events[0].data.message, '读取中文文件');
  assert.equal(fragmented.events[1].type, 'done');
  console.log('PASS: LF 分隔与逐字节 UTF-8 分块得到相同事件');

  const malformed = await parse([encode('event: tool\ndata: {broken}\n\n')]);
  assert.equal(malformed.events.length, 0);
  assert.equal(malformed.errors.length, 1);
  console.log('PASS: 非法 JSON 进入解析错误回调');

  const sequence = normalizeEvents([
    {event:'step',data:{id:'s1',status:'running',description:'读取'}},
    {event:'tool',data:{tool_call_id:'c1',name:'file',function:'read_file',status:'calling'}},
    {event:'tool',data:{tool_call_id:'c1',name:'file',function:'read_file',status:'called'}},
    {event:'step',data:{id:'s1',status:'completed',description:'读取'}},
    {event:'message',data:{role:'user',message:'继续'}},
    {event:'step',data:{id:'s1',status:'running',description:'再次进入该步骤'}},
    {event:'tool',data:{tool_call_id:'c2',name:'file',function:'read_file',status:'calling'}}
  ]);
  const steps = eventsToTimeline(sequence).filter(e=>e.kind==='step');
  assert.equal(steps.length,2);
  assert.equal(steps[0].tools.length,1);
  assert.equal(steps[0].tools[0].status,'called');
  assert.equal(steps[1].tools[0].tool_call_id,'c2');
  console.log('PASS: 调用阶段合并，用户消息后的同名步骤另建展示项');

  // 以下断言锁定当前可观察限制，不表示 SSE 标准符合性通过。
  const eof = await parse([encode('event: message\ndata: {"message":"没有空行结尾"}')]);
  assert.equal(eof.events.length,1);
  assert.ok(!eof.events.some(e=>e.type==='done'));
  console.log('LIMITATION: EOF 时分派完整 JSON 尾段，不等于已收到 done');
  const crlf = await parse([encode('event: tool\r'),encode('\ndata: {"value":1}\r\n\r\n')]);
  assert.equal(crlf.events[0].type,'message');
  assert.equal(crlf.events[0].data.value,1);
  console.log('LIMITATION: CRLF 恰在 CR/LF 之间分块时，当前解析器丢失 tool 类型');
})().catch(error=>{console.error(error);process.exitCode=1;});

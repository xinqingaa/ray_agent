/**
 * 组件状态目录用的状态夹具。
 *
 * 标“真实”的条目直接取自 w1-sessions.ts（W1 真实事件投影）。
 * 该文件头列出按 W3 契约补写的字段：RunView（含 turns、summary）、TurnView、
 * RawEvent.seq 与 runId。本文件的真实条目原样引用这些字段。
 *
 * 标“合成”的条目是 W1 事件中不会出现的状态（失败、审批、截断、压缩、失败尝试、停止与中断等），
 * 以真实条目为底按 W3/W2/W6/W7.2 的契约改写。终态运行经 ended() 补写的
 * RunView.summary（用时、轮数、工具数、tokens）和未结束轮次的 endedAt
 * 同样按 W3 契约由夹具时间戳推算，不是事件原文。
 */
import type {ListA2AServerItem, ListMCPServerItem, Session} from '@/lib/api'
import type {
  FileView,
  PlanView,
  RunView,
  SessionView,
  TimelineItemKind,
  TimelineItemOf,
  ToolCallView,
  UsageView,
} from '@/lib/session-view'
import {
  e2Delivery,
  E2_DELIVERY_NOW,
  e3Ask,
  e3Waiting,
  E3_WAITING_NOW,
  planChanged,
  PLAN_CHANGED_NOW,
  planModelThinking,
  PLAN_MODEL_THINKING_NOW,
  planToolRunning,
  PLAN_TOOL_RUNNING_NOW,
  planWalkthrough,
  PLAN_WALKTHROUGH_NOW,
} from './w1-sessions'

export {
  e2Delivery,
  E2_DELIVERY_NOW,
  e3Ask,
  e3Waiting,
  E3_WAITING_NOW,
  planChanged,
  PLAN_CHANGED_NOW,
  planModelThinking,
  PLAN_MODEL_THINKING_NOW,
  planToolRunning,
  PLAN_TOOL_RUNNING_NOW,
  planWalkthrough,
  PLAN_WALKTHROUGH_NOW,
}

function item<K extends TimelineItemKind>(view: SessionView, kind: K, nth = 0): TimelineItemOf<K> {
  const found = view.timeline.filter((i) => i.kind === kind)[nth]
  if (!found) throw new Error(`fixture: ${view.id} 没有第 ${nth} 个 ${kind}`)
  return found as TimelineItemOf<K>
}

function call(view: SessionView, name: string, nth = 0): ToolCallView {
  const calls = view.timeline.flatMap((i) => (i.kind === 'tools' ? i.calls : [])).filter((c) => c.name === name)
  if (!calls[nth]) throw new Error(`fixture: ${view.id} 没有第 ${nth} 个 ${name}`)
  return calls[nth]
}

// ==================== 运行状态条 ====================

const runningRun = planToolRunning.runs[0]
const completedRun = e2Delivery.runs[0]

function ended(base: RunView, patch: Partial<RunView>): RunView {
  const endedAt = patch.endedAt ?? base.startedAt + 41_000
  const turns = base.turns.map((t) => ({...t, endedAt: t.endedAt ?? endedAt}))
  return {
    ...base,
    endedAt,
    turns,
    activity: {kind: 'idle'},
    summary: {
      durationMs: endedAt - base.startedAt,
      turns: turns.length,
      toolCalls: turns.reduce((n, t) => n + t.toolCallIds.length, 0),
      tokens: base.tokens,
    },
    ...patch,
  }
}

export const runStates = {
  idle: null,
  /** 真实：走查会话截到第二轮工具结果之后 */
  model: planModelThinking.runs[0],
  modelNow: PLAN_MODEL_THINKING_NOW,
  /** 真实：走查会话截到 shell_execute calling */
  tool: runningRun,
  toolNow: PLAN_TOOL_RUNNING_NOW,
  /** 真实：E3 截到 wait */
  waitingReply: e3Waiting.runs[0],
  waitingReplyNow: E3_WAITING_NOW,
  /** 合成：同一调用改为需要审批 */
  waitingApproval: {
    ...runningRun,
    status: 'waiting',
    reason: 'approval',
    activity: {kind: 'waiting_approval', callId: 'call_00_tvMhIphECPx3AQeD6SVl9190', title: '运行命令 cd /home/ubuntu && python3 - <<\'EOF\''},
  } satisfies RunView,
  /** 合成：已请求停止，尚未收到终态 */
  stopping: {
    ...runningRun,
    activity: {kind: 'stopping', requestedAt: PLAN_TOOL_RUNNING_NOW - 800},
  } satisfies RunView,
  /** 合成：计划模式运行中 */
  planMode: {
    ...runningRun,
    mode: 'plan',
  } satisfies RunView,
  /** 真实：E2 完成 */
  completed: completedRun,
  /** 合成：模型请求次数达到上限 */
  failed: ended(runningRun, {
    status: 'failed',
    reason: 'max_iterations',
    reasonText: '模型请求次数达到本次运行上限 100 次。确认任务没有陷入重复后，可在设置中调高“单次运行最大模型请求次数”再重试',
  }),
  /** 合成：用户停止 */
  cancelled: ended(runningRun, {status: 'cancelled', reason: 'user_stop', reasonText: '你停止了这次运行'}),
  /** 合成：API 重启 */
  interrupted: ended(runningRun, {status: 'interrupted', reason: 'api_restart', reasonText: '服务重启导致运行中断'}),
}

// ==================== 计划条 ====================

const planInProgress = planToolRunning.plan as PlanView

export const planStates = {
  none: null,
  /** 真实：第一版计划，第 1 项进行中 */
  inProgress: planInProgress,
  inProgressNow: PLAN_TOOL_RUNNING_NOW,
  /** 真实：走查结束时的第三版，全部完成 */
  allDone: planWalkthrough.plan as PlanView,
  /** 合成：同一计划，运行被停止时仍有未完成项 */
  endedUnfinished: planInProgress,
  /** 真实：第二版计划，前三项完成、第四项开始 */
  changed: planChanged.plan as PlanView,
  changedNow: PLAN_CHANGED_NOW,
  /** 合成：模型改写清单，新增一项、删除一项 */
  rewritten: {
    ...planInProgress,
    items: [
      {...planInProgress.items[0], status: 'completed', completedAt: planInProgress.updatedAt + 1100},
      {...planInProgress.items[1], status: 'in_progress', startedAt: planInProgress.updatedAt + 1100},
      {text: '校验 amount 列没有缺失值', status: 'pending', startedAt: null, completedAt: null},
      planInProgress.items[3],
    ],
    currentIndex: 1,
    completedCount: 1,
    explanation: '数据里 amount 列可能有空值，先补一步校验；写文件与交付合并到最后一步。',
    updatedAt: planInProgress.updatedAt + 1100,
    changed: [
      {index: 0, text: planInProgress.items[0].text, kind: 'status', from: 'in_progress', to: 'completed'},
      {index: 1, text: planInProgress.items[1].text, kind: 'status', from: 'pending', to: 'in_progress'},
      {index: 2, text: '校验 amount 列没有缺失值', kind: 'added'},
      {index: 2, text: planInProgress.items[2].text, kind: 'removed'},
    ],
    version: 2,
  } satisfies PlanView,
}

// ==================== 工具卡 ====================

const shellRunning = call(planToolRunning, 'shell_execute')
const readOk = call(e2Delivery, 'read_file')
const shellOk = call(e2Delivery, 'shell_execute', 1)
const writeOk = call(e3Ask, 'write_file')

const longOutput = Array.from({length: 60}, (_, i) => `2026-09-28 09:4${i % 10}:0${i % 6} INFO  build step ${i + 1}/412 compiled src/module_${i}.py`).join('\n')

export const toolStates: Record<string, ToolCallView> = {
  /** 真实 */
  running: shellRunning,
  /** 真实 */
  succeeded: readOk,
  /** 真实（带多行命令） */
  succeededShell: shellOk,
  /** 合成：非零退出码 */
  failed: {
    ...shellOk,
    callId: 'call_fx_failed',
    target: 'python3 /home/ubuntu/stats.py',
    title: '运行命令 python3 /home/ubuntu/stats.py',
    argSummary: 'python3 /home/ubuntu/stats.py',
    status: 'failed',
    durationMs: 214,
    result: {exitCode: 1, truncated: false, fullOutputPath: null, rawChars: 96, error: '退出码 1：python3: can\'t open file \'/home/ubuntu/stats.py\': [Errno 2] No such file or directory', summary: null},
    raw: {
      args: {command: 'python3 /home/ubuntu/stats.py', exec_dir: '/home/ubuntu', session_id: 'main'},
      content: {console: [{ps1: 'root@f46b02bc21e2:~ $', command: 'python3 /home/ubuntu/stats.py', output: 'python3: can\'t open file \'/home/ubuntu/stats.py\': [Errno 2] No such file or directory\n'}]},
    },
  },
  /** 合成：审批被拒绝（W7.2） */
  denied: {
    ...shellOk,
    callId: 'call_fx_denied',
    target: 'rm -rf /home/ubuntu/upload',
    title: '运行命令 rm -rf /home/ubuntu/upload',
    argSummary: 'rm -rf /home/ubuntu/upload',
    status: 'denied',
    durationMs: null,
    result: {exitCode: null, truncated: false, fullOutputPath: null, rawChars: null, error: '被拒绝：你拒绝了这次调用，Agent 已收到“用户拒绝执行”', summary: null},
    raw: {args: {command: 'rm -rf /home/ubuntu/upload', exec_dir: '/home/ubuntu', session_id: 'main'}, content: null},
  },
  /** 合成：同批次前一个调用中止后补为未执行（W1 悬空调用规则） */
  skipped: {
    ...readOk,
    callId: 'call_fx_skipped',
    status: 'skipped',
    durationMs: null,
    result: {exitCode: null, truncated: false, fullOutputPath: null, rawChars: null, error: '未执行：同一批次中前面的调用等待审批，这个调用没有执行', summary: null},
    raw: {args: readOk.raw.args, content: null},
  },
  /** 合成：运行被停止时仍在执行 */
  cancelled: {
    ...shellRunning,
    callId: 'call_fx_cancelled',
    status: 'cancelled',
    durationMs: 12_400,
    result: {exitCode: null, truncated: false, fullOutputPath: null, rawChars: null, error: '已取消：运行被停止，命令已终止', summary: null},
  },
  /** 合成：W2 输出整形后的截断结果 */
  truncated: {
    ...shellOk,
    callId: 'call_fx_truncated',
    target: 'npm run build',
    title: '运行命令 npm run build',
    argSummary: 'npm run build',
    durationMs: 48_210,
    result: {exitCode: 0, truncated: true, fullOutputPath: '/home/ubuntu/.ray/outputs/call_fx_truncated.txt', rawChars: 48_213, error: null, summary: '412 行输出'},
    raw: {
      args: {command: 'npm run build', exec_dir: '/home/ubuntu/app', session_id: 'main'},
      content: {console: [{ps1: 'root@f46b02bc21e2:~/app $', command: 'npm run build', output: `${longOutput}\n…（中间 352 行已省略，完整输出见保存路径）\n`}]},
    },
  },
  /** 合成：写入长内容，参数过长 */
  longArgs: {
    ...writeOk,
    callId: 'call_fx_long_args',
    target: '/home/ubuntu/report/analysis.md',
    title: '写入文件 /home/ubuntu/report/analysis.md',
    argSummary: '/home/ubuntu/report/analysis.md',
    durationMs: 11,
    result: {exitCode: null, truncated: false, fullOutputPath: null, rawChars: 3_864, error: null, summary: '3.8 KB'},
    raw: {
      args: {
        filepath: '/home/ubuntu/report/analysis.md',
        content: Array.from({length: 24}, (_, i) => `## 第 ${i + 1} 节\n\n库存清单中 amount 列的第 ${i + 1} 组统计：总和、最大值与对应 item，按原始顺序列出，未修改源文件。`).join('\n\n'),
        trailing_newline: true,
      },
      content: {content: '（写入成功）'},
    },
  },
}

export const toolGroups = {
  /** 合成：三个调用，一个仍在运行 */
  partial: [readOk, {...shellOk, callId: 'call_fx_g1'}, {...shellRunning, callId: 'call_fx_g2'}],
  /** 真实：E2 第一轮的两个调用 */
  allSucceeded: item(e2Delivery, 'tools', 0).calls,
  /** 合成：三个调用，一个失败 */
  withFailure: [readOk, toolStates.failed, {...toolStates.skipped, callId: 'call_fx_g3'}],
}

// ==================== 消息 ====================

const longMarkdown = `已完成日志分析，结论如下。

构建失败只发生在 \`test_inventory.py\` 的第 3 个用例，原因是 \`amount\` 列在读取时被解析成字符串，与整数比较时抛出 \`TypeError\`。其余 41 个用例全部通过，耗时与上一次提交相比没有明显变化。

修复方式是在读取 CSV 后统一转换类型：

\`\`\`python
import csv

def load_rows(path: str) -> list[dict]:
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        row["amount"] = int(row["amount"])
    return rows
\`\`\`

改动只涉及 \`inventory/loader.py\`，没有修改测试文件。重新运行后 42 个用例全部通过，完整输出已保存在 \`/home/ubuntu/.ray/outputs/pytest.txt\`。

如果之后 CSV 里可能出现空值，建议在转换前跳过空行，或者在计划里加一步数据校验。`

export const messageStates = {
  /** 真实：E2 旁白 */
  narration: item(e2Delivery, 'narration', 1).text,
  /** 真实：E3 最终回复（短文本） */
  finalShort: item(e3Ask, 'final'),
  /** 合成：长文本与代码块 */
  finalLong: {...item(e2Delivery, 'final'), text: longMarkdown},
  /** 真实：走查最终回复（含表格与代码块） */
  finalTable: item(planWalkthrough, 'final'),
  /** 真实：E3 用户消息 */
  user: item(e3Ask, 'user', 0),
  /** 真实：E2 带附件的用户消息 */
  userWithAttachment: item(e2Delivery, 'user', 0),
  /** 合成：运行中注入的补充要求 */
  userInjected: {...item(e3Ask, 'user', 1), text: '另外，count 改成 5，文件名不变。', injected: true},
}

export const askStates = {
  /** 真实 */
  waiting: item(e3Waiting, 'ask'),
  /** 真实 */
  answered: item(e3Ask, 'ask'),
}

// ==================== 审批 ====================

export const approvalCall: ToolCallView = {
  ...toolStates.denied,
  callId: 'call_fx_approval',
  status: 'running',
  result: null,
  raw: {args: {command: 'rm -rf /home/ubuntu/build && npm run build', exec_dir: '/home/ubuntu/app', session_id: 'main'}, content: null},
  target: 'rm -rf /home/ubuntu/build && npm run build',
  title: '运行命令 rm -rf /home/ubuntu/build && npm run build',
}

export const approvalMcpCall: ToolCallView = {
  callId: 'call_fx_approval_mcp',
  family: 'mcp',
  name: 'upload_file',
  toolset: 'mcp_qiniu',
  verb: '调用 MCP 工具 qiniu / upload_file',
  target: '',
  title: '调用 MCP 工具 qiniu / upload_file',
  argSummary: 'bucket=reports key=2026/09/report.json',
  status: 'running',
  startedAt: PLAN_TOOL_RUNNING_NOW,
  durationMs: null,
  result: null,
  raw: {args: {bucket: 'reports', key: '2026/09/report.json', local_path: '/home/ubuntu/report.json'}, content: null},
}

// ==================== 交付 ====================

const deliveredReport = item(planWalkthrough, 'delivery')

const extraFiles: FileView[] = [
  {id: 'fx-chart', filename: 'amount-by-item.png', size: 48_120, extension: '.png', contentType: 'image/png', source: 'delivery', path: '/home/ubuntu/amount-by-item.png'},
  {id: 'fx-archive', filename: 'raw-exports.zip', size: 2_310_442, extension: '.zip', contentType: 'application/zip', source: 'delivery', path: '/home/ubuntu/raw-exports.zip'},
]

export const deliveryStates = {
  /** 真实 */
  single: item(e2Delivery, 'delivery'),
  /** 合成：在真实交付上追加两个文件 */
  multiple: {...deliveredReport, files: [...deliveredReport.files, ...extraFiles], note: 'report.json、分项图表与原始导出，共 3 个文件'},
  /** 合成：压缩包不能在页面预览 */
  previewUnavailable: {...deliveredReport, files: [extraFiles[1]], note: '原始导出打包为 raw-exports.zip'},
}

// ==================== 上下文环 ====================

export const usageStates: Record<'none' | 'normal' | 'near' | 'compacted' | 'postCompactEstimate', UsageView> = {
  none: {session: {prompt: null, completion: null, total: null}, context: null, watermarkRatio: 0.75, compactions: 0},
  /** 真实：E2 最后一次请求 */
  normal: e2Delivery.usage,
  /** 合成：接近 75% 水位 */
  near: {...e2Delivery.usage, context: {usedTokens: 46_812, windowTokens: 65_536, lastTurnTokens: 47_390}},
  /** 合成：压缩一次之后 */
  compacted: {...e2Delivery.usage, context: {usedTokens: 11_402, windowTokens: 65_536, lastTurnTokens: 11_980}, compactions: 1},
  postCompactEstimate: {
    ...e2Delivery.usage,
    context: {
      usedTokens: 8_200,
      windowTokens: 65_536,
      lastTurnTokens: 11_980,
      postCompactEstimate: true,
    },
    lastCompaction: {seq: 120, trigger: 'manual', beforeTotal: 15_226, afterTotal: 8_200},
    compactions: 2,
  },
}

// ==================== 会话列表项 ====================

function session(id: string, title: string, status: string, at: string): Session {
  return {session_id: id, title, status: status as Session['status'], latest_message: '', latest_message_at: at, unread_message_count: 0}
}

const today = '2026-09-28T09:43:08'

export const sessionItemStates = {
  running: session('fx-s1', planWalkthrough.title, 'running', today),
  /** 合成：执行器尚未接管；徽标与运行中相同 */
  pending: session('fx-s7', '等待执行器接管的新任务', 'pending', today),
  waiting: session('fx-s2', e3Waiting.title, 'waiting', today),
  failed: session('fx-s3', '统计 logs/ 下所有构建日志的失败原因', 'failed', today),
  interrupted: session('fx-s6', '整理本周构建日志并写出失败原因', 'interrupted', today),
  completed: session('fx-s4', e2Delivery.title, 'completed', today),
  /** 合成：用户停止；与已完成一样不显示徽标 */
  cancelled: session('fx-s8', '统计 logs/ 下所有构建日志的失败原因', 'cancelled', today),
  longTitle: session('fx-s5', '把 inventory.csv 按 item 分组统计 amount 的总和、平均值与最大值，生成带图表的 Markdown 报告，并把报告和图表一起打包交付给我下载', 'completed', '2026-09-26T21:10:44'),
}

// ==================== 本地项目（合成） ====================

export const projectPickerStates = {
  unselected: null as import('@/lib/session-view').ProjectView | null,
  selected: {
    id: 'catalog-ray-sample',
    path: '/Users/demo/ray-sample',
    name: 'ray-sample',
    available: true,
    reason: null,
  },
  unavailable: {
    id: 'catalog-moved-away',
    path: '/Users/demo/moved-away',
    name: 'moved-away',
    available: false,
    reason: '路径不存在',
  },
}

export const projectWorkbenchNotes = {
  treeEmpty: '项目目录为空，或当前层没有可列出的文件。',
  notGit: '这个项目不是 Git 仓库',
  changesClean: '工作区干净，没有改动',
}

// ==================== 设置列表项（合成：开发库当前没有配置 MCP 与 A2A） ====================

export const settingsListStates: {mcp: ListMCPServerItem[]; a2a: ListA2AServerItem[]} = {
  mcp: [
    {
      server_name: 'qiniu',
      enabled: true,
      transport: 'stdio',
      tools: ['upload_file', 'list_buckets', 'list_objects', 'get_object_url', 'delete_object'],
      connection_status: 'connected',
      error: null,
    },
    {
      server_name: 'acceptance',
      enabled: false,
      transport: 'streamable_http',
      tools: [],
      connection_status: 'disabled',
      error: null,
    },
    {
      server_name: 'weather',
      enabled: true,
      transport: 'streamable_http',
      tools: [],
      connection_status: 'unavailable',
      error: '连接 http://host.docker.internal:8931/mcp 超时（10 秒）',
    },
  ],
  a2a: [
    {
      id: 'fx-a2a-1',
      base_url: 'http://host.docker.internal:9999',
      name: 'RayAgent 验收 Agent',
      description: '回显输入并按要求故意失败，用于协议验收。',
      input_modes: ['text'],
      output_modes: ['text'],
      streaming: true,
      push_notifications: false,
      enabled: true,
      connection_status: 'connected',
      error: null,
    },
    {
      id: 'fx-a2a-2',
      base_url: 'https://example.com/weather-agent',
      name: '',
      description: '',
      input_modes: [],
      output_modes: [],
      streaming: false,
      push_notifications: false,
      enabled: true,
      connection_status: 'unavailable',
      error: '读取 Agent Card 失败：HTTP 404',
    },
  ],
}

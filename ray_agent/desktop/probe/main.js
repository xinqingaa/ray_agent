const { invoke } = window.__TAURI__.core;

const STATES = {
  starting: '启动中',
  ready: '已就绪',
  failed: '启动失败',
  exited: '已退出',
  stopped: '已停止',
};
const CAPABILITIES = {
  file_access: '文件访问',
  local_command: '本机命令',
  browser: '浏览器',
  full_text_search: '全文检索',
  semantic_index: '语义索引',
  ocr: 'OCR',
  remote_control: '远程控制',
};
const MESSAGE = '请只回复一句话，说明你已收到这条消息。';
const REPLY_TIMEOUT_MS = 120000;
const $ = (id) => document.getElementById(id);

let core = null;
let chatting = false;

function describeHealth(health) {
  if (!health) return '—';
  if (health.error) return `不可达：${health.error}`;
  const status = health.body?.data;
  const parts = (status?.services ?? []).map((item) => `${item.service} ${item.status === 'ok' ? '正常' : '异常'}`);
  return `HTTP ${health.http_status}${status ? (status.healthy ? ' · 依赖正常' : ' · 依赖异常') : ''}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
}

function renderCapabilities(capabilities) {
  const list = $('capabilities');
  list.replaceChildren(...capabilities.map((item) => {
    const entry = document.createElement('li');
    entry.dataset.state = item.state;
    const label = CAPABILITIES[item.capability] ?? item.capability;
    entry.textContent = item.state === 'available'
      ? `${label} · 可用${item.detail ? `（${item.detail}）` : ''}`
      : `${label} · 不可用：${item.reason}${item.detail ? `（${item.detail}）` : ''}`;
    return entry;
  }));
}

function render() {
  const state = $('state');
  const ready = core.ready;
  state.textContent = STATES[core.state] ?? '未启动';
  state.dataset.state = core.state || 'idle';
  $('port').textContent = ready?.port ?? '—';
  $('pid').textContent = core.pid ?? '—';
  $('startup').textContent = core.startup_ms != null ? `${(core.startup_ms / 1000).toFixed(1)} s` : '—';
  $('protocol').textContent = ready ? `协议 ${ready.protocol_version} · 事件 ${ready.event_version}` : '—';
  $('instance').textContent = ready?.instance.instance_id ?? '—';
  const build = ready?.build;
  $('build').textContent = build?.revision ? `${build.revision.slice(0, 7)}${build.dirty ? ' · 含未提交改动' : ''}` : '—';
  $('health').textContent = describeHealth(core.health);
  renderCapabilities(ready?.capabilities ?? []);
  $('detail').textContent = core.detail ?? '';
  const logs = $('logs');
  const atBottom = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 8;
  logs.textContent = core.logs.join('\n');
  if (atBottom) logs.scrollTop = logs.scrollHeight;
  $('run').disabled = core.state !== 'ready' || chatting;
}

async function refresh() {
  try {
    core = await invoke('core_status');
    render();
  } catch (error) {
    $('detail').textContent = `读取宿主状态失败：${error}`;
  }
}

async function api(path, init = {}) {
  const response = await fetch(`http://127.0.0.1:${core.ready.port}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body.data;
}

async function runConversation() {
  chatting = true;
  render();
  const status = $('chat-state');
  const reply = $('reply');
  reply.hidden = true;
  try {
    status.textContent = '创建会话';
    const { session_id: sessionId } = await api('/sessions', { method: 'POST', body: '{}' });
    status.textContent = '等待模型回复';
    await api(`/sessions/${sessionId}/chat`, { method: 'POST', body: JSON.stringify({ message: MESSAGE }) });
    const deadline = Date.now() + REPLY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const detail = await api(`/sessions/${sessionId}`);
      const run = detail.runs.at(-1);
      if (run && !['running', 'waiting'].includes(run.status)) {
        const answers = detail.events.filter((item) => item.event === 'message' && item.data.role === 'assistant');
        const failure = detail.events.findLast((item) => item.event === 'error');
        status.textContent = `运行 ${run.status} · 会话 ${sessionId}`;
        reply.textContent = answers.at(-1)?.data.message ?? failure?.data.error ?? '没有助手回复';
        reply.hidden = false;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    status.textContent = '等待回复超时';
  } catch (error) {
    status.textContent = `会话失败：${error.message}`;
  } finally {
    chatting = false;
    render();
  }
}

$('run').addEventListener('click', runConversation);
refresh();
setInterval(refresh, 1000);

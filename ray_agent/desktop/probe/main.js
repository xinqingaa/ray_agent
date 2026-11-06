const { invoke } = window.__TAURI__.core;

const STATES = {
  starting: '启动中',
  ready: '已就绪',
  failed: '启动失败',
  exited: '已退出',
  stopped: '已停止',
};
const MESSAGE = '请只回复一句话，说明你已收到这条消息。';
const REPLY_TIMEOUT_MS = 120000;
const $ = (id) => document.getElementById(id);

let core = null;
let chatting = false;

function describeHealth(health) {
  if (!health) return '—';
  if (health.error) return `不可达：${health.error}`;
  const services = Array.isArray(health.body?.data) ? health.body.data : [];
  const parts = services.map((item) => `${item.service} ${item.status === 'ok' ? '正常' : '异常'}`);
  return `HTTP ${health.http_status}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
}

function render() {
  const state = $('state');
  state.textContent = STATES[core.state] ?? '未启动';
  state.dataset.state = core.state || 'idle';
  $('port').textContent = core.port ?? '—';
  $('pid').textContent = core.pid ?? '—';
  $('startup').textContent = core.startup_ms != null ? `${(core.startup_ms / 1000).toFixed(1)} s` : '—';
  const build = core.build;
  $('build').textContent = build?.revision ? `${build.revision.slice(0, 7)}${build.dirty ? ' · 含未提交改动' : ''}` : '—';
  $('health').textContent = describeHealth(core.health);
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
  const response = await fetch(`http://127.0.0.1:${core.port}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  if (!response.ok || body.code !== 200) throw new Error(body.msg || `HTTP ${response.status}`);
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

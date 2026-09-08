#!/usr/bin/env bash
# 本地 MCP/A2A 验收夹具。不写仓库 config.yaml，不代替 pytest。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_DIR="${ROOT}/tmp/protocol-fixtures"
LOG_FILE="${STATE_DIR}/acceptance.jsonl"
MCP_PID_FILE="${STATE_DIR}/mcp.pid"
A2A_PID_FILE="${STATE_DIR}/a2a.pid"
MCP_PORT=9911
A2A_PORT=9912
FIXTURE="tests/protocols/fixture_server.py"

usage() {
  cat <<'EOF'
用法（在 ray_agent/api/ 执行）：
  ./scripts/run-protocol-fixtures.sh start          # Compose / Docker Desktop
  ./scripts/run-protocol-fixtures.sh start --local  # API 跑在宿主机
  ./scripts/run-protocol-fixtures.sh status
  ./scripts/run-protocol-fixtures.sh stop
EOF
}

port_listening() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

pid_running() {
  [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null
}

wait_for_port() {
  local port="$1" name="$2"
  local i
  for i in $(seq 1 50); do
    if port_listening "$port"; then
      return 0
    fi
    sleep 0.1
  done
  echo "${name} 未在端口 ${port} 就绪，日志见 ${STATE_DIR}/${name}.log" >&2
  return 1
}

print_settings() {
  local mcp_url="$1" a2a_url="$2"
  cat <<EOF

本机探测：
  MCP  http://127.0.0.1:${MCP_PORT}/mcp
  A2A  http://127.0.0.1:${A2A_PORT}/.well-known/agent-card.json

首页右上角齿轮 →「MCP 服务器」添加：
{"mcpServers":{"acceptance":{"transport":"streamable_http","url":"${mcp_url}"}}}

「A2A Agent 配置」添加：
  ${a2a_url}

不要改仓库里的 config.yaml。会话详情页没有设置入口。做完后删除这两项设置，再执行 stop。
调用日志：${LOG_FILE}
EOF
}

cmd="${1:-}"
mode="docker"
if [[ "${2:-}" == "--local" ]]; then
  mode="local"
elif [[ -n "${2:-}" ]]; then
  echo "未知参数: $2" >&2
  usage >&2
  exit 2
fi

if [[ "$mode" == "local" ]]; then
  mcp_url="http://127.0.0.1:${MCP_PORT}/mcp"
  a2a_public="http://127.0.0.1:${A2A_PORT}"
else
  mcp_url="http://host.docker.internal:${MCP_PORT}/mcp"
  a2a_public="http://host.docker.internal:${A2A_PORT}"
fi

case "$cmd" in
  start)
    mkdir -p "$STATE_DIR"
    if port_listening "$MCP_PORT" && port_listening "$A2A_PORT"; then
      echo "9911 与 9912 已在监听，未重复启动。"
      print_settings "$mcp_url" "$a2a_public"
      exit 0
    fi
    if port_listening "$MCP_PORT" || port_listening "$A2A_PORT"; then
      echo "端口被部分占用：MCP $(port_listening "$MCP_PORT" && echo 占用 || echo 空闲)，A2A $(port_listening "$A2A_PORT" && echo 占用 || echo 空闲)。先 stop 或自行结束占用进程。" >&2
      exit 1
    fi
    export RAY_PROTOCOL_LOG="$LOG_FILE"
    : >"$LOG_FILE"
    nohup uv run --locked python "$FIXTURE" mcp --port "$MCP_PORT" \
      >"${STATE_DIR}/mcp.log" 2>&1 &
    echo $! >"$MCP_PID_FILE"
    nohup uv run --locked python "$FIXTURE" a2a --port "$A2A_PORT" --public-url "$a2a_public" \
      >"${STATE_DIR}/a2a.log" 2>&1 &
    echo $! >"$A2A_PID_FILE"
    disown -a 2>/dev/null || true
    wait_for_port "$MCP_PORT" mcp
    wait_for_port "$A2A_PORT" a2a
    echo "验收服务已启动（${mode}）。"
    print_settings "$mcp_url" "$a2a_public"
    echo "进程已脱离当前终端，用 status 查看，用 stop 结束。"
    ;;
  status)
    mkdir -p "$STATE_DIR"
    echo "MCP :${MCP_PORT}  $(port_listening "$MCP_PORT" && echo 监听中 || echo 未监听)  pid=$( [[ -f "$MCP_PID_FILE" ]] && cat "$MCP_PID_FILE" || echo - )"
    echo "A2A :${A2A_PORT}  $(port_listening "$A2A_PORT" && echo 监听中 || echo 未监听)  pid=$( [[ -f "$A2A_PID_FILE" ]] && cat "$A2A_PID_FILE" || echo - )"
    if port_listening "$MCP_PORT" && port_listening "$A2A_PORT"; then
      print_settings "$mcp_url" "$a2a_public"
    fi
    ;;
  stop)
    mkdir -p "$STATE_DIR"
    for pid_file in "$MCP_PID_FILE" "$A2A_PID_FILE"; do
      if pid_running "$pid_file"; then
        kill "$(cat "$pid_file")" 2>/dev/null || true
      fi
      rm -f "$pid_file"
    done
    if command -v pkill >/dev/null; then
      pkill -f "fixture_server.py mcp --port ${MCP_PORT}" 2>/dev/null || true
      pkill -f "fixture_server.py a2a --port ${A2A_PORT}" 2>/dev/null || true
    fi
    sleep 0.3
    if port_listening "$MCP_PORT" || port_listening "$A2A_PORT"; then
      echo "仍有端口占用：MCP $(port_listening "$MCP_PORT" && echo 占用 || echo 空闲)，A2A $(port_listening "$A2A_PORT" && echo 占用 || echo 空闲)。" >&2
      exit 1
    fi
    echo "验收服务已停止。"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

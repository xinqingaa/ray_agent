#!/usr/bin/env bash
# 在仓库根目录按 pnpm 锁文件同步界面与宿主依赖，然后启动桌面开发构建。
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "需要 Node.js 22 与 pnpm。说明见 ray_agent/desktop/README.md" >&2
  exit 1
fi

echo "→ 同步界面依赖 (ray_agent/ui)"
pnpm --dir "$root/ray_agent/ui" install --frozen-lockfile

echo "→ 同步宿主依赖 (ray_agent/desktop)"
pnpm --dir "$root/ray_agent/desktop" install --frozen-lockfile

echo "→ 启动桌面开发构建"
exec pnpm --dir "$root/ray_agent/desktop" run dev

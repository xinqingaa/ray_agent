# RayAgent 桌面宿主开发指南

`ray_agent/desktop` 是 Tauri 2 原生宿主：随包分发 PyInstaller 冻结的 Python 核心，负责拉起、握手、健康检查与退出回收。当前处于 M0 宿主探针阶段，窗口只有一个最小探针页面，用来观察核心状态并触发一次普通会话；共享界面、钥匙串与正式打包在 P2 接入，本指南随之扩展为桌面开发指南。实施范围与进度见[实施工作包](../../docs/plan/implementation.md#实施状态)，代码入口见[代码地图](../../docs/code-map.md#桌面宿主与核心打包)。

以下命令在 `ray_agent/desktop/` 执行，另有说明的除外。

## 环境准备

- macOS Apple Silicon，Xcode 或 Command Line Tools。
- Rust stable（`aarch64-apple-darwin`），用 rustup 安装：

  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
  . "$HOME/.cargo/env"
  ```

- Node 22 与 npm。Tauri CLI 使用 npm 包 `@tauri-apps/cli`，版本由 [package.json](package.json) 与 `package-lock.json` 锁定，不另装 `cargo tauri`：

  ```bash
  npm ci
  npx tauri --version
  ```

- uv，以及 API 的开发依赖（含 PyInstaller），见 [API 开发指南](../api/README.md#冻结桌面核心)。

## 冻结核心

宿主把 `../api/dist/rayagent-core/` 整个 onedir 目录作为资源打进应用，入口文件离开 `_internal/` 无法运行。构建宿主前先冻结核心：

```bash
cd ../api
uv sync --locked --group dev
uv run --locked pyinstaller --noconfirm --clean rayagent-core.spec
```

`npx tauri build` 会在构建前自动重新冻结；`npx tauri dev` 直接使用已有产物，核心代码改动后需要手动重新冻结。

## 运行探针

核心目前仍依赖 PostgreSQL 与 Redis（P1 移除）。在产品目录 `ray_agent/` 下只拉起这两项服务，并把端口发布到本机回环：

```bash
docker compose -f docker-compose.yml -f desktop/dev/services.compose.yml up -d manus-postgres manus-redis
docker exec manus-postgres sh -c 'createdb -U "$POSTGRES_USER" rayagent_probe'
```

探针使用独立的 `rayagent_probe` 数据库与 Redis 第 1 号库，不读写 Web 版的 `manus` 库。回到本目录，把 [dev/.env.core.example](dev/.env.core.example) 复制为 `dev/.env.core`（已被 Git 忽略）并按 `ray_agent/.env` 的数据库用户名与密码调整。宿主从 `RAYAGENT_CORE_ENV` 读取要叠加的环境文件列表（冒号分隔，后者覆盖前者），模型地址与密钥沿用 `ray_agent/.env`：

```bash
RAYAGENT_CORE_ENV="$PWD/../.env:$PWD/dev/.env.core" npx tauri dev
```

探针页面由 Tauri CLI 提供，直接运行 `target/debug/rayagent-desktop` 时窗口为空白，但宿主照常拉起核心。窗口显示核心状态、端口、启动到握手的耗时、协议与事件版本、实例身份、构建身份、健康检查和能力声明；就绪后点“发起一次会话”，页面创建会话、发送一条消息并显示模型回复。终端里 `[core]` 前缀是核心日志，`[host]` 前缀是宿主日志。没有设置 `RAYAGENT_CORE_ENV` 或服务不可达时，核心在初始化阶段失败，页面显示启动失败与日志尾部。

探针数据写在 `~/Library/Application Support/com.rayagent.desktop/probe-core/`（配置副本、附件与 skill 目录），可以直接删除；P2 起的正式数据根不沿用该目录。

## 构建应用

```bash
npx tauri build --bundles app
```

产物为 `target/release/bundle/macos/RayAgent.app`，只做本机 ad-hoc 签名，不作为交付物。onedir 位于 `RayAgent.app/Contents/Resources/rayagent-core/`。从终端运行时可直接带上环境文件：

```bash
RAYAGENT_CORE_ENV="$PWD/../.env:$PWD/dev/.env.core" target/release/bundle/macos/RayAgent.app/Contents/MacOS/rayagent-desktop
```

## 宿主与核心的约定

- 宿主以资源目录中的 `rayagent-core/rayagent-core` 为可执行文件、该目录为工作目录，在独立进程组中启动核心，并移除可能改变冻结解释器或动态库查找的 `PYTHON*`、`VIRTUAL_ENV` 与 `DYLD_*` 变量。
- 启动参数与握手都是[契约](../contracts/README.md)类型，宿主的对应类型在 `src/contract.rs`。
- 启动参数（`CoreLaunch`）是写入核心 stdin 的一行 JSON：`data_dir` 为可写数据目录，`env_files` 为要叠加的环境文件，`env` 为最后叠加的显式环境。参数和其中的凭据都不经命令行传递；写完后宿主保持 stdin 打开。
- 核心在 `127.0.0.1` 上监听系统分配的端口，完成数据库迁移与初始化后向 stdout 写一行握手（`CoreHandshake`）：`event` 为 `ready` 时带协议与事件版本、实例身份（`instance_id`、`pid`、启动时间）、构建身份、存储版本（桌面业务库建立前为空）、能力声明与端口，`instance_token` 预留、目前为空；为 `failed` 时带结构化错误。宿主按类型解析，不符合契约的握手按启动失败处理；协议版本目前只显示，不做兼容核对。stdout 只用于握手，日志写 stderr。
- 握手后宿主请求一次 `/api/status`，它返回与握手相同的身份与能力，另带依赖服务检查与 `healthy`。
- 退出时宿主关闭核心 stdin，核心随即正常停止；超过等待期限再发送 SIGTERM，最后对整个进程组发送 SIGKILL 并回收首进程。宿主被强制结束时，核心同样因 stdin 关闭而自行退出。等待期限见[运行参数与限额](../../docs/limits.md#桌面宿主与核心进程)。

## 检查

- 契约对齐：在本目录运行 `cargo test`。它内嵌 `../contracts/generated` 中的 `core.schema.json` 与样例，核对宿主的启动参数、握手、能力与错误代码类型和契约的字段、枚举取值一致；契约变化后先按[契约指南](../contracts/README.md)重新生成，再修改宿主类型。
- 启动：页面显示“已就绪”，协议、实例与能力有值，健康检查为 HTTP 200、依赖正常且 postgres、redis 正常。新复制或新构建的核心首次启动要等 macOS 逐个检查原生库，握手明显慢于再次启动；这不是失败，以页面状态为准。
- 会话：“发起一次会话”得到助手回复，运行状态为 `completed`。
- 退出：关闭窗口或 Cmd+Q 后，确认没有残留进程：

  ```bash
  pgrep -fl rayagent-core || echo "no core left"
  ```

  也可以在宿主运行时用 `kill -9 <宿主 PID>` 模拟宿主崩溃，核心应在数秒内自行退出。

这些检查只覆盖宿主拉起、通信、契约对齐和退出；业务行为仍按 [API 开发指南](../api/README.md) 的测试入口检查。

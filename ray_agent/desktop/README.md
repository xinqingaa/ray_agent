# RayAgent 桌面开发指南

`ray_agent/desktop` 是 Tauri 2 原生宿主：窗口加载 `ray_agent/ui` 的共享界面，宿主拉起 Python 核心、核对握手、把接口地址与实例令牌交给界面，并负责保存文件、打开外部链接与退出流程。正式包随包分发 PyInstaller 冻结的核心。模型连接、数据位置与运行检查见[运行指南](../README.md)，实施范围见[实施工作包](../../docs/plan/implementation.md#实施状态)，代码入口见[代码地图](../../docs/code-map.md#桌面宿主与核心打包)。

以下命令在 `ray_agent/desktop/` 执行，另有说明的除外。

## 环境准备

- macOS Apple Silicon，Xcode 或 Command Line Tools。
- Rust stable（`aarch64-apple-darwin`），用 rustup 安装：

  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
  . "$HOME/.cargo/env"
  ```

- Node 22 与 npm。Tauri CLI 使用 npm 包 `@tauri-apps/cli`，版本由 [package.json](package.json) 与 `package-lock.json` 锁定，不另装 `cargo tauri`。宿主与界面各自安装依赖：

  ```bash
  npm ci
  npm --prefix ../ui ci
  ```

- uv 与 API 的开发依赖（含 PyInstaller），见 [API 开发指南](../api/README.md#依赖与配置)。

## 开发运行

```bash
npm run dev
```

它先在 `../ui` 启动 Vite 开发服务器，再编译并运行宿主。开发构建直接运行源码核心（`../api/.venv` 的解释器加 `sidecar.py`），改了核心代码重启宿主即可，不需要重新冻结；缺少虚拟环境时界面显示启动失败与原因。界面改动由 Vite 热更新。

开发构建的数据根是应用数据目录下的 `dev-core/`，与正式包的 `core/` 分开；`RAYAGENT_CORE_DATA_DIR` 可另指数据根，多个宿主同时运行或做检查时用它隔开实例锁：

```bash
RAYAGENT_CORE_DATA_DIR=/tmp/rayagent-dev npm run dev
```

终端里 `[core]` 前缀是核心日志，`[host]` 前缀是宿主日志。界面只在宿主窗口中工作；在普通浏览器打开开发服务器地址只显示“请从 RayAgent 应用打开”。

## 构建内部包（Apple Silicon）

正式内部包命令（在本目录，需已 `source "$HOME/.cargo/env"`）：

```bash
npm ci
npm --prefix ../ui ci
npm run build
# 等价：npx tauri build --bundles app --config tauri.bundle.json
```

构建叠加 [tauri.bundle.json](tauri.bundle.json)：先写 UI 构建身份并构建静态产物（`../ui/dist`），再按 [rayagent-core.spec](../api/rayagent-core.spec) 冻结核心（`../api/dist/rayagent-core/`，含 LanceDB／ONNX／OCR／OpenCV／Playwright 等隐式导入与数据文件），然后把整个 onedir 作为资源打进应用；入口离开 `_internal/` 无法运行。产物为 `target/release/bundle/macos/RayAgent.app`，`bundle.macOS.signingIdentity` 为 `-`（仅 ad-hoc，不公证），只供内部使用，不作为公开分发。

产物内含：UI／核心 `build-manifest.json`、`resources/package_identity.json`（协议与 schema 兼容范围）、`resources/component_manifest.json`、`resources/THIRD_PARTY_NOTICES.md`。`build/`、`dist/`、`target/` 已由根 `.gitignore` 排除，不提交。

核对签名与从终端查看日志：

```bash
codesign --verify --deep --strict target/release/bundle/macos/RayAgent.app
target/release/bundle/macos/RayAgent.app/Contents/MacOS/rayagent-desktop
```

新冻结或新复制的散装 onedir 首次启动到握手约 15–40 秒（macOS 逐个检查原生库），再次约 1–2 秒；ad-hoc 签名的 `.app` 整包复制到新位置后首启仍约 1–2 秒。宿主不按热启动设握手期限，以界面“启动中”为准。带隔离属性（`com.apple.quarantine`）的首次打开需在系统设置中手动允许；另一台未装开发环境的 Mac 上的完整检查见实施状态的「待用户处理」。

## 宿主与核心的约定

- 正式包以资源目录中的 `rayagent-core/rayagent-core` 为可执行文件，开发构建以源码核心为入口，两者都不依赖工作目录。核心在独立进程组中启动，宿主移除可能改变冻结解释器或动态库查找的 `PYTHON*`、`VIRTUAL_ENV` 与 `DYLD_*` 变量。
- 启动参数与握手都是[契约](../contracts/README.md)类型，宿主的对应类型在 `src/contract.rs`。启动参数（`CoreLaunch`）是写入核心 stdin 的一行 JSON，只有数据根 `data_dir`、预留的显式环境 `env` 与宿主密钥 `host_secret`（每次启动随机生成，只在宿主内存与核心内存中，不进环境变量，也不交给界面；宿主选择文件夹或显示位置时带它调用核心的 `/api/host/` 接口，见下文宿主命令），不经命令行传递；模型连接由核心自己读取用户配置文件。写完后宿主保持 stdin 打开。
- 核心在 `127.0.0.1` 的系统分配端口上监听，就绪后向 stdout 写一行握手（`CoreHandshake`），带协议与事件版本、实例与构建身份、存储版本、能力声明、端口和本次生成的实例令牌；失败时带结构化错误。stdout 只用于握手，日志写 stderr。
- 宿主只接受协议与事件版本都与自身一致的核心，不一致时状态为 `incompatible`，界面显示版本不匹配。版本一致时带令牌请求一次 `/api/status` 作为健康检查。

## 界面与宿主的接口

界面经 Tauri 命令访问宿主，不直接使用插件。窗口只授予 `core:default` 能力；CSP 只允许连接、加载图片与媒体、嵌入预览时访问 `127.0.0.1`，不允许内联脚本。

| 命令或事件 | 用途 |
|---|---|
| `core_connection` | 读取核心状态（`starting`、`ready`、`failed`、`incompatible`、`exited`、`stopped`）；就绪时给出接口地址与实例令牌，失败时给出原因与核心日志尾部 |
| `restart_core` | 回收旧进程后重新拉起核心 |
| `open_model_config` | 模型连接配置文件不存在时按示例创建，再用系统文本编辑器打开 |
| `open_external` | 用系统浏览器打开 http、https 或 mailto 链接，其他协议拒绝 |
| `save_resource` | 让用户选择位置后，由宿主带令牌下载核心 `/api/` 下的资源；临时文件写完再改名，取消时不留文件 |
| `save_bytes` | 保存界面已持有的内容，文件名放在 `x-filename` 请求头 |
| `select_folder_grant` | 参数 `purpose` 取 `open_workspace`、`default_location` 或 `relocate_workspace`（只决定选择器标题，其他取值拒绝）：弹出系统文件夹选择器，取消返回空；选中后由宿主带实例令牌与宿主密钥向核心的 `/api/host/folder-grants` 登记路径，只把一次性 `grant_id` 与文件夹显示名交给界面。宿主密钥与桌面路径不经过界面，凭证的用法与期限见 [API 开发指南](../api/README.md#工作区与文件夹授权) |
| `reveal_in_file_manager` | 参数 `root_id` 与根内 `relative_path`（空表示根目录本身）：宿主带实例令牌与宿主密钥向核心的 `/api/host/roots/{root_id}/resolve` 取目标的绝对路径（核心按根身份与路径规则核对，不越出根，拒绝保留目录与凭据文件，目标须存在），再在系统文件管理器中显示：macOS 执行 `open -R`，其他平台走打开插件的显示文件。界面不接触也不能指定绝对路径；`root_id` 只接受核心签发的字符 |
| `rayagent://quit-requested`、`quit_ack`、`quit_confirm` | 退出确认，见下文 |

宿主命令失败时返回字符串，界面在 [platform.ts](../ui/src/lib/platform.ts) 统一转为 `Error`。实例令牌只经 `core_connection` 交给界面，由界面放进请求头，不进 URL。图片、PDF 与网页预览由 WebView 按 URL 直接加载，界面先为该资源申请短期票据再拼进地址；票据的范围与有效期见 [API 开发指南](../api/README.md#启动与接口)。界面中的跨源链接一律交给 `open_external`，WebView 本身不打开外部页面。

## 关闭与退出

- 关闭主窗口只隐藏窗口，核心与运行继续；点程序坞图标重新显示。
- Cmd+Q 或菜单退出时，核心已就绪则宿主向界面发出 `rayagent://quit-requested`。界面先回应 `quit_ack`，没有活动任务时直接 `quit_confirm`，否则弹出确认；界面在期限内没有回应时宿主直接退出，避免界面卡住后无法退出。macOS 预置的退出菜单项直接终止应用、宿主收不到退出请求，所以应用菜单里的退出是宿主自己的菜单项。
- 程序坞菜单退出、注销与关机由系统直接终止应用，不经过界面确认；宿主仍走下面的停止流程，活动运行记为中断。
- 退出、确认退出与 SIGTERM、SIGINT、SIGHUP 走同一条停止流程：宿主关闭核心 stdin，核心停止受理新工作，先结束仍开着的事件流，再结束活动运行后退出；超过等待期限再发 SIGTERM，最后对整个进程组发送 SIGKILL 并回收首进程。宿主被强制结束时，核心同样因 stdin 关闭而自行退出。期限见[运行参数与限额](../../docs/limits.md#桌面宿主与核心进程)。

## 检查

- 契约对齐与宿主单元测试：在本目录运行 `cargo test`。它内嵌 `../contracts/generated` 中的 `core.schema.json` 与样例，核对启动参数、握手、能力与错误代码类型和契约一致，并检查协议与事件版本常量与样例相同；契约变化后先按[契约指南](../contracts/README.md)重新生成，再修改宿主类型。
- 选择文件夹与显示位置：`cargo test` 覆盖选择器用途的封闭取值、核心响应的解析（只保留凭证与显示名）、根身份只允许核心签发的字符、解析出的位置必须是绝对路径；原生选择器、取消路径与登记失败的提示只能在宿主窗口里走查，步骤见[运行指南的运行检查](../README.md#运行检查)。`reveal_in_file_manager` 在 macOS 以外的平台走打开插件的显示文件分支，该分支没有编译验证，也没有在 Windows 或 Linux 上运行过。
- 启动与界面：开发运行或打开内部包，界面进入首页；设置页能看到模型连接状态，按[运行指南的运行检查](../README.md#运行检查)完成独立对话、导航与草稿检查。
- 退出：有活动任务时 Cmd+Q 先确认；退出后确认没有残留进程：

  ```bash
  pgrep -fl rayagent-core || echo "no core left"
  ```

  也可以在宿主运行时用 `kill -9 <宿主 PID>` 模拟宿主崩溃，核心应在数秒内自行退出。

这些检查覆盖宿主拉起、通信、契约对齐、界面接入和退出；业务行为按 [API](../api/README.md) 与 [UI](../ui/README.md) 指南的检查入口验证。

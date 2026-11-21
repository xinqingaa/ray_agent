# RayAgent 桌面开发指南

`ray_agent/desktop` 是 Tauri 2 原生宿主：窗口加载 `ray_agent/ui` 的共享界面，宿主拉起 Python 核心、核对握手、把接口地址与实例令牌交给界面，并负责保存文件、打开外部链接与退出流程。正式包随包分发 PyInstaller 冻结的核心。模型连接、数据位置与运行检查见[运行指南](../README.md)，实施范围见[实施工作包](../../docs/plan/implementation.md#实施状态)，代码入口见[代码地图](../../docs/code-map.md#桌面宿主与核心打包)。

以下命令在 `ray_agent/desktop/` 执行，另有说明的除外。

## 环境准备

- macOS Apple Silicon，Xcode 或 Command Line Tools，以及构建本机语音程序所需的 CMake。
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

它先准备本机语音程序并启动 `../ui` 的 Vite 开发服务器，再编译和运行宿主。首次构建下载锁定的语音源码和许可，后续从构建缓存增量编译。开发构建直接运行源码核心（`../api/.venv` 的解释器加 `sidecar.py`），改了核心代码重启宿主即可，不需要重新冻结；缺少虚拟环境时界面显示启动失败与原因。界面改动由 Vite 热更新。

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

构建叠加 [tauri.bundle.json](tauri.bundle.json)：先写 UI 构建身份并构建静态产物（`../ui/dist`），再按 [rayagent-core.spec](../api/rayagent-core.spec) 冻结核心（`../api/dist/rayagent-core/`，含 LanceDB／ONNX／OCR／OpenCV／Playwright 等隐式导入与数据文件），构建前还按固定清单准备正常 CPython 与 Node 工具运行时，再把整个 onedir 作为资源打进应用；入口离开 `_internal/` 无法运行。产物为 `target/release/bundle/macos/RayAgent.app`，`bundle.macOS.signingIdentity` 为 `-`（仅 ad-hoc，不公证），只供内部使用，不作为公开分发。

产物内含：UI／核心 `build-manifest.json`、`resources/package_identity.json`（协议与 schema 兼容范围）、`resources/component_manifest.json`、`resources/tool_runtime_manifest.json`、`tool-runtime-archives/` 与 `resources/THIRD_PARTY_NOTICES.md`。正常工具解释器独立于冻结核心；Node 来自锁定 Playwright 包内的原生解释器，单独作为工具运行时校验并分发，不经 driver CLI 执行脚本。CPython 采用固定的 python-build-standalone 产物。两者均在构建时核对哈希和真实版本，缺失时冻结构建失败；运行时不借用开发机解释器。`build/`、`dist/`、`target/` 已由根 `.gitignore` 排除，不提交。

内置应用的麦克风用途来自 Info.plist，签名时合入录音授权项。本机转写程序和第三方许可随核心分发，语言模型通过运行组件按需安装。签名后的录音与转写走查见[运行指南](../README.md#运行检查)。

核对签名与从终端查看日志：

```bash
codesign --verify --deep --strict target/release/bundle/macos/RayAgent.app
target/release/bundle/macos/RayAgent.app/Contents/MacOS/rayagent-desktop
```

工具解释器以归档随包分发，避免冻结工具重写动态库路径；首次执行时校验并原子展开到数据根 `runtimes/`，实际核对版本后进入工具 PATH。核心库和工具库独立，工具环境默认禁止写字节码，普通 Python 或 Skill 脚本不会修改签名包内的缓存。验证时须从完整包经执行端口读回 Python／Node 实际版本，运行普通脚本、标准库及 Skill 资源，再重复上述验签；只做构建前版本检查或首次验签不足以证明执行后完整性。

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
| `host_preferences`、`set_host_preferences` | 读取与局部更新宿主偏好 `notifyOnFinish`、`confirmBeforeQuit`，见下文「任务通知与偏好」；未知字段拒绝 |
| `notification_permission` | 恒返回 `unsupported`：插件在桌面端恒报告已授权，宿主读不到 macOS 的通知开关，不伪装成 `granted` |
| `set_viewed_session` | 界面报告当前停在哪个会话（`null` 表示不在会话页）；只影响是否跳过通知，不改变任何数据 |
| `data_location` | 返回核心数据根的绝对路径，与宿主启动核心时使用的位置相同，界面不写死路径 |
| `reveal_data_location` | 在系统文件管理器中显示数据根；目录尚未创建（核心还没启动过）时返回原因，不替核心创建目录 |
| `rayagent://open-session` | 宿主事件，载荷为会话 ID。点击任务通知后宿主先显示窗口再发出，界面导航到该会话 |

宿主命令失败时返回字符串，界面在 [platform.ts](../ui/src/lib/platform.ts) 统一转为 `Error`。实例令牌只经 `core_connection` 交给界面，由界面放进请求头，不进 URL。图片、PDF 与网页预览由 WebView 按 URL 直接加载，界面先为该资源申请短期票据再拼进地址；票据的范围与有效期见 [API 开发指南](../api/README.md#启动与接口)。界面中的跨源链接一律交给 `open_external`，WebView 本身不打开外部页面。

宿主把外部文件拖放交给 WebView 的文件事件。各落点复用页面上传入口，由核心按会话或已授权工作区处理。检查入口见[运行指南](../README.md#运行检查)。

## 任务通知与偏好

- 宿主自己订阅核心的会话列表流（`POST /api/sessions/stream`），不占用界面的同源连接，也不受界面当前范围限制。会话状态从活动（等待、运行中、待处理）转为完成、失败或等待用户时，宿主发一条系统通知。用户停止（`cancelled`）与退出导致的中断（`interrupted`）不通知。订阅随核心实例变化重建，断线后按间隔重连；核心重启后清空上一次看到的状态，不把启动扫描结果当成完成。订阅覆盖列表的第一页。
- 有以下情况时不通知：偏好「完成后通知」关闭；窗口聚焦且界面停在该会话上。界面经 `set_viewed_session` 报告当前会话，离开会话页时清空。
- 点击通知：显示并聚焦主窗口，再发出 `rayagent://open-session`，界面导航到该会话（工作区会话的路由由界面规范化）。
- 偏好 `notifyOnFinish`（默认开）、`confirmBeforeQuit`（默认开）保存在应用配置目录下的 `host-preferences.json`，原子写入，由宿主读写。它不放进核心数据根：退出时核心可能已停止，宿主仍要读得到；「清空全部数据」只清核心数据根，不重置这两个开关。文件不存在使用默认值；文件损坏时记录原因并使用默认值，直到下一次保存覆盖它。
- 界面侧通过 [platform.ts](../ui/src/lib/platform.ts) 的 `getHostPreferences()`、`setHostPreferences(patch)` 访问；非桌面环境抛出 `HostUnavailableError`，不伪造默认值；`notificationPermission()` 在非桌面环境返回 `unsupported`，`setViewedSession()` 为空操作。
- 通知权限无法从宿主读取。插件在桌面端恒报告已授权，`notification_permission` 因此返回 `unsupported`；系统关闭了本应用的通知时，宿主无从得知，通知只是不出现。开发构建是未打包的可执行文件，系统把它的通知归属到「终端」，与正式包的应用身份不同，检查时要按实际身份在系统设置中查看。

## 依赖与权限

- 新增 Rust 依赖 `tauri-plugin-notification`（[Cargo.toml](Cargo.toml)）：提供 macOS 系统通知与点击回调。只在 Rust 侧使用，界面不调用插件 API，因此 [default.json](capabilities/default.json) 不需要新增权限，窗口能力仍只有 `core:default`。代价是多一个插件及其 Cargo 依赖（`Cargo.lock` 随之增加若干传递包），且插件在桌面端没有授权查询接口。备选是直接调用系统通知接口（需自己维护绑定与点击回调，工作量与风险更高）；界面侧的 Web 通知需要界面常驻并占用同源连接，窗口隐藏时不可靠，因此不采用。
- 退出确认与文件选择器使用既有的 `tauri-plugin-dialog`，没有新增插件；显示文件使用 `tauri-plugin-opener`。

## 关闭与退出

- 关闭主窗口只隐藏窗口，核心与运行继续；点程序坞图标重新显示。
- Cmd+Q 或菜单退出时，若偏好「退出前确认」开启且核心已就绪，宿主先向核心的 `/api/host/activity` 询问活动运行数，再弹出原生对话框：有活动运行（运行中或等待用户）时列出数量并要求确认，没有时直接退出；无法取得数量时仍提示确认。取消则应用与运行都不受影响。偏好关闭或核心未就绪时直接退出。macOS 预置的退出菜单项直接终止应用、宿主收不到退出请求，所以应用菜单里的退出是宿主自己的菜单项。
- 程序坞菜单退出、注销与关机由系统直接终止应用，不经过确认；宿主仍走下面的停止流程，活动运行记为中断。窗口关闭按钮只隐藏窗口，不进入退出流程，也不确认。
- 退出、确认退出与 SIGTERM、SIGINT、SIGHUP 走同一条停止流程：宿主关闭核心 stdin，核心停止受理新工作，先结束仍开着的事件流，再结束活动运行后退出；超过等待期限再发 SIGTERM，最后对整个进程组发送 SIGKILL 并回收首进程。宿主被强制结束时，核心同样因 stdin 关闭而自行退出。期限见[运行参数与限额](../../docs/limits.md#桌面宿主与核心进程)。

## 检查

- 契约对齐与宿主单元测试：在本目录运行 `cargo test`。它内嵌 `../contracts/generated` 中的 `core.schema.json` 与样例，核对启动参数、握手、能力与错误代码类型和契约一致，并检查协议与事件版本常量与样例相同；契约变化后先按[契约指南](../contracts/README.md)重新生成，再修改宿主类型。
- 选择文件夹与显示位置：`cargo test` 覆盖选择器用途的封闭取值、核心响应的解析（只保留凭证与显示名）、根身份只允许核心签发的字符、解析出的位置必须是绝对路径；原生选择器、取消路径与登记失败的提示只能在宿主窗口里走查，步骤见[运行指南的运行检查](../README.md#运行检查)。`reveal_in_file_manager` 在 macOS 以外的平台走打开插件的显示文件分支，该分支没有编译验证，也没有在 Windows 或 Linux 上运行过。
- 启动与界面：开发运行或打开内部包，界面进入首页；设置页能看到模型连接状态，按[运行指南的运行检查](../README.md#运行检查)完成独立对话、导航与草稿检查。
- 任务通知：在宿主窗口里发起一个需要一段时间的任务，切到其他应用，任务完成后应出现系统通知；窗口聚焦并停在该会话时不应通知。点击通知应显示窗口并打开该会话。关闭偏好后不再通知。这些条目需要在打包或开发的真实窗口中逐项走查；`cargo test` 只覆盖状态转换与偏好读写。
- 退出：有活动任务时 Cmd+Q 先确认，取消后任务继续；偏好关闭后直接退出。退出后确认没有残留进程：

  ```bash
  pgrep -fl rayagent-core || echo "no core left"
  ```

  也可以在宿主运行时用 `kill -9 <宿主 PID>` 模拟宿主崩溃，核心应在数秒内自行退出。

这些检查覆盖宿主拉起、通信、契约对齐、界面接入和退出；业务行为按 [API](../api/README.md) 与 [UI](../ui/README.md) 指南的检查入口验证。

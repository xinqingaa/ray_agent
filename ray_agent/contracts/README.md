# RayAgent 契约指南

`ray_agent/contracts` 保存核心契约的生成结果与生成工具。契约的唯一来源是核心（`ray_agent/api`）中的 Pydantic 模型：HTTP 接口经 FastAPI 导出 OpenAPI，事件联合类型与核心启动协议导出 JSON Schema，UI 的 TypeScript 类型由两者生成，桌面宿主的 Rust 类型用生成的 schema 与样例做对齐检查。`generated/` 下的文件都不手改。跨模块规则见[共享契约](../../docs/plan/shared-contracts.md)，各契约的定义位置与检查入口见[代码地图](../../docs/code-map.md#共享契约)。

以下命令在 `ray_agent/contracts/` 执行，另有说明的除外。

## 契约放在哪一层

| 契约 | 所在层 | 原因 |
|---|---|---|
| 身份类型、相对路径与可访问根 | 领域模型 | 领域服务、仓库、端口与持久化都用它，和 HTTP 无关 |
| 错误代码与结构化错误 | 领域模型；异常在应用层，HTTP 状态映射在接口层 | 长操作的失败与接口错误共用同一结构，领域异常也要声明代码 |
| 长操作与能力声明 | 领域模型；长操作另有毫秒时间的接口视图 | 状态迁移、可取消与可重试由领域规则决定 |
| 执行与平台端口 | 领域外部能力协议，与现有 Sandbox、Browser 协议并列 | 只定义接口与值类型，具体实现属于基础设施 |
| 响应包装、版本、启动参数、握手与状态、事件信封 | 接口 schema | 描述线上格式，只在接口层使用 |

## 生成产物

| 文件 | 来源 | 使用方 |
|---|---|---|
| `generated/openapi.json` | FastAPI 应用对象 | HTTP 接口全集，`openapi.ts` 的输入 |
| `generated/events.schema.json` | 落库事件联合 `SessionEvent` 与 SSE 帧联合 `StreamEvent` | 事件结构的权威说明，`events.ts` 的输入 |
| `generated/core.schema.json` | 启动参数 `CoreLaunch`、握手 `CoreHandshake`、状态 `CoreStatus` | 宿主对齐检查，`core.ts` 的输入 |
| `generated/samples/*.json` | 契约模型构造的样例，每个字段都有取值 | 宿主对齐检查 |
| `generated/openapi.ts` | openapi-typescript | UI 的 HTTP 类型 |
| `generated/events.ts`、`generated/core.ts` | json-schema-to-typescript | UI 的事件、握手与能力类型 |

生成器版本由 [package.json](package.json) 与 `package-lock.json` 锁定。导出不启动服务、不连接数据库；OpenAPI 中的 SSE 接口不描述流内容，事件结构以 `events.schema.json` 为准。

## 生成与检查

先按 [API 开发指南](../api/README.md#依赖与配置)安装 API 的锁定依赖，再安装生成器：

```bash
npm ci
npm run generate   # 由 Pydantic 重新导出 JSON 并生成 TypeScript，写入 generated/
npm run check      # 重新生成并与 generated/ 比对，任何文件过期都以退出码 1 失败
```

`generate` 与 `check` 先在 `../api` 运行 `uv run --locked python scripts/contracts.py`（检查时带 `--check`），再生成 TypeScript。改了契约后提交代码时一并提交 `generated/` 的变化。

各服务的检查入口也覆盖契约：

| 位置 | 命令 | 检查内容 |
|---|---|---|
| `ray_agent/api` | `uv run --locked python -m pytest tests/core/test_contracts.py` | JSON 产物未过期，以及身份、路径、错误、事件、能力、长操作与握手的行为；随 API 全量测试运行 |
| `ray_agent/desktop` | `cargo test` | 宿主类型与 `core.schema.json` 的字段和枚举取值一致，样例往返不丢字段 |
| `ray_agent/ui` | `npm run lint`、`npm run build` | 界面代码按生成类型通过类型检查 |

## 何时重新生成

- 增删或修改路由，或修改任何出现在请求、响应中的模型。
- 修改事件信封、任一事件数据模型，或新增事件类型。
- 修改启动参数、握手、状态、能力、错误代码，或导出脚本里的样例。

生成结果不一致时，`npm run check` 与 API 的契约测试失败；握手、能力或错误代码的变化还会让宿主的 `cargo test` 失败，需要同步修改 Rust 类型。

## 版本

- **协议版本** `PROTOCOL_VERSION`：HTTP、SSE 与启动协议不兼容地变化时递增，例如删除或改义字段、改变类型、移除路由；新增可选字段或新增路由不递增。握手与状态都返回它，宿主据此判断能否继续连接，核对在桌面骨架阶段接入。
- **事件版本** `EVENT_VERSION`：事件结构不兼容地变化时递增；新增字段或事件类型不递增。每条事件的 `data.event_version` 都带上它。
- **存储版本**：桌面业务库建立后由其迁移版本提供；在此之前握手与状态中的 `storage` 为空。
- **构建身份**：沿用 API 的构建清单，`fingerprint` 为空表示未知。

## 后续工作包怎样使用契约

### 新增契约类型

1. 按上表选择层：身份与领域值类型放领域模型，端口放领域外部能力协议，线上格式放接口 schema。身份字段使用已有身份类型（如 `WorkspaceId`、`RootedPath`），需要新身份时先在身份模块登记，不在接口里另起同义字段。
2. 文件位置一律是 `root_id` 加相对路径。相对路径以 `/` 分隔，空串表示根本身，拒绝绝对路径、盘符、反斜杠、空段、`.`、`..` 与控制字符；平台特有的文件名限制由文件 IO 实现判断。
3. 模型被路由使用后会自动进入 OpenAPI；不经 HTTP 的契约（例如原生进程之间的私有 IPC）需要给其他语言使用时，在导出脚本中增加一个 JSON Schema 产物和样例，并在 `scripts/generate.mjs` 中增加对应的 TypeScript 生成。
4. 运行 `npm run generate`，按生成结果修改调用方，再运行上表的检查。

### 新接口的错误

- 失败一律抛应用异常：常用的有 `BadRequestError`、`NotFoundError`、`ConflictError`、`GoneError`，其他代码用 `AppException(ErrorCode.X, 原因)`；不要在路由里手写错误 JSON。HTTP 状态由错误代码决定。
- 冲突来自版本不符时带 `resource_version`（当前版本）和必要的 `details`；只有原样重试不会制造重复副作用时才设 `retryable`，限流或繁忙可以给 `retry_after_ms`，响应同时带 `Retry-After`。结果未知的失败不设 `retryable`，调用方先读回。
- 需要新的错误代码时在 `ErrorCode` 中登记并在接口层映射 HTTP 状态，测试会核对每个代码都有状态；宿主的 `ErrorCode` 同步增加。
- UI 的 `ApiError` 提供 `status`（没有响应时为 0）、`code`、`retryable`、`retryAfterMs`、`resourceVersion` 与 `details`；`rejected` 为真表示核心已明确拒绝，其余失败结果未知。

### 新接口的长操作

- 受理接口先持久保存操作再返回 `OperationView`，其中有 `operation_id`；查询、取消与重试都沿同一身份，并按操作的范围核对来源。
- 状态只用 `queued / running / succeeded / failed / cancelled`。运行中收到取消时记 `cancel_requested_at`，它不是终态；失败必须带结构化错误，成功结果放在 `result`。原操作已完成时取消或重试返回完成结果，不制造另一份副作用。
- 操作被重试或替换时 `generation` 递增；执行端写回结果前核对代次，代次不符的迟到结果不得写回。
- 新的操作类型在 `OperationKind` 中登记；能否重试由类型决定（`retry_supported`）。持久化与路由由使用它的工作包实现，模型进入 OpenAPI 后 UI 自动得到类型。

### 能力与事件

- 能力的实现或可用条件变化时更新能力上报；不可用必须给出原因代码，`recoverable` 由原因决定。新的原因代码在 `UnavailableReason` 中登记，宿主同步。
- 新的领域事件必须有对应的信封类型并加入事件联合，数据模型继承公共元数据；测试会核对每种领域事件都有信封。

## 宿主怎样对齐

`ray_agent/desktop/src/contract.rs` 手写 serde 类型，结构体拒绝未知字段，枚举列出全部取值。`cargo test` 在编译期内嵌 `core.schema.json` 与 `samples/`：样例反序列化后再序列化必须与样例完全一致，结构的字段集合与 schema 的 `properties` 一致，枚举取值与 schema 的 `enum` 一致。握手或能力契约变化后先运行 `npm run generate`，再改 Rust 类型直到 `cargo test` 通过。

## 覆盖边界

过期检查只保证生成结果与 Pydantic 定义一致，不验证接口行为。UI 只在编译期使用生成类型，运行时不校验响应；宿主只对齐启动参数、握手与能力相关类型。其余手写的前端接口类型由修改对应接口的工作包替换为生成类型。

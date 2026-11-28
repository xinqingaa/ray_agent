# RayAgent 1.0.0 发版准备、文档深度收敛与 Skill 升级计划

> **状态**：已定稿，待授权执行（严格排在 [评测平台升级、版本号体系与 KV-Cache 抖动修复计划](evaluation-platform.md) 的 WP-E1–WP-E6 全部落地之后，在新对话中从头无人值守执行到尾）。
>
> **职责边界**：本轮规划仅产出收敛与发版准备蓝图；正式执行时按 `WP-R1 → WP-R6` 顺序推进。禁止提前删除未吸收的旧文档，禁止擅自运行付费批量模型评测，禁止擅自 `git push` 或对外发布。

---

## 前置硬门禁（执行前必须先核验）

在动手执行 `WP-R1` 前，必须先运行并全部确认通过以下条件；任一不满足立即停止并向用户报告阻塞点，不得跳过或猜测补全：

1. **前置计划（[evaluation-platform.md](evaluation-platform.md)）已落地**：
   - `python3 ray_agent/scripts/bump_version.py --show` 可正常执行并输出一致版本号（`0.0.1` 或以上 `0.x.y`）；
   - `cd ray_agent/api && uv run --locked python -m scripts.eval --list` 正常列出 5 组 14 题 `suite-v2` 套件；
   - 以下基线检查全通过：
     - `cd ray_agent/contracts && pnpm run generate && pnpm run check`
     - `cd ray_agent/api && uv run --locked python -m pytest`
     - `cd ray_agent/ui && pnpm run lint && pnpm run build`
     - `cd ray_agent/desktop && cargo test`
2. **工作区整洁度确认**：执行前先核对 `git status --short`，确保没有与前置任务无关的悬空未提交脏改。

---

## 一、背景、调研事实与 1.0.0 收敛目标

### 1.1 调研确认的仓库现状（源码与文档核对事实）

| 维度 | 现状事实 | 核心问题与发版阻塞 |
|---|---|---|
| 文档体量与分散度 | 根目录 3 份 + `docs/` 顶层 8 份（~277 KB）+ `docs/background/` 9 份（~38 KB）+ `docs/plan/` 12 份（~172 KB） | 同一条任务链路被切碎在 [product.md](../product.md)、[harness.md](../harness.md)、[architecture.md](../architecture.md)、[skills.md](../skills.md)、[model-usage.md](../model-usage.md) 与 9 篇设计背景中；偏“产品说明书式”罗列，跨文跳读成本极高 |
| 废弃内容与旧词残留 | [projects-and-artifacts.md](../background/projects-and-artifacts.md) 写的是已删除的“托管项目”；[limits.md](../limits.md#L304) 仍写“沙箱的独立硬边界” | 误导读者把早期设想或已移除方案当成现行机制 |
| 历史计划与占位碎片 | [docs/plan/](README.md) 中 7 份为已完成或前置执行计划（[capability-foundation-and-presets.md](capability-foundation-and-presets.md) 已实现却在 [PLAN.md](../../PLAN.md#L9) 仍标“设计细化中”，[first-delivery-remaining.md](first-delivery-remaining.md) 早已合并进修复计划）；4 份为 7–21 行 P10–P12 占位短文 | 施工脚手架与已完成决策堆在规划区，未铺平回正文 |
| 临时过程二进制 | `docs/todo/`（~2.5 MB 验收文档与重复二进制附件）、`prototype/`（15 个静态 HTML/JS/CSS 原型文件 ~400 KB）均被 Git 追踪 | 过程材料占仓库体积，且 [docs/README.md](../README.md#L21) 与多处指南仍在导流 |
| 配图事实严重过期 | [docs/assets/](../assets) 全部 7 张 SVG 最后更新于 10/19–11/07：[product-task-map.svg](../assets/product-task-map.svg) 写 `执行端口待接入`/`记忆待接入`，[system-data-map.svg](../assets/system-data-map.svg) 写 `Web UI`/`端口待接入`，[context-memory-map.svg](../assets/context-memory-map.svg) 写 `工作方式与记忆接入前为空`，[skill-agent-flow.svg](../assets/skill-agent-flow.svg) 仍写 `沙箱`，其余 3 张漏掉 `ExecutionProfile`、守卫熔断、预览工具与 KV-Cache 固定前缀 | 图示与 1.0.0 真实能力完全脱节 |
| 两个仓库级 Skill 老化 | [skills/write-lessons/SKILL.md](../../skills/write-lessons/SKILL.md)（Sep 11）仍为旧“技术课程写作”体系且未被 [AGENTS.md](../../AGENTS.md) 引用；[skills/draw-tech-diagrams/SKILL.md](../../skills/draw-tech-diagrams/SKILL.md)（Sep 17）未对接本机新版 `fireworks-tech-graph` CLI（`scripts/fireworks.py`、`scripts/validate-svg.sh`）且缺便携降级与中文 Chromium 渲染检查 | 无法直接服务 1.0.0 深度工程文档重构与配图自检 |
| 包元数据与许可卫生 | 根目录缺 `LICENSE`；[pyproject.toml](../../ray_agent/api/pyproject.toml#L4) 仍为占位文案 `description = "Add your description here"`；[package_identity.json](../../ray_agent/api/resources/package_identity.json#L9) 的 `head_revision` 停在 `0007_semantic_index`（落后实际 Alembic head `0017_usage_currency` 10 个迁移），且 [rayagent-core.spec](../../ray_agent/api/rayagent-core.spec#L55-L107) 在 `resources` 遍历时会与动态 `identity_path` 重复打包；[README.md](../../README.md#L35) 与 [ray_agent/README.md](../../ray_agent/README.md#L9) 仍写“首个桌面交付仍在实施中” | 对外展示、版本身份与 1.0.0 构建打包不一致 |

### 1.2 用户已确认的 4 项收敛与发版决策

1. **深度收敛文档结构**：保留 **1 篇独立深度拆解长文**（`docs/deep-dive.md`）+ **4 份精简工程参考**（`docs/README.md`、`docs/architecture.md`、`docs/limits.md`、`docs/code-map.md`）+ **5 张 1.0.0 配图**（`docs/assets/*.svg`）。原 [product.md](../product.md)、[harness.md](../harness.md)、[skills.md](../skills.md)、[model-usage.md](../model-usage.md) 与 [docs/background/](../background/README.md) 全部铺平融合后删除；`docs/plan/` 已完成计划全部归并清空，Post-1.0（P10–P12）收敛进根目录 [PLAN.md](../../PLAN.md)。
2. **清理过程历史目录**：彻底删除 `docs/todo/`（核心场景已由评测平台 `suite-v2` 承接）与 `prototype/`（均可从 Git 历史追溯）。
3. **两个 Skill 同步升级**：`skills/write-lessons/` 升级并重命名为 `skills/write-tech-docs/`（聚焦工程架构与深度拆解写作、叙事铺平与反膨胀）；`skills/draw-tech-diagrams/` 保留原名并升级工具链、无外部工具降级流，以及基于 Playwright Chromium + `cairosvg` 回退的内置校验渲染脚本。
4. **1.0.0 发布与许可口径**：定位为 **Apple Silicon Mac 1.0.0 开源/内部可用版** —— 补齐根目录 `LICENSE`（MIT，已核对 [pyproject.toml](../../ray_agent/api/pyproject.toml) 运行期依赖无 GPL/AGPL 冲突，`pyinstaller` 仅构建工具带 Bootloader Exception）、刷新 [THIRD_PARTY_NOTICES.md](../../ray_agent/api/resources/THIRD_PARTY_NOTICES.md)、校准各包 manifest 与 `package_identity.json`、经 `bump_version.py --set 1.0.0` 升版并完成 `.app` 内部包构建与 `codesign --verify --deep --strict` 验签（Developer ID 公证留到 Post-1.0 P10）。

---

## 二、目标文档树与全仓逐文件映射表

### 2.1 收敛前后目录结构对比

- **收敛前**：根目录 3 份文档 + `docs/` 8 份顶层 + `docs/background/` 9 份 + `docs/plan/` 12 份 + `docs/todo/`（2.5 MB）+ `prototype/`（15 文件）+ 7 张过期 SVG + 旧版 `skills/write-lessons/`。
- **1.0.0 目标态**：
  - 根目录：`README.md`、`AGENTS.md`、`PLAN.md`、`LICENSE`
  - `docs/`：`deep-dive.md`、`README.md`、`architecture.md`、`limits.md`、`code-map.md`
  - `docs/assets/`：`product-overview.svg`、`system-architecture.svg`、`harness-loop-and-tools.svg`、`context-memory-kvcache.svg`、`skills-presets-eval.svg`
  - `skills/`：`write-tech-docs/`、`draw-tech-diagrams/`（新增 `scripts/audit_and_render_svg.py`）、`frontend-design/`

### 2.2 逐文件去向映射表（防止遗漏与断链）

| 现有路径 | 1.0.0 处置 | 内容去向与承接方 | 删除/修改时机 |
|---|---|---|---|
| `skills/write-lessons/*` | 升级并替换 | 新建 `skills/write-tech-docs/SKILL.md` 与 `agents/openai.yaml` 后删除 | WP-R1 |
| `skills/draw-tech-diagrams/*` | 原位升级 | 升级 `SKILL.md`、`agents/openai.yaml`，新增 `scripts/audit_and_render_svg.py` | WP-R1 |
| `docs/product.md` | 铺平融合后删除 | 端到端用户能力与交付链路融入 `docs/deep-dive.md`；页面与交互契约已归 [DESIGN.md](../../ray_agent/ui/DESIGN.md) | WP-R2 吸收，WP-R4 删除 |
| `docs/harness.md` | 铺平融合后删除 | 执行循环、工具守卫、上下文与记忆治理融入 `docs/deep-dive.md`；结构边界留 [architecture.md](../architecture.md) | WP-R2 吸收，WP-R4 删除 |
| `docs/skills.md` | 铺平融合后删除 | 多来源发现、不可变快照、两层渐进目录与内置预设融入 `docs/deep-dive.md` | WP-R2 吸收，WP-R4 删除 |
| `docs/model-usage.md` | 铺平融合后删除 | 模型目录所有权、计费账本与本机 Whisper 语音融入 `docs/deep-dive.md` | WP-R2 吸收，WP-R4 删除 |
| `docs/background/*`（9 份） | 铺平融合后整目录删除 | 有效设计取舍融入 `docs/deep-dive.md` 各章“工程取舍”与 [architecture.md](../architecture.md)；已删除的 `projects-and-artifacts.md` 仅在工作区对比处一句交代 | WP-R2 吸收，WP-R4 删除 |
| `docs/plan/*`（12 份） | 归并后清空 | `decisions.md`、`implementation.md`(M0–P9)、`prototype-ui.md`、`desktop-acceptance-remediation.md`、`capability-foundation-and-presets.md`、`evaluation-platform.md`、`first-delivery-remaining.md` 铺平进 `docs/deep-dive.md` 与四大参考；P10–P12 与 OpenAI 转写 4 份短文收敛进 [PLAN.md](../../PLAN.md)；本计划最后退役 | WP-R2/R3 吸收，WP-R4 删 11 份，WP-R6 删本文件 |
| `docs/todo/` | 直接删除 | 过程二进制不入正式正文；关键场景已进入评测 `suite-v2` | WP-R4 删除 |
| `prototype/` | 直接删除 | UI 规则已固化至 [DESIGN.md](../../ray_agent/ui/DESIGN.md) 与正式 UI 实现，历史代码可从 Git 追溯 | WP-R4 删除 |
| `docs/assets/*.svg`（旧 7 张） | 替换重绘 | 收敛为 5 张 1.0.0 SVG，全部渲染并目视核验后删除旧 7 张 | WP-R3 |
| `docs/README.md`、`architecture.md`、`limits.md`、`code-map.md` | 瘦身校准保留 | 对齐 1.0.0 实现、保留全部外部引用 `#anchor`、清理旧词 | WP-R3 |
| `README.md`、`AGENTS.md`、`PLAN.md`、`ray_agent/**/README.md`、`DESIGN.md` | 重写/同步改链 | 更新能力现状、文档入口与全部跨文件链接 | WP-R5 |

---

## 三、分工作包详细实施规范（WP-R1 → WP-R6）

### WP-R1：升级仓库级两大 Skill（写作 + 作图）

- **目标**：让工程写作与 SVG 技术制图 Skill 具备 1.0.0 叙事铺平方法与可本地确定性执行的中文 SVG 渲染/校验脚本。
- **前置条件**：通过前置硬门禁检查。
- **具体改动**：
  1. **新建 `skills/write-tech-docs/SKILL.md` 与 `skills/write-tech-docs/agents/openai.yaml`，删除 `skills/write-lessons/`**：
     - 定位：面向工程架构说明、系统参考与项目深度拆解长文的编写与重构 Skill（彻底删除“课号、课程大纲、课程素材文档、教材”等旧课程概念）。
     - 核心规范章节：
       - **先读契约后落笔**：动笔前必须核对真实源码、Schema/协议与服务入口，严禁凭历史文档或目录名猜测行为。
       - **反说明书与反堆砌**：禁止按前端菜单/按钮罗列功能，禁止把正文写成源码翻译或逐行注释。围绕“遇到什么工程问题 → 用什么机制解决 → 状态与数据边界在哪 → 取舍与已知限制”组织叙述。
       - **叙事铺平（Narrative Flattening）**：将多轮开发计划（`WP*`/`P*`）、修复补丁与阶段评审记录铺平为现时态稳定结构；正文中不残留“本轮修复、后续待接入、早期暂行”等施工脚手架。
       - **关注点单一与零重复**：深度拆解讲脉络与设计取舍；架构速查讲组件边界、状态机与写协调；参数页（如 `docs/limits.md`）独占可调数字；代码地图独占文件与单测索引；运行/构建命令只留各服务指南。
       - **证据分级与交付门禁**：严格区分**代码事实**、**设计意图推断**、**概念简化**与**待演进边界**；明确区分静态核对与真实运行；交付前强制检查相对链接、`#anchor`、过期术语与图文一致。
     - 同步更新 `skills/write-tech-docs/agents/openai.yaml` 的 `display_name`、`short_description` 与 `$write-tech-docs` 默认提示词。
  2. **升级 [skills/draw-tech-diagrams/SKILL.md](../../skills/draw-tech-diagrams/SKILL.md) 与 [openai.yaml](../../skills/draw-tech-diagrams/agents/openai.yaml)，新建 `skills/draw-tech-diagrams/scripts/audit_and_render_svg.py`**：
     - 在 `SKILL.md` 中保留 9 类图型选择与信息组织原则，重点升级两处：
       - **工具链分层与降级**：优先检查并使用外部 `fireworks-tech-graph`（适配新版 `scripts/fireworks.py`、`scripts/validate-svg.sh`、`references/composition-quality-contract.md`、`references/style-1-flat-icon.md`）；若环境不存在 `fireworks-tech-graph`，自动使用规范内联 SVG + 本 skill 内置脚本 `audit_and_render_svg.py` 完成校验与渲染，不阻塞执行。
       - **macOS 中文渲染与目视闭环**：明确 `cairosvg` 在 macOS 上对 `PingFang SC` 等中文字体字距测量易与浏览器产生偏差，规定**优先用无头 Chromium（Playwright）按精确 `viewBox` 尺寸截屏渲染**到临时目录（如 `/tmp/rayagent-svg-preview/`），`cairosvg` 仅作为无 Chromium 时的回退；渲染后必须通过图片读取工具目视核对中文不溢出、不截断、节点不重叠、连线不穿框，未目视核对不得宣称 `visual_review: passed`。
       - **规则优先级**：`用户明确要求 → 目标项目规范（如 docs/README.md#制图约定）→ 本 skill 默认值 → 外部工具默认值`。
     - 新建确定性脚本 `skills/draw-tech-diagrams/scripts/audit_and_render_svg.py`：
       - CLI：`python3 skills/draw-tech-diagrams/scripts/audit_and_render_svg.py <svg_path_or_dir> --out-dir /tmp/rayagent-svg-preview [--renderer auto|playwright|cairosvg]`
       - **静态结构校验**：
         1. XML 解析合法；
         2. 根 `<svg>` 具备合法 `viewBox`、`width`/`height`、`role="img"`，以及非空 `<title>` 与 `<desc>`；
         3. 校验全部 `url(#...)` 引用（`marker-end`/`marker-start`/`clip-path`/`filter`/`fill`）均存在对应 `id` 定义；
         4. 检查所有 `<path>` 的 `d` 属性非空，主要 `<text>` / `<rect>` 坐标未明显跑出 `viewBox` 范围；
         5. 若 `$FIREWORKS_SKILL_DIR` 或 `$HOME/.codex/skills/fireworks-tech-graph/scripts/validate-svg.sh` 存在，自动串联调用它完成进阶几何/构图预算校验。
       - **真实渲染导出**：`auto` 模式下优先定位可用 Playwright（如 `sys.executable` 或项目 `ray_agent/api/.venv/bin/python`）调起无头 Chromium 按精确 `viewBox` 像素尺寸把 SVG 注入页面等待字体就绪后截图输出到 `--out-dir`（绝不写进仓库目录），无 Playwright 时回退 `cairosvg` CLI 或 Python 包。
- **防踩坑**：不要直接把 PNG 渲染图放进 `docs/assets/`；必须输出到 `/tmp/`，在目视检查后清理。
- **完成判据 & 验证**：
  - `skills/write-lessons/` 已删除，`skills/write-tech-docs/` 完整可用；
  - 用一条命令对现有 SVG 试跑 `audit_and_render_svg.py --out-dir /tmp/rayagent-svg-test` 返回 exit code `0`，生成 PNG 并读取验证正常后删除 `/tmp/rayagent-svg-test`。

---

### WP-R2：撰写独立项目深度拆解长文 `docs/deep-dive.md`（先写后删）

- **目标**：产出全项目唯一的核心技术拆解长文，让新接手开发者或开源读者通过**一篇连贯长文**理解 RayAgent 1.0.0 的设计动机、完整运行机制、关键实现锚点与工程取舍。
- **前置条件**：`WP-R1` 完成；**严禁在此步骤删除任何旧文档或旧计划**（必须把所有旧文档内容先吸干再清理）。
- **正文组织架构（9 章全链路工程叙事，严格遵循 `skills/write-tech-docs/SKILL.md`）**：
  1. **系统定位与根架构取舍**：为什么从早期独立 Web/Docker 服务转向 `Tauri 2 + 本地 Python Harness + 原位文件夹工作区`（铺平 [decisions.md](decisions.md) D1–D9 与“原位读写 vs 托管副本”取舍）；嵌入配图 `assets/product-overview.svg`。
  2. **桌面宿主、核心握手与安全边界**：Tauri 宿主与冻结 core 的 stdin `CoreLaunch` / stdout `CoreHandshake` 启动契约、实例令牌（header）vs 短期资源票据（预览 URL）、宿主文件夹授权 `grant_id` 与无跟随目录描述符（`O_NOFOLLOW`）、执行 Supervisor 进程树回收、随包独立 Python/Node 工具运行时归档与按需组件安装；嵌入配图 `assets/system-architecture.svg`。
  3. **单循环 Harness、运行轮廓与计划驱动**：为什么用单循环决策而不是静态多 Agent 图、4 种 `ExecutionProfile` 如何动态裁剪工具集、计划清单的身份/层级/来源、`模型声明 ≠ 工具执行成功 ≠ 业务核验通过` 三层边界、停止/审批/重启中断后的等待与续接规则；嵌入配图 `assets/harness-loop-and-tools.svg`。
  4. **工具契约、执行守卫与成果交付**：工具注册/Schema 裁剪/超时未知结果不重放、`WorkspaceShellGuard` 防工作区污染守卫、`WriteLeaseGuard` 连续冲突熔断、写前快照备份与单步撤销、Shell 有界变更观察；应用内文件预览 + `register_preview` 静态与受管轻脚本 Web 预览、`read_document` 与预装办公库（`python-docx`/`openpyxl`/`python-pptx`/`pypdf` 等）。
  5. **工作区知识底座：混合检索、语义索引与 OCR**：SQLite FTS5 全文检索 + LanceDB 嵌入式向量检索 + RapidOCR 扫描页补录、外部文件变更防抖重扫、索引暂停/范围排除/失败重试，以及版本化参考引用与正文角标定位。
  6. **上下文装配、长期记忆与 KV-Cache 稳定性**：请求前缀固定段（系统提示词 + `<active_preset>` + 固定锚点 Skill 正文或两层渐进目录）如何消除旧版 >12 Skill 触发时的前缀缓存抖动；工作区工作方式版本化与 Agent 建议审阅；长期记忆分级、冲突候选队列与钉住边界；结果整形 → Token 预算估算 → 安全截断点压缩与手动压缩；嵌入配图 `assets/context-memory-kvcache.svg`。
  7. **多来源 Skill 与内置场景预设体系**：6 类来源优先级与冲突消解、内容快照不可变冻结、两层渐进目录 `search_skills`、“运行内核不入侵”原则下的 5 项共性底座技能与内置场景预设流转；嵌入配图 `assets/skills-presets-eval.svg`。
  8. **模型连接、费用账本与本机语音输入**：为什么核心唯一持有模型能力目录、目录外模型上游 `/models` 探测与“目录/上游/未确认”三态来源标记、Responses 与 Chat Completions 双协议适配、十亿分之一美元精确账本与缓存读取计费、`whisper.cpp` 本机端侧转写与音频校验契约。
  9. **工程闭环：一核两端开发者评测平台与版本体系**：为什么必须从“主观盲盒体感”升级为“隔离实测驱动”、`0.0.1 → 1.0.0` 单一 SemVer 与 `bump_version.py`、独立评测核心端口 + `<data_root>/evaluation/artifacts/` 解耦避免 SQLite `InstanceLock`、`suite-v2` 5 组 14 题黄金套件、`git_tag` 受管 worktree 对比、双盲人工评判与可选 LLM-as-Judge。
- **硬性写作约束**：
  - 全文写完前必须真实读过 `evaluation-platform.md` 落地后的新代码锚点与旧文档对应内容，不得凭旧计划想象细节；
  - 正文不直接写任何可调阈值数字（一律链接 [limits.md](../limits.md) 对应小节），不贴长源码，不出现 `WP1/P7/本轮` 等过程词汇；
  - 每章末尾收口 2–4 条“已知边界与设计取舍”。
- **完成判据**：`docs/deep-dive.md` 成文并通过自我机制/事实核对（确认 [product.md](../product.md)、[harness.md](../harness.md)、[skills.md](../skills.md)、[model-usage.md](../model-usage.md)、[docs/background/](../background/README.md) 及历史计划中的有效设计已无遗漏吸收）。

---

### WP-R3：重绘收敛 5 张 1.0.0 配图并目视核验 + 精简四大工程参考

- **目标**：用 5 张准确反映 1.0.0 事实的新 SVG 替代 7 张过期旧图，并将 [docs/README.md](../README.md)、[docs/architecture.md](../architecture.md)、[docs/limits.md](../limits.md)、[docs/code-map.md](../code-map.md) 精简校准为高信噪比工程参考。
- **前置条件**：`WP-R2` 完成（图注与 `docs/deep-dive.md`、`docs/architecture.md` 标题对齐）。
- **子任务 3.1：重绘 5 张 SVG 并完成 Playwright Chromium 目视核验**
  - 按 [docs/README.md#制图约定](../README.md#制图约定) 与升级后的 `skills/draw-tech-diagrams/SKILL.md` 绘制：
    1. `docs/assets/product-overview.svg` —— 回答：**RayAgent 1.0.0 面向哪些工作入口、依靠哪些核心能力推进、最终交付什么成果？**（独立对话 / 工作区文件夹、内置场景预设、单循环 Harness、混合知识检索、Shell/浏览器/文件工具、应用内文件与 Web 预览、语音与用量）。
    2. `docs/assets/system-architecture.svg` —— 回答：**Tauri 宿主、本机核心、执行环境、本机存储与外部服务如何协作，安全与数据边界在哪？**（Tauri WebView、实例令牌与短期票据、`grant_id` 无跟随目录、Execution Supervisor + 随包 Python/Node、SQLite + LanceDB + 评测隔离产物、LLM / MCP / A2A）。
    3. `docs/assets/harness-loop-and-tools.svg` —— 回答：**一次任务在单循环中如何经轮廓裁剪、守卫校验、等待审批推进并安全收尾？**（`ExecutionProfile` 工具裁剪、计划清单、工具校验与 `WorkspaceShellGuard`/`WriteLeaseGuard`、写前备份、待批准/待回答暂停与中断/停止/完成终态）。
    4. `docs/assets/context-memory-kvcache.svg` —— 回答：**请求上下文如何分层装配以保持 KV-Cache 前缀稳定，以及超预算时如何安全压缩？**（固定前缀段含 `<active_preset>` 与固定锚点 Skill 目录/正文 → 工作方式与常驻记忆 → 按需召回与检索 → 历史消息与最新工具结果；右侧/下方展示结果整形、容量探测与安全截断边界压缩）。
    5. `docs/assets/skills-presets-eval.svg` —— 回答：**多来源 Skill 与内置预设如何冻结参与运行，以及开发者评测平台如何隔离验证并驱动版本迭代？**（6 来源发现 → 不可变版本快照 & 两层渐进目录 → `ExecutionProfile` 协作；下半区/右区展示 `git_tag` 受管 worktree → 一核两端隔离实测 → 指标/双盲评审 → 版本决策闭环）。
  - **删除 7 张旧 SVG**：`product-task-map.svg`、`system-data-map.svg`、`task-run-flow.svg`、`tool-contract-flow.svg`、`context-memory-map.svg`、`context-compaction-flow.svg`、`skill-agent-flow.svg`。
  - **渲染与目视闭环**：执行 `python3 skills/draw-tech-diagrams/scripts/audit_and_render_svg.py docs/assets --out-dir /tmp/rayagent-svg-preview --renderer auto`，用 `read_file` **逐张打开 `/tmp/rayagent-svg-preview/*.png`** 目视检查排版、中文不溢出、不穿线、图例清晰；如有视觉瑕疵当场修正 SVG 重渲染（最多 2 轮），全部确认无误后 `rm -rf /tmp/rayagent-svg-preview`。
- **子任务 3.2：精简与校准四大工程参考**
  - **[docs/README.md](../README.md)**：精简为“5 份文档 + 5 张图”的清晰地图；更新写作与制图 skill 引用为 `skills/write-tech-docs/SKILL.md` 与 `skills/draw-tech-diagrams/SKILL.md`；移除 `prototype/README.md` 入口；保留“按改动选择更新位置”、“审阅标准”、“8 项高风险代码审查清单”与“制图约定”（配图表改为 5 张新图）。
  - **[docs/architecture.md](../architecture.md)**：定位转为“结构契约、状态与数据边界速查”（一般机制原理解释移出至 `deep-dive.md`，减少 30%+ 冗余叙述）；嵌入 `assets/system-architecture.svg` 与 `assets/harness-loop-and-tools.svg`；补充应用内 Web 预览、场景预设与评测平台隔离存储的数据归属；**强制核对并保留以下外部引用锚点**：`#系统边界`、`#业务库与写协调`、`#后台任务`、`#数据归属`、`#构建身份与运行快照`、`#事件与投影`、`#执行环境与限制`（`ray_agent/api/README.md` 现行引用依赖这些锚点）。
  - **[docs/limits.md](../limits.md)**：删除第 304 行过时的“沙箱的独立硬边界”段落；逐段核对 1.0.0 代码新增/变更的参数（内置预设、`ExecutionProfile` 工具可见性规则、应用内静态/受管预览限额、`SKILL_INLINE_CATALOG_LIMIT`、评测平台运行超时与产物限制），保持源码链接与全仓唯一数字真相源定位，保留所有被服务指南引用的标题锚点。
  - **[docs/code-map.md](../code-map.md)**：逐行校验所有模块路径与单测命令是否存在（纳入 `evaluation-platform.md` 新增的 `bump_version.py`、评测服务/UI/CLI 与预设/预览模块，移除不存在的旧路径），保留 `#主执行路径`、`#共享契约`、`#上下文与记忆`、`#桌面宿主与核心打包` 等外部引用锚点。
- **完成判据 & 验证**：5 张新 SVG 静态校验 + Playwright 渲染目视全通过并已清理 `/tmp/rayagent-svg-preview`；四大参考文档中零 `沙箱` / `待接入` / `首个交付仍在实施` 等旧词。

---

### WP-R4：清理退役文档、历史计划与临时过程目录

- **目标**：彻底清零文档负债，只留清晰的 1.0.0 文档体系与精简的 Post-1.0 路线图。
- **前置条件**：`WP-R2` 与 `WP-R3` 均已完成且确认有效内容全部就位。
- **执行清理清单**：
  1. 删除已融合旧正文：`docs/product.md`、`docs/harness.md`、`docs/skills.md`、`docs/model-usage.md`。
  2. 删除历史背景文件夹：`docs/background/` 整目录（全部 9 份文件）。
  3. 删除过程验收与静置原型：`docs/todo/` 整目录（~2.5 MB）与 `prototype/` 整目录（15 个文件）。
  4. 清理 `docs/plan/` 下已完结或已收敛的 11 份文件：`docs/plan/README.md`、`implementation.md`、`first-delivery-remaining.md`、`decisions.md`、`prototype-ui.md`、`desktop-acceptance-remediation.md`、`capability-foundation-and-presets.md`、`evaluation-platform.md`、`clients-and-distribution.md`、`local-runtime-and-storage.md`、`shared-contracts.md`、`usage-models-voice.md`。（**注意**：本计划 `release-1.0.0-preparation.md` 保留至 `WP-R6` 最后收尾再删除，方便执行期间回溯检查与收尾。）
- **重写根目录 [PLAN.md](../../PLAN.md)**（控制在 ~40–60 行）：
  - 声明 1.0.0（Apple Silicon Mac 内部/开源版）核心闭环已达成，现行体系入口指向 [docs/README.md](../README.md) 与 `docs/deep-dive.md`。
  - 以紧凑表格收敛原 Post-1.0 远期阶段：
    - **P10 Mac 正式对外分发**：Developer ID 签名与公证、DMG、签名自动更新与失败回退、离线组件包、完整备份/恢复界面、自动生成全量依赖许可证清单（含原 `clients-and-distribution.md` 与 `local-runtime-and-storage.md` 目标）。
    - **P11 Windows x64 适配与发布**：原生句柄防重解析点 IO、Job Object 进程树回收、PowerShell、Windows 运行时与签名安装包。
    - **P12 辅助移动端与云端转写扩展**：基于共享 UI 与契约的局域网设备配对/TLS 固定/离线补读（原 `shared-contracts.md`），先 Android 后 iOS；OpenAI 云端音频转写接入（原 `usage-models-voice.md`）。
  - 保留规划管理规则：后续仅在正式立项跨模块专题时于 `docs/plan/` 建档，完成后立即归并正文并删档。
- **完成判据**：`git status` 显示旧文档与 `docs/todo/`、`prototype/` 已正确移除，仅余预期保留与待删收尾文件。

---

### WP-R5：重写 `README.md` / `AGENTS.md`，同步全仓服务指南与断链自动化扫查

- **目标**：刷新仓库首页、Agent 协作规范与 6 份服务指南，确保全仓无一处断链、失效 `#anchor` 或历史旧词。
- **前置条件**：`WP-R4` 完成。
- **子任务 5.1：重写根目录 [README.md](../../README.md)**（~90–130 行，1.0.0 清晰产品/开源门面）
  - **产品定位与视觉总览**：明确 RayAgent 是面向复杂任务执行的桌面 AI Agent 应用（Apple Silicon macOS，Tauri 2 + 本机 Python Harness + 原位文件夹工作区），嵌入 `docs/assets/product-overview.svg`。
  - **1.0.0 核心能力**：精炼分点展示（单循环决策与 4 种运行轮廓、内置场景预设与多来源 Skill、原位文件夹与写前备份撤销、SQLite FTS5 + LanceDB + RapidOCR 混合知识检索、受管 Shell 与浏览器观察、应用内文件与受管 Web 项目预览、多协议模型/费用账本/Whisper 本机语音、开发者一核两端评测平台）。
  - **系统结构与快速开始**：嵌入 `docs/assets/system-architecture.svg`；简要说明前提（macOS arm64、Node 22 + pnpm、uv + Python 3.12+、Rust stable）与 `./dev.sh` 一键开发启动、模型配置入口（`~/.config/rayagent/config.toml`）与桌面构建指南入口。
  - **阅读导航（高信噪比 5+N 入口）**：突出推荐 `docs/deep-dive.md`（项目端到端深度拆解）、[docs/architecture.md](../architecture.md)、[docs/limits.md](../limits.md)、[docs/code-map.md](../code-map.md)、各服务指南、[PLAN.md](../../PLAN.md) 与开源协议 `LICENSE` / [THIRD_PARTY_NOTICES.md](../../ray_agent/api/resources/THIRD_PARTY_NOTICES.md)。
  - **当前 1.0.0 已知边界**：如实注明仅构建 Apple Silicon ad-hoc 签名包（Developer ID 公证、Windows 与移动端属 Post-1.0），模型密钥本地文件权限保护、本机 Shell 默认按开关启用。
- **子任务 5.2：瘦身重写根目录 [AGENTS.md](../../AGENTS.md)**（~55–65 行）
  - 更新“按任务读取文档”表，仅保留真实存在的 5 份 `docs/` + 服务指南 + `PLAN.md`；
  - 更新 Skill 绑定：写作/整理技术文档遵循 `skills/write-tech-docs/SKILL.md`；技术配图遵循 `skills/draw-tech-diagrams/SKILL.md` 与 `docs/README.md#制图约定`；前端界面遵循 [frontend-design](../../skills/frontend-design/SKILL.md) 与 [ray_agent/ui/DESIGN.md](../../ray_agent/ui/DESIGN.md)；
  - 保留核心工程纪律（分层职责、通用提示词不写个案、数值只在 `limits.md` 维护、区分代码事实/意图推断/建议、区分静态核对与真实运行）；彻底删去 `docs/todo/`、`docs/plan/README.md` 与 `Fireworks Tech Graph` 旧硬编码路径。
- **子任务 5.3：同步 6 份 `ray_agent/` 服务指南与 3 处源码注释**（对应前期 `git grep` 全量摸排结果）
  - [ray_agent/README.md](../../ray_agent/README.md)：删去“首个桌面交付仍在实施中”及指向 `first-delivery-remaining.md`、`prototype-ui.md` 的失效链接；第 15 行改链 `../docs/deep-dive.md` 对应锚点；更新 1.0.0 运行检查清单（加入内置预设、应用内 Web 预览与开发者评测台走查）。
  - [ray_agent/api/README.md](../../ray_agent/api/README.md)：第 357/365/383 行原指向 `harness.md` 与 `product.md` 全部改链至 `../../docs/deep-dive.md` 对应锚点；核对第 415 行 `../../docs/architecture.md#执行环境与限制` 有效。
  - [ray_agent/contracts/README.md](../../ray_agent/contracts/README.md)：第 3 行原指向 `../../docs/plan/shared-contracts.md` 改链至 `../../docs/architecture.md` 与 `../../PLAN.md`。
  - [ray_agent/desktop/README.md](../../ray_agent/desktop/README.md)：第 3 行原指向 `../../docs/plan/implementation.md#实施状态` 改链至 `../../PLAN.md`；第 76 行原“见实施状态的「待用户处理」”更新为干净的跨机手验与 Post-1.0 边界说明；补充说明 `app-version.json` 与 `package_identity.json` 打包行为。
  - [ray_agent/ui/DESIGN.md](../../ray_agent/ui/DESIGN.md) 与 [ray_agent/ui/README.md](../../ray_agent/ui/README.md)：所有指向 `../../docs/product.md` 全部改链至 `../../docs/deep-dive.md` 对应锚点。
  - 核对源码注释：[semantic_index.py](../../ray_agent/api/app/domain/models/semantic_index.py#L4)、[skill_context.py](../../ray_agent/api/app/domain/services/skill_context.py#L6)、[session-view.ts](../../ray_agent/ui/src/lib/session-view.ts#L3) 仍能精准对应目标文件与标题锚点。
- **子任务 5.4：全仓 Markdown 断链（含 `#anchor`）+ 过期旧词自动化扫描**
  - 在工作目录运行 Python 校验脚本，覆盖全部受管 `.md` 文件（排除 `node_modules`/`.venv`/`target`），要求以下三项**零误差**：
    1. 所有 `[text](relative_path#anchor)` 不仅文件存在，且 `#anchor` 按 GitHub 标题 slug 规则在目标文档中真实存在；
    2. `docs/assets/*.svg` 下 5 张新图至少各有 1 处有效引用，且旧 7 张已全部清除引用；
    3. 过期旧词黑名单命中 **0 处**：`首个交付仍在实施中`、`first-delivery-remaining`、`prototype-ui`、`docs/todo`、`prototype/`、`write-lessons`、`docs/product.md`、`docs/harness.md`、`docs/skills.md`、`docs/model-usage.md`、`docs/background/`、`projects-and-artifacts`、`执行端口待接入`、`记忆待接入`、`端口待接入`、`工作方式与记忆接入前为空`、`脚本与素材准备到沙箱`、`沙箱的独立硬边界`、`Add your description here`、`Fireworks Tech Graph`。
  - *注*：此处对 [AGENTS.md](../../AGENTS.md) 等文件的检查需注意：除 `WP-R6` 最后删掉 `release-1.0.0-preparation.md` 之外，其余旧计划路径不得出现在正式文档。

---

### WP-R6：1.0.0 许可合规、升版 `1.0.0`、全量验证与 Apple Silicon 整包验收

- **目标**：完成开源/内部发版法律与包元数据闭环，统一升版至 `1.0.0`，通过全部自动化与整包验签门禁并退役本计划。
- **前置条件**：`WP-R5` 全仓扫描 0 报错。
- **子任务 6.1：LICENSE、包元数据与 `package_identity` 修复**
  1. **新建根目录 `LICENSE`**：写入标准 MIT License 文本（年份 `2026`，版权主体先执行 `git config user.name` 核对无误后使用合理项目署名如 `RayAgent Contributors` 或作者名称，避免泄露个人工作邮箱）。
  2. **补全各模块包元数据**：
     - [ray_agent/api/pyproject.toml](../../ray_agent/api/pyproject.toml)：将第 4 行 `description = "Add your description here"` 改为 `"RayAgent local core service"`，补充 `license = "MIT"`；
     - [ray_agent/ui/package.json](../../ray_agent/ui/package.json) 与 [ray_agent/contracts/package.json](../../ray_agent/contracts/package.json)：补充 `"license": "MIT"`；
     - [ray_agent/desktop/Cargo.toml](../../ray_agent/desktop/Cargo.toml)：补充 `license = "MIT"`。
  3. **刷新 [THIRD_PARTY_NOTICES.md](../../ray_agent/api/resources/THIRD_PARTY_NOTICES.md)**：逐项核对 [pyproject.toml](../../ray_agent/api/pyproject.toml)、[component_manifest.json](../../ray_agent/api/resources/component_manifest.json)、[tool_runtime_manifest.json](../../ray_agent/api/resources/tool_runtime_manifest.json)、[ui/package.json](../../ray_agent/ui/package.json) 与 [Cargo.toml](../../ray_agent/desktop/Cargo.toml)，补全缺失的核心直接依赖摘要（如 `a2a-sdk`、`mcp`、`jieba`、`pypdfium2`、`defusedxml`、`xlrd`、`tomlkit`、`Tauri 2`），并将末句更新为符合 1.0.0 的准确声明（当前包已随依赖分发组件与工具运行时 LICENSE 文本；对外公证渠道在 Post-1.0 P10 自动生成全量依赖许可清单）。
  4. **修复 [package_identity.json](../../ray_agent/api/resources/package_identity.json) 与 [rayagent-core.spec](../../ray_agent/api/rayagent-core.spec)**：
     - 先运行 `cd ray_agent/api && uv run --locked alembic heads` 获取真实 Alembic head（禁止手填猜测），再将 `resources/package_identity.json` 的 `head_revision`、`channel`、`notes` 同步更新为 1.0.0 Apple Silicon 真实口径（保持字段集合不变，`#` 不额外加未知字段以免影响既有消费方）；
     - 修改 `ray_agent/api/rayagent-core.spec` 第 103–106 行：遍历 `resources` 目录时排除顶层静态 `package_identity.json`（确保不会与第 57 行动态写入 `identity_path` 的文件发生重名冲突或旧值回写）。
- **子任务 6.2：升版 `1.0.0` 并核对锁文件**
  - 运行：
    ```bash
    python3 ray_agent/scripts/bump_version.py --set 1.0.0
    python3 ray_agent/scripts/bump_version.py --show
    ```
  - 核对全部 5 处版本配置均一致变为 `1.0.0`；若 `pyproject.toml` 或 `Cargo.toml` 版本变化影响 `uv.lock` / `Cargo.lock` 校验，执行 `cd ray_agent/api && uv lock --check` 与 `cd ray_agent/desktop && cargo check --locked`（如 `uv.lock` 因虚拟 root 包版本需刷新则同步更新并保持 `--locked` 可通过）。
- **子任务 6.3：全量验证与 Apple Silicon `.app` 整包构建验签**
  - 依次执行全量验证矩阵（任一失败必须查因修复后重跑，未全部执行完不得标通过）：
    1. `python3 ray_agent/scripts/bump_version.py --show`
    2. `cd ray_agent/contracts && pnpm run generate && pnpm run check`
    3. `cd ray_agent/api && uv run --locked python -m pytest`
    4. `cd ray_agent/api && uv run --locked python -m scripts.eval --list`
    5. `cd ray_agent/ui && pnpm run lint && pnpm run build`（同步跑所有 `node scripts/check-*.cjs` 如 `check-chat-progress.cjs`、`check-doc-and-excel-preview.cjs`、`check-workspace-changes.cjs`、`check-evaluation-summary.cjs`）
    6. `cd ray_agent/desktop && cargo test`
    7. **Apple Silicon 内部包构建与产物验签**：
       ```bash
       cd ray_agent/desktop && pnpm run build
       codesign --verify --deep --strict target/release/bundle/macos/RayAgent.app
       ```
       - 核对产物包内部关键身份文件真实内容：`RayAgent.app/Contents/Resources/rayagent-core/_internal/resources/package_identity.json`（`head_revision` 等于真实 Alembic head）、`THIRD_PARTY_NOTICES.md`、`app-version.json`（`1.0.0`）。
       - **如实边界**：若构建前 `prepare_tool_runtimes.py` / `prepare_voice_runtime.py` 因离线无缓存受阻，必须明确记录“整包构建因缺少网络/缓存未验证”，严禁绕过或谎报通过。
- **子任务 6.4：退役本计划与交付收口**
  - 在所有验证通过并整理完变更后，删除本计划文件 `docs/plan/release-1.0.0-preparation.md`（使 `docs/plan/` 正式清空收敛），**再次重跑 WP-R5.4 全仓断链与旧词扫查脚本**确认 0 报错（包括 `PLAN.md` 无悬空入口）。
  - 在最终交付报告中向用户如实汇报所有命令实际结果与未执行边界，并附上供用户审阅后执行的 1.0.0 最终收口指令：
    - 审查 `git status` / `git diff --stat` 后提交 `RayAgent 1.0.0` 变更；
    - 打正式发版标签：`git tag -a v1.0.0 -m "RayAgent 1.0.0"`；
    - 可选在开发者模式评测台中用 `v1.0.0` vs 既有基线（如 `v0.0.1`）运行 `suite-v2` 获取首份 1.0.0 量化评测成绩单。

---

## 四、实施必避的 8 个已知坑（直接复用经验）

1. **禁止颠倒“先写后删”顺序**：必须先在 `WP-R2`、`WP-R3` 完成所有机制吸收、新图绘制与参考重构，再在 `WP-R4` 删除旧文件；否则会丢失旧设计背景与历史边界依据。
2. **禁止在 [evaluation-platform.md](evaluation-platform.md) 落地前启动本计划**：没有 `bump_version.py` 与 `suite-v2` 时强行执行会让版本体系断档、`docs/todo/` 失去承接底座。
3. **跨指南 `#anchor` 强约束**：[ray_agent/api/README.md](../../ray_agent/api/README.md)、[ui/README.md](../../ray_agent/ui/README.md)、[ui/DESIGN.md](../../ray_agent/ui/DESIGN.md)、[desktop/README.md](../../ray_agent/desktop/README.md)、[contracts/README.md](../../ray_agent/contracts/README.md) 与 [session-view.ts](../../ray_agent/ui/src/lib/session-view.ts#L3) 引用了特定小节锚点，删改标题时必须同步替换并跑 WP-R5.4 锚点校验。
4. **macOS 中文 SVG 渲染错位陷阱**：不能依赖 `cairosvg` 或 XML 语法通过判断中文排版是否截断，必须通过 Playwright Chromium（使用 `PingFang SC`）截屏并调用图片读取工具逐张目视核对。
5. **临时 PNG 绝对不提交进仓库**：所有 SVG 验收渲染截图只放 `/tmp/rayagent-svg-preview/`，验收完成即清理。
6. **`rayagent-core.spec` 静态与动态 `package_identity.json` 覆盖冲突**：必须同步更新仓库静态 JSON 并在 spec 遍历 `resources` 时排除它，防止 PyInstaller 重复拷贝或用旧值覆盖构建产物。
7. **禁止在 `ray_agent/` 根目录使用原始 `grep -rn`**：`node_modules/` 与 `.venv/` 会导致全盘扫描卡死；全仓文本搜索一律使用 `git grep`。
8. **严格守住零擅自消耗与零擅自推送底线**：所有计划内验证均基于离线测试、Mock 替身、脚本扫描与本地打包验签；付费批量 LLM 评测与 `git tag` / `git push` 由用户最终拍板执行。

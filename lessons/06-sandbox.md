# Sandbox

Status: stub
Area: Sandbox
Prerequisites: [01](01-application-flow.md)、[02](02-models-and-tool-calling.md)

## 1. Learning objectives and prerequisites

- 能说明 Shell、文件、浏览器分别由哪一侧发起、在哪一侧执行。
- 能区分动态沙箱与已有沙箱的资源归属。
- 能指出附件、沙箱工作区文件、截图失败时应查哪一层存储。
- 前置：文件任务需产品 Compose。浏览器 lab 见 [基础实验](../labs/foundations/README.md)；完整 Chromium/VNC 见 [沙箱指南](../ray_agent/sandbox/README.md)。

## 2. Essential concepts and a runnable example

| 档位 | 脚本（`labs/foundations/`） |
|---|---|
| Recommended | `10-6 使用Playwright简化CDP连接.py` |
| Optional | `10-4 browser-use本地操控实例.py`、`10-4 browser-use远程操控实例.py` |

`10-4` / `10-6` 只建立 CDP / 浏览器控制概念，不是产品 `DockerSandbox` + 沙箱镜像。

产品观察（`unverified`）：[共用写文件任务](map.md#shared-product-observation)。浏览器与 VNC 另开观察，未跑前不要写成已验证。

## 3. Product code entry points and the execution path

| 主题 | 入口 |
|---|---|
| 文件 / Shell / 浏览器工具 | `domain/services/tools/file.py`、`shell.py`、`browser.py` |
| 沙箱适配 | `infrastructure/external/sandbox/docker_sandbox.py` |
| 浏览器适配 | `infrastructure/external/browser/playwright_browser.py` |
| 沙箱服务 | `ray_agent/sandbox/`（Shell / 文件 / 进程；CDP / VNC） |
| 连接方式 | [沙箱指南：与 API 连接](../ray_agent/sandbox/README.md#与-api-连接) |
| 画面 | `ray_agent/ui/src/components/vnc-viewer.tsx` |
| 存储 | `FILE_STORAGE_BACKEND`；Compose 下本地目录为 `/data/files` |

动态沙箱：不设 `SANDBOX_ADDRESS`，由 API 经 Docker Socket 建容器。已有沙箱：设可解析地址，销毁逻辑不删除外部容器。两种假设不能混用。

## 4. Design rationale, limitations, and relevant failure behavior

- 不使用浏览器工具的对话也会走「准备沙箱和浏览器」链路。
- 沙箱 TTL（如 `SANDBOX_TTL_MINUTES`）到期后的行为待读代码后写实。
- 页面文件 URL 由存储实现提供，执行流程里不写死 COS 域名。

## 5. Understanding checks or a focused observation experiment

- 为什么 Compose 的 `.env` 不能照抄 `localhost` 版示例里的 `SANDBOX_*`？
- 附件上传失败、工具写文件失败、截图看不到，分别应先查哪一边？
- 本机跑 `10-6` 成功，能否声称产品浏览器可用？缺了哪几段？

# RayAgent 沙箱开发指南

沙箱提供 Shell、文件、浏览器与进程管理能力。完整镜像由 Ubuntu、Python、Chromium、虚拟显示与 VNC 组件构成，Supervisor 负责启动各进程。

本文区分完整沙箱与 Python 开发环境。架构边界见 [架构说明](../../docs/architecture.md)，整体部署见 [运行指南](../README.md)。部署配置与启动命令已静态核对；下方任务控制脚本已有本地运行记录，不能代替完整沙箱验证。

## 完整沙箱

[Dockerfile](Dockerfile) 安装运行组件，[supervisord.conf](supervisord.conf) 定义进程和端点：

| 端点 | 用途 |
|---|---|
| `8080` | FastAPI：Shell、文件与进程管理 |
| `8222` | Chromium 内部调试端口 |
| `9222` | CDP 代理，供 API 连接浏览器 |
| `5900` | VNC RFB |
| `5901` | WebSocket VNC |

完整镜像由产品目录的 Compose 构建。上述沙箱端口未在产品 Compose 中映射到宿主机，访问方式取决于 API 与沙箱所在网络。

## 与 API 连接

连接模式由 API 的环境配置决定，实现见 [DockerSandbox](../api/app/infrastructure/external/sandbox/docker_sandbox.py)。

| 模式 | 配置条件 | 资源归属 |
|---|---|---|
| 动态沙箱 | 不设置 `SANDBOX_ADDRESS`；配置 `SANDBOX_IMAGE`、`SANDBOX_NETWORK`、`SANDBOX_NAME_PREFIX` | API 创建容器，并在其销毁逻辑中删除所创建的容器 |
| 已有沙箱 | `SANDBOX_ADDRESS` 设置为可解析的主机名或 IP，如同一 Compose 网络内的 `manus-sandbox` | API 连接已有服务，适配对象的销毁逻辑不删除该外部容器 |

`SANDBOX_ADDRESS` 使用主机名或 IP，不填完整 URL。API 必须能访问沙箱的服务与浏览器端点；动态模式还需要访问 Docker。

产品 Compose 中存在沙箱服务并不自动决定使用哪种模式，选择由 API 配置决定。具体 Compose 镜像、网络和环境取值统一见 [运行指南](../README.md#服务环境)。

在宿主机运行 API 时，不要假设 Docker 内部 IP 必然从宿主机可达；尤其需要核对 Docker Desktop 下的网络和必要端口映射。

## Python 开发环境

以下命令在 `ray_agent/sandbox/` 执行，需要 Python 3.10+ 和 uv：

```bash
uv sync --locked
uv run --locked uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

这只启动 Python API，不会自动启动 Chromium、VNC 或 Supervisor。需要验证完整浏览器能力时使用完整沙箱环境。

本地依赖由 [pyproject.toml](pyproject.toml) 和 [uv.lock](uv.lock) 管理，完整 Docker 镜像使用 [requirements.txt](requirements.txt) 安装；调整依赖时核对两条安装路径。

### 开发容器

[.devops/](.devops/) 提供 SSH 与 Python 环境，挂载沙箱源目录。它与完整沙箱镜像用途不同，默认只运行 SSH 服务。

在 `ray_agent/sandbox/` 执行：

```bash
docker compose -f .devops/docker-compose.yml up -d --build
ssh root@localhost -p 2222
```

开发镜像内置的登录密码为 `root`。进入容器后显式指定镜像已准备的 `/venv` 环境，避免 SSH 会话环境差异导致使用其他虚拟环境：

```bash
cd /sandbox
UV_PROJECT_ENVIRONMENT=/venv uv run --locked uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

开发 Compose 只映射 SSH 和 API 端口，不提供完整浏览器环境。

## 开发与验证入口

- [app/interfaces/endpoints/](app/interfaces/endpoints/)：API 路由；运行后的接口文档位于服务的 `/docs`。
- [app/services/](app/services/)：Shell、文件和进程管理实现。
- [app/core/](app/core/)：环境配置与请求中间件。
- API 侧调用方：[沙箱适配](../api/app/infrastructure/external/sandbox/docker_sandbox.py)、[浏览器适配](../api/app/infrastructure/external/browser/playwright_browser.py)。

当前没有独立测试套件。Shell 或文件修改应在临时工作目录验证请求、结果和错误路径；浏览器相关修改需连同 CDP、VNC 和 API 侧调用一起验证。只启动 Python API 不代表完整沙箱可用。

### 任务控制观察

在本目录运行第八章的单进程实验：

```bash
uv run --locked python scripts/check_shell_control.py
```

脚本直接使用实际 `ShellService`，在临时目录启动一个持续追加文件的 Python 进程，依次观察等待超时、调用协程取消、文件继续增长、显式终止与实际退出码。它用 `exec` 消除外层 shell 子进程，并在 `finally` 中回收进程、退出临时目录时删除实验文件。终止前的文件仍存在，用于说明取消没有撤销先前写入。

需要本机有 `/bin/bash`；使用沙箱锁定 Python 环境，无需启动 HTTP、Docker 或模型。输出含本次 PID、相对耗时、文件字节与退出结果，数值随运行变化；预期会出现一次等待超时日志。它不验证 API 停止接口、容器隔离、多层进程树、忽略终止信号或完整产品取消传播。课程验证记录见[制作进度](../../lessons/progress.md)。

### 执行环境观察

在本目录运行第十一章的本地边界观察：

```bash
uv run --locked python scripts/check_environment_boundaries.py
```

脚本在临时目录使用实际 `FileService` 与 `ShellService`，核对 `work/` 外的受控标记可通过 `..` 和符号链接读取、同一 Shell ID 不保留环境变量与 `cd`、子进程能访问本机回环 HTTP，以及实验结束时进程退出、临时目录删除。它不启动 Docker、不连接公网、不是容器逃逸实验。完整容器复用、文件分离、同网络访问与显式删除见 [API 指南](../api/README.md#沙箱环境观察)。课程记录见[制作进度](../../lessons/progress.md#第-11-章沙箱与执行环境)。

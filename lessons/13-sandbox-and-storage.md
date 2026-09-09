# Sandbox and storage

[08](08-browser-and-cdp.md) 只是本机 CDP。产品在隔离容器里跑 Shell / 文件 / 浏览器，附件和截图另走存储。

入口：[沙箱指南：与 API 连接](../ray_agent/sandbox/README.md#与-api-连接)；`docker_sandbox.py`；`tools/file.py` `shell.py` `browser.py`；UI VNC。动态沙箱不要设 `SANDBOX_ADDRESS`；Compose 的镜像/网络名见运行指南，不能照抄 `localhost` 版 `.env.example`。

观察仍用写文件任务。浏览器/VNC 另验，未跑不要写成已验证。创建任务时就会准备沙箱和浏览器，即使用户只提文件问题。

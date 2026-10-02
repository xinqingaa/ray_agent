# 阶段 D 出口（2026-10-02）

日期：2026-10-02。产品提交 `89aa642d08137521e1099e11c0822ea0b5f6367f`，分支 `phase-4` 比 `origin/phase-4` 超前 41。本轮没有改产品代码，没有重建 API/UI 镜像，没有推送，没有 tag，没有改课程，没有跑阶段 E。W9、W10、W11 仍为进行中。

本轮只补阶段 D 还缺的模型路径：跨对话笔记与自动摘要、等待回复、等待审批。上传、快照、恢复、故障注入和整目录走查沿用既有证据，没有重做。

## 运行条件

- 网关 `http://127.0.0.1:8088`。`manus-api`、`manus-ui`、`manus-postgres`、`manus-redis` healthy，`manus-nginx` 在运行。
- API 镜像 `sha256:766d33b91334d4f326997592f4e1309202785c2a7ea976dffc8bb98b336d692d`。UI 镜像 `sha256:c425f52e6af5ca8b10ad67da0767b1bb15c4e59ac7271c9a8d1e7d5414cca6f6`。
- 对话模型是 `config.yaml` 的 `deepseek-flash`，地址 `https://api.deepseek.com`。项目摘要和标题在同一地址、同一把 `LLM_API_KEY` 上使用 `deepseek-chat`。密钥只来自环境变量，证据不记录密钥。
- 浏览器是 Cursor 内置浏览器。会话页标签 `5a1892`，等待审批期间另开项目页标签 `7d7776`。

## 模型探测

已经在运行的 API 容器里，`deepseek-flash` 与 `deepseek-chat` 各一次最小请求都返回 HTTP 401，错误类型 `authentication_error` / `invalid_request_error`。容器里的密钥与宿主机 `.env` 不一致（两边长度都是 35，摘要不同；摘要不入库）。用宿主机 `.env` 的同一把密钥再探，两个模型都是 HTTP 200。

在 `ray_agent` 执行 `docker compose up -d --force-recreate --no-deps manus-api` 后，容器 healthy。容器内再探，两个模型都是 HTTP 200。没有改 `model_name`，没有改 yaml。镜像 digest 不变。

## 跨对话背景

新建项目 `8932a690-0d06-40dd-a350-e354f89c8296`（stage-d-exit-20261002）。发送前会话数为 0，笔记版本 0。

第一段对话 `740af376-0d60-4653-9105-473536b0b01f`，标题「写入标记并更新项目笔记」。`write_file` 写入 `/workspace/note.txt`，`update_project_notes` 以 `base_version` 0 成功。读回：笔记版本 1，正文「口径：stage-d-marker 已写入 note.txt」。`note.txt` 14 字节，sha256 `f9f6eb7409136c3113d05f1d9c530a1557953761f85dbc4ec4b0b2e81114fee1`，内容 `stage-d-marker`。自动摘要就绪，来源 auto，代次 1：「用户要求写入 note.txt 并更新项目笔记；最终回复称两项均已完成。」

打开「在此项目新对话」后、第二段发送前，会话数仍是 1。第二段 `2450f434-b17b-48df-8675-3100ff16c754`，标题「note.txt 标记词」。用户消息要求不复述上一段，只根据项目笔记回答标记词。回复是「note.txt 里的标记词是 stage-d-marker」，工具调用 0。开发者视图第 1 轮请求重建（run `befe7457-f209-40cd-9e92-6b039185de09`）的系统段含 `<project_context>`：项目说明未设置，项目笔记版本 1 为上述口径，近期对话摘要指向 `740af376-0d60-4653-9105-473536b0b01f`（auto，截止 seq 22）并带第一段摘要原文。第二段自己的自动摘要随后就绪：「用户询问 note.txt 中的标记词；已回复为 stage-d-marker。」

## 等待回复

对话 `19cf8e9d-7314-40c3-ac80-5c338db2f6a3`，标题「询问文件名」。模型调用 `message_ask_user`，页面显示「请告诉我文件名是什么？」，输入占位为「回复将继续当前任务」。侧栏项目为「等待回复」，该对话为「等你处理」。项目页在冲突发送前已有「返回占用对话」和「停止占用运行」。

同项目再发送「请用一句话回答 1+1。」后，页面显示「项目正在被另一段对话占用，请返回占用对话或停止其运行」，并保留上述两个入口。这次发送先建了空会话（见下方副作用）。在原对话回复 `reply.txt` 后运行继续并完成。助手确认文件名，且没有写文件。自动摘要：「用户要求先询问文件名且暂不写文件；助手已获知文件名为reply.txt，尚未写入，等待用户提供内容。」随后项目占用清空。

## 等待审批

测前读到的工具策略只有 `mcp:*` 与 `a2a:*` 为 ask，已备份。设置页把 `write_file` 设为执行前询问并保存。读回规则为 `mcp:*` ask、`a2a:*` ask、`write_file` ask。

对话 `114cb5a9-36d8-4149-9cee-0b34ec6918b2`。前三次 `write_file`（`approval.txt`、`second.txt`、`third.txt`）的批准请求来自该会话页，批准后文件已写入；当时的快照赶到时卡片已是「已批准，只执行这一次」，没有留下待批准画面。第三次等待期间，另一段对话的 chat 返回 HTTP 409，正文「项目正在被另一段对话占用，请返回占用对话或停止其运行」，`occupying_session_id` 为 `114cb5a9-36d8-4149-9cee-0b34ec6918b2`。

第四次 run `34eba76e-2f7d-481b-87d0-71f1bdfd443b` 在页面上停住。卡片为「需要你批准后才会执行」，工具 `file.write_file`，文件 `/workspace/fourth.txt`，按钮「批准 Y」「拒绝 N」。输入占位为「先在上方批准或拒绝这个操作，或点停止结束运行」，上传禁用。侧栏项目名是「stage-d-exit-20261002 等待审批」，对话是「等你处理」。

等待期间在项目页发送「另一段对话发送一句问候。」，页面显示「项目正在被另一段对话占用，请返回占用对话或停止其运行」，并有「返回占用对话」和「停止占用运行」。随后在会话页点击「批准」。按钮变为「正在批准」，然后卡片为「已批准，只执行这一次 16:25:44」，「执行完成：14 字节」。回复：「已将 fourth-marker 写入 /workspace/fourth.txt，任务完成。」读回 `fourth.txt` 14 字节，sha256 `66f909178d786cb2cc15e69162e2448d71d36adfc2afb290144f8f122d422116`，内容 `fourth-marker` 加换行。同一次运行的保护快照 `1f3c2cd4-f826-499a-86de-5cf2540e049b`，当时项目文件 57 字节。

测完把工具策略恢复为只有 `mcp:*` 与 `a2a:*` 为 ask。随后 GET 读回与此一致，没有 `write_file` 规则。

另外三次写入的读回：`approval.txt` 16 字节 `4d26e9d94b7253160dab93f0ed4e3e98b49fa21f9cbc508f1fecb405c2da17e7`，`second.txt` 14 字节 `9de296b82612ab96a951f3ee4d586cd478f6e72d01a33598650f1c6e8be7a4c0`，`third.txt` 13 字节 `3f62fcfe32af79e7360c172f9618644165665b597f12d7946e68dbb129fefd39`。

## 观察到的副作用

占用期间的第二次发送会先创建会话，再收到 409。因此留下两个没有运行的「新对话」：`7ae45bd7-f584-4c4d-9d5b-8d27329397c2`（浏览器里的等待审批冲突发送）和 `464e466c-7df1-48e5-9ed7-30bcd6d3ecbd`（等待审批期间的接口探测）。409 文案本身已出现。这两个空会话已随本次项目一起删除。

## 清理

只动本次项目 `8932a690-0d06-40dd-a350-e354f89c8296`。六个会话经 `POST /sessions/{id}/delete` 删除。项目归档后 `POST /snapshots/cleanup` 返回 200，快照行变为 0。随后删除该项目的 53 条 `project_audit_events` 和 1 条 `projects`，并删除容器内 `/data/files/projects/8932a690-0d06-40dd-a350-e354f89c8296`（删除前 5 个文件、40K，即上述工作区文件；快照对象已不在）。清理后 `projects`、`project_audit_events`、`sessions`、`runs`、`events`、`files` 均为 0。活动项目列表 total 为 0。没有其他项目。

## 未做

阶段 E 的 E1–E7、E6-deny、MCP/A2A 界面回归、固定 CSV 连续项目、能力边界等事实文档、`v2-projects`、课程和推送都没有做。

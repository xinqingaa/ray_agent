/* 由 ray_agent/contracts 从 openapi.json 生成，勿手改；改 Pydantic 契约后运行 npm run generate。 */
export interface paths {
    "/api/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 核心状态
         * @description 返回协议与事件版本、构建与实例身份、存储版本、能力声明和依赖服务检查。依赖异常时仍返回 200，healthy 为 false。
         */
        get: operations["get_status_api_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/status/build": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取 API 构建身份 */
        get: operations["get_build_api_status_build_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/llm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取LLM配置信息
         * @description 返回模型名、地址等可写字段，以及是否已从环境变量配置密钥；不返回密钥明文
         */
        get: operations["get_llm_config_api_app_config_llm_get"];
        put?: never;
        /**
         * 更新LLM配置信息
         * @description 更新模型名、地址、温度等；请求中的 api_key 会被忽略
         */
        post: operations["update_llm_config_api_app_config_llm_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 当前接口可选的模型
         * @description 返回已配置模型的能力与厂商信息，不返回内部端点或密钥。
         */
        get: operations["get_model_catalog_api_app_config_models_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/llm/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview Sampling */
        post: operations["preview_sampling_api_app_config_llm_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/agent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取Agent通用配置信息
         * @description 包含最大迭代次数、最大重试次数、最大搜索结果数
         */
        get: operations["get_agent_config_api_app_config_agent_get"];
        put?: never;
        /**
         * 更新Agent通用配置信息
         * @description 更新Agent通用配置信息
         */
        post: operations["update_llm_config_api_app_config_agent_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/tool-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取工具策略表
         * @description 规则键：内置工具写函数名或 <工具集>:*；MCP 写 mcp:<服务名>:<工具名>、mcp:<服务名>:*、mcp:*；A2A 写 a2a:<远程Agent id>:call_remote_agent、a2a:<id>:*、a2a:*。值为 allow / ask / deny，未匹配任何规则的调用为 allow
         */
        get: operations["get_tool_policy_api_app_config_tool_policy_get"];
        put?: never;
        /**
         * 更新工具策略表
         * @description 整体替换规则表；键格式不正确或指向计划、提问工具时返回 400。从下一次创建的执行任务起生效
         */
        post: operations["update_tool_policy_api_app_config_tool_policy_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/mcp-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取MCP服务器工具列表
         * @description 获取当前系统的MCP服务器列表，包含MCP服务名字、工具列表、启用状态等
         */
        get: operations["get_mcp_servers_api_app_config_mcp_servers_get"];
        put?: never;
        /**
         * 新增MCP服务配置，支持传递一个或者多个配置
         * @description 传递MCP配置信息为系统新增MCP工具
         */
        post: operations["create_mcp_servers_api_app_config_mcp_servers_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/mcp-servers/{server_name}/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 删除MCP服务配置
         * @description 根据传递的MCP服务名字删除指定的MCP服务
         */
        post: operations["delete_mcp_server_api_app_config_mcp_servers__server_name__delete_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/mcp-servers/{server_name}/enabled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 更新MCP服务的启用状态
         * @description 根据传递的server_name+enabled更新指定MCP服务的启用状态
         */
        post: operations["set_mcp_server_enabled_api_app_config_mcp_servers__server_name__enabled_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/a2a-servers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取a2a服务器列表
         * @description 获取MoocManus项目中的所有已配置的a2a服务列表
         */
        get: operations["get_a2a_servers_api_app_config_a2a_servers_get"];
        put?: never;
        /**
         * 新增a2a服务器
         * @description 为MoocManus项目新增a2a服务器
         */
        post: operations["create_a2a_server_api_app_config_a2a_servers_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/a2a-servers/{a2a_id}/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 删除a2a服务器
         * @description 根据A2A服务id标识删除指定的A2A服务
         */
        post: operations["delete_a2a_server_api_app_config_a2a_servers__a2a_id__delete_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/app-config/a2a-servers/{a2a_id}/enabled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 更新A2A服务的启用状态
         * @description 启动or禁用A2A服务的状态
         */
        post: operations["set_a2a_server_enabled_api_app_config_a2a_servers__a2a_id__enabled_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/download-batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 下载选定附件 ZIP */
        get: operations["download_batch_link_api_files_download_batch_get"];
        put?: never;
        /** 将选定附件打包为 ZIP */
        post: operations["download_batch_api_files_download_batch_post"];
        delete?: never;
        options?: never;
        /** 核对选定附件 ZIP 能否下载 */
        head: operations["download_batch_link_api_files_download_batch_head"];
        patch?: never;
        trace?: never;
    };
    "/api/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 对话文件上传接口
         * @description 上传附件并保存为内容对象；发送消息时附件放入该会话的工作目录
         */
        post: operations["upload_file_api_files_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/{file_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取文件信息接口
         * @description 获取指定会话中对应文件的基础信息
         */
        get: operations["get_file_info_api_files__file_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/{file_id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 文件下载接口
         * @description 下载附件或交付文件的内容对象
         */
        get: operations["download_file_api_files__file_id__download_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        /**
         * 核对文件能否下载
         * @description 下载指定会话中的指定文件
         */
        head: operations["download_file_api_files__file_id__download_head"];
        patch?: never;
        trace?: never;
    };
    "/api/files/{file_id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Attachment Preview */
        get: operations["attachment_preview_api_files__file_id__preview_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/files/{file_id}/preview/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Attachment Content */
        get: operations["attachment_content_api_files__file_id__preview_content_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取会话列表基础信息
         * @description 获取MoocManus项目中所有任务会话基础信息列表
         */
        get: operations["get_all_sessions_api_sessions_get"];
        put?: never;
        /**
         * 创建新任务会话
         * @description 创建一个空白的新任务会话
         */
        post: operations["create_session_api_sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 流式获取所有会话基础信息列表
         * @description 连接后先推送一页列表。目录有写入时再查；没有通知时最多每 30 秒兜底一次。内容没变不重复推送。
         */
        post: operations["stream_sessions_api_sessions_stream_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/clear-unread-message-count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 清除指定任务会话未读消息数
         * @description 清除指定任务会话未读消息数
         */
        post: operations["clear_unread_message_count_api_sessions__session_id__clear_unread_message_count_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 删除指定任务会话
         * @description 根据传递的会话id删除指定任务会话
         */
        post: operations["delete_session_api_sessions__session_id__delete_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/chat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 向指定任务会话发送消息
         * @description 受理一条用户消息并立即返回 run_id 与消息事件的 seq；执行过程通过事件流接口观察。mode 为 plan 时新运行以计划模式执行；会话有活动运行（会注入或续接）时带 plan 返回 409。带 request_id 时同身份同内容返回原受理结果，内容不同返回 409；结果未知时按身份读回
         */
        post: operations["chat_api_sessions__session_id__chat_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/requests/{request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 按请求身份读回受理结果
         * @description 发送结果未知时先读回；没有受理记录返回 404，此时原请求尚未被核心受理，可以按同一身份重新发送
         */
        get: operations["get_accepted_request_api_sessions__session_id__requests__request_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/inputs/{input_id}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 重新发起未处理的消息
         * @description 所属运行已结束（如核心重启中断或被停止）而尚未进入模型历史的消息，明确交给一个新运行处理；消息不重复写入。已处理、正在处理或会话已有活动运行时返回 409
         */
        post: operations["resume_input_api_sessions__session_id__inputs__input_id__resume_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/model": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 保存会话的模型与思考强度
         * @description 写入下一次新运行使用的模型 id 与思考参数。进行中的运行仍用自己的快照。
         */
        put: operations["set_session_model_api_sessions__session_id__model_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/compact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 手动压缩会话上下文
         * @description 没有活动运行时把较早的轮次替换为摘要，写入不属于任何运行的 compact(trigger=manual) 与 context(replace)。会话不存在 404；有运行中或等待中（提问或审批）的运行 409；少于 2 轮返回 status=skipped；摘要请求失败 502，上下文不变。压缩期间 chat/compact 及时返回 409；摘要总期限 60 秒，超时结果需读回核对
         */
        post: operations["compact_session_api_sessions__session_id__compact_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/title": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 重命名会话 */
        put: operations["rename_title_api_sessions__session_id__title_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/title/suggestion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 生成标题建议 */
        post: operations["suggest_title_api_sessions__session_id__title_suggestion_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/approvals/{tool_call_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 回复工具调用的审批
         * @description decision 为 approve（执行该调用一次）或 deny（回填“用户拒绝执行”）；运行随后续接，过程通过事件流观察。审批请求不存在返回 404；已回复、已失效或运行已结束返回 409，不重复执行
         */
        post: operations["reply_approval_api_sessions__session_id__approvals__tool_call_id__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 按序号订阅会话事件
         * @description SSE：推送 after_seq（或 Last-Event-ID）之后的全部事件，每条的 id 是会话内 seq；连接不主动结束
         */
        get: operations["stream_events_api_sessions__session_id__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取指定会话详情信息
         * @description 返回会话、全部运行，以及 after_seq 之后按 seq 升序的事件（limit 为空时读到最新）
         */
        get: operations["get_session_api_sessions__session_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/context-preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Preview Context */
        get: operations["preview_context_api_sessions__session_id__context_preview_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/runs/{run_id}/turns/{index}/request": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 重建某一轮的模型请求
         * @description 只读调试：由运行的配置快照与事件重建该轮发给模型的消息与工具，不重放任何动作
         */
        get: operations["get_turn_request_api_sessions__session_id__runs__run_id__turns__index__request_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 停止指定任务会话
         * @description 根据传递的指定会话id停止对应任务会话
         */
        post: operations["stop_session_api_sessions__session_id__stop_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 获取指定任务会话文件列表信息
         * @description 获取指定任务会话文件列表信息
         */
        get: operations["get_session_files_api_sessions__session_id__files_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/data/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取清空范围 */
        get: operations["preview_api_data_preview_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/data/tasks/latest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取最近一次清空 */
        get: operations["latest_api_data_tasks_latest_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/data/tasks/{identifier}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取清空进度 */
        get: operations["read_api_data_tasks__identifier__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/data/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 清空所有对话与附件
         * @description 删除全部会话与文件记录并登记持久清理任务回收字节；有运行中或等待中的对话时返回 409
         */
        post: operations["reset_api_data_reset_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/data/tasks/{identifier}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 按原清单重试回收 */
        post: operations["retry_api_data_tasks__identifier__retry_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/operations/{operation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 查询操作状态 */
        get: operations["get_operation_api_operations__operation_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/operations/{operation_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 请求取消操作
         * @description 排队中的操作直接取消；运行中的操作记录取消请求，由执行端在安全点确认。已结束的操作原样返回
         */
        post: operations["cancel_operation_api_operations__operation_id__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/operations/{operation_id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 重试操作
         * @description 失败或取消且类型支持重试时按同一身份重新排队并递增代次；其他状态原样返回
         */
        post: operations["retry_operation_api_operations__operation_id__retry_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Skills */
        get: operations["list_skills_api_skills_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Import */
        post: operations["create_import_api_skills_imports_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/imports/zip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload Import */
        post: operations["upload_import_api_skills_imports_zip_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/imports/local": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upload Local */
        post: operations["upload_local_api_skills_imports_local_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/imports/{operation_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Import */
        get: operations["get_import_api_skills_imports__operation_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/imports/{operation_id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publish Import */
        post: operations["publish_import_api_skills_imports__operation_id__publish_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/imports/{operation_id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Import File */
        get: operations["import_file_api_skills_imports__operation_id__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/imports/{operation_id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Revise Import */
        put: operations["revise_import_api_skills_imports__operation_id__content_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/{name}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Skill File */
        get: operations["skill_file_api_skills__name__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Skill Detail */
        get: operations["skill_detail_api_skills__name__get"];
        /** Edit Skill */
        put: operations["edit_skill_api_skills__name__put"];
        post?: never;
        /** Delete Skill */
        delete: operations["delete_skill_api_skills__name__delete"];
        options?: never;
        head?: never;
        /** Change Skill */
        patch: operations["change_skill_api_skills__name__patch"];
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * AgentConfig
         * @description Agent通用配置
         */
        AgentConfig: {
            /**
             * Max Iterations
             * @default 100
             */
            max_iterations: number;
            /**
             * Max Retries
             * @default 3
             */
            max_retries: number;
            /**
             * Max Search Results
             * @default 10
             */
            max_search_results: number;
            /**
             * Context Safety Ratio
             * @default 0.05
             */
            context_safety_ratio: number;
            /**
             * Compact Watermark
             * @default 0.75
             */
            compact_watermark: number;
            /**
             * Compact Keep Turns
             * @default 3
             */
            compact_keep_turns: number;
            /**
             * Compact User Chars
             * @default 16000
             */
            compact_user_chars: number;
            /**
             * Tool Result Max Chars
             * @default 8000
             */
            tool_result_max_chars: number;
        };
        /**
         * ApprovalEventData
         * @description 工具级审批。字段名与工具事件一致（name 为工具集、function 为函数名、args 为参数）；decided_at 为毫秒时间戳。
         */
        ApprovalEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /** Tool Call Id */
            tool_call_id: string;
            /** Name */
            name: string;
            /** Function */
            function: string;
            /** Args */
            args: {
                [key: string]: unknown;
            };
            /**
             * Status
             * @enum {string}
             */
            status: "pending" | "approved" | "rejected" | "expired";
            /** Rule */
            rule: string | null;
            /** Service */
            service: string | null;
            /** Service Tool */
            service_tool: string | null;
            /** Decided At */
            decided_at: number | null;
        };
        /**
         * ApprovalRequest
         * @description 审批回复：approve 执行该调用一次，deny 回填“用户拒绝执行”。
         */
        ApprovalRequest: {
            /**
             * Decision
             * @enum {string}
             */
            decision: "approve" | "deny";
        };
        /**
         * ApprovalResponse
         * @description 审批受理结果：approval 事件的 seq 与续接的运行；执行过程通过事件流观察。
         */
        ApprovalResponse: {
            /** Run Id */
            run_id: string;
            /** Seq */
            seq: number;
            /**
             * Status
             * @enum {string}
             */
            status: "approved" | "rejected";
        };
        /**
         * ApprovalSSEEvent
         * @description 工具级审批流式事件
         */
        ApprovalSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "approval";
            data: components["schemas"]["ApprovalEventData"];
        };
        /**
         * AttemptEventData
         * @description 失败的模型请求。reason 是稳定代码，chars 是已推送的文本字符数。
         */
        AttemptEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /** Turn */
            turn: number;
            /** Attempt */
            attempt: number;
            /** Reason */
            reason: string;
            /**
             * Chars
             * @default 0
             */
            chars: number;
            /**
             * Retried
             * @default false
             */
            retried: boolean;
        };
        /**
         * AttemptSSEEvent
         * @description 失败尝试流式事件
         */
        AttemptSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "attempt";
            data: components["schemas"]["AttemptEventData"];
        };
        /**
         * BaseEventData
         * @description 信封的公共元数据。seq 是会话内序号（SSE 的 id），created_at 是毫秒时间戳。
         */
        BaseEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
        };
        /** Body_create_a2a_server_api_app_config_a2a_servers_post */
        Body_create_a2a_server_api_app_config_a2a_servers_post: {
            /** Base Url */
            base_url: string;
        };
        /** Body_set_a2a_server_enabled_api_app_config_a2a_servers__a2a_id__enabled_post */
        Body_set_a2a_server_enabled_api_app_config_a2a_servers__a2a_id__enabled_post: {
            /** Enabled */
            enabled: boolean;
        };
        /** Body_set_mcp_server_enabled_api_app_config_mcp_servers__server_name__enabled_post */
        Body_set_mcp_server_enabled_api_app_config_mcp_servers__server_name__enabled_post: {
            /** Enabled */
            enabled: boolean;
        };
        /** Body_upload_file_api_files_post */
        Body_upload_file_api_files_post: {
            /**
             * File
             * Format: binary
             */
            file: string;
        };
        /** Body_upload_import_api_skills_imports_zip_post */
        Body_upload_import_api_skills_imports_zip_post: {
            /** Operation Id */
            operation_id: string;
            /**
             * File
             * Format: binary
             */
            file: string;
            /** Update Name */
            update_name?: string | null;
            /** Expected Version */
            expected_version?: string | null;
        };
        /** Body_upload_local_api_skills_imports_local_post */
        Body_upload_local_api_skills_imports_local_post: {
            /** Paths */
            paths: string[];
            /** Files */
            files: string[];
            /** Operation Id */
            operation_id: string;
            /**
             * Unpack Zip
             * @default 0
             */
            unpack_zip: string;
            /** Update Name */
            update_name?: string | null;
            /** Expected Version */
            expected_version?: string | null;
        };
        /**
         * BuildIdentity
         * @description 构建身份；fingerprint 为空表示未知，不能用 Git 提交代替内容依据。
         */
        BuildIdentity: {
            /** Service */
            service: string;
            /** Algorithm */
            algorithm: string | null;
            /** Fingerprint */
            fingerprint: string | null;
            /** Revision */
            revision: string | null;
            /** Dirty */
            dirty: boolean | null;
            /** Built At */
            built_at: string | null;
        };
        /** BuiltinToolset */
        BuiltinToolset: {
            /** Toolset */
            toolset: string;
            /** Functions */
            functions?: string[];
        };
        /**
         * Capability
         * @enum {string}
         */
        Capability: "file_access" | "local_command" | "browser" | "full_text_search" | "semantic_index" | "ocr" | "remote_control";
        /**
         * CapabilityState
         * @enum {string}
         */
        CapabilityState: "available" | "unavailable";
        /** CapabilityStatus */
        CapabilityStatus: {
            capability: components["schemas"]["Capability"];
            state: components["schemas"]["CapabilityState"];
            reason: components["schemas"]["UnavailableReason"] | null;
            /**
             * Recoverable
             * @default false
             */
            recoverable: boolean;
            /** Detail */
            detail: string | null;
        };
        /**
         * ChatRequest
         * @description 聊天请求结构
         */
        ChatRequest: {
            execute_plan?: components["schemas"]["PlanAcceptance"] | null;
            /** Message */
            message?: string | null;
            /** Attachments */
            attachments?: string[] | null;
            /** Timestamp */
            timestamp?: number | null;
            /**
             * Mode
             * @default normal
             * @enum {string}
             */
            mode: "normal" | "plan";
            /** Model */
            model?: string | null;
            /** Reasoning */
            reasoning?: string | null;
            skill?: components["schemas"]["SkillSelection"] | null;
            /**
             * Image Mode
             * @default auto
             * @enum {string}
             */
            image_mode: "auto" | "files";
            request_id?: components["schemas"]["RequestId"] | null;
        };
        /**
         * ChatResponse
         * @description chat 受理结果：消息事件的 seq 与处理它的运行；执行过程通过 GET /sessions/{id}/events 观察。
         */
        ChatResponse: {
            /** Run Id */
            run_id: string;
            /** Seq */
            seq: number;
            /** Route */
            route: string;
        };
        /**
         * CleanupEventData
         * @description 停止后的收尾结果，失败不改变运行终态。
         */
        CleanupEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /** Targets */
            targets: components["schemas"]["CleanupTarget"][];
        };
        /** CleanupPreview */
        CleanupPreview: {
            /** Name */
            name: string;
            /** Counts */
            counts: {
                [key: string]: number;
            };
            /** Blocked Reason */
            blocked_reason?: string | null;
            /** Occupying Session Id */
            occupying_session_id?: string | null;
            task?: components["schemas"]["CleanupTask"] | null;
        };
        /** CleanupRequest */
        CleanupRequest: {
            /**
             * Confirmation
             * @default
             */
            confirmation: string;
        };
        /** CleanupSSEEvent */
        CleanupSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "cleanup";
            data: components["schemas"]["CleanupEventData"];
        };
        /** CleanupTarget */
        CleanupTarget: {
            /**
             * Kind
             * @default shell
             * @enum {string}
             */
            kind: "shell" | "a2a" | "browser";
            /** Id */
            id: string;
            /** Success */
            success: boolean;
            /**
             * Message
             * @default
             */
            message: string;
        };
        /** CleanupTask */
        CleanupTask: {
            /** Id */
            id: string;
            /**
             * Scope
             * @default all
             */
            scope: string;
            /** Project Id */
            project_id?: string | null;
            /**
             * Name
             * @default 所有对话与附件
             */
            name: string;
            /** State */
            state: string;
            /** Phase */
            phase: string;
            /**
             * Completed
             * @default 0
             */
            completed: number;
            /**
             * Total
             * @default 0
             */
            total: number;
            /** Error */
            error?: string | null;
            /** Counts */
            counts?: {
                [key: string]: number;
            };
            /** Session Ids */
            session_ids?: string[];
            /** Project Ids */
            project_ids?: string[];
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /**
         * CompactEventData
         * @description 压缩事件数据，字段含义见领域模型 CompactEvent；摘要全文随事件推送，供开发者视图显示。manual 时 run_id 为空。
         */
        CompactEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /**
             * Trigger
             * @enum {string}
             */
            trigger: "watermark" | "overflow" | "manual";
            /** Before Estimate */
            before_estimate: {
                [key: string]: unknown;
            };
            /** After Estimate */
            after_estimate: {
                [key: string]: unknown;
            };
            /**
             * Summarized Turns
             * @default 0
             */
            summarized_turns: number;
            /**
             * Kept Turns
             * @default 0
             */
            kept_turns: number;
            /**
             * Summary
             * @default
             */
            summary: string;
            /** Reinjected Event Seqs */
            reinjected_event_seqs: number[];
            /**
             * Omitted User Messages
             * @default 0
             */
            omitted_user_messages: number;
            usage: components["schemas"]["CompactUsage"];
        };
        /**
         * CompactResponse
         * @description 手动压缩结果。compacted：两条事件的 seq、前后估算总量（按字符估算的 tokens）与轮数；
         *     skipped：reason 为 no_rounds，没有写事件，其余字段为空。
         */
        CompactResponse: {
            /**
             * Status
             * @enum {string}
             */
            status: "compacted" | "skipped";
            /** Reason */
            reason?: "no_rounds" | null;
            /** Message */
            message: string;
            /** Compact Seq */
            compact_seq?: number | null;
            /** Context Seq */
            context_seq?: number | null;
            /** Before Total */
            before_total?: number | null;
            /** After Total */
            after_total?: number | null;
            /** Summarized Turns */
            summarized_turns?: number | null;
            /** Kept Turns */
            kept_turns?: number | null;
        };
        /**
         * CompactSSEEvent
         * @description 压缩流式事件
         */
        CompactSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "compact";
            data: components["schemas"]["CompactEventData"];
        };
        /**
         * CompactUsage
         * @description 摘要请求各次尝试的用量合计；属于运行时计入运行的模型请求数与 tokens，不算一轮。
         */
        CompactUsage: {
            /**
             * Attempts
             * @default 0
             */
            attempts: number;
            /** Prompt Tokens */
            prompt_tokens?: number | null;
            /** Completion Tokens */
            completion_tokens?: number | null;
            /** Cached Tokens */
            cached_tokens?: number | null;
        };
        /**
         * ContextEventData
         * @description 模型历史变化的轻量投影：消息全文只在数据库与请求重建接口里，推送时只给条数与角色。
         */
        ContextEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /**
             * Op
             * @enum {string}
             */
            op: "append" | "strip_reasoning" | "replace";
            /**
             * Message Count
             * @default 0
             */
            message_count: number;
            /** Roles */
            roles: string[];
        };
        /** ContextOperation */
        ContextOperation: {
            /**
             * Status
             * @default idle
             * @enum {string}
             */
            status: "idle" | "compacting";
            /** Started At */
            started_at?: string | null;
        };
        /**
         * ContextSSEEvent
         * @description 模型历史变化流式事件
         */
        ContextSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "context";
            data: components["schemas"]["ContextEventData"];
        };
        /** CoreInstance */
        CoreInstance: {
            instance_id: components["schemas"]["InstanceId"];
            /** Pid */
            pid: number;
            /**
             * Started At
             * @description 核心进程启动时间，毫秒时间戳
             */
            started_at: number;
        };
        /** CoreStatus */
        CoreStatus: {
            /** @default 1 */
            protocol_version: components["schemas"]["ProtocolVersion"];
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            instance: components["schemas"]["CoreInstance"];
            build: components["schemas"]["BuildIdentity"];
            /** @description 业务库 schema 版本；业务库尚未打开时为空 */
            storage: components["schemas"]["StorageVersion"] | null;
            /** Capabilities */
            capabilities: components["schemas"]["CapabilityStatus"][];
            /**
             * Healthy
             * @description 全部依赖服务检查通过
             */
            healthy: boolean;
            /** Services */
            services: components["schemas"]["HealthStatus"][];
        };
        /** CreateSessionRequest */
        CreateSessionRequest: {
            /** Creation Id */
            creation_id?: string | null;
        };
        /**
         * CreateSessionResponse
         * @description 创建会话响应结构
         */
        CreateSessionResponse: {
            /** Session Id */
            session_id: string;
        };
        /** DoneEventData */
        DoneEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /**
             * Outcome
             * @default complete
             */
            outcome: string;
            /** Missing */
            missing: string[];
        };
        /**
         * DoneSSEEvent
         * @description 停止流式事件
         */
        DoneSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "done";
            data: components["schemas"]["DoneEventData"];
        };
        /** DownloadBatch */
        DownloadBatch: {
            /** File Ids */
            file_ids: string[];
        };
        /** EditRequest */
        EditRequest: {
            /** Expected Version */
            expected_version: string;
            /** Text */
            text: string;
        };
        /** EnvironmentEventData */
        EnvironmentEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /**
             * Status
             * @enum {string}
             */
            status: "preparing" | "ready";
            /** Message */
            message: string | null;
        };
        /** EnvironmentSSEEvent */
        EnvironmentSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "environment";
            data: components["schemas"]["EnvironmentEventData"];
        };
        /**
         * ErrorCode
         * @description 机器可读的错误代码，按客户端的处理方式区分；具体原因写在 message 与 details。
         * @enum {string}
         */
        ErrorCode: "invalid_request" | "validation_failed" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "gone" | "payload_too_large" | "range_not_satisfiable" | "context_limit" | "rate_limited" | "internal_error" | "upstream_error" | "unavailable" | "timeout";
        /**
         * ErrorEventData
         * @description 错误事件数据
         */
        ErrorEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /** Error */
            error: string;
            /** Context Estimate */
            context_estimate: {
                [key: string]: unknown;
            } | null;
            /**
             * Fixed Input Exceeded
             * @default false
             */
            fixed_input_exceeded: boolean;
        };
        /**
         * ErrorInfo
         * @description retryable 表示原样重试不会制造重复副作用；结果未知的失败为 false，需要先读回。
         */
        ErrorInfo: {
            code: components["schemas"]["ErrorCode"];
            /**
             * Message
             * @description 给用户看的原因
             */
            message: string;
            /**
             * Retryable
             * @default false
             */
            retryable: boolean;
            /**
             * Retry After Ms
             * @description 建议的最短重试等待
             */
            retry_after_ms: number | null;
            /** @description 冲突时资源的当前版本 */
            resource_version: components["schemas"]["ResourceVersion"] | null;
            /**
             * Details
             * @description 与代码相关的补充字段
             */
            details: {
                [key: string]: unknown;
            };
        };
        /**
         * ErrorResponse
         * @description 失败响应：HTTP 状态表达类别，error 给出机器可读代码、原因与重试建议。
         */
        ErrorResponse: {
            error: components["schemas"]["ErrorInfo"];
        };
        /**
         * ErrorSSEEvent
         * @description 错误流式事件
         */
        ErrorSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "error";
            data: components["schemas"]["ErrorEventData"];
        };
        /** @description 事件结构版本 */
        EventVersion: number;
        /**
         * ExecutionStatus
         * @enum {string}
         */
        ExecutionStatus: "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled";
        /**
         * File
         * @description 文件信息Domain模型，用于记录用户上传或 Agent 交付的文件；字节保存为数据根中的内容对象
         */
        File: {
            /** Id */
            id?: string;
            /**
             * Filename
             * @default
             */
            filename: string;
            /**
             * Filepath
             * @default
             */
            filepath: string;
            /**
             * Key
             * @default
             */
            key: string;
            /**
             * Extension
             * @default
             */
            extension: string;
            /**
             * Mime Type
             * @default
             */
            mime_type: string;
            /**
             * Size
             * @default 0
             */
            size: number;
            /** Sha256 */
            sha256?: string | null;
            /** Visual */
            visual?: {
                [key: string]: unknown;
            } | null;
        };
        /** @description 代次：对象被重试或替换时递增，迟到结果代次不符时不得写回 */
        Generation: number;
        /**
         * GetSessionFilesResponse
         * @description 获取会话文件列表响应结构
         */
        GetSessionFilesResponse: {
            /** Files */
            files?: components["schemas"]["File"][];
        };
        /**
         * GetSessionResponse
         * @description 获取会话详情响应结构。events 为 after_seq 之后按 seq 升序的事件；last_seq 是会话当前最大 seq。
         */
        GetSessionResponse: {
            /** Session Id */
            session_id: string;
            /** Title */
            title?: string | null;
            status: components["schemas"]["SessionStatus"];
            /** Runs */
            runs?: components["schemas"]["RunItem"][];
            /** Events */
            events?: components["schemas"]["SessionEvent"][];
            /**
             * Last Seq
             * @default 0
             */
            last_seq: number;
            context_operation?: components["schemas"]["ContextOperation"];
            /** Context Config */
            context_config?: {
                [key: string]: number;
            };
            /** Unconsumed Inputs */
            unconsumed_inputs?: components["schemas"]["UnconsumedInputItem"][];
            /** Model Id */
            model_id?: string | null;
            /** Reasoning */
            reasoning?: string | null;
            /** Run Model */
            run_model?: string | null;
            /** Run Reasoning */
            run_reasoning?: string | null;
        };
        /**
         * HealthStatus
         * @description 健康检查状态
         */
        HealthStatus: {
            /**
             * Service
             * @description 健康检查对应的服务名字
             * @default
             */
            service: string;
            /**
             * Status
             * @description ok 表示正常，error 表示出错
             * @default ok
             * @enum {string}
             */
            status: "ok" | "error";
            /**
             * Details
             * @description 出错时的详情提示
             * @default
             */
            details: string;
        };
        /** ImportRequest */
        ImportRequest: {
            /** Operation Id */
            operation_id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "github" | "manual";
            /** Url */
            url?: string | null;
            /** Text */
            text?: string | null;
            /** Update Name */
            update_name?: string | null;
            /** Expected Version */
            expected_version?: string | null;
        };
        /** @description 核心进程的一次启动 */
        InstanceId: string;
        /**
         * LLMConfigPublic
         * @description 设置页可见的 LLM 配置；不含密钥明文。
         */
        LLMConfigPublic: {
            /** Base Url */
            base_url: string;
            /** Model Name */
            model_name: string;
            /** Temperature */
            temperature: number;
            /** Max Tokens */
            max_tokens: number;
            /** Context Window */
            context_window: number;
            /** Model Profiles */
            model_profiles?: {
                [key: string]: components["schemas"]["ModelSamplingPublic"];
            };
            /**
             * Has Api Key
             * @default false
             */
            has_api_key: boolean;
        };
        /**
         * LLMConfigUpdate
         * @description 更新 LLM 配置时忽略密钥字段。未提交的字段保持原值。
         */
        LLMConfigUpdate: {
            /** Base Url */
            base_url?: string | null;
            /** Model Name */
            model_name?: string | null;
            /**
             * Temperature
             * @default 0.7
             */
            temperature: number;
            /**
             * Max Tokens
             * @default 8192
             */
            max_tokens: number;
            /**
             * Context Window
             * @default 200000
             */
            context_window: number;
            /** Model Profiles */
            model_profiles?: {
                [key: string]: components["schemas"]["ModelSampling"];
            } | null;
        };
        /** ListA2AServerItem */
        ListA2AServerItem: {
            /**
             * Connection Status
             * @enum {string}
             */
            connection_status: "connected" | "disabled" | "unavailable";
            /** Error */
            error?: string | null;
            /** Base Url */
            base_url: string;
            /**
             * Id
             * @default
             */
            id: string;
            /**
             * Name
             * @default
             */
            name: string;
            /**
             * Description
             * @default
             */
            description: string;
            /** Input Modes */
            input_modes?: string[];
            /** Output Modes */
            output_modes?: string[];
            /**
             * Streaming
             * @default false
             */
            streaming: boolean;
            /**
             * Push Notifications
             * @default false
             */
            push_notifications: boolean;
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
        };
        /**
         * ListA2AServerResponse
         * @description 获取A2A服务列表响应结构
         */
        ListA2AServerResponse: {
            /** A2A Servers */
            a2a_servers?: components["schemas"]["ListA2AServerItem"][];
        };
        /**
         * ListMCPServerItem
         * @description MCP服务列表条目选项
         */
        ListMCPServerItem: {
            /**
             * Connection Status
             * @enum {string}
             */
            connection_status: "connected" | "disabled" | "unavailable";
            /** Error */
            error?: string | null;
            /**
             * Server Name
             * @default
             */
            server_name: string;
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /** @default streamable_http */
            transport: components["schemas"]["MCPTransport"];
            /** Tools */
            tools?: string[];
        };
        /**
         * ListMCPServerResponse
         * @description 获取MCP服务列表响应结构
         */
        ListMCPServerResponse: {
            /** Mcp Servers */
            mcp_servers?: components["schemas"]["ListMCPServerItem"][];
        };
        /**
         * ListSessionItem
         * @description 会话列表条目基础信息
         */
        ListSessionItem: {
            /**
             * Session Id
             * @default
             */
            session_id: string;
            /**
             * Title
             * @default
             */
            title: string;
            /**
             * Latest Message
             * @default
             */
            latest_message: string;
            /** Latest Message At */
            latest_message_at?: string | null;
            /** @default pending */
            status: components["schemas"]["SessionStatus"];
            /**
             * Unread Message Count
             * @default 0
             */
            unread_message_count: number;
        };
        /**
         * ListSessionResponse
         * @description 获取会话列表基础信息响应结构
         */
        ListSessionResponse: {
            /** Sessions */
            sessions: components["schemas"]["ListSessionItem"][];
            /**
             * Total
             * @default 0
             */
            total: number;
            /**
             * Offset
             * @default 0
             */
            offset: number;
            /**
             * Limit
             * @default 50
             */
            limit: number;
        };
        /** MCPConfig */
        MCPConfig: {
            /** Mcpservers */
            mcpServers?: {
                [key: string]: components["schemas"]["MCPServerConfig"];
            };
            /**
             * Discovery Budget
             * @default 20
             */
            discovery_budget: number;
        };
        /** MCPServerConfig */
        MCPServerConfig: {
            /**
             * Connect Timeout
             * @default 10
             */
            connect_timeout: number;
            /**
             * Discovery Timeout
             * @default 15
             */
            discovery_timeout: number;
            /**
             * Call Timeout
             * @default 120
             */
            call_timeout: number;
            /** @default streamable_http */
            transport: components["schemas"]["MCPTransport"];
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /** Description */
            description?: string | null;
            /** Env */
            env?: {
                [key: string]: string;
            };
            /** Command */
            command?: string | null;
            /** Args */
            args?: string[];
            /** Url */
            url?: string | null;
            /** Headers */
            headers?: {
                [key: string]: string;
            };
        };
        /**
         * MCPTransport
         * @enum {string}
         */
        MCPTransport: "stdio" | "streamable_http";
        /**
         * MessageEventData
         * @description 消息事件数据
         */
        MessageEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /**
             * Role
             * @default assistant
             * @enum {string}
             */
            role: "user" | "assistant";
            /**
             * Message
             * @default
             */
            message: string;
            /** Attachments */
            attachments: components["schemas"]["File"][];
            skill: components["schemas"]["SkillSelection"] | null;
            /**
             * Image Mode
             * @default auto
             * @enum {string}
             */
            image_mode: "auto" | "files";
            /** Attempt */
            attempt: number | null;
        };
        /**
         * MessageSSEEvent
         * @description 流式消息事件数据响应结构
         */
        MessageSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "message";
            data: components["schemas"]["MessageEventData"];
        };
        /** ModelCatalogItem */
        ModelCatalogItem: {
            /** Id */
            id: string;
            /** Vendor */
            vendor: string;
            /** Vendor Label */
            vendor_label: string;
            /**
             * Vision
             * @default false
             */
            vision: boolean;
            /** Context Window */
            context_window: number;
            /** Max Output */
            max_output: number;
            /** Choices */
            choices: string[];
            /** Default Choice */
            default_choice: string;
            /** Reasoning Options */
            reasoning_options?: {
                [key: string]: unknown;
            }[];
            /**
             * Reasoning Ordered
             * @default false
             */
            reasoning_ordered: boolean;
            /** Reasoning Family */
            reasoning_family?: string | null;
            /**
             * Temperature When
             * @default always
             * @enum {string}
             */
            temperature_when: "always" | "disabled" | "never";
            /** Temperature Max */
            temperature_max?: number | null;
        };
        /** ModelCatalogResponse */
        ModelCatalogResponse: {
            /** Provider */
            provider?: string | null;
            /** Models */
            models?: components["schemas"]["ModelCatalogItem"][];
            /** Default Model */
            default_model?: string | null;
        };
        /**
         * ModelSampling
         * @description 一个模型给新建对话使用的温度、输出上限和上下文窗口。
         */
        ModelSampling: {
            /**
             * Temperature
             * @default 0.7
             */
            temperature: number;
            /**
             * Max Tokens
             * @default 8192
             */
            max_tokens: number;
            /**
             * Context Window
             * @default 200000
             */
            context_window: number;
        };
        /** ModelSamplingPublic */
        ModelSamplingPublic: {
            /** Temperature */
            temperature: number;
            /** Max Tokens */
            max_tokens: number;
            /** Context Window */
            context_window: number;
        };
        /** ModelSelectionRequest */
        ModelSelectionRequest: {
            /** Model */
            model: string;
            /** Reasoning */
            reasoning: string;
        };
        /** ModelSelectionResponse */
        ModelSelectionResponse: {
            /** Model */
            model: string;
            /** Reasoning */
            reasoning: string;
        };
        /** @description 长操作身份；查询、取消与重试沿同一身份 */
        OperationId: string;
        /**
         * OperationKind
         * @description 新增类型在这里登记，各工作包不另起同义名称。
         * @enum {string}
         */
        OperationKind: "component_install" | "document_index" | "memory_extraction" | "session_summary" | "data_cleanup";
        /** OperationProgress */
        OperationProgress: {
            /**
             * Completed
             * @default 0
             */
            completed: number;
            /** Total */
            total?: number | null;
        };
        /**
         * OperationScope
         * @description 操作的所有者范围；查询、取消与重试按范围核对来源。
         */
        OperationScope: {
            kind: components["schemas"]["OperationScopeKind"];
            workspace_id?: components["schemas"]["WorkspaceId"] | null;
            session_id?: components["schemas"]["SessionId"] | null;
        };
        /**
         * OperationScopeKind
         * @enum {string}
         */
        OperationScopeKind: "app" | "workspace" | "session";
        /**
         * OperationStatus
         * @enum {string}
         */
        OperationStatus: "queued" | "running" | "succeeded" | "failed" | "cancelled";
        /** OperationView */
        OperationView: {
            operation_id: components["schemas"]["OperationId"];
            kind: components["schemas"]["OperationKind"];
            scope: components["schemas"]["OperationScope"];
            generation: components["schemas"]["Generation"];
            status: components["schemas"]["OperationStatus"];
            /** Phase */
            phase: string | null;
            progress: components["schemas"]["OperationProgress"] | null;
            request_id: components["schemas"]["RequestId"] | null;
            /** Cancel Requested At */
            cancel_requested_at: number | null;
            /** Created At */
            created_at: number;
            /** Updated At */
            updated_at: number;
            /** Finished At */
            finished_at: number | null;
            /** Result */
            result: {
                [key: string]: unknown;
            } | null;
            error: components["schemas"]["ErrorInfo"] | null;
            /** Can Cancel */
            can_cancel: boolean;
            /** Can Retry */
            can_retry: boolean;
        };
        /** PlanAcceptance */
        PlanAcceptance: {
            /** Source Run Id */
            source_run_id: string;
            /** Plan Id */
            plan_id: string;
            /** Source Seq */
            source_seq: number;
            /** Request Id */
            request_id: string;
        };
        /** PlanEventData */
        PlanEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /** Plan Id */
            plan_id: string;
            /**
             * Title
             * @default
             */
            title: string;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Goal
             * @default
             */
            goal: string;
            /**
             * Scope
             * @default
             */
            scope: string;
            /** Artifacts */
            artifacts: {
                [key: string]: unknown;
            }[];
            /**
             * Progress State
             * @default confirmed
             */
            progress_state: string;
            /**
             * Review Only
             * @default false
             */
            review_only: boolean;
            accepted_from: components["schemas"]["PlanAcceptance"] | null;
            /**
             * Explanation
             * @default
             */
            explanation: string;
            /** Steps */
            steps: components["schemas"]["StepEventData"][];
        };
        /**
         * PlanSSEEvent
         * @description 计划流式事件
         */
        PlanSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "plan";
            data: components["schemas"]["PlanEventData"];
        };
        /** @description 核心协议版本 */
        ProtocolVersion: number;
        /** PublishRequest */
        PublishRequest: {
            /** Candidate Path */
            candidate_path: string;
            /** Fingerprint */
            fingerprint: string;
        };
        /** RenameTitleRequest */
        RenameTitleRequest: {
            /** Title */
            title: string;
        };
        /** @description 业务幂等请求身份；同身份不同内容返回冲突 */
        RequestId: string;
        ResourceVersion: number | string;
        /** Response[AgentConfig] */
        Response_AgentConfig_: {
            data: components["schemas"]["AgentConfig"] | null;
        };
        /** Response[ApprovalResponse] */
        Response_ApprovalResponse_: {
            data: components["schemas"]["ApprovalResponse"] | null;
        };
        /** Response[BuildIdentity] */
        Response_BuildIdentity_: {
            data: components["schemas"]["BuildIdentity"] | null;
        };
        /** Response[ChatResponse] */
        Response_ChatResponse_: {
            data: components["schemas"]["ChatResponse"] | null;
        };
        /** Response[CleanupPreview] */
        Response_CleanupPreview_: {
            data: components["schemas"]["CleanupPreview"] | null;
        };
        /** Response[CleanupTask] */
        Response_CleanupTask_: {
            data: components["schemas"]["CleanupTask"] | null;
        };
        /** Response[CompactResponse] */
        Response_CompactResponse_: {
            data: components["schemas"]["CompactResponse"] | null;
        };
        /** Response[CoreStatus] */
        Response_CoreStatus_: {
            data: components["schemas"]["CoreStatus"] | null;
        };
        /** Response[CreateSessionResponse] */
        Response_CreateSessionResponse_: {
            data: components["schemas"]["CreateSessionResponse"] | null;
        };
        /** Response[Dict] */
        Response_Dict_: {
            /** Data */
            data: {
                [key: string]: unknown;
            } | null;
        };
        /** Response[Dict[str, Any]] */
        Response_Dict_str__Any__: {
            /** Data */
            data: {
                [key: string]: unknown;
            } | null;
        };
        /** Response[File] */
        Response_File_: {
            data: components["schemas"]["File"] | null;
        };
        /** Response[GetSessionFilesResponse] */
        Response_GetSessionFilesResponse_: {
            data: components["schemas"]["GetSessionFilesResponse"] | null;
        };
        /** Response[GetSessionResponse] */
        Response_GetSessionResponse_: {
            data: components["schemas"]["GetSessionResponse"] | null;
        };
        /** Response[LLMConfigPublic] */
        Response_LLMConfigPublic_: {
            data: components["schemas"]["LLMConfigPublic"] | null;
        };
        /** Response[ListA2AServerResponse] */
        Response_ListA2AServerResponse_: {
            data: components["schemas"]["ListA2AServerResponse"] | null;
        };
        /** Response[ListMCPServerResponse] */
        Response_ListMCPServerResponse_: {
            data: components["schemas"]["ListMCPServerResponse"] | null;
        };
        /** Response[ListSessionResponse] */
        Response_ListSessionResponse_: {
            data: components["schemas"]["ListSessionResponse"] | null;
        };
        /** Response[ModelCatalogResponse] */
        Response_ModelCatalogResponse_: {
            data: components["schemas"]["ModelCatalogResponse"] | null;
        };
        /** Response[ModelSelectionResponse] */
        Response_ModelSelectionResponse_: {
            data: components["schemas"]["ModelSelectionResponse"] | null;
        };
        /** Response[OperationView] */
        Response_OperationView_: {
            data: components["schemas"]["OperationView"] | null;
        };
        /** Response[TitleResponse] */
        Response_TitleResponse_: {
            data: components["schemas"]["TitleResponse"] | null;
        };
        /** Response[ToolPolicyResponse] */
        Response_ToolPolicyResponse_: {
            data: components["schemas"]["ToolPolicyResponse"] | null;
        };
        /** Response[TurnRequestResponse] */
        Response_TurnRequestResponse_: {
            data: components["schemas"]["TurnRequestResponse"] | null;
        };
        /** Response[Union[CleanupTask, NoneType]] */
        Response_Union_CleanupTask__NoneType__: {
            data: components["schemas"]["CleanupTask"] | null;
        };
        /** Response[Union[Dict, NoneType]] */
        Response_Union_Dict__NoneType__: {
            /** Data */
            data: {
                [key: string]: unknown;
            } | null;
        };
        /** ReviseRequest */
        ReviseRequest: {
            /** Candidate Path */
            candidate_path: string;
            /** Fingerprint */
            fingerprint: string;
            /** Text */
            text: string;
            /** Revision Id */
            revision_id: string;
        };
        /**
         * RunEventData
         * @description 运行状态变化事件数据；终态时 summary 为运行汇总，mode 为运行模式（normal / plan）。
         */
        RunEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            status: components["schemas"]["RunStatus"];
            /** Reason */
            reason: string | null;
            /** Summary */
            summary: {
                [key: string]: unknown;
            } | null;
            mode: components["schemas"]["RunMode"] | null;
        };
        /** @description 运行身份；一个会话至多一个活动运行 */
        RunId: string;
        /**
         * RunItem
         * @description 运行摘要；时间为毫秒时间戳。
         */
        RunItem: {
            /** Run Id */
            run_id: string;
            /** Status */
            status: string;
            /** Reason */
            reason?: string | null;
            /**
             * Mode
             * @default normal
             * @enum {string}
             */
            mode: "normal" | "plan";
            /** Started At */
            started_at: number;
            /** Ended At */
            ended_at?: number | null;
            /**
             * Turns
             * @default 0
             */
            turns: number;
            /**
             * Model Requests
             * @default 0
             */
            model_requests: number;
            /**
             * Tool Calls
             * @default 0
             */
            tool_calls: number;
            /**
             * Prompt Tokens
             * @default 0
             */
            prompt_tokens: number;
            /**
             * Completion Tokens
             * @default 0
             */
            completion_tokens: number;
            /** Cached Tokens */
            cached_tokens?: number | null;
        };
        /**
         * RunMode
         * @description 运行模式：只在新建运行时由 chat 选择，续接沿用。
         * @enum {string}
         */
        RunMode: "normal" | "plan";
        /**
         * RunSSEEvent
         * @description 运行状态流式事件
         */
        RunSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "run";
            data: components["schemas"]["RunEventData"];
        };
        /**
         * RunStatus
         * @description 运行状态。running/waiting 是活动状态，其余是终态，终态不可再改。
         * @enum {string}
         */
        RunStatus: "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted";
        /** SamplingPreviewRequest */
        SamplingPreviewRequest: {
            /** Model */
            model: string;
            sampling: components["schemas"]["ModelSampling"];
        };
        SessionEvent: components["schemas"]["MessageSSEEvent"] | components["schemas"]["TitleSSEEvent"] | components["schemas"]["StepSSEEvent"] | components["schemas"]["PlanSSEEvent"] | components["schemas"]["ToolSSEEvent"] | components["schemas"]["DoneSSEEvent"] | components["schemas"]["ErrorSSEEvent"] | components["schemas"]["WaitSSEEvent"] | components["schemas"]["TurnSSEEvent"] | components["schemas"]["AttemptSSEEvent"] | components["schemas"]["RunSSEEvent"] | components["schemas"]["EnvironmentSSEEvent"] | components["schemas"]["ContextSSEEvent"] | components["schemas"]["CompactSSEEvent"] | components["schemas"]["CleanupSSEEvent"] | components["schemas"]["ApprovalSSEEvent"];
        /** @description 会话身份 */
        SessionId: string;
        /**
         * SessionStatus
         * @description 会话状态：最新运行状态的冗余副本，与运行状态在同一事务更新，供会话列表使用。
         * @enum {string}
         */
        SessionStatus: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted";
        /** SkillSelection */
        SkillSelection: {
            /** Id */
            id: string;
            /** Version */
            version: string;
        };
        /** StateRequest */
        StateRequest: {
            /** Expected Version */
            expected_version: string;
            /** Enabled */
            enabled: boolean;
        };
        /**
         * StepEventData
         * @description 步骤事件数据
         */
        StepEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /** Id */
            id: string;
            status: components["schemas"]["ExecutionStatus"];
            /** Description */
            description: string;
            /**
             * Kind
             * @default stage
             */
            kind: string;
            /** Parent Id */
            parent_id: string | null;
            /**
             * Schedule
             * @default current
             */
            schedule: string;
            /**
             * Reason
             * @default
             */
            reason: string;
        };
        /**
         * StepSSEEvent
         * @description 步骤流式事件
         */
        StepSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "step";
            data: components["schemas"]["StepEventData"];
        };
        /** StorageVersion */
        StorageVersion: {
            /**
             * Schema Revision
             * @description 业务库当前迁移版本
             */
            schema_revision: string;
        };
        /**
         * TitleEventData
         * @description 标题事件数据
         */
        TitleEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /** Title */
            title: string;
        };
        /** TitleResponse */
        TitleResponse: {
            /** Title */
            title: string;
        };
        /**
         * TitleSSEEvent
         * @description 标题流式事件
         */
        TitleSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "title";
            data: components["schemas"]["TitleEventData"];
        };
        /**
         * ToolEventData
         * @description 工具事件数据
         */
        ToolEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /** Tool Call Id */
            tool_call_id: string;
            /** Name */
            name: string;
            status: components["schemas"]["ToolEventStatus"];
            /** Function */
            function: string;
            /** Args */
            args: {
                [key: string]: unknown;
            };
            /** Content */
            content: unknown | null;
            /** Duration Ms */
            duration_ms: number | null;
            /** Stages Ms */
            stages_ms: {
                [key: string]: number;
            };
            shaping: components["schemas"]["ToolResultShaping"] | null;
            /** Denied By */
            denied_by: ("policy" | "user" | "plan_mode" | "budget" | "batch" | "verification_cache" | "verification_limit") | null;
        };
        /**
         * ToolEventStatus
         * @description 工具事件状态类型枚举
         * @enum {string}
         */
        ToolEventStatus: "calling" | "called";
        /**
         * ToolPolicy
         * @description 工具调用前的策略：直接执行、请求用户批准、禁止执行。
         * @enum {string}
         */
        ToolPolicy: "allow" | "ask" | "deny";
        /**
         * ToolPolicyResponse
         * @description 工具策略表与设置页需要的参照信息。未匹配任何规则的调用为 fallback（allow）。
         */
        ToolPolicyResponse: {
            /** Rules */
            rules: {
                [key: string]: components["schemas"]["ToolPolicy"];
            };
            /** Default Rules */
            default_rules: {
                [key: string]: components["schemas"]["ToolPolicy"];
            };
            /** @default allow */
            fallback: components["schemas"]["ToolPolicy"];
            /** Builtin Toolsets */
            builtin_toolsets?: components["schemas"]["BuiltinToolset"][];
        };
        /**
         * ToolPolicyUpdate
         * @description 整体替换工具策略表；键格式见 GET 响应说明与 ToolPolicyConfig。
         */
        ToolPolicyUpdate: {
            /** Rules */
            rules?: {
                [key: string]: components["schemas"]["ToolPolicy"];
            };
        };
        /**
         * ToolResultShaping
         * @description 结果整形元数据：结果序列化后超过单条上限时，进入上下文的只是首尾预览。
         */
        ToolResultShaping: {
            /** Original Chars */
            original_chars: number;
            /** Preview Chars */
            preview_chars: number;
            /**
             * Truncated
             * @default true
             */
            truncated: boolean;
            /** Full Output Path */
            full_output_path?: string | null;
            /** Error */
            error?: string | null;
        };
        /**
         * ToolSSEEvent
         * @description 工具流式事件
         */
        ToolSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "tool";
            data: components["schemas"]["ToolEventData"];
        };
        /**
         * TurnEventData
         * @description 轮次边界事件数据，字段含义见领域模型 TurnEvent。
         */
        TurnEventData: {
            /** Event Id */
            event_id: string | null;
            /** Seq */
            seq: number | null;
            run_id: components["schemas"]["RunId"] | null;
            /**
             * Created At
             * @default 0
             */
            created_at: number;
            /** @default 1 */
            event_version: components["schemas"]["EventVersion"];
            /**
             * Phase
             * @enum {string}
             */
            phase: "started" | "completed";
            /** Index */
            index: number;
            /** Context Estimate */
            context_estimate: {
                [key: string]: unknown;
            } | null;
            /** Context Window */
            context_window: number | null;
            /** Model Ms */
            model_ms: number | null;
            /** Attempts */
            attempts: number | null;
            /** Ttft Ms */
            ttft_ms: number | null;
            usage: components["schemas"]["TurnUsage"] | null;
            /** Finish Reason */
            finish_reason: string | null;
            /** Tool Call Ids */
            tool_call_ids: string[];
            /** Tools Ms */
            tools_ms: number | null;
            /** Error */
            error: string | null;
        };
        /**
         * TurnRequestResponse
         * @description 由运行快照与事件重建的某一轮模型请求（只读调试）。
         */
        TurnRequestResponse: {
            /** Run Id */
            run_id: string;
            /** Index */
            index: number;
            /** Turn Seq */
            turn_seq: number;
            /**
             * Api Protocol
             * @default chat_completions
             */
            api_protocol: string;
            /** Messages */
            messages: {
                [key: string]: unknown;
            }[];
            /** Tools */
            tools: {
                [key: string]: unknown;
            }[];
            /** Images */
            images?: {
                [key: string]: unknown;
            }[];
        };
        /**
         * TurnSSEEvent
         * @description 轮次边界流式事件
         */
        TurnSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "turn";
            data: components["schemas"]["TurnEventData"];
        };
        /**
         * TurnUsage
         * @description 一轮内返回了响应的各次尝试的用量合计；服务未返回的项为空。
         */
        TurnUsage: {
            /** Prompt Tokens */
            prompt_tokens?: number | null;
            /** Completion Tokens */
            completion_tokens?: number | null;
            /** Cached Tokens */
            cached_tokens?: number | null;
            /** Reasoning Tokens */
            reasoning_tokens?: number | null;
        };
        /**
         * UnavailableReason
         * @enum {string}
         */
        UnavailableReason: "not_implemented" | "component_missing" | "component_failed" | "disabled" | "permission_denied" | "dependency_unavailable";
        /**
         * UnconsumedInputItem
         * @description 已受理但所属运行已结束、尚未进入模型历史的消息；可经重新发起接口交给新运行。
         */
        UnconsumedInputItem: {
            /** Input Id */
            input_id: number;
            /** Run Id */
            run_id: string;
            /** Message Seq */
            message_seq: number;
            /** Request Id */
            request_id?: string | null;
        };
        /**
         * WaitSSEEvent
         * @description 等待人类输入流式事件
         */
        WaitSSEEvent: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "wait";
            data: components["schemas"]["BaseEventData"];
        };
        /** @description 工作区身份；独立对话没有工作区 */
        WorkspaceId: string;
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    get_status_api_status_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_CoreStatus_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_build_api_status_build_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_BuildIdentity_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_llm_config_api_app_config_llm_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_LLMConfigPublic_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    update_llm_config_api_app_config_llm_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LLMConfigUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_LLMConfigPublic_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_model_catalog_api_app_config_models_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ModelCatalogResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    preview_sampling_api_app_config_llm_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SamplingPreviewRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Dict_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_agent_config_api_app_config_agent_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_AgentConfig_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    update_llm_config_api_app_config_agent_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentConfig"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_AgentConfig_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_tool_policy_api_app_config_tool_policy_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ToolPolicyResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    update_tool_policy_api_app_config_tool_policy_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ToolPolicyUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ToolPolicyResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_mcp_servers_api_app_config_mcp_servers_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ListMCPServerResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    create_mcp_servers_api_app_config_mcp_servers_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MCPConfig"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_Dict__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete_mcp_server_api_app_config_mcp_servers__server_name__delete_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                server_name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_Dict__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    set_mcp_server_enabled_api_app_config_mcp_servers__server_name__enabled_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                server_name: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Body_set_mcp_server_enabled_api_app_config_mcp_servers__server_name__enabled_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_Dict__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_a2a_servers_api_app_config_a2a_servers_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ListA2AServerResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    create_a2a_server_api_app_config_a2a_servers_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Body_create_a2a_server_api_app_config_a2a_servers_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_Dict__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete_a2a_server_api_app_config_a2a_servers__a2a_id__delete_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                a2a_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_Dict__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    set_a2a_server_enabled_api_app_config_a2a_servers__a2a_id__enabled_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                a2a_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Body_set_a2a_server_enabled_api_app_config_a2a_servers__a2a_id__enabled_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_Dict__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    download_batch_link_api_files_download_batch_get: {
        parameters: {
            query: {
                file_id: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    download_batch_api_files_download_batch_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DownloadBatch"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    download_batch_link_api_files_download_batch_head: {
        parameters: {
            query: {
                file_id: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    upload_file_api_files_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_file_api_files_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_File_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_file_info_api_files__file_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_File_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    download_file_api_files__file_id__download_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    download_file_api_files__file_id__download_head: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    attachment_preview_api_files__file_id__preview_get: {
        parameters: {
            query?: {
                sheet?: number;
                row?: number;
                column?: number;
                offset?: number;
                revision?: string | null;
            };
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    attachment_content_api_files__file_id__preview_content_get: {
        parameters: {
            query?: {
                revision?: string | null;
            };
            header?: never;
            path: {
                file_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_all_sessions_api_sessions_get: {
        parameters: {
            query?: {
                offset?: number;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ListSessionResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    create_session_api_sessions_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["CreateSessionRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_CreateSessionResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    stream_sessions_api_sessions_stream_post: {
        parameters: {
            query?: {
                offset?: number;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    clear_unread_message_count_api_sessions__session_id__clear_unread_message_count_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_Dict__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete_session_api_sessions__session_id__delete_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_Dict__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    chat_api_sessions__session_id__chat_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChatRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ChatResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_accepted_request_api_sessions__session_id__requests__request_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
                request_id: components["schemas"]["RequestId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ChatResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    resume_input_api_sessions__session_id__inputs__input_id__resume_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
                input_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ChatResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    set_session_model_api_sessions__session_id__model_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelSelectionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ModelSelectionResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    compact_session_api_sessions__session_id__compact_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_CompactResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    rename_title_api_sessions__session_id__title_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenameTitleRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_TitleResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    suggest_title_api_sessions__session_id__title_suggestion_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_TitleResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reply_approval_api_sessions__session_id__approvals__tool_call_id__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
                tool_call_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApprovalRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ApprovalResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    stream_events_api_sessions__session_id__events_get: {
        parameters: {
            query?: {
                after_seq?: number | null;
            };
            header?: {
                "last-event-id"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_session_api_sessions__session_id__get: {
        parameters: {
            query?: {
                after_seq?: number;
                limit?: number | null;
            };
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_GetSessionResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    preview_context_api_sessions__session_id__context_preview_get: {
        parameters: {
            query?: {
                mode?: components["schemas"]["RunMode"];
            };
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Dict_str__Any__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_turn_request_api_sessions__session_id__runs__run_id__turns__index__request_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
                run_id: string;
                index: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_TurnRequestResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    stop_session_api_sessions__session_id__stop_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_Dict__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_session_files_api_sessions__session_id__files_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_GetSessionFilesResponse_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    preview_api_data_preview_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_CleanupPreview_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    latest_api_data_tasks_latest_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_Union_CleanupTask__NoneType__"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    read_api_data_tasks__identifier__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_CleanupTask_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    reset_api_data_reset_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CleanupRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_CleanupTask_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    retry_api_data_tasks__identifier__retry_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                identifier: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_CleanupTask_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_operation_api_operations__operation_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_OperationView_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    cancel_operation_api_operations__operation_id__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_OperationView_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    retry_operation_api_operations__operation_id__retry_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_OperationView_"];
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    list_skills_api_skills_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    create_import_api_skills_imports_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    upload_import_api_skills_imports_zip_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_import_api_skills_imports_zip_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    upload_local_api_skills_imports_local_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_local_api_skills_imports_local_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    get_import_api_skills_imports__operation_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    publish_import_api_skills_imports__operation_id__publish_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublishRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    import_file_api_skills_imports__operation_id__file_get: {
        parameters: {
            query: {
                candidate_path: string;
                fingerprint: string;
                path: string;
                download?: boolean;
            };
            header?: never;
            path: {
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    revise_import_api_skills_imports__operation_id__content_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operation_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviseRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skill_file_api_skills__name__file_get: {
        parameters: {
            query: {
                expected_version: string;
                path: string;
                download?: boolean;
            };
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    skill_detail_api_skills__name__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    edit_skill_api_skills__name__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EditRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    delete_skill_api_skills__name__delete: {
        parameters: {
            query: {
                expected_version: string;
            };
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    change_skill_api_skills__name__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description 结构化错误 */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
}

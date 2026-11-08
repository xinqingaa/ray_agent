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
         * @description 返回默认模型与采样参数，以及模型连接配置文件中各提供商的地址、密钥掩码与可用状态；不返回密钥明文
         */
        get: operations["get_llm_config_api_app_config_llm_get"];
        put?: never;
        /**
         * 更新LLM配置信息
         * @description 更新默认模型与采样参数；模型连接只在配置文件中修改
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
    "/api/files/{file_id}/preview/ticket": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 签发原始内容的读取票据
         * @description 图片、PDF 与网页按 URL 加载时把票据放在 ticket 参数里
         */
        post: operations["attachment_content_ticket_api_files__file_id__preview_ticket_post"];
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
    "/api/skills/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Sources */
        get: operations["list_sources_api_skills_sources_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Scan Skills */
        post: operations["scan_skills_api_skills_scan_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Skill Config */
        get: operations["get_skill_config_api_skills_config_get"];
        /** Update Skill Config */
        put: operations["update_skill_config_api_skills_config_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/extra-dirs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add Extra Dir */
        post: operations["add_extra_dir_api_skills_extra_dirs_post"];
        /** Remove Extra Dir */
        delete: operations["remove_extra_dir_api_skills_extra_dirs_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/prefer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Prefer Skill */
        post: operations["prefer_skill_api_skills_prefer_post"];
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
    "/api/skills/{skill_id}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Skill File */
        get: operations["skill_file_api_skills__skill_id__file_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/skills/{skill_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Skill Detail */
        get: operations["skill_detail_api_skills__skill_id__get"];
        /** Edit Skill */
        put: operations["edit_skill_api_skills__skill_id__put"];
        post?: never;
        /** Delete Skill */
        delete: operations["delete_skill_api_skills__skill_id__delete"];
        options?: never;
        head?: never;
        /** Change Skill */
        patch: operations["change_skill_api_skills__skill_id__patch"];
        trace?: never;
    };
    "/api/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 工作区列表
         * @description 按需核对每个文件夹的可用性：路径缺失或文件系统身份不符为 unavailable，会话仍可用
         */
        get: operations["list_workspaces_api_workspaces_get"];
        put?: never;
        /**
         * 新建工作区
         * @description 在默认工作区位置下按名称新建文件夹（重名加序号，不复用已有目录）。可同时给出工作方式正文或模板；模板只复制工作方式，不带记忆、路径或凭据
         */
        post: operations["create_workspace_api_workspaces_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/open": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 打开已有文件夹为工作区
         * @description 需要宿主选择器产生的一次性 grant_id。打开新文件夹会写入身份标记；识别出移动则改绑；复制出的文件夹返回 conflict，用 /workspaces/open/resolve 选择
         */
        post: operations["open_workspace_api_workspaces_open_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/open/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 处理复制文件夹的冲突
         * @description as_new：在此文件夹重写本机标记条目并成为新工作区；rebind：原工作区改绑到这里，原文件夹解除绑定
         */
        post: operations["resolve_conflict_api_workspaces_open_resolve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/default-location": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 默认工作区位置 */
        get: operations["get_default_location_api_workspaces_default_location_get"];
        put?: never;
        /**
         * 更改默认工作区位置
         * @description 需要宿主选择器产生的一次性 grant_id
         */
        post: operations["set_default_location_api_workspaces_default_location_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 工作区详情 */
        get: operations["get_workspace_api_workspaces__workspace_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/rename": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 重命名工作区
         * @description 只改名称，不改文件夹名；version 不符返回 409
         */
        post: operations["rename_workspace_api_workspaces__workspace_id__rename_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/local-execution": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 设置工作区本机执行开关
         * @description 启用后该工作区会话可使用 Shell／脚本；文件工具不受影响。version 不符返回 409
         */
        post: operations["set_local_execution_api_workspaces__workspace_id__local_execution_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/auto-memory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 设置工作区自动记忆开关
         * @description 关闭后运行结束不再自动提炼记忆（已有记忆、明确要求写入与会话摘要不受影响）。version 不符返回 409
         */
        post: operations["set_auto_memory_api_workspaces__workspace_id__auto_memory_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 归档工作区
         * @description 归档后不能新建会话，也不会写入文件夹；已有会话可读
         */
        post: operations["archive_workspace_api_workspaces__workspace_id__archive_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/unarchive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 取消归档 */
        post: operations["unarchive_workspace_api_workspaces__workspace_id__unarchive_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/relocate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 重新定位工作区的文件夹
         * @description 用宿主选择器产生的 grant_id 把工作区改绑到另一个文件夹，不依赖身份标记；校验同打开。version 不符、目标已绑定其他工作区（details.reason=already_bound）、目标标记属于本机另一个工作区（marker_other_workspace）、有未释放的写入租约（details.lease）或活动运行（details.run_id）时返回 409；嵌套、数据根与系统目录返回 400/403 同打开。成功后外部变更订阅自动切到新位置
         */
        post: operations["relocate_workspace_api_workspaces__workspace_id__relocate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/recheck": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 重新核对文件夹可用性 */
        post: operations["recheck_workspace_api_workspaces__workspace_id__recheck_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 删除工作区
         * @description 删除工作区记录与它的全部会话，后台回收会话文件并尽力移除文件夹里的本机标记条目；不删除文件夹和其中的任何用户文件。返回长操作，用 /operations/{id} 读回
         */
        post: operations["delete_workspace_api_workspaces__workspace_id__delete_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/write-lease": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 文件夹写入租约
         * @description 文件夹当前的写入者；没有租约表示没有写入者。其他会话的写入被占用时得到 409，details.lease 带同样信息。
         */
        get: operations["get_write_lease_api_workspaces__workspace_id__write_lease_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/write-lease/retry-settle": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 重试写入租约收尾
         * @description 租约处于 settling 或 blocked（停止后未能确认写入结束）时，再次要求写入者退出并确认；确认后释放租约，仍未确认返回 409 并保持阻止状态。正常写入中的租约不可收尾（409）。
         */
        post: operations["retry_settle_api_workspaces__workspace_id__write_lease_retry_settle_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/modified-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 最近修改过文件夹的运行
         * @description 按最近修改时间倒序，供文件夹面板展示「最近一次修改」入口；只含有净变化的运行
         */
        get: operations["modified_runs_api_workspaces__workspace_id__modified_runs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/runs/{run_id}/changes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 一次运行在文件夹里的文件变更
         * @description 每个文件给出运行前版本、运行最后写入版本、当前版本与撤销状态（undoable/restored/conflict）；run_active 为真时不能撤销
         */
        get: operations["run_changes_api_workspaces__workspace_id__runs__run_id__changes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/runs/{run_id}/changes/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 预览撤销后的内容
         * @description 当前版本到撤销后版本的统一 diff；二进制或超过预览上限的文件只返回大小
         */
        get: operations["preview_change_api_workspaces__workspace_id__runs__run_id__changes_preview_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/runs/{run_id}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 撤销本次修改
         * @description 只处理选中的文件，逐个返回结果：restored/removed 已处理，unchanged 本来就是运行前状态，conflict 文件在运行之后被改动（带当前版本；can_force 时可带 force=当前版本再次提交以仍要恢复），failed 其他原因。恢复与移除前会备份当前版本，并占用文件夹写入租约；租约被占用、运行仍在进行或工作区不可写时整体返回 409。撤销不回滚会话与记忆。
         */
        post: operations["undo_run_api_workspaces__workspace_id__runs__run_id__undo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/changes/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 订阅文件夹的外部变更
         * @description SSE：先推送 ready（当前是否可用），之后推送 changed（paths 为变化的相对路径，refresh 为真表示需要整体刷新）与 availability（文件夹失联或恢复）。应用自己的写入同样会触发 changed。只在有订阅者时监视；通知之外还有定期重扫兜底。事件数据见 WorkspaceChangeEvent。
         */
        get: operations["stream_changes_api_workspaces__workspace_id__changes_stream_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/instruction": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 当前工作方式
         * @description 尚未设置时正文为空串、版本为空
         */
        get: operations["get_instruction_api_workspaces__workspace_id__instruction_get"];
        /**
         * 发布新的工作方式版本
         * @description 用户编辑：发布来源为 user_edit 的新版本。body 超过上限返回 400；version 是工作区 version，不符返回 409 并带最新值
         */
        put: operations["put_instruction_api_workspaces__workspace_id__instruction_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/instruction/proposals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Agent 的工作方式提议
         * @description status 省略时返回全部；待确认的提议未生效
         */
        get: operations["list_proposals_api_workspaces__workspace_id__instruction_proposals_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/instruction/proposals/{proposal_id}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 确认提议
         * @description 发布来源为 confirmed_proposal 的新版本。提议之后工作方式已变化时提议作废并返回 409，请重新审阅
         */
        post: operations["accept_proposal_api_workspaces__workspace_id__instruction_proposals__proposal_id__accept_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/instruction/proposals/{proposal_id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 拒绝提议 */
        post: operations["reject_proposal_api_workspaces__workspace_id__instruction_proposals__proposal_id__reject_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 工作方式模板列表 */
        get: operations["list_templates_api_templates_get"];
        put?: never;
        /**
         * 把工作区另存为模板
         * @description 只复制当前工作方式正文与可选的工具启用建议；不带记忆、文件、路径或凭据
         */
        post: operations["save_template_api_templates_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates/{template_id}/rename": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 重命名模板 */
        post: operations["rename_template_api_templates__template_id__rename_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates/{template_id}/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 把模板应用到工作区
         * @description 发布来源为 template 的新工作方式版本；模板里的工具建议随结果返回，不会自动启用任何开关
         */
        post: operations["apply_template_api_templates__template_id__apply_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates/{template_id}/delete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 删除模板
         * @description 不影响已经应用过该模板的工作区
         */
        post: operations["delete_template_api_templates__template_id__delete_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/memories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 工作区记忆列表
         * @description status 可重复指定；省略时返回活动与候选。常驻层条目带 resident=true
         */
        get: operations["list_memories_api_workspaces__workspace_id__memories_get"];
        put?: never;
        /**
         * 新增记忆
         * @description 用户操作：立即生效并标为用户确认
         */
        post: operations["create_memory_api_workspaces__workspace_id__memories_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/memories/{memory_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 对一条记忆的用户操作
         * @description edit 修改内容或类型、pin／unpin 钉住、confirm 确认候选、retract 撤回、undo 撤销最近一次变更。version 不符返回 409 并带最新值
         */
        patch: operations["patch_memory_api_workspaces__workspace_id__memories__memory_id__patch"];
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/memories/{memory_id}/sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 记忆的来源与变更历史
         * @description 来源会话已被删除时 available 为 false，界面如实标明，不指向别处
         */
        get: operations["memory_sources_api_workspaces__workspace_id__memories__memory_id__sources_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/participate-in-memory": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 设置会话是否参与记忆
         * @description 关闭后该会话不再提炼记忆、不再生成可检索的摘要，已索引的摘要撤出检索；独立对话返回 400
         */
        post: operations["participate_in_memory_api_sessions__session_id__participate_in_memory_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 在工作区内全文检索
         * @description 范围固定为路径里的工作区；可检索记忆、会话摘要与已发布的文件片段
         */
        post: operations["search_workspace_api_workspaces__workspace_id__search_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/runs/{run_id}/context-manifest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 本次参考：一次运行实际使用的背景
         * @description 工作方式版本、常驻记忆、初始召回与未采用的原因；独立对话的运行没有清单（404）
         */
        get: operations["run_context_manifest_api_runs__run_id__context_manifest_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/documents/index": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 工作区文档索引汇总 */
        get: operations["document_index_summary_api_workspaces__workspace_id__documents_index_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 工作区已登记文档列表 */
        get: operations["list_documents_api_workspaces__workspace_id__documents_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/documents/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 触发工作区文档登记与索引 */
        post: operations["sync_documents_api_workspaces__workspace_id__documents_sync_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/workspaces/{workspace_id}/documents/chunks/{chunk_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读回已发布文件片段原文 */
        get: operations["read_document_chunk_api_workspaces__workspace_id__documents_chunks__chunk_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/roots/{root_id}/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 列出目录 */
        get: operations["list_entries_api_roots__root_id__entries_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/roots/{root_id}/entry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 读取文件或目录的元数据 */
        get: operations["get_entry_api_roots__root_id__entry_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/roots/{root_id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取文件的原始字节
         * @description 按 offset 与 length 分段读取，单次有上限；始终作为附件返回，不内联渲染
         */
        get: operations["read_content_api_roots__root_id__content_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/roots/{root_id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 文件预览
         * @description 与附件预览同一协议；revision 随文件大小与修改时间变化
         */
        get: operations["preview_api_roots__root_id__preview_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/roots/{root_id}/preview/ticket": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 签发原始内容的读取票据
         * @description 图片、PDF 与网页按 URL 加载：用 /roots/{root_id}/preview/content/{path} 并带 ticket 参数
         */
        post: operations["content_ticket_api_roots__root_id__preview_ticket_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/roots/{root_id}/preview/content/{relative_path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 原始内容的内联读取
         * @description 只放行图片、PDF 与网页；需要票据
         */
        get: operations["root_content_api_roots__root_id__preview_content__relative_path__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/roots/{root_id}/upload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 把文件放进工作区文件夹
         * @description 复制到根目录，directory 可指定子目录；同名文件不覆盖，自动取不冲突的名称。归档的工作区不可写
         */
        post: operations["upload_api_roots__root_id__upload_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/host/folder-grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 登记宿主选中的文件夹
         * @description 返回一次性、短期有效的 grant_id；界面凭它打开工作区或更改默认位置。需要宿主密钥头 X-RayAgent-Host-Secret
         */
        post: operations["create_folder_grant_api_host_folder_grants_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/host/roots/{root_id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 解析根内路径的本机绝对位置
         * @description 供宿主「在文件管理器中显示」：按根身份与路径规则核对（不越出根、拒绝 .rayagent、版本控制内部与凭据文件，目标必须存在），返回绝对路径；会话工作目录与工作区文件夹都适用。需要宿主密钥头 X-RayAgent-Host-Secret
         */
        post: operations["resolve_root_path_api_host_roots__root_id__resolve_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
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
            /**
             * Standalone Execution Enabled
             * @default false
             */
            standalone_execution_enabled: boolean;
        };
        /** ApplyTemplateRequest */
        ApplyTemplateRequest: {
            /** Workspace Id */
            workspace_id: string;
            /**
             * Version
             * @description 工作区 version；提供时核对并发修改
             */
            version?: number | null;
        };
        /**
         * ApplyTemplateResponse
         * @description 应用模板只发布工作方式新版本；tool_suggestions 是模板里的建议，不会自动启用任何开关。
         */
        ApplyTemplateResponse: {
            instruction: components["schemas"]["InstructionView"];
            /** Tool Suggestions */
            tool_suggestions: {
                [key: string]: unknown;
            };
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
        /** AutoMemoryRequest */
        AutoMemoryRequest: {
            /** Enabled */
            enabled: boolean;
            /** Version */
            version: number;
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
        /** Body_upload_api_roots__root_id__upload_post */
        Body_upload_api_roots__root_id__upload_post: {
            /** File */
            file: string;
            /**
             * Directory
             * @default
             */
            directory: string;
        };
        /** Body_upload_file_api_files_post */
        Body_upload_file_api_files_post: {
            /** File */
            file: string;
        };
        /** Body_upload_import_api_skills_imports_zip_post */
        Body_upload_import_api_skills_imports_zip_post: {
            /** Operation Id */
            operation_id: string;
            /** File */
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
        /** ChangeEntryView */
        ChangeEntryView: {
            /** Root Id */
            root_id: string;
            /** Relative Path */
            relative_path: string;
            /** @description 折叠后的净操作：运行前不存在为 create，运行前存在且最后被删除为 delete，其余为 modify */
            operation: components["schemas"]["ChangeOperation"];
            /**
             * Writes
             * @description 运行对该文件的写入次数
             */
            writes: number;
            /** First At */
            first_at: number;
            /** Last At */
            last_at: number;
            /** @description 运行前版本；create 为空 */
            before: components["schemas"]["FileVersionView"] | null;
            /** @description 运行最后写入的版本；delete 为空 */
            after: components["schemas"]["FileVersionView"] | null;
            /** @description 文件夹里当前的版本；不存在为空 */
            current: components["schemas"]["FileVersionView"] | null;
            /**
             * Status
             * @description undoable：当前版本仍是运行最后写入的，可直接撤销；restored：已经是运行前状态；conflict：之后被改动过，只有明确仍要恢复才会覆盖
             * @enum {string}
             */
            status: "undoable" | "restored" | "conflict";
            /** Conflict Reason */
            conflict_reason: ("modified" | "missing" | "appeared" | "not_file" | "modified_during_run") | null;
            /**
             * Can Force
             * @description 冲突时是否允许仍要恢复；运行新建的文件与非普通文件不允许
             */
            can_force: boolean;
            /**
             * Preview Kind
             * @description 撤销会恢复运行前内容，或移除运行新建的文件
             * @enum {string}
             */
            preview_kind: "restore" | "remove";
        };
        /**
         * ChangeOperation
         * @enum {string}
         */
        ChangeOperation: "create" | "modify" | "delete";
        /** ChangePreviewResponse */
        ChangePreviewResponse: {
            /**
             * Kind
             * @description diff：当前版本到撤销后版本的统一 diff；binary 与 too_large 只给大小；unchanged：撤销不会改变内容
             * @enum {string}
             */
            kind: "diff" | "binary" | "too_large" | "unchanged";
            /**
             * Diff
             * @default
             */
            diff: string;
            /**
             * Truncated
             * @default false
             */
            truncated: boolean;
            /** Current Size */
            current_size: number | null;
            /** Restore Size */
            restore_size: number | null;
            /**
             * Removes File
             * @description 撤销会移除文件（运行新建的文件）
             */
            removes_file: boolean;
            /**
             * Warning
             * @description 撤销会丢掉运行期间的外部修改等需要用户知道的情况；为空表示没有
             * @default
             */
            warning: string;
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
         * ConflictResolution
         * @enum {string}
         */
        ConflictResolution: "as_new" | "rebind";
        /**
         * ConnectionSource
         * @description 模型连接配置文件的读取结果。
         */
        ConnectionSource: {
            /** Path */
            path: string;
            /**
             * Exists
             * @default false
             */
            exists: boolean;
            /**
             * Issue
             * @description 整份文件无法使用的原因
             */
            issue?: string | null;
            /**
             * Notices
             * @description 不影响使用的提醒
             */
            notices?: string[];
            /** Providers */
            providers?: components["schemas"]["ProviderStatus"][];
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
        /**
         * ContextManifestView
         * @description 一次运行实际使用的背景：工作方式版本、常驻记忆、初始召回与未采用原因。
         */
        ContextManifestView: {
            /** Run Id */
            run_id: string;
            /** Session Id */
            session_id: string;
            /** Workspace Id */
            workspace_id: string | null;
            /** Instruction Version */
            instruction_version: number | null;
            /** Instruction Body */
            instruction_body: string | null;
            /** Resident Memories */
            resident_memories: components["schemas"]["ResidentMemoryView"][];
            /** Retrieval Hits */
            retrieval_hits: components["schemas"]["SearchHitView"][];
            /** Omissions */
            omissions: components["schemas"]["ContextOmissionView"][];
            /** Created At */
            created_at: number;
        };
        /** ContextOmissionView */
        ContextOmissionView: {
            /**
             * Kind
             * @description retrieval 为初始召回未采用，revision 为冻结后因不可用被移除
             */
            kind: string;
            /** Reason */
            reason: string;
            /** Source Id */
            source_id: string | null;
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
            /** @default 4 */
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
        /** CreateMemoryRequest */
        CreateMemoryRequest: {
            /** Content */
            content: string;
            /** @default fact */
            memory_type: components["schemas"]["MemoryType"];
            /**
             * Pinned
             * @default false
             */
            pinned: boolean;
        };
        /** CreateSessionRequest */
        CreateSessionRequest: {
            /** Creation Id */
            creation_id?: string | null;
            /**
             * Workspace Id
             * @description 会话所属的工作区；创建后不再改变，省略为独立对话
             */
            workspace_id?: string | null;
        };
        /**
         * CreateSessionResponse
         * @description 创建会话响应结构
         */
        CreateSessionResponse: {
            /** Session Id */
            session_id: string;
        };
        /** CreateWorkspaceRequest */
        CreateWorkspaceRequest: {
            /**
             * Name
             * @description 工作区名称，同时是默认位置下新建文件夹的名称
             */
            name: string;
            /**
             * Instruction
             * @description 可选：创建时填写的工作方式
             */
            instruction?: string | null;
            /**
             * Template Id
             * @description 可选：用模板的工作方式初始化；与 instruction 同时给出时以 instruction 为准
             */
            template_id?: string | null;
        };
        /** DefaultLocationRequest */
        DefaultLocationRequest: {
            /** Grant Id */
            grant_id: string;
        };
        /** DefaultLocationResponse */
        DefaultLocationResponse: {
            /** Path */
            path: string;
        };
        /**
         * DocumentIndexStatus
         * @description 界面与 API 可见的索引状态；扫描件在缺 OCR 时停在 pending_component。
         * @enum {string}
         */
        DocumentIndexStatus: "registered" | "pending_parse" | "parsing" | "pending_component" | "indexing" | "searchable" | "failed" | "withdrawn";
        /** DocumentSourceView */
        DocumentSourceView: {
            /** Source Type */
            source_type: string;
            /** Source Id */
            source_id: string;
            /** Document Id */
            document_id: string;
            /** Revision */
            revision: number;
            /** Relative Path */
            relative_path: string;
            /** Title */
            title: string;
            /** Body */
            body: string;
            /** Locator */
            locator: {
                [key: string]: unknown;
            };
            /** Stale */
            stale: boolean;
        };
        /** DocumentView */
        DocumentView: {
            /** Id */
            id: string;
            /** Relative Path */
            relative_path: string;
            /** Current Revision */
            current_revision: number;
            status: components["schemas"]["DocumentIndexStatus"];
            /** Format */
            format: string;
            /** Updated At */
            updated_at: number;
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
        ErrorCode: "invalid_request" | "validation_failed" | "unauthorized" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "gone" | "payload_too_large" | "range_not_satisfiable" | "context_limit" | "rate_limited" | "internal_error" | "upstream_error" | "unavailable" | "timeout";
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
        /** ExtraDirRequest */
        ExtraDirRequest: {
            /** Grant Id */
            grant_id: string;
        };
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
            /** Root Id */
            root_id?: string | null;
            /** Relative Path */
            relative_path?: string | null;
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
        /**
         * FileKind
         * @enum {string}
         */
        FileKind: "file" | "directory" | "symlink" | "other";
        /** FileVersionView */
        FileVersionView: {
            /** Size */
            size: number;
            /**
             * Modified Ns
             * @description 十进制字符串，仍要恢复时原样回传，避免 JavaScript 数字丢失纳秒精度
             */
            modified_ns: string | null;
            /** Sha256 */
            sha256: string | null;
        };
        /** FolderGrantRequest */
        FolderGrantRequest: {
            /**
             * Path
             * @description 宿主在系统选择器里选中的文件夹绝对路径
             */
            path: string;
        };
        /** FolderGrantResponse */
        FolderGrantResponse: {
            /**
             * Grant Id
             * @description 一次性、短期有效的凭证；界面用它打开工作区或更改默认位置
             */
            grant_id: string;
            /** Path */
            path: string;
            /**
             * Expires At
             * @description 毫秒时间戳
             */
            expires_at: number;
        };
        /**
         * FolderStatus
         * @enum {string}
         */
        FolderStatus: "available" | "unavailable";
        /** FolderView */
        FolderView: {
            /**
             * Root Id
             * @description 文件接口使用的可访问根
             */
            root_id: string;
            /**
             * Path
             * @description 绑定的文件夹位置，用于展示与打开位置
             */
            path: string;
            status: components["schemas"]["FolderStatus"];
            /**
             * Marker Writable
             * @description 身份标记写入失败为假：移动文件夹后需要手动重新选择
             */
            marker_writable: boolean;
            /** Checked At */
            checked_at: number | null;
        };
        /**
         * ForceCurrentRequest
         * @description 用户看到的当前版本；与实际不一致时不覆盖，重新返回冲突。
         */
        ForceCurrentRequest: {
            /** Exists */
            exists: boolean;
            /** Size */
            size?: number | null;
            /** Modified Ns */
            modified_ns?: string | null;
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
            /** Workspace Id */
            workspace_id?: string | null;
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
        /** IndexSummaryView */
        IndexSummaryView: {
            /** Workspace Id */
            workspace_id: string;
            /** Total */
            total: number;
            /** Searchable */
            searchable: number;
            /** Pending */
            pending: number;
            /** Parsing */
            parsing: number;
            /** Pending Component */
            pending_component: number;
            /** Failed */
            failed: number;
            /** Withdrawn */
            withdrawn: number;
            /** Truncated Scan */
            truncated_scan: boolean;
            /** Active Operation Id */
            active_operation_id: string | null;
            /** Publication Generation */
            publication_generation: number;
            /** Vector Generation */
            vector_generation: number | null;
            /** Embedding Config */
            embedding_config: string | null;
            /**
             * Semantic Ready
             * @default false
             */
            semantic_ready: boolean;
        };
        /** @description 核心进程的一次启动 */
        InstanceId: string;
        /** InstructionProposalList */
        InstructionProposalList: {
            /** Proposals */
            proposals: components["schemas"]["InstructionProposalView"][];
        };
        /** InstructionProposalView */
        InstructionProposalView: {
            /** Id */
            id: string;
            /** Workspace Id */
            workspace_id: string;
            /** Base Version */
            base_version: number;
            /** Body */
            body: string;
            /** Rationale */
            rationale: string;
            /** Session Id */
            session_id: string | null;
            status: components["schemas"]["ProposalStatus"];
            /** Created At */
            created_at: number;
            /** Resolved At */
            resolved_at: number | null;
        };
        /**
         * InstructionSource
         * @enum {string}
         */
        InstructionSource: "user_edit" | "confirmed_proposal" | "template";
        /**
         * InstructionView
         * @description 工作区当前生效的工作方式；尚未设置时 instruction_version 与 source 为空、正文为空串。
         */
        InstructionView: {
            /** Workspace Id */
            workspace_id: string;
            /** Instruction Version */
            instruction_version: number | null;
            /** Body */
            body: string;
            source: components["schemas"]["InstructionSource"] | null;
            /** Updated At */
            updated_at: number | null;
            /**
             * Workspace Version
             * @description 工作区 version；提交修改时回传，用于并发修改核对
             */
            workspace_version: number;
            /**
             * Max Chars
             * @default 4000
             */
            max_chars: number;
        };
        /**
         * LLMConfigPublic
         * @description 设置页可见的 LLM 配置；模型连接只给地址、掩码与可用状态，不含密钥明文。
         */
        LLMConfigPublic: {
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
            /** @description 模型连接配置文件的读取结果 */
            connections?: components["schemas"]["ConnectionSource"] | null;
        };
        /**
         * LLMConfigUpdate
         * @description 更新默认模型与采样参数；模型连接只在配置文件中修改。未提交的字段保持原值。
         */
        LLMConfigUpdate: {
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
        /**
         * LeaseState
         * @enum {string}
         */
        LeaseState: "preparing" | "held" | "settling" | "blocked";
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
            /** Workspace Id */
            workspace_id?: string | null;
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
        /** LocalExecutionRequest */
        LocalExecutionRequest: {
            /** Enabled */
            enabled: boolean;
            /** Version */
            version: number;
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
         * MarkerConflict
         * @description 复制出的文件夹：标记指向一个仍绑定在别处的已知工作区。
         */
        MarkerConflict: {
            /** Conflict Id */
            conflict_id: string;
            /** Path */
            path: string;
            workspace_id: components["schemas"]["WorkspaceId"];
            /** Workspace Name */
            workspace_name: string;
            /** Bound Path */
            bound_path: string;
            /** Options */
            options: ("as_new" | "rebind")[];
        };
        /**
         * MemoryCertainty
         * @enum {string}
         */
        MemoryCertainty: "user_confirmed" | "material_stated" | "model_inferred";
        /**
         * MemoryChangeAction
         * @enum {string}
         */
        MemoryChangeAction: "create" | "update" | "confirm" | "pin" | "unpin" | "retract" | "supersede" | "undo";
        /** MemoryChangeView */
        MemoryChangeView: {
            /** Id */
            id: string;
            /** From Version */
            from_version: number | null;
            /** To Version */
            to_version: number;
            action: components["schemas"]["MemoryChangeAction"];
            origin: components["schemas"]["MemoryOrigin"];
            /** Rationale */
            rationale: string;
            /** Replaces Change Id */
            replaces_change_id: string | null;
            /** Created At */
            created_at: number;
        };
        /** MemoryItem */
        MemoryItem: {
            /** Id */
            id: string;
            /** Workspace Id */
            workspace_id: string;
            /** Content */
            content: string;
            memory_type: components["schemas"]["MemoryType"];
            origin: components["schemas"]["MemoryOrigin"];
            certainty: components["schemas"]["MemoryCertainty"];
            status: components["schemas"]["MemoryStatus"];
            /** Pinned */
            pinned: boolean;
            /**
             * Version
             * @description 修改时回传，用于并发修改核对
             */
            version: number;
            /**
             * Supersedes Id
             * @description 候选指向的、确认后将被替代的条目
             */
            supersedes_id: string | null;
            /**
             * Resident
             * @description 当前是否在常驻层（每次新运行注入）
             */
            resident: boolean;
            /** Created At */
            created_at: number;
            /** Updated At */
            updated_at: number;
            /** Last Used At */
            last_used_at: number | null;
        };
        /** MemoryListResponse */
        MemoryListResponse: {
            /** Memories */
            memories: components["schemas"]["MemoryItem"][];
            /**
             * Resident Limit
             * @default 12
             */
            resident_limit: number;
        };
        /**
         * MemoryOrigin
         * @enum {string}
         */
        MemoryOrigin: "user" | "agent_requested" | "auto_extraction";
        /**
         * MemorySourceKind
         * @enum {string}
         */
        MemorySourceKind: "session" | "document";
        /** MemorySourceView */
        MemorySourceView: {
            /** Id */
            id: string;
            kind: components["schemas"]["MemorySourceKind"];
            /** Session Id */
            session_id: string | null;
            /** Event Seq Start */
            event_seq_start: number | null;
            /** Event Seq End */
            event_seq_end: number | null;
            /** Document Id */
            document_id: string | null;
            /** Document Revision */
            document_revision: number | null;
            /**
             * Available
             * @description 来源会话或文件仍然存在；为假时界面如实标明，不跳转到别处
             */
            available: boolean;
        };
        /** MemorySourcesResponse */
        MemorySourcesResponse: {
            /** Sources */
            sources: components["schemas"]["MemorySourceView"][];
            /** Changes */
            changes: components["schemas"]["MemoryChangeView"][];
        };
        /**
         * MemoryStatus
         * @enum {string}
         */
        MemoryStatus: "candidate" | "active" | "superseded" | "retracted";
        /**
         * MemoryType
         * @enum {string}
         */
        MemoryType: "fact" | "preference" | "decision" | "constraint";
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
        /** ModifiedRunsResponse */
        ModifiedRunsResponse: {
            /** Runs */
            runs: components["schemas"]["RunSummaryView"][];
        };
        /** OpenWorkspaceRequest */
        OpenWorkspaceRequest: {
            /** Grant Id */
            grant_id: string;
            /**
             * Name
             * @description 新工作区的名称；省略时用文件夹名
             */
            name?: string | null;
        };
        /**
         * OpenWorkspaceResult
         * @description status=opened：workspace 为打开的工作区，recognized 说明是新工作区、已有工作区，还是识别出移动并改绑；
         *     status=conflict：文件夹是复制出来的，调用 resolve 带 conflict.conflict_id 选择作为新工作区或改绑到这里。
         */
        OpenWorkspaceResult: {
            /**
             * Status
             * @enum {string}
             */
            status: "opened" | "conflict";
            workspace: components["schemas"]["WorkspaceItem"] | null;
            scan: components["schemas"]["ScanSummary"] | null;
            /** Recognized */
            recognized: ("new" | "existing" | "moved") | null;
            conflict: components["schemas"]["MarkerConflict"] | null;
        };
        /** @description 长操作身份；查询、取消与重试沿同一身份 */
        OperationId: string;
        /**
         * OperationKind
         * @description 新增类型在这里登记，各工作包不另起同义名称。
         * @enum {string}
         */
        OperationKind: "component_install" | "document_index" | "semantic_index" | "memory_extraction" | "session_summary" | "data_cleanup" | "workspace_delete";
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
        /** ParticipateInMemoryRequest */
        ParticipateInMemoryRequest: {
            /** Participate */
            participate: boolean;
        };
        /** ParticipateInMemoryResponse */
        ParticipateInMemoryResponse: {
            /** Session Id */
            session_id: string;
            /** Participate In Memory */
            participate_in_memory: boolean;
        };
        /**
         * PatchMemoryRequest
         * @description 对一条记忆的用户操作；version 必须回传。edit 需要 content 或 memory_type 之一。
         */
        PatchMemoryRequest: {
            /**
             * Action
             * @enum {string}
             */
            action: "edit" | "pin" | "unpin" | "confirm" | "retract" | "undo";
            /** Version */
            version: number;
            /** Content */
            content?: string | null;
            memory_type?: components["schemas"]["MemoryType"] | null;
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
        /** PreferRequest */
        PreferRequest: {
            /** Name */
            name: string;
            /** Skill Id */
            skill_id?: string | null;
        };
        /**
         * ProposalStatus
         * @enum {string}
         */
        ProposalStatus: "pending" | "accepted" | "rejected" | "superseded";
        /** @description 核心协议版本 */
        ProtocolVersion: number;
        /**
         * ProviderStatus
         * @description 设置页可见的提供商状态；密钥只给掩码。
         */
        ProviderStatus: {
            /** Name */
            name: string;
            /** Base Url */
            base_url?: string | null;
            /**
             * Api Protocol
             * @default responses
             * @enum {string}
             */
            api_protocol: "responses" | "chat_completions";
            /**
             * Models
             * @description 由它提供的已知模型
             */
            models?: string[];
            /**
             * Has Key
             * @default false
             */
            has_key: boolean;
            /** Key Hint */
            key_hint?: string | null;
            /**
             * Issue
             * @description 不可用或部分忽略的原因
             */
            issue?: string | null;
        };
        /** PublishRequest */
        PublishRequest: {
            /** Candidate Path */
            candidate_path: string;
            /** Fingerprint */
            fingerprint: string;
        };
        /** @description 根内相对路径：以 / 分隔，空串表示根本身；不含绝对路径、盘符、反斜杠、空段、. 与 ..，不含控制字符 */
        RelativePath: string;
        /** RelocateWorkspaceRequest */
        RelocateWorkspaceRequest: {
            /** Grant Id */
            grant_id: string;
            /** Version */
            version: number;
        };
        /** RenameTemplateRequest */
        RenameTemplateRequest: {
            /** Name */
            name: string;
        };
        /** RenameTitleRequest */
        RenameTitleRequest: {
            /** Title */
            title: string;
        };
        /** RenameWorkspaceRequest */
        RenameWorkspaceRequest: {
            /** Name */
            name: string;
            /** Version */
            version: number;
        };
        /** @description 业务幂等请求身份；同身份不同内容返回冲突 */
        RequestId: string;
        /** ResidentMemoryView */
        ResidentMemoryView: {
            /** Memory Id */
            memory_id: string;
            /** Version */
            version: number;
            /** Content */
            content: string;
            /** Memory Type */
            memory_type: string;
            /** Certainty */
            certainty: string;
            /** Pinned */
            pinned: boolean;
        };
        /** ResolveConflictRequest */
        ResolveConflictRequest: {
            /** Conflict Id */
            conflict_id: string;
            resolution: components["schemas"]["ConflictResolution"];
        };
        /** ResolveRootPathRequest */
        ResolveRootPathRequest: {
            /**
             * Relative Path
             * @description 根内相对路径；空表示根目录本身
             * @default
             */
            relative_path: string;
        };
        /** ResolveRootPathResponse */
        ResolveRootPathResponse: {
            /**
             * Path
             * @description 目标在本机的绝对路径，只供宿主在文件管理器中显示位置
             */
            path: string;
        };
        /**
         * ResourceTicket
         * @description 按 URL 加载资源时代替实例令牌；只对签发路径的 GET 与 HEAD 有效，到期前可重复使用。
         */
        ResourceTicket: {
            /** Ticket */
            ticket: string;
            /**
             * Expires At
             * @description 到期时间，毫秒时间戳
             */
            expires_at: number;
        };
        ResourceVersion: number | string;
        /** Response[AgentConfig] */
        Response_AgentConfig_: {
            data: components["schemas"]["AgentConfig"] | null;
        };
        /** Response[ApplyTemplateResponse] */
        Response_ApplyTemplateResponse_: {
            data: components["schemas"]["ApplyTemplateResponse"] | null;
        };
        /** Response[ApprovalResponse] */
        Response_ApprovalResponse_: {
            data: components["schemas"]["ApprovalResponse"] | null;
        };
        /** Response[BuildIdentity] */
        Response_BuildIdentity_: {
            data: components["schemas"]["BuildIdentity"] | null;
        };
        /** Response[ChangePreviewResponse] */
        Response_ChangePreviewResponse_: {
            data: components["schemas"]["ChangePreviewResponse"] | null;
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
        /** Response[ContextManifestView] */
        Response_ContextManifestView_: {
            data: components["schemas"]["ContextManifestView"] | null;
        };
        /** Response[CoreStatus] */
        Response_CoreStatus_: {
            data: components["schemas"]["CoreStatus"] | null;
        };
        /** Response[CreateSessionResponse] */
        Response_CreateSessionResponse_: {
            data: components["schemas"]["CreateSessionResponse"] | null;
        };
        /** Response[DefaultLocationResponse] */
        Response_DefaultLocationResponse_: {
            data: components["schemas"]["DefaultLocationResponse"] | null;
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
        /** Response[DocumentSourceView] */
        Response_DocumentSourceView_: {
            data: components["schemas"]["DocumentSourceView"] | null;
        };
        /** Response[File] */
        Response_File_: {
            data: components["schemas"]["File"] | null;
        };
        /** Response[FolderGrantResponse] */
        Response_FolderGrantResponse_: {
            data: components["schemas"]["FolderGrantResponse"] | null;
        };
        /** Response[GetSessionFilesResponse] */
        Response_GetSessionFilesResponse_: {
            data: components["schemas"]["GetSessionFilesResponse"] | null;
        };
        /** Response[GetSessionResponse] */
        Response_GetSessionResponse_: {
            data: components["schemas"]["GetSessionResponse"] | null;
        };
        /** Response[IndexSummaryView] */
        Response_IndexSummaryView_: {
            data: components["schemas"]["IndexSummaryView"] | null;
        };
        /** Response[InstructionProposalList] */
        Response_InstructionProposalList_: {
            data: components["schemas"]["InstructionProposalList"] | null;
        };
        /** Response[InstructionProposalView] */
        Response_InstructionProposalView_: {
            data: components["schemas"]["InstructionProposalView"] | null;
        };
        /** Response[InstructionView] */
        Response_InstructionView_: {
            data: components["schemas"]["InstructionView"] | null;
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
        /** Response[MemoryItem] */
        Response_MemoryItem_: {
            data: components["schemas"]["MemoryItem"] | null;
        };
        /** Response[MemoryListResponse] */
        Response_MemoryListResponse_: {
            data: components["schemas"]["MemoryListResponse"] | null;
        };
        /** Response[MemorySourcesResponse] */
        Response_MemorySourcesResponse_: {
            data: components["schemas"]["MemorySourcesResponse"] | null;
        };
        /** Response[ModelCatalogResponse] */
        Response_ModelCatalogResponse_: {
            data: components["schemas"]["ModelCatalogResponse"] | null;
        };
        /** Response[ModelSelectionResponse] */
        Response_ModelSelectionResponse_: {
            data: components["schemas"]["ModelSelectionResponse"] | null;
        };
        /** Response[ModifiedRunsResponse] */
        Response_ModifiedRunsResponse_: {
            data: components["schemas"]["ModifiedRunsResponse"] | null;
        };
        /** Response[OpenWorkspaceResult] */
        Response_OpenWorkspaceResult_: {
            data: components["schemas"]["OpenWorkspaceResult"] | null;
        };
        /** Response[OperationView] */
        Response_OperationView_: {
            data: components["schemas"]["OperationView"] | null;
        };
        /** Response[ParticipateInMemoryResponse] */
        Response_ParticipateInMemoryResponse_: {
            data: components["schemas"]["ParticipateInMemoryResponse"] | null;
        };
        /** Response[ResolveRootPathResponse] */
        Response_ResolveRootPathResponse_: {
            data: components["schemas"]["ResolveRootPathResponse"] | null;
        };
        /** Response[ResourceTicket] */
        Response_ResourceTicket_: {
            data: components["schemas"]["ResourceTicket"] | null;
        };
        /** Response[RootEntryResponse] */
        Response_RootEntryResponse_: {
            data: components["schemas"]["RootEntryResponse"] | null;
        };
        /** Response[RootListing] */
        Response_RootListing_: {
            data: components["schemas"]["RootListing"] | null;
        };
        /** Response[RunChangesResponse] */
        Response_RunChangesResponse_: {
            data: components["schemas"]["RunChangesResponse"] | null;
        };
        /** Response[SearchResponse] */
        Response_SearchResponse_: {
            data: components["schemas"]["SearchResponse"] | null;
        };
        /** Response[TemplateListResponse] */
        Response_TemplateListResponse_: {
            data: components["schemas"]["TemplateListResponse"] | null;
        };
        /** Response[TemplateView] */
        Response_TemplateView_: {
            data: components["schemas"]["TemplateView"] | null;
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
        /** Response[UndoResponse] */
        Response_UndoResponse_: {
            data: components["schemas"]["UndoResponse"] | null;
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
        /** Response[WorkspaceItem] */
        Response_WorkspaceItem_: {
            data: components["schemas"]["WorkspaceItem"] | null;
        };
        /** Response[WorkspaceListResponse] */
        Response_WorkspaceListResponse_: {
            data: components["schemas"]["WorkspaceListResponse"] | null;
        };
        /** Response[WriteLeaseResponse] */
        Response_WriteLeaseResponse_: {
            data: components["schemas"]["WriteLeaseResponse"] | null;
        };
        /** Response[dict] */
        Response_dict_: {
            /** Data */
            data: {
                [key: string]: unknown;
            } | null;
        };
        /** Response[list[DocumentView]] */
        Response_list_DocumentView__: {
            /** Data */
            data: components["schemas"]["DocumentView"][] | null;
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
        /** RootEntryResponse */
        RootEntryResponse: {
            entry: components["schemas"]["RootEntryView"];
        };
        /** RootEntryView */
        RootEntryView: {
            path: components["schemas"]["RootedPath"];
            /** Name */
            name: string;
            kind: components["schemas"]["FileKind"];
            /** Size */
            size: number | null;
            /**
             * Modified At
             * @description 毫秒时间戳；只有普通文件有
             */
            modified_at: number | null;
            /**
             * Link Target
             * @description 符号链接的目标文本；链接不被展开或跟随
             */
            link_target: string | null;
        };
        /** @description 可访问根：工作区文件夹或会话工作目录 */
        RootId: string;
        /** RootListing */
        RootListing: {
            path: components["schemas"]["RootedPath"];
            /** Entries */
            entries: components["schemas"]["RootEntryView"][];
            /**
             * Truncated
             * @default false
             */
            truncated: boolean;
        };
        /**
         * RootedPath
         * @description 文件接口与执行端口使用的位置；客户端不提交桌面绝对路径。
         */
        RootedPath: {
            root_id: components["schemas"]["RootId"];
            /** @default  */
            relative_path: components["schemas"]["RelativePath"];
        };
        /** RunChangesResponse */
        RunChangesResponse: {
            /** Run Id */
            run_id: string;
            /** Session Id */
            session_id: string;
            /** Session Title */
            session_title: string;
            /**
             * Run Active
             * @description 运行仍在进行时不能撤销
             */
            run_active: boolean;
            /**
             * Kind
             * @default run
             * @enum {string}
             */
            kind: "run" | "undo";
            /** Undo Of Run Id */
            undo_of_run_id: string | null;
            /** Entries */
            entries: components["schemas"]["ChangeEntryView"][];
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
        /** RunSummaryView */
        RunSummaryView: {
            /** Run Id */
            run_id: string;
            /** Session Id */
            session_id: string;
            /** Session Title */
            session_title: string;
            /** Run Status */
            run_status: string;
            /**
             * Changed Files
             * @description 净变化的文件数；运行里新建后又删除的文件不计
             */
            changed_files: number;
            /** First At */
            first_at: number;
            /** Last At */
            last_at: number;
            /**
             * Kind
             * @description run：Agent 运行；undo：一次撤销操作，它的 run_id 是操作身份，可像运行一样查看变更并撤回
             * @default run
             * @enum {string}
             */
            kind: "run" | "undo";
            /**
             * Undo Of Run Id
             * @description kind=undo 时被撤销的运行
             */
            undo_of_run_id: string | null;
        };
        /** SamplingPreviewRequest */
        SamplingPreviewRequest: {
            /** Model */
            model: string;
            sampling: components["schemas"]["ModelSampling"];
        };
        /** SaveTemplateRequest */
        SaveTemplateRequest: {
            /** Workspace Id */
            workspace_id: string;
            /** Name */
            name: string;
            /**
             * Include Tool Suggestions
             * @description 同时保存工具启用建议（只含本机执行开关）
             * @default false
             */
            include_tool_suggestions: boolean;
        };
        /**
         * ScanSummary
         * @description 文件夹规模：排除规则之外的文件数与总大小；达到扫描上限时截断。
         */
        ScanSummary: {
            /**
             * Files
             * @default 0
             */
            files: number;
            /**
             * Directories
             * @default 0
             */
            directories: number;
            /**
             * Bytes
             * @default 0
             */
            bytes: number;
            /**
             * Truncated
             * @default false
             */
            truncated: boolean;
        };
        /** SearchHitView */
        SearchHitView: {
            source_type: components["schemas"]["SearchSourceType"];
            /** Source Id */
            source_id: string;
            /** Source Version */
            source_version: number;
            /** Title */
            title: string;
            /** Snippet */
            snippet: string;
            /** Score */
            score: number;
            /** Certainty */
            certainty: string | null;
            /** Stale */
            stale: boolean;
            /** Payload */
            payload: {
                [key: string]: unknown;
            };
        };
        /**
         * SearchRequest
         * @description 范围固定为路径里的工作区；可检索记忆、会话摘要与文件片段。
         */
        SearchRequest: {
            /** Query */
            query: string;
            /**
             * Source Types
             * @description 省略为记忆、会话摘要与文件片段都查
             */
            source_types?: ("memory" | "session_summary" | "document_chunk")[] | null;
            /**
             * Limit
             * @default 20
             */
            limit: number;
        };
        /** SearchResponse */
        SearchResponse: {
            /** Hits */
            hits: components["schemas"]["SearchHitView"][];
        };
        /**
         * SearchSourceType
         * @enum {string}
         */
        SearchSourceType: "memory" | "session_summary" | "document_chunk";
        SessionEvent: components["schemas"]["MessageSSEEvent"] | components["schemas"]["TitleSSEEvent"] | components["schemas"]["StepSSEEvent"] | components["schemas"]["PlanSSEEvent"] | components["schemas"]["ToolSSEEvent"] | components["schemas"]["DoneSSEEvent"] | components["schemas"]["ErrorSSEEvent"] | components["schemas"]["WaitSSEEvent"] | components["schemas"]["TurnSSEEvent"] | components["schemas"]["AttemptSSEEvent"] | components["schemas"]["RunSSEEvent"] | components["schemas"]["EnvironmentSSEEvent"] | components["schemas"]["ContextSSEEvent"] | components["schemas"]["CompactSSEEvent"] | components["schemas"]["CleanupSSEEvent"] | components["schemas"]["ApprovalSSEEvent"];
        /** @description 会话身份 */
        SessionId: string;
        /**
         * SessionStatus
         * @description 会话状态：最新运行状态的冗余副本，与运行状态在同一事务更新，供会话列表使用。
         * @enum {string}
         */
        SessionStatus: "pending" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted";
        /**
         * SkillConfig
         * @description Skill 多来源发现与选择偏好；不存放密钥。
         */
        SkillConfig: {
            /**
             * Discover User
             * @default true
             */
            discover_user: boolean;
            /**
             * Discover Workspace
             * @default true
             */
            discover_workspace: boolean;
            /** Disabled Sources */
            disabled_sources?: string[];
            /** Disabled Skills */
            disabled_skills?: string[];
            /** Extra Dirs */
            extra_dirs?: string[];
            /** Preferred */
            preferred?: {
                [key: string]: string;
            };
        };
        /**
         * SkillSelection
         * @description 显式选择使用稳定 skill_id 与内容版本，不以可见名称冒充身份。
         */
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
            enabled?: boolean | null;
            /** Included */
            included?: boolean | null;
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
        /** SyncIndexRequest */
        SyncIndexRequest: {
            /**
             * Paths
             * @description 省略则全量对照文件夹重扫
             */
            paths?: string[] | null;
        };
        /** TemplateListResponse */
        TemplateListResponse: {
            /** Templates */
            templates: components["schemas"]["TemplateView"][];
        };
        /** TemplateView */
        TemplateView: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Body */
            body: string;
            /** Tool Suggestions */
            tool_suggestions: {
                [key: string]: unknown;
            };
            /** Created At */
            created_at: number;
            /** Updated At */
            updated_at: number;
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
        /** UndoItemRequest */
        UndoItemRequest: {
            /** Relative Path */
            relative_path: string;
            /** @description 仍要恢复：带上冲突结果里的当前版本 */
            force?: components["schemas"]["ForceCurrentRequest"] | null;
        };
        /** UndoItemResult */
        UndoItemResult: {
            /** Relative Path */
            relative_path: string;
            /**
             * Status
             * @enum {string}
             */
            status: "restored" | "removed" | "unchanged" | "conflict" | "failed";
            /** Message */
            message: string;
            current: components["schemas"]["FileVersionView"] | null;
            /** Conflict Reason */
            conflict_reason: ("modified" | "missing" | "appeared" | "not_file" | "modified_during_run") | null;
            /**
             * Can Force
             * @default false
             */
            can_force: boolean;
        };
        /** UndoRequest */
        UndoRequest: {
            /** Items */
            items: components["schemas"]["UndoItemRequest"][];
        };
        /** UndoResponse */
        UndoResponse: {
            /** Results */
            results: components["schemas"]["UndoItemResult"][];
        };
        /** UpdateInstructionRequest */
        UpdateInstructionRequest: {
            /**
             * Body
             * @description 新的工作方式全文；可为空串表示清除
             */
            body: string;
            /**
             * Version
             * @description 工作区 version；不符返回 409 并带最新值
             */
            version: number;
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
        /** WorkspaceItem */
        WorkspaceItem: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            status: components["schemas"]["WorkspaceStatus"];
            /**
             * Version
             * @description 重命名、归档等修改时回传，用于并发修改核对
             */
            version: number;
            folder: components["schemas"]["FolderView"] | null;
            /** @description 文件夹当前的写入租约；为空表示没有写入者 */
            write_lease: components["schemas"]["WriteLeaseView"] | null;
            /**
             * Local Execution Enabled
             * @description 本工作区是否启用本机 Shell／脚本；默认关闭
             * @default false
             */
            local_execution_enabled: boolean;
            /**
             * Auto Memory Enabled
             * @description 是否在运行正常结束后自动提炼记忆；默认开启，会话可单独设为不参与
             * @default true
             */
            auto_memory_enabled: boolean;
            /**
             * Instruction Version
             * @description 当前工作方式版本；空表示尚未设置
             */
            instruction_version: number | null;
            /**
             * Instruction Preview
             * @description 当前工作方式的开头预览
             */
            instruction_preview: string | null;
            /** Created At */
            created_at: number;
            /** Updated At */
            updated_at: number;
        };
        /** WorkspaceListResponse */
        WorkspaceListResponse: {
            /** Workspaces */
            workspaces: components["schemas"]["WorkspaceItem"][];
        };
        /**
         * WorkspaceStatus
         * @enum {string}
         */
        WorkspaceStatus: "active" | "archived" | "deleting";
        /** WorkspaceVersionRequest */
        WorkspaceVersionRequest: {
            /** Version */
            version: number;
        };
        /** WriteLeaseResponse */
        WriteLeaseResponse: {
            /** @description 没有租约表示文件夹当前没有写入者 */
            lease: components["schemas"]["WriteLeaseView"] | null;
        };
        /**
         * WriteLeaseView
         * @description 文件夹当前的写入租约；被占用时其他会话的写入立即得到带这些信息的 409。
         */
        WriteLeaseView: {
            /** Id */
            id: string;
            /** @description preparing/held 正常写入中；settling 已请求停止；blocked 停止后未能确认写入结束，需重试收尾 */
            state: components["schemas"]["LeaseState"];
            writer_kind: components["schemas"]["WriterKind"];
            /**
             * Owner Session Id
             * @description 持有者会话；上传等不属于会话的写入为空串
             */
            owner_session_id: string;
            /** Owner Run Id */
            owner_run_id: string | null;
            /** Operation */
            operation: string | null;
            /** Reason */
            reason: string;
            /** Acquired At */
            acquired_at: number;
            /** Updated At */
            updated_at: number;
        };
        /**
         * WriterKind
         * @enum {string}
         */
        WriterKind: "core_tool" | "process";
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
    attachment_content_ticket_api_files__file_id__preview_ticket_post: {
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
                    "application/json": components["schemas"]["Response_ResourceTicket_"];
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
                /** @description 只列出该工作区的会话 */
                workspace_id?: string | null;
                /** @description 只列出没有工作区的独立对话；不能与 workspace_id 同时使用 */
                independent?: boolean;
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
                /** @description 只列出该工作区的会话 */
                workspace_id?: string | null;
                /** @description 只列出没有工作区的独立对话；不能与 workspace_id 同时使用 */
                independent?: boolean;
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
                request_id: string;
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
            query?: {
                workspace_id?: string | null;
                refresh?: boolean;
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
    list_sources_api_skills_sources_get: {
        parameters: {
            query?: {
                workspace_id?: string | null;
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
    scan_skills_api_skills_scan_post: {
        parameters: {
            query?: {
                workspace_id?: string | null;
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
    get_skill_config_api_skills_config_get: {
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
    update_skill_config_api_skills_config_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SkillConfig"];
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
    add_extra_dir_api_skills_extra_dirs_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExtraDirRequest"];
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
    remove_extra_dir_api_skills_extra_dirs_delete: {
        parameters: {
            query: {
                path: string;
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
    prefer_skill_api_skills_prefer_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreferRequest"];
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
    skill_file_api_skills__skill_id__file_get: {
        parameters: {
            query: {
                expected_version: string;
                path: string;
                download?: boolean;
            };
            header?: never;
            path: {
                skill_id: string;
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
    skill_detail_api_skills__skill_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skill_id: string;
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
    edit_skill_api_skills__skill_id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skill_id: string;
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
    delete_skill_api_skills__skill_id__delete: {
        parameters: {
            query: {
                expected_version: string;
            };
            header?: never;
            path: {
                skill_id: string;
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
    change_skill_api_skills__skill_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                skill_id: string;
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
    list_workspaces_api_workspaces_get: {
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
                    "application/json": components["schemas"]["Response_WorkspaceListResponse_"];
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
    create_workspace_api_workspaces_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateWorkspaceRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_WorkspaceItem_"];
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
    open_workspace_api_workspaces_open_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OpenWorkspaceRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_OpenWorkspaceResult_"];
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
    resolve_conflict_api_workspaces_open_resolve_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveConflictRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_OpenWorkspaceResult_"];
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
    get_default_location_api_workspaces_default_location_get: {
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
                    "application/json": components["schemas"]["Response_DefaultLocationResponse_"];
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
    set_default_location_api_workspaces_default_location_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DefaultLocationRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_DefaultLocationResponse_"];
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
    get_workspace_api_workspaces__workspace_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_WorkspaceItem_"];
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
    rename_workspace_api_workspaces__workspace_id__rename_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenameWorkspaceRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_WorkspaceItem_"];
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
    set_local_execution_api_workspaces__workspace_id__local_execution_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LocalExecutionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_WorkspaceItem_"];
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
    set_auto_memory_api_workspaces__workspace_id__auto_memory_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AutoMemoryRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_WorkspaceItem_"];
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
    archive_workspace_api_workspaces__workspace_id__archive_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkspaceVersionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_WorkspaceItem_"];
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
    unarchive_workspace_api_workspaces__workspace_id__unarchive_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorkspaceVersionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_WorkspaceItem_"];
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
    relocate_workspace_api_workspaces__workspace_id__relocate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RelocateWorkspaceRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_WorkspaceItem_"];
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
    recheck_workspace_api_workspaces__workspace_id__recheck_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_WorkspaceItem_"];
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
    delete_workspace_api_workspaces__workspace_id__delete_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
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
    get_write_lease_api_workspaces__workspace_id__write_lease_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_WriteLeaseResponse_"];
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
    retry_settle_api_workspaces__workspace_id__write_lease_retry_settle_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_WriteLeaseResponse_"];
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
    modified_runs_api_workspaces__workspace_id__modified_runs_get: {
        parameters: {
            query?: {
                limit?: number | null;
            };
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_ModifiedRunsResponse_"];
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
    run_changes_api_workspaces__workspace_id__runs__run_id__changes_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
                run_id: string;
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
                    "application/json": components["schemas"]["Response_RunChangesResponse_"];
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
    preview_change_api_workspaces__workspace_id__runs__run_id__changes_preview_get: {
        parameters: {
            query: {
                /** @description 相对文件夹的路径 */
                path: string;
            };
            header?: never;
            path: {
                workspace_id: string;
                run_id: string;
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
                    "application/json": components["schemas"]["Response_ChangePreviewResponse_"];
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
    undo_run_api_workspaces__workspace_id__runs__run_id__undo_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UndoRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_UndoResponse_"];
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
    stream_changes_api_workspaces__workspace_id__changes_stream_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
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
    get_instruction_api_workspaces__workspace_id__instruction_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_InstructionView_"];
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
    put_instruction_api_workspaces__workspace_id__instruction_put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateInstructionRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_InstructionView_"];
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
    list_proposals_api_workspaces__workspace_id__instruction_proposals_get: {
        parameters: {
            query?: {
                status?: string | null;
            };
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_InstructionProposalList_"];
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
    accept_proposal_api_workspaces__workspace_id__instruction_proposals__proposal_id__accept_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
                proposal_id: string;
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
                    "application/json": components["schemas"]["Response_InstructionView_"];
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
    reject_proposal_api_workspaces__workspace_id__instruction_proposals__proposal_id__reject_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
                proposal_id: string;
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
                    "application/json": components["schemas"]["Response_InstructionProposalView_"];
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
    list_templates_api_templates_get: {
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
                    "application/json": components["schemas"]["Response_TemplateListResponse_"];
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
    save_template_api_templates_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveTemplateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_TemplateView_"];
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
    rename_template_api_templates__template_id__rename_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                template_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RenameTemplateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_TemplateView_"];
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
    apply_template_api_templates__template_id__apply_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                template_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApplyTemplateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ApplyTemplateResponse_"];
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
    delete_template_api_templates__template_id__delete_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                template_id: string;
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
                    "application/json": components["schemas"]["Response_dict_"];
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
    list_memories_api_workspaces__workspace_id__memories_get: {
        parameters: {
            query?: {
                status?: components["schemas"]["MemoryStatus"][] | null;
            };
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_MemoryListResponse_"];
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
    create_memory_api_workspaces__workspace_id__memories_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateMemoryRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_MemoryItem_"];
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
    patch_memory_api_workspaces__workspace_id__memories__memory_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
                memory_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchMemoryRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_MemoryItem_"];
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
    memory_sources_api_workspaces__workspace_id__memories__memory_id__sources_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
                memory_id: string;
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
                    "application/json": components["schemas"]["Response_MemorySourcesResponse_"];
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
    participate_in_memory_api_sessions__session_id__participate_in_memory_post: {
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
                "application/json": components["schemas"]["ParticipateInMemoryRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ParticipateInMemoryResponse_"];
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
    search_workspace_api_workspaces__workspace_id__search_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SearchRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_SearchResponse_"];
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
    run_context_manifest_api_runs__run_id__context_manifest_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
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
                    "application/json": components["schemas"]["Response_ContextManifestView_"];
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
    document_index_summary_api_workspaces__workspace_id__documents_index_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_IndexSummaryView_"];
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
    list_documents_api_workspaces__workspace_id__documents_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
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
                    "application/json": components["schemas"]["Response_list_DocumentView__"];
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
    sync_documents_api_workspaces__workspace_id__documents_sync_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SyncIndexRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_dict_"];
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
    read_document_chunk_api_workspaces__workspace_id__documents_chunks__chunk_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspace_id: string;
                chunk_id: string;
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
                    "application/json": components["schemas"]["Response_DocumentSourceView_"];
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
    list_entries_api_roots__root_id__entries_get: {
        parameters: {
            query?: {
                /** @description 根内相对路径，空串为根本身 */
                path?: string;
            };
            header?: never;
            path: {
                root_id: string;
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
                    "application/json": components["schemas"]["Response_RootListing_"];
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
    get_entry_api_roots__root_id__entry_get: {
        parameters: {
            query?: {
                /** @description 根内相对路径，空串为根本身 */
                path?: string;
            };
            header?: never;
            path: {
                root_id: string;
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
                    "application/json": components["schemas"]["Response_RootEntryResponse_"];
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
    read_content_api_roots__root_id__content_get: {
        parameters: {
            query?: {
                /** @description 根内相对路径，空串为根本身 */
                path?: string;
                offset?: number;
                length?: number | null;
            };
            header?: never;
            path: {
                root_id: string;
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
    preview_api_roots__root_id__preview_get: {
        parameters: {
            query?: {
                /** @description 根内相对路径，空串为根本身 */
                path?: string;
                sheet?: number;
                row?: number;
                column?: number;
                offset?: number;
                revision?: string | null;
            };
            header?: never;
            path: {
                root_id: string;
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
    content_ticket_api_roots__root_id__preview_ticket_post: {
        parameters: {
            query: {
                path: string;
            };
            header?: never;
            path: {
                root_id: string;
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
                    "application/json": components["schemas"]["Response_ResourceTicket_"];
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
    root_content_api_roots__root_id__preview_content__relative_path__get: {
        parameters: {
            query?: {
                revision?: string | null;
            };
            header?: never;
            path: {
                root_id: string;
                relative_path: string;
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
    upload_api_roots__root_id__upload_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                root_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_api_roots__root_id__upload_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_RootEntryResponse_"];
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
    create_folder_grant_api_host_folder_grants_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FolderGrantRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_FolderGrantResponse_"];
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
    resolve_root_path_api_host_roots__root_id__resolve_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                root_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveRootPathRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Response_ResolveRootPathResponse_"];
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

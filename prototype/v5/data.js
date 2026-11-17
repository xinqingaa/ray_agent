// 静态夹具：所有内容均为原型示例，不连接核心、模型或真实文件夹。
const DATA = {
  independent: [
    {id: 'c1', title: '把会议录音整理成纪要', when: '今天', time: '14:20'},
    {id: 'c2', title: '润色一封给供应商的邮件', when: '今天', time: '10:05'},
    {id: 'c3', title: '解释一个 Python 报错', when: '昨天', time: '21:40'},
    {id: 'c4', title: '旅行行程对比', when: '更早', time: '11月9日'},
  ],
  workspaces: [
    {
      id: 'review', name: '季度复盘', folder: '~/Documents/季度复盘', state: 'ok', hue: 'blue',
      sessions: [
        {id: 's1', title: '整理竞品表', time: '14:32', status: 'live'},
        {id: 's2', title: '写纪要给市场', time: '昨天', status: 'waiting'},
        {id: 's3', title: '定价策略讨论', time: '周一'},
      ],
    },
    {
      id: 'course', name: '课程笔记', folder: '~/Documents/课程笔记', state: 'ok', hue: 'green',
      sessions: [
        {id: 'k1', title: '第三章习题整理', time: '周二'},
        {id: 'k2', title: '期中复习提纲', time: '11月8日'},
      ],
    },
    {
      id: 'expense', name: '出差报销', folder: '~/Desktop/出差报销', state: 'missing', hue: 'amber',
      sessions: [{id: 'e1', title: '核对发票金额', time: '11月3日'}],
    },
    {
      id: 'photos', name: '家庭旧照整理', folder: '~/Pictures/旧照', state: 'archived', hue: 'violet',
      sessions: [{id: 'p1', title: '按年份重命名', time: '10月'}],
    },
  ],

  tree: [
    {name: '材料', type: 'dir', open: true, children: [
      {name: '竞品-A.pdf', index: 'ready', used: true},
      {name: '竞品-B.pdf', index: 'ready', used: true},
      {name: '渠道访谈纪要.md', index: 'ready'},
      {name: '白板照片.png', index: 'ocr'},
      {name: '上季结论.txt', index: 'ready'},
    ]},
    {name: '合同', type: 'dir', open: false, children: [
      {name: '扫描合同.pdf', index: 'pending'},
    ]},
    {name: '成果', type: 'dir', open: true, children: [
      {name: '竞品对比表.xlsx', index: 'ready', fresh: true},
    ]},
  ],

  workingStyle: {
    version: 3,
    text: '先给结论，再给依据。数字和引述需要能回到原文；材料不足时明确说明缺了什么，不用推测补齐。\n交付表格放在「成果/」，文件名用中文。',
    updated: '11月12日 · 你编辑',
  },
  proposal: {
    from: '整理竞品表',
    before: '数字和引述需要能回到原文；',
    after: '数字和引述需要能回到原文，表格中的数字在备注列标出页码；',
  },

  // pinned 钉住；排序规则同核心 select_resident：钉住先，其次 约束 > 偏好 > 决定 > 事实，再按最近使用
  // 前 12 条每次新运行都带上，其余只在检索时按任务内容召回
  memories: [
    {id: 'm1', text: '对外报价需要先经过市场部确认，不直接写进给客户的材料。', type: '约束', pinned: true, source: '定价策略讨论', when: '11月11日', rank: 1},
    {id: 'm2', text: '汇报材料先写结论，再展开依据，篇幅控制在两页。', type: '偏好', source: '你添加', when: '11月6日', rank: 3},
    {id: 'm3', text: '竞品统一按「直营 / 渠道 / 线上」三类渠道比较。', type: '决定', source: '整理竞品表', when: '今天', rank: 1},
    {id: 'm4', text: '竞品-B 自 2026 年 Q3 起取消了年付折扣。', type: '事实', source: '整理竞品表', when: '今天', rank: 1},
    {id: 'm5', text: '市场部对接人是周敏，纪要抄送她。', type: '事实', source: '写纪要给市场', when: '昨天', rank: 2},
    {id: 'm6', text: '上季复盘里渠道返点按 8% 估算。', type: '事实', source: '上季结论.txt', when: '11月2日', rank: 9},
    {id: 'm7', text: '金额统一保留到元，不写小数。', type: '偏好', source: '整理竞品表', when: '今天', rank: 1},
    {id: 'm8', text: '不要引用来源不明的行业报告。', type: '约束', source: '你添加', when: '10月28日', rank: 6},
    {id: 'm9', text: '季度复盘每季最后一周交给管理层。', type: '事实', source: '定价策略讨论', when: '11月11日', rank: 3},
    {id: 'm10', text: '竞品-A 的直营团队约 40 人。', type: '事实', source: '渠道访谈纪要.md', when: '11月10日', rank: 4},
    {id: 'm11', text: '对比表的列顺序：价格、渠道、返点、备注。', type: '决定', source: '整理竞品表', when: '今天', rank: 2},
    {id: 'm12', text: '图表配色避开红绿对比，管理层有人色弱。', type: '偏好', source: '写纪要给市场', when: '昨天', rank: 2},
    {id: 'm13', text: '竞品-C 暂不纳入本季比较。', type: '决定', source: '定价策略讨论', when: '11月11日', rank: 5},
    {id: 'm14', text: '上季线上渠道收入占比 31%。', type: '事实', source: '上季结论.txt', when: '11月2日', rank: 8},
    {id: 'm15', text: '渠道访谈共 6 家代理商，名单在访谈纪要第 1 节。', type: '事实', source: '渠道访谈纪要.md', when: '11月10日', rank: 7},
  ],
  candidates: [
    {id: 'n1', text: '渠道返点改按 10% 估算。', type: '事实', source: '整理竞品表', conflictWith: 'm6',
      reason: '与已保存的「按 8% 估算」矛盾，需要你决定保留哪一条。'},
  ],

  citations: {
    1: {file: '竞品-A.pdf', loc: '第 5 页', text: '标准版年费 <mark>¥ 4,800</mark>，渠道合作伙伴可获得 <mark>12%</mark> 返点，按季度结算。'},
    2: {file: '竞品-B.pdf', loc: '第 3 页', text: '自 2026 年第三季度起，<mark>不再提供年付折扣</mark>，统一按月计费 ¥ 420。'},
    3: {file: '渠道访谈纪要.md', loc: '第 2 节', text: '代理商反馈 B 的线上渠道占比已超过 <mark>六成</mark>，直营团队收缩。'},
  },

  references: {
    style: 'v3',
    resident: ['对外报价需要先经过市场部确认…', '汇报材料先写结论…', '竞品统一按三类渠道比较'],
    recalled: [
      {kind: 'file', label: '竞品-A.pdf', loc: '第 5 页'},
      {kind: 'file', label: '竞品-B.pdf', loc: '第 3 页'},
      {kind: 'file', label: '渠道访谈纪要.md', loc: '第 2 节'},
      {kind: 'summary', label: '定价策略讨论', loc: '会话摘要'},
    ],
  },

  steps: [
    {icon: 'listChecks', verb: '列出计划', obj: '4 项', ok: true},
    {icon: 'fileText', verb: '读取', obj: '竞品-A.pdf · 第 1–9 页', ok: true},
    {icon: 'fileText', verb: '读取', obj: '竞品-B.pdf · 第 1–6 页', ok: true},
    {icon: 'search', verb: '检索工作区', obj: '「渠道 返点」 · 命中 4 处', ok: true},
    {icon: 'terminal', verb: '运行命令', obj: 'python build_table.py', ok: true, approval: true},
    {icon: 'pencil', verb: '写入', obj: '成果/竞品对比表.xlsx', ok: true},
  ],

  // 计划：阶段 + 阶段内步骤。顶层计数只算阶段，子步骤不重复计数
  plan: {
    title: '竞品价格与渠道对比',
    desc: '读两份材料，按工作区约定的三类渠道整理，生成对比表并写出结论与缺口。',
    stages: [
      {text: '读取两份竞品材料', state: 'done', steps: [
        {text: '竞品-A.pdf', state: 'done'}, {text: '竞品-B.pdf', state: 'done'}]},
      {text: '统一渠道口径并检索补充依据', state: 'done'},
      {text: '生成对比表', state: 'active', steps: [
        {text: '运行脚本生成表格', state: 'active'}, {text: '核对数字与页码', state: 'todo'}]},
      {text: '写结论与缺口说明', state: 'todo'},
    ],
  },

  // 模型：来自用户配置文件的上游，按厂商分组
  models: [
    {vendor: 'Anthropic', mark: 'spark', items: [
      {id: 'opus', name: 'Claude Opus 5.5', ctx: '1M', out: '128K', levels: ['低', '中', '高', '最高'], canOff: true},
      {id: 'sonnet', name: 'Claude Sonnet 5.5', ctx: '1M', out: '64K', levels: ['低', '中', '高'], canOff: true},
      {id: 'haiku', name: 'Claude Haiku 5.5', ctx: '200K', out: '64K', levels: ['低', '中'], canOff: true},
    ]},
    {vendor: 'OpenAI', mark: 'hex', items: [
      {id: 'gpt', name: 'GPT-5.2', ctx: '400K', out: '128K', levels: ['最低', '低', '中', '高'], canOff: false},
    ]},
    {vendor: 'DeepSeek', mark: 'wave', items: [
      {id: 'ds', name: 'DeepSeek V4', ctx: '128K', out: '32K', levels: null, canOff: true},
    ]},
  ],

  // 斜杠菜单：操作 + 已启用的 Skill（来源始终显示）
  slash: [
    {id: 'attach', group: '操作', icon: 'clip', name: '添加文件', desc: '从磁盘选择，也可以直接拖进来'},
    {id: 'plan', group: '操作', icon: 'listChecks', name: '计划模式', desc: '先调研并制定方案，不执行写入和命令', ws: true},
    {id: 'compact', group: '操作', icon: 'layers', name: '压缩上下文', desc: '整理模型上下文，会话历史保留', ring: 0.62},
    {id: 'sk-compete', group: 'Skill', icon: 'spark', name: '竞品分析', desc: '按维度整理竞品材料并标注出处', src: '工作区'},
    {id: 'sk-minutes', group: 'Skill', icon: 'spark', name: '会议纪要', desc: '从录音或笔记整理决定、待办与风险', src: '应用'},
    {id: 'sk-table', group: 'Skill', icon: 'spark', name: '表格整理', desc: '清洗、合并与校验表格数据', src: '~/.codex'},
    {id: 'sk-deck', group: 'Skill', icon: 'spark', name: '汇报提纲', desc: '把结论整理成两页以内的汇报结构', src: '应用'},
    {id: 'sk-find', group: 'Skill', icon: 'spark', name: 'find-skills', desc: '寻找、核对并推荐可安装的 Skill', src: '内置'},
  ],
};

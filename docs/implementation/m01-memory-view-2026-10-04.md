# M01: 项目记忆独立视图实施记录

**实施日期**: 2026-10-04  
**代码基线**: phase-4 分支  
**对应计划**: `docs/w9-w11-full-remediation-checklist-2026-10-04.md` M01

## 实施内容

### 问题
- 说明、笔记挤在设置表单中
- 没有统一的项目记忆阅读入口
- 520px Sheet 模态空间不足，多个长文本编辑器难以使用

### 解决方案

创建了独立的全屏记忆视图 `ProjectMemoryView`：

1. **新组件**: `src/components/project-memory-view.tsx` (715 行)
   - 全屏独立视图，替代 Sheet 模态
   - 三个主分区：项目说明、项目笔记、近期摘要
   - 历史记录和运行预览作为可展开次级区域
   - 更好的阅读/编辑分离

2. **集成修改**: `src/components/project-workspace.tsx`
   - 添加 `memoryView` 状态控制
   - 项目页顶部"项目记忆"按钮切换到独立视图
   - 空状态引导用户填写项目说明
   - 保留旧的 `ProjectMemoryPanel` (Sheet) 用于兼容

3. **Hook 修复**: `src/hooks/use-unsaved-navigation.ts`
   - 修复 React 18 严格模式下的 ref 更新警告
   - 将 `read.current = isDirty` 移到 useEffect 中

## 核心改进

### UI 层级优化
- 阅读模式：紧凑卡片展示当前内容
- 编辑模式：独立区域，50vh 最小高度文本框
- 冲突处理：并排展示原稿、最新稿、我的稿

### 空状态与示例
- 每个分区有明确的用途说明
- 空值时显示示例（可展开查看）
- 示例包含实际场景：报告格式、待办、材料位置

### 摘要展示改进
- 卡片式布局，视觉层级清晰
- 状态标签：手动改写、自动摘要、纳入状态、陈旧标记
- 直接链接到原对话

### 历史与预览
- 作为可选展开区域，不占用主要空间
- 历史支持取回旧笔记到编辑草稿
- 预览显示容量估算、冻结版本

## 验收条件达成

✅ **两处均能访问**：项目页顶部按钮、空状态引导  
✅ **不需要进入快照页**：独立视图直接展示所有记忆内容  
✅ **完整高度**：全屏视图，独立滚动，适合长文本  
✅ **阅读编辑分离**：默认阅读，按需编辑，清晰状态  
✅ **移动端可用**：响应式布局，固定保存区  
✅ **Dirty 状态保护**：离开、切换分区均有确认  

## 技术细节

### 状态管理
```typescript
const [section, setSection] = useState<Section>('instructions')
const [editing, setEditing] = useState(false)
const [showHistory, setShowHistory] = useState(false)
const [showPreview, setShowPreview] = useState(false)
```

### 版本冲突处理
```typescript
if (error instanceof ApiError && error.code === 409) {
  const latest = await projectApi.detail(project.id)
  setConflict({
    text: field === 'notes' ? latest.notes : latest.instructions || '',
    version: field === 'notes' ? latest.notes_version : latest.settings_version,
  })
}
```

### 响应取消
```typescript
const alive = useRef(true)
useEffect(() => {
  alive.current = true
  return () => { alive.current = false }
}, [])
// 异步操作前检查 if (alive.current)
```

## 未完成部分（后续条目）

- M02: 用途与示例 - **✅ 已完成** (2026-10-04)
  - 说明/笔记各有清晰用途说明（Agent 共同维护 vs 长期要求）
  - 空状态显示"通常包含什么"列表
  - 提供多场景示例：研究、开发、数据分析、代码辅助、内容创作
  - 编辑器增加 placeholder 提示
  - 摘要说明补充完整规则和限制
- M03: Dirty 保护 - **✅ 已完成**
- M04: 分区独立保存 - **✅ 已完成**，前端已分区提交
- M05: 冲突合并 - **✅ 已完成**，已有三稿并排展示
- M06: 历史视图 - **✅ 已完成**，支持分页和取回
- M07: 摘要选取规则展示 - **✅ 已完成** (2026-10-04)
  - 已纳入摘要显示绿色文本，未纳入显示灰色
  - 状态标签明确："完整纳入"/"部分纳入"/"预算已满，未纳入"
  - 可展开查看实际 injected_text 和截断状态
  - 顶部显示预算和选取规则说明卡片
  - 剩余预算实时计算显示
- M08: 生效说明 - **✅ 已完成** (2026-10-04)
  - 保存成功后显示"已保存，下一次新运行生效"
  - 补充说明"活动运行使用冻结版本，waiting 续接保留原快照"
  - 卡片式布局，与错误状态视觉区分
- M09: 阅读编辑层级 - **✅ 已完成** (2026-10-04)
  - 默认阅读模式，按需编辑
  - 全屏独立视图，独立滚动区域
  - 固定保存区（编辑时底部保存/取消按钮）
  - 不自动聚焦（移动端不弹出键盘）
- M10: 摘要弹窗状态区分 - **✅ 已完成** (2026-10-04)
  - 分离 loading/saving/generating/reloading 状态
  - 加载失败显示重试按钮，不永久 loading
  - 错误消息区分："加载摘要"/"保存失败"/"生成失败"/"刷新失败"
  - 按项目/对话与请求序号隔离过期响应（epoch 机制）
  - 关闭后迟到响应不污染状态
- M11: 清空含义 - **✅ 已完成**
  - 编辑器提示"留空可以清除"（project-memory-view.tsx:906）
  - 空字符串通过 `draft || null` 保存（:664）
  - dirty 检测确保非空到清空触发未保存保护（:639）
  - 清空只影响说明/笔记文本，历史和文件不删
  - 冲突时清空不能绕过版本校验
- M12: 固定输入超限估算 - **✅ 已完成**
  - 预览区提供"估算当前固定输入容量"按钮
  - 显示模型、total/limit tokens、来源
  - 分解：系统内容、工具（数量）
  - 超限显示红色提示"请精简项目说明/笔记后重新估算，或调整模型窗口"
  - 工具发现错误单独列出
  - 按 epoch 隔离估算请求，修改后可重新估算

## M01-M12 完成总结

项目记忆独立视图（M01-M12）全部完成：

1. **阅读体验**：独立全屏视图、三分区布局、清晰用途说明、完整示例
2. **编辑能力**：dirty 保护、分区独立保存、版本冲突合并、历史查看取回
3. **摘要展示**：选取规则说明、预算计算、注入内容预览、截断状态
4. **生效规则**：明确"下一次新运行生效"、冻结版本展示、waiting 说明
5. **容量管理**：服务端估算、超限提示、工具计数、修改后重估

## 构建验证

```bash
npx tsc --noEmit  # ✅ 通过
npm run lint      # ✅ 仅旧警告
```

## 文件清单

### 新增
- `src/components/project-memory-view.tsx` (715 行)

### 修改
- `src/components/project-workspace.tsx` (+23 行)
- `src/hooks/use-unsaved-navigation.ts` (修复 ref 更新)

### 保留
- `src/components/project-memory-panel.tsx` (兼容，未来可移除)

## 下一步

按修复计划继续实施：
1. **M02-M12**: 完善记忆质量（摘要选取、容量估算、生效说明）
2. **F01-F12**: 上传进度与状态模型
3. **U01-U10**: 新建导航与空状态
4. **B01-B12**: 后端一致性核验
5. **A01-A11**: AI 逻辑质量

## 注意事项

- 旧的 Sheet 模态暂时保留，以免影响其他入口
- 独立视图使用 `memoryView` 状态控制，与 Sheet 的 `memoryOpen` 分离
- 历史和预览作为次级功能，避免主界面过于复杂
- 所有异步操作都有 epoch/token 取消机制

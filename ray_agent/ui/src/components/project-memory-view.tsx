'use client'

import {useCallback, useEffect, useRef, useState} from 'react'
import Link from 'next/link'
import {BookOpen, ArrowLeft} from 'lucide-react'
import {useUnsavedNavigation} from '@/hooks/use-unsaved-navigation'
import {Button} from '@/components/ui/button'
import {projectApi} from '@/lib/api/project'
import {ApiError} from '@/lib/api/fetch'
import type {ProjectAuditEvent, ProjectDetails, ProjectMemoryView} from '@/lib/api/types'
import {ProjectSummaryDialog} from '@/components/project-summary-dialog'

type Section = 'instructions' | 'notes' | 'summaries'
const sections: Array<[Section, string]> = [
  ['instructions', '项目说明'],
  ['notes', '项目笔记'],
  ['summaries', '近期摘要']
]

export function ProjectMemoryView({
  projectId,
  sessionId,
  onBack,
}: {
  projectId: string
  sessionId?: string
  onBack: () => void
}) {
  const [project, setProject] = useState<ProjectDetails | null>(null)
  const [memory, setMemory] = useState<ProjectMemoryView | null>(null)
  const [section, setSection] = useState<Section>('instructions')
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<ProjectAuditEvent[]>([])
  const [more, setMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [summary, setSummary] = useState<{id: string; title: string} | null>(null)
  const [restore, setRestore] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const dirty = useRef(false)
  const epoch = useRef(0)
  const historyEpoch = useRef(0)
  const estimateEpoch = useRef(0)

  const refresh = useCallback(async () => {
    const token = ++epoch.current
    try {
      const [p, m] = await Promise.all([
        projectApi.detail(projectId),
        projectApi.memory(projectId, sessionId),
      ])
      if (token === epoch.current) {
        setProject(p)
        setMemory(old => ({
          ...m,
          capacity: old?.project_prompt === m.project_prompt ? old.capacity : undefined,
        }))
        setError(null)
      }
    } catch (error) {
      if (token === epoch.current)
        setError(error instanceof Error ? error.message : '读取项目记忆失败')
    }
  }, [projectId, sessionId])

  useEffect(() => {
    setProject(null)
    setMemory(null)
    setError(null)
    setHistory([])
    dirty.current = false
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh()
    }, 5000)
    const counter = epoch
    const historyCounter = historyEpoch
    const estimateCounter = estimateEpoch
    return () => {
      counter.current++
      historyCounter.current++
      estimateCounter.current++
      setEstimating(false)
      clearInterval(timer)
    }
  }, [refresh])

  useUnsavedNavigation(() => dirty.current, true)

  const leave = () => {
    if (!dirty.current || window.confirm('项目记忆有未保存的修改，放弃修改并关闭？'))
      onBack()
  }

  const changeSection = (next: Section) => {
    if (next === section) return
    if (
      dirty.current &&
      !window.confirm('放弃当前未保存的修改并切换分区？')
    )
      return
    dirty.current = false
    setRestore(null)
    setSection(next)
  }

  const loadHistory = async (append = false) => {
    const token = ++historyEpoch.current
    setHistoryLoading(true)
    try {
      const rows = await projectApi.memoryHistory(
        projectId,
        append ? history.at(-1)?.seq || 0 : 0
      )
      if (token === historyEpoch.current) {
        setHistory(old => (append ? [...old, ...rows] : rows))
        setMore(rows.length === 20)
        setError(null)
      }
    } catch (error) {
      if (token === historyEpoch.current)
        setError(error instanceof Error ? error.message : '读取修改记录失败')
    } finally {
      if (token === historyEpoch.current) setHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (showHistory) void loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHistory, projectId])

  const changed = () => {
    void refresh()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="返回项目"
          onClick={leave}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-base font-medium">
            <BookOpen className="size-4 shrink-0" />
            项目记忆
            {project && (
              <span className="truncate text-sm font-normal text-muted-foreground">
                {project.name}
              </span>
            )}
          </h1>
          <p className="text-xs text-muted-foreground">
            说明是长期要求，笔记是共同积累，摘要是有限近期背景
          </p>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="项目记忆分区"
        className="flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2"
      >
        {sections.map(([id, label]) => (
          <Button
            key={id}
            role="tab"
            id={`memory-tab-${id}`}
            tabIndex={section === id ? 0 : -1}
            aria-selected={section === id}
            onKeyDown={event => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const index = sections.findIndex(([key]) => key === section)
                const next =
                  sections[
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? sections.length - 1
                        : (index +
                            (event.key === 'ArrowLeft' ? -1 : 1) +
                            sections.length) %
                          sections.length
                  ][0]
                changeSection(next)
                document.getElementById(`memory-tab-${next}`)?.focus()
              }
            }}
            variant={section === id ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => changeSection(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
          {error && (
            <div role="alert" className="text-meta text-state-failed">
              {error}
              <Button size="sm" variant="ghost" onClick={() => void refresh()}>
                重新读取
              </Button>
            </div>
          )}
          {!project && !error && <p className="text-meta text-faint">正在读取项目记忆</p>}

          {project && (section === 'instructions' || section === 'notes') && (
            <MemoryEditor
              key={`${projectId}:${section}`}
              field={section}
              project={project}
              restored={restore}
              onDirty={value => {
                dirty.current = value
              }}
              onSaved={changed}
            />
          )}

          {section === 'summaries' && memory && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-4">
                <h2 className="mb-2 text-sm font-medium">关于近期摘要</h2>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    摘要是对话完成后的简短总结，帮助 Agent 了解近期工作背景。
                  </p>
                  <ul className="space-y-1 pl-4">
                    <li>• 最多参考近期 10 段对话</li>
                    <li>• 注入文本合计不超过 1500 字符</li>
                    <li>• 当前对话不纳入自己的背景</li>
                    <li>• 摘要不能替代原始材料和完整历史</li>
                  </ul>
                  <p className="text-xs">
                    完成对话后自动生成摘要，你也可以手动改写。预算已满时，较早的摘要不会注入新对话。
                  </p>
                </div>
              </div>

              {memory.project.summaries.length > 0 && (
                <div className="rounded-lg border border-signal/20 bg-signal/5 p-3">
                  <p className="text-sm font-medium text-signal">
                    当前预览选取规则
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <li>• 按最近活动排序，最多纳入 10 条摘要</li>
                    <li>
                      • 总预算 1500 字符，包含对话标识、来源和状态前缀
                    </li>
                    <li>• 单条摘要不足时截断，超出预算的摘要不纳入</li>
                    <li>
                      • 实际受理时重新读取，预览仅供参考
                    </li>
                  </ul>
                  <p className="mt-2 text-xs">
                    已纳入 {memory.project.summaries.length} 条，剩余预算约{' '}
                    {1500 -
                      memory.project.summaries.reduce(
                        (sum, s) => sum + (s.injected_text?.length || 0),
                        0
                      )}{' '}
                    字符
                  </p>
                </div>
              )}

              {!memory.candidates.length && (
                <div className="rounded-lg border p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    还没有可参考的摘要
                  </p>
                  <p className="mt-2 text-xs text-faint">
                    项目任务完成后会自动生成摘要，也可在对话页面手动改写
                  </p>
                </div>
              )}

              {memory.candidates.map(item => {
                const included = memory.project.summaries.find(
                  value => value.session_id === item.session_id
                )
                const willInject = included && included.injected_text
                return (
                  <article
                    key={item.session_id}
                    className="space-y-3 rounded-lg border bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/sessions/${item.session_id}`}
                        className="text-sm font-medium text-signal underline"
                      >
                        {item.title || '项目对话'}
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSummary({id: item.session_id, title: item.title})
                        }
                      >
                        改写
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className={willInject ? 'text-state-success' : 'text-muted-foreground'}>
                        {item.source === 'manual' ? '手动改写' : '自动摘要'}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span className={willInject ? 'font-medium text-state-success' : 'text-muted-foreground'}>
                        {included
                          ? included.truncated
                            ? '部分纳入'
                            : '完整纳入'
                          : '预算已满，未纳入'}
                      </span>
                      {item.stale && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-state-waiting">有后续对话，可能过时</span>
                        </>
                      )}
                      {item.state === 'generating' && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-state-waiting">正在生成</span>
                        </>
                      )}
                      {item.state === 'failed' && (
                        <>
                          <span className="text-muted-foreground">·</span>
                          <span className="text-state-failed">生成失败</span>
                        </>
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {item.summary}
                      </p>

                      {willInject && included.injected_text && (
                        <details className="rounded border bg-muted/50 p-3">
                          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                            实际注入内容 ({included.injected_text.length} 字符
                            {included.truncated && '，已截断'})
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            {included.injected_text}
                          </pre>
                        </details>
                      )}
                    </div>

                    {item.error && (
                      <p className="text-xs text-state-failed">{item.error}</p>
                    )}
                  </article>
                )
              })}
            </div>
          )}

          {/* History and Preview as expandable sections */}
          <div className="space-y-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowHistory(!showHistory)}
            >
              {showHistory ? '隐藏修改记录' : '查看修改记录'}
            </Button>

            {showHistory && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  取回旧笔记会载入编辑草稿，保存时生成新版本；文件恢复不会回滚记忆。
                </p>
                {history.map(event => (
                  <details key={event.seq} className="border-b pb-3 last:border-b-0">
                    <summary className="cursor-pointer text-sm font-medium">
                      {event.type === 'project_notes'
                        ? '笔记修改'
                        : event.type === 'project_settings'
                          ? '项目说明与名称'
                          : event.type === 'conversation_summary'
                            ? '摘要更新'
                            : '摘要生成记录'}{' '}
                      · {new Date(event.created_at).toLocaleString()}
                    </summary>
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {event.payload.source === 'agent'
                          ? 'Agent'
                          : event.payload.source === 'user' ||
                              event.payload.source === 'manual'
                            ? '用户'
                            : '自动生成'}
                        {event.payload.notes_version != null &&
                          ` · 版本 ${event.payload.notes_version}`}
                      </p>
                      {typeof event.payload.session_id === 'string' && (
                        <Link
                          className="text-xs text-signal underline"
                          href={`/sessions/${event.payload.session_id}`}
                        >
                          打开来源对话
                        </Link>
                      )}
                      {!!event.payload.auxiliary &&
                        typeof event.payload.auxiliary === 'object' && (
                          <p className="text-xs text-faint">
                            摘要辅助请求：
                            {String(
                              (event.payload.auxiliary as Record<string, unknown>)
                                .model || '模型未记录'
                            )}
                            ，
                            {String(
                              (event.payload.auxiliary as Record<string, unknown>)
                                .duration_ms ?? '未知'
                            )}{' '}
                            ms，用量：
                            {(event.payload.auxiliary as Record<string, unknown>)
                              .usage
                              ? JSON.stringify(
                                  (event.payload.auxiliary as Record<string, unknown>)
                                    .usage
                                )
                              : '服务未返回或未完成'}
                          </p>
                        )}
                      <pre className="whitespace-pre-wrap break-words rounded border bg-muted/50 p-3 text-sm">
                        {String(
                          event.payload.content ??
                            event.payload.instructions ??
                            event.payload.summary ??
                            event.payload.error ??
                            event.payload.reason ??
                            ''
                        )}
                      </pre>
                      {event.type === 'project_notes' &&
                        typeof event.payload.content === 'string' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setRestore(String(event.payload.content))
                              setSection('notes')
                              setShowHistory(false)
                            }}
                          >
                            取回到编辑草稿
                          </Button>
                        )}
                    </div>
                  </details>
                ))}
                {historyLoading && (
                  <p role="status" className="text-meta text-faint">
                    正在读取修改记录
                  </p>
                )}
                {!historyLoading && !history.length && (
                  <p className="text-meta text-faint">还没有记忆修改记录</p>
                )}
                {more && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadHistory(true)}
                  >
                    加载更早记录
                  </Button>
                )}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? '隐藏运行内容预览' : '查看运行内容预览'}
            </Button>

            {showPreview && memory && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    这是此刻用于下一次新运行的项目内容；受理时会重新读取。完整请求还包括基础提示、工具和对话，容量结果以受理检查为准。
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={estimating}
                    onClick={async () => {
                      const token = ++estimateEpoch.current
                      setEstimating(true)
                      try {
                        const result = await projectApi.estimateMemory(
                          projectId,
                          sessionId
                        )
                        if (token === estimateEpoch.current) {
                          setMemory(result)
                          setError(null)
                        }
                      } catch (error) {
                        if (token === estimateEpoch.current)
                          setError(
                            error instanceof Error ? error.message : '估算失败'
                          )
                      } finally {
                        if (token === estimateEpoch.current) setEstimating(false)
                      }
                    }}
                  >
                    {estimating ? '正在读取工具与估算' : '估算当前固定输入容量'}
                  </Button>
                  {memory.capacity && (
                    <div
                      role="status"
                      className="space-y-2 rounded-md border bg-muted/50 p-3 text-sm"
                    >
                      <p>
                        {memory.capacity.model} · 固定输入约{' '}
                        {memory.capacity.total} / {memory.capacity.limit} tokens
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {memory.capacity.source}
                      </p>
                      <p className="text-xs">
                        系统内容 {memory.capacity.system_prompt}，工具{' '}
                        {memory.capacity.tools}（{memory.capacity.tool_count}{' '}
                        个）。实际请求仍需为对话留空间。
                      </p>
                      {memory.capacity.over_limit && (
                        <p className="text-sm text-state-failed">
                          固定内容已超限，压缩历史不能解决。请精简项目说明/笔记后重新估算，或调整模型窗口。
                        </p>
                      )}
                      {Object.entries(memory.capacity.discovery_errors).map(
                        ([name, error]) => (
                          <p className="text-xs text-state-waiting" key={name}>
                            {name}：{error}
                            ，本次估算未纳入其工具；恢复后需要重新估算。
                          </p>
                        )
                      )}
                    </div>
                  )}
                </div>
                <pre className="whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-4 text-sm">
                  {memory.project_prompt}
                </pre>
                {memory.frozen && (
                  <details>
                    <summary className="cursor-pointer text-sm">
                      当前活动运行使用的冻结内容
                    </summary>
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-faint">
                        说明版本 {memory.frozen.settings_version}，笔记版本{' '}
                        {memory.frozen.notes_version}
                        。新保存的内容不会改变这次运行。
                      </p>
                      <pre className="whitespace-pre-wrap break-words rounded border bg-muted/50 p-3 text-sm">
                        {memory.frozen.instructions || '未设置说明'}
                        {'\n\n'}
                        {memory.frozen.notes || '未设置笔记'}
                      </pre>
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ProjectSummaryDialog
        sessionId={summary?.id || null}
        title={summary?.title || ''}
        onClose={() => setSummary(null)}
        onChanged={changed}
      />
    </div>
  )
}

function MemoryEditor({
  field,
  project,
  restored,
  onDirty,
  onSaved,
}: {
  field: 'instructions' | 'notes'
  project: ProjectDetails
  restored: string | null
  onDirty: (value: boolean) => void
  onSaved: () => void
}) {
  const current = field === 'notes' ? project.notes : project.instructions || ''
  const version =
    field === 'notes' ? project.notes_version : project.settings_version
  const [draft, setDraft] = useState(restored ?? current)
  const [base, setBase] = useState(version)
  const [original, setOriginal] = useState(current)
  const [editing, setEditing] = useState(restored !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [conflict, setConflict] = useState<{text: string; version: number} | null>(
    null
  )
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const dirty = editing && draft !== original
  useEffect(() => {
    onDirty(dirty)
  }, [dirty, onDirty])

  const start = () => {
    setOriginal(current)
    setDraft(current)
    setBase(version)
    setEditing(true)
    setSaved(false)
    setError(null)
    setConflict(null)
  }

  const save = async () => {
    if (busy || !dirty) return
    setBusy(true)
    setError(null)
    try {
      if (field === 'notes')
        await projectApi.updateNotes(project.id, draft, base)
      else
        await projectApi.update(project.id, {
          name: project.name,
          instructions: draft || null,
          settings_version: base,
        })
      if (alive.current) {
        setOriginal(draft)
        setEditing(false)
        setSaved(true)
        setConflict(null)
        onDirty(false)
        onSaved()
      }
    } catch (error) {
      if (alive.current) {
        setError(
          error instanceof Error ? error.message : '保存失败，草稿已保留'
        )
        if (error instanceof ApiError && error.code === 409) {
          const latest = await projectApi.detail(project.id).catch(() => null)
          if (alive.current && latest)
            setConflict({
              text:
                field === 'notes' ? latest.notes : latest.instructions || '',
              version:
                field === 'notes'
                  ? latest.notes_version
                  : latest.settings_version,
            })
        }
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const title = field === 'notes' ? '项目笔记' : '项目说明'
  const purpose =
    field === 'notes'
      ? '你和 Agent 共同维护的结论、决策、待办与重要文件位置。Agent 会在任务中更新笔记，你也可以随时编辑。'
      : '给 Agent 的长期目标、工作要求和交付偏好。新对话会沿用这些要求，保持一致的工作标准。'
  const placeholder =
    field === 'notes'
      ? '还没有笔记。可写下已确认的结论、待办和材料位置，Agent 也会在任务中更新。'
      : '还没有项目说明。写下长期目标和偏好，让新对话沿用同一要求。'

  const examples = field === 'notes'
    ? [
        {
          title: '研究项目笔记示例',
          content: `已确认结论：
- 用户留存率在第3周达到峰值（68%），此后缓慢下降
- A/B测试结果显示新引导流程提升15%转化（p<0.05）

待办事项：
- [ ] 补充Q4数据验证
- [ ] 与产品团队对齐新版本优化方向
- [x] 完成用户访谈记录整理

重要文件：
- 原始数据：data/raw/user_retention_2024.csv
- 分析脚本：scripts/analyze_retention.py
- 凭证配置：config/db_credentials.json（不在版本控制）`
        },
        {
          title: '开发项目笔记示例',
          content: `技术决策：
- 使用 PostgreSQL 15 + Redis 7 作为主要数据层
- API 认证采用 JWT，刷新令牌有效期7天
- 文件上传限制：单文件50MB，总量500MB

已知问题：
- 大批量导入时可能触发超时（临时方案：分批处理）
- Safari 14 下文件预览有兼容性问题

待办：
- [ ] 补充单元测试覆盖率到80%
- [ ] 性能测试：并发用户>1000
- [x] 完成 API 文档更新

部署配置：
- 生产环境：aws-prod-us-east-1
- 预发环境：aws-staging-us-west-2
- 部署密钥位于：/secure/deploy-keys/`
        }
      ]
    : [
        {
          title: '数据分析项目说明示例',
          content: `项目目标：
每周生成销售数据分析报告，支持管理层决策

工作要求：
- 使用公司标准 Markdown 模板
- 数据源：CRM 数据库（连接信息见材料）
- 分析维度：按地区、产品线、销售团队
- 包含同比、环比分析，标注异常值

交付偏好：
- 主报告：Markdown 格式，包含图表
- 附件：原始数据表格（CSV）、可交互图表（HTML）
- 命名规范：weekly_sales_YYYY-MM-DD.md
- 交付到项目的 reports/ 目录

数据口径：
- 销售额统计截止每周日23:59
- 退款在发生当周计入负值
- 大客户（年消费>100万）单独统计`,
        },
        {
          title: '代码辅助项目说明示例',
          content: `项目目标：
开发用户管理系统的后端 API

技术栈要求：
- Python 3.11 + FastAPI
- PostgreSQL 数据库
- Redis 缓存
- Docker 容器化部署

代码规范：
- 遵循 PEP 8
- 所有公开函数必须有类型注解和文档字符串
- 单元测试覆盖率要求 >80%
- 提交前运行 black + ruff 格式化

文件组织：
- API 路由：app/routes/
- 业务逻辑：app/services/
- 数据模型：app/models/
- 测试用例：tests/

交付要求：
- 每个功能模块完成后创建可运行的测试
- API 文档使用 OpenAPI 自动生成
- 重要变更需要更新 CHANGELOG.md`,
        },
        {
          title: '内容创作项目说明示例',
          content: `项目目标：
创作技术博客文章，分享开发经验

内容要求：
- 目标读者：3-5年经验的开发者
- 文章长度：2000-3000字
- 风格：技术准确、通俗易懂、有实际案例

结构规范：
1. 标题：明确问题或技术点
2. 引言：为什么这个话题重要（100-200字）
3. 正文：技术细节、代码示例、最佳实践
4. 总结：要点回顾、延伸阅读

交付格式：
- Markdown 文件
- 代码块使用正确的语法高亮标记
- 配图保存到 images/ 目录
- 元信息：标签、发布日期、预计阅读时间

写作偏好：
- 使用第一人称"我"而非"笔者"
- 技术术语首次出现时加注释
- 避免空泛建议，给出具体可执行的步骤`,
        }
      ]

  return (
    <section className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{title}</h2>
          {!editing && (
            <Button size="sm" variant="outline" onClick={start}>
              编辑{title}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{purpose}</p>
        {!editing && !current && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/20 p-4">
              <h3 className="mb-2 text-sm font-medium">
                {field === 'notes' ? '笔记通常包含什么？' : '说明通常包含什么？'}
              </h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {field === 'notes' ? (
                  <>
                    <li>• 已确认的结论、发现和技术决策</li>
                    <li>• 待办事项与完成状态</li>
                    <li>• 重要文件位置、凭证路径（不含密码）</li>
                    <li>• 已知问题与临时解决方案</li>
                  </>
                ) : (
                  <>
                    <li>• 项目的长期目标和预期成果</li>
                    <li>• 工作要求：数据来源、技术栈、代码规范</li>
                    <li>• 交付偏好：格式、命名、目录结构</li>
                    <li>• 质量标准：测试覆盖率、文档要求</li>
                  </>
                )}
              </ul>
            </div>
            <details className="rounded-lg border bg-card p-4">
              <summary className="cursor-pointer text-sm font-medium text-signal">
                查看 {examples.length} 个示例场景
              </summary>
              <div className="mt-4 space-y-4">
                {examples.map((ex, idx) => (
                  <div key={idx} className="space-y-2 border-l-2 border-muted pl-3">
                    <p className="text-sm font-medium">{ex.title}</p>
                    <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {ex.content}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
        <p className="text-xs text-faint">
          当前版本 {version}
          {editing && version !== base && ' · 内容已被其他操作更新，保存前需比较'}
        </p>
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="sr-only" htmlFor={`memory-${field}`}>
              {title}全文
            </label>
            <textarea
              id={`memory-${field}`}
              disabled={busy}
              maxLength={8000}
              placeholder={field === 'notes'
                ? '在这里记录已确认的结论、待办事项和重要文件位置...'
                : '描述项目的长期目标、工作要求和交付偏好...'}
              className="min-h-[50vh] w-full rounded-md border bg-background p-4 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft}
              onChange={event => setDraft(event.target.value)}
            />
          </div>
          <p className="text-xs text-faint">
            {draft.length} / 8000 字符。保存整体替换此分区；留空可以清除。
          </p>

          {conflict && (
            <div className="space-y-3 rounded-md border border-state-waiting bg-muted/20 p-4">
              <p className="text-sm">
                最新版本 {conflict.version}
                ，你的草稿已保留。比较后在上方合并内容。
              </p>
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  编辑前的内容
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded border bg-background p-3 text-sm">
                  {original}
                </pre>
              </details>
              <details open>
                <summary className="cursor-pointer text-sm font-medium">
                  最新内容
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words rounded border bg-background p-3 text-sm">
                  {conflict.text || '（空）'}
                </pre>
              </details>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBase(conflict.version)
                  setOriginal(conflict.text)
                  setConflict(null)
                  setError(null)
                }}
              >
                已比较，以最新版本保存合并稿
              </Button>
            </div>
          )}

          <div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background py-3">
            <Button
              disabled={busy || !dirty || !!conflict}
              onClick={() => void save()}
            >
              {busy ? '正在保存' : '保存' + title}
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => {
                if (!dirty || window.confirm('放弃未保存的修改？')) {
                  setEditing(false)
                  onDirty(false)
                  setError(null)
                  setConflict(null)
                }
              }}
            >
              取消编辑
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4">
          <p className="min-h-24 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {current || placeholder}
          </p>
        </div>
      )}

      {saved && (
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <p role="status" className="text-sm font-medium text-state-success">
            已保存，下一次新运行生效
          </p>
          <p className="text-xs text-muted-foreground">
            活动运行使用冻结版本，waiting 续接保留原快照
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-state-failed">
          {error}
        </p>
      )}
    </section>
  )
}

'use client'

import {useCallback, useEffect, useState, type ReactNode} from 'react'
import {Plus, RotateCcw, Trash2} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {configApi} from '@/lib/api/config'
import type {BuiltinToolset, ListA2AServerItem, ListMCPServerItem, ToolPolicy, ToolPolicyConfig} from '@/lib/api/types'
import {cn} from '@/lib/utils'
import {errorMessage, FormSkeleton, LoadError, SaveBar, SectionHeader} from './form'

type Rules = Record<string, ToolPolicy>
type LoadPhase = {phase: 'loading'} | {phase: 'error'; message: string} | {phase: 'ready'}

const POLICY_LABEL: Record<ToolPolicy, string> = {
  allow: '直接执行',
  ask: '执行前询问',
  deny: '禁止',
}
const POLICIES: ToolPolicy[] = ['allow', 'ask', 'deny']

const TOOLSET_LABEL: Record<string, string> = {
  file: '文件',
  shell: '终端',
  browser: '浏览器',
  search: '网页搜索',
  deliver: '交付文件',
  a2a: '远程 Agent 目录',
}

export type ToolPolicyForm = {
  load: LoadPhase
  config: ToolPolicyConfig | null
  mcpServers: ListMCPServerItem[]
  a2aServers: ListA2AServerItem[]
  rules: Rules | null
  dirty: boolean
  saving: boolean
  savedAt: number | null
  saveError: string | null
  setRule: (key: string, policy: ToolPolicy | null) => void
  restoreDefaults: () => void
  reset: () => void
  save: () => Promise<void>
  reload: () => void
}

function sameRules(a: Rules | null, b: Rules | null): boolean {
  if (!a || !b) return a === b
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

/** 工具策略分区的数据与草稿；放在设置页上层，切换分区不丢失 */
export function useToolPolicyForm(): ToolPolicyForm {
  const [load, setLoad] = useState<LoadPhase>({phase: 'loading'})
  const [config, setConfig] = useState<ToolPolicyConfig | null>(null)
  const [mcpServers, setMcpServers] = useState<ListMCPServerItem[]>([])
  const [a2aServers, setA2aServers] = useState<ListA2AServerItem[]>([])
  const [rules, setRules] = useState<Rules | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    // 服务器列表只用于列出可单独设置的服务；读取失败时仍可编辑其余规则
    Promise.all([
      configApi.getToolPolicy(),
      configApi.getMCPServers().then((data) => data?.mcp_servers ?? []).catch(() => []),
      configApi.getA2AServers().then((data) => data?.a2a_servers ?? []).catch(() => []),
    ])
      .then(([policy, mcp, a2a]) => {
        if (cancelled) return
        setConfig(policy)
        setRules({...policy.rules})
        setMcpServers(mcp)
        setA2aServers(a2a)
        setLoad({phase: 'ready'})
      })
      .catch((err) => {
        if (!cancelled) setLoad({phase: 'error', message: errorMessage(err)})
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const setRule = useCallback((key: string, policy: ToolPolicy | null) => {
    setRules((prev) => {
      if (!prev) return prev
      const next = {...prev}
      if (policy == null) delete next[key]
      else next[key] = policy
      return next
    })
    setSaveError(null)
  }, [])

  const restoreDefaults = useCallback(() => {
    if (!config) return
    setRules({...config.default_rules})
    setSaveError(null)
  }, [config])

  const reset = useCallback(() => {
    if (!config) return
    setRules({...config.rules})
    setSaveError(null)
  }, [config])

  const save = useCallback(async () => {
    if (!rules || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const next = await configApi.updateToolPolicy(rules)
      setConfig(next)
      setRules({...next.rules})
      setSavedAt(Date.now())
    } catch (err) {
      const message = errorMessage(err, '保存失败')
      setSaveError(message)
      toast.error(`保存失败：${message}`)
    } finally {
      setSaving(false)
    }
  }, [rules, saving])

  const reload = useCallback(() => {
    setLoad({phase: 'loading'})
    setAttempt((n) => n + 1)
  }, [])

  const dirty = config != null && rules != null && !sameRules(config.rules, rules)
  return {load, config, mcpServers, a2aServers, rules, dirty, saving, savedAt, saveError, setRule, restoreDefaults, reset, save, reload}
}

function PolicySelect({id, value, inherit, onChange, disabled}: {
  id: string
  value: ToolPolicy | null
  /** 不设规则时的说明；为空表示必须选一个取值 */
  inherit?: string
  onChange: (policy: ToolPolicy | null) => void
  disabled?: boolean
}) {
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? e.target.value as ToolPolicy : null)}
      disabled={disabled}
      className={cn(
        'h-8 w-full max-w-60 rounded-md border bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
        value === 'ask' && 'border-state-waiting/60',
        value === 'deny' && 'border-state-failed/60',
      )}
    >
      {inherit != null && <option value="">{inherit}</option>}
      {POLICIES.map((policy) => <option key={policy} value={policy}>{POLICY_LABEL[policy]}</option>)}
    </select>
  )
}

function RuleRow({id, label, ruleKey, hint, children, onRemove}: {
  id: string
  label: string
  ruleKey: string
  hint?: string | null
  children: ReactNode
  onRemove?: () => void
}) {
  return (
    <li className="grid items-center gap-x-6 gap-y-1.5 py-3 @xl/form:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={hint ?? ruleKey}>
          <code className="font-mono text-faint">{ruleKey}</code>
          {hint && <span className="ml-2">{hint}</span>}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {children}
        {onRemove && (
          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={`删除规则 ${ruleKey}`}>
            <Trash2 aria-hidden/>
          </Button>
        )}
      </div>
    </li>
  )
}

function Group({title, description, children}: {title: string; description?: string; children: ReactNode}) {
  return (
    <div className="pt-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-0.5 max-w-prose text-xs leading-5 text-muted-foreground">{description}</p>}
      <ul className="mt-1 divide-y">{children}</ul>
    </div>
  )
}

function functionsHint(toolset: BuiltinToolset): string {
  const head = toolset.functions.slice(0, 4).join('、')
  return toolset.functions.length > 4 ? `${head} 等 ${toolset.functions.length} 个` : head
}

function inheritText(label: string, policy: ToolPolicy): string {
  return `跟随“${label}”（${POLICY_LABEL[policy]}）`
}

/** 工具审批策略：内置工具按工具集，MCP 与远程 Agent 按服务设置执行前是否需要批准 */
export function ToolPolicySection({form}: {form: ToolPolicyForm}) {
  const [newKey, setNewKey] = useState('')
  const [newPolicy, setNewPolicy] = useState<ToolPolicy>('ask')
  const {config, rules} = form

  return (
    <section aria-labelledby="settings-tool-policy-title">
      <SectionHeader
        id="settings-tool-policy-title"
        title="工具策略"
        description="按工具来源设置执行前是否需要你批准。越具体的规则优先；没有命中规则的调用直接执行。计划与提问不受约束。保存后从下一次执行起生效，包括批准或回复后的续接。"
        action={form.load.phase === 'ready' ? (
          <Button type="button" size="sm" variant="outline" onClick={form.restoreDefaults} disabled={form.saving}>
            <RotateCcw aria-hidden/>
            恢复默认
          </Button>
        ) : undefined}
      />
      {form.load.phase === 'loading' && <FormSkeleton rows={4}/>}
      {form.load.phase === 'error' && <div className="py-5"><LoadError message={form.load.message} onRetry={form.reload}/></div>}
      {form.load.phase === 'ready' && config && rules && (() => {
        const mcpAll = rules['mcp:*'] ?? config.fallback
        const a2aAll = rules['a2a:*'] ?? config.fallback
        const builtinKeys = new Set(config.builtin_toolsets.filter((t) => t.toolset !== 'a2a').map((t) => `${t.toolset}:*`))
        const mcpKeys = new Set(form.mcpServers.map((s) => `mcp:${s.server_name}:*`))
        const a2aKeys = new Set(form.a2aServers.map((s) => `a2a:${s.id}:*`))
        const shown = new Set(['mcp:*', 'a2a:*', ...builtinKeys, ...mcpKeys, ...a2aKeys])
        const others = Object.keys(rules).filter((key) => !shown.has(key)).sort()
        const addKey = newKey.trim()
        return (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              void form.save()
            }}
          >
            <Group title="外部工具" description="MCP 与远程 Agent 的工具来自外部服务，默认执行前询问。">
              <RuleRow id="tp-mcp-all" label="所有 MCP 工具" ruleKey="mcp:*">
                <PolicySelect id="tp-mcp-all" value={mcpAll} onChange={(p) => form.setRule('mcp:*', p ?? 'allow')} disabled={form.saving}/>
              </RuleRow>
              <RuleRow id="tp-a2a-all" label="所有远程 Agent" ruleKey="a2a:*" hint="委派任务（call_remote_agent）；查看 Agent 列表不受约束">
                <PolicySelect id="tp-a2a-all" value={a2aAll} onChange={(p) => form.setRule('a2a:*', p ?? 'allow')} disabled={form.saving}/>
              </RuleRow>
            </Group>

            {form.mcpServers.length > 0 && (
              <Group title="MCP 服务器" description="单独设置某个服务器；不设时跟随“所有 MCP 工具”。">
                {form.mcpServers.map((server) => {
                  const key = `mcp:${server.server_name}:*`
                  const id = `tp-mcp-${server.server_name}`
                  return (
                    <RuleRow key={key} id={id} label={server.server_name} ruleKey={key} hint={server.tools.length > 0 ? `${server.tools.length} 个工具` : null}>
                      <PolicySelect id={id} value={rules[key] ?? null} inherit={inheritText('所有 MCP 工具', mcpAll)} onChange={(p) => form.setRule(key, p)} disabled={form.saving}/>
                    </RuleRow>
                  )
                })}
              </Group>
            )}

            {form.a2aServers.length > 0 && (
              <Group title="远程 Agent" description="单独设置某个远程 Agent；不设时跟随“所有远程 Agent”。">
                {form.a2aServers.map((server) => {
                  const key = `a2a:${server.id}:*`
                  const id = `tp-a2a-${server.id}`
                  return (
                    <RuleRow key={key} id={id} label={server.name || server.id} ruleKey={key}>
                      <PolicySelect id={id} value={rules[key] ?? null} inherit={inheritText('所有远程 Agent', a2aAll)} onChange={(p) => form.setRule(key, p)} disabled={form.saving}/>
                    </RuleRow>
                  )
                })}
              </Group>
            )}

            <Group title="内置工具" description="在沙箱里执行，默认直接执行。">
              {config.builtin_toolsets.filter((t) => t.toolset !== 'a2a').map((toolset) => {
                const key = `${toolset.toolset}:*`
                const id = `tp-builtin-${toolset.toolset}`
                const value = rules[key] ?? null
                return (
                  <RuleRow key={key} id={id} label={TOOLSET_LABEL[toolset.toolset] ?? toolset.toolset} ruleKey={key} hint={functionsHint(toolset)}>
                    <PolicySelect
                      id={id}
                      value={value === 'allow' ? null : value}
                      inherit={POLICY_LABEL.allow}
                      onChange={(p) => form.setRule(key, p === 'allow' ? null : p)}
                      disabled={form.saving}
                    />
                  </RuleRow>
                )
              })}
            </Group>

            <Group title="其他规则" description="按单个函数或 MCP 工具设置，例如 shell_execute、mcp:服务器名:工具名。优先于上面的整组设置。">
              {others.map((key) => (
                <RuleRow key={key} id={`tp-other-${key}`} label={key} ruleKey={key} onRemove={form.saving ? undefined : () => form.setRule(key, null)}>
                  <PolicySelect id={`tp-other-${key}`} value={rules[key]} onChange={(p) => form.setRule(key, p ?? 'allow')} disabled={form.saving}/>
                </RuleRow>
              ))}
              <li className="flex flex-wrap items-center gap-2 py-3">
                <label htmlFor="tp-new-key" className="sr-only">新规则的键</label>
                <Input
                  id="tp-new-key"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="shell_execute 或 mcp:服务器名:工具名"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 w-72 font-mono text-xs md:text-xs"
                  disabled={form.saving}
                />
                <label htmlFor="tp-new-policy" className="sr-only">新规则的取值</label>
                <select
                  id="tp-new-policy"
                  value={newPolicy}
                  onChange={(e) => setNewPolicy(e.target.value as ToolPolicy)}
                  disabled={form.saving}
                  className="h-8 rounded-md border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {POLICIES.map((policy) => <option key={policy} value={policy}>{POLICY_LABEL[policy]}</option>)}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!addKey || form.saving}
                  onClick={() => {
                    form.setRule(addKey, newPolicy)
                    setNewKey('')
                  }}
                >
                  <Plus aria-hidden/>
                  添加
                </Button>
                <span className="text-xs text-muted-foreground">格式由服务端校验，保存时不合法会提示。</span>
              </li>
            </Group>

            <SaveBar
              dirty={form.dirty}
              saving={form.saving}
              invalid={false}
              savedAt={form.savedAt}
              saveError={form.saveError}
              onReset={form.reset}
            />
          </form>
        )
      })()}
    </section>
  )
}

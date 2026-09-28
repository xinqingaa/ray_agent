'use client'

import {useState} from 'react'
import {Loader2, Plus} from 'lucide-react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {Textarea} from '@/components/ui/textarea'
import {configApi} from '@/lib/api/config'
import type {ListMCPServerItem, MCPConfig} from '@/lib/api/types'
import {errorMessage, LoadError, SectionHeader} from './form'
import {DeleteDialog, EmptyList, ListSkeleton, ServerRow, useServerList} from './server-list'

const MCP_LIST = {
  load: async () => (await configApi.getMCPServers())?.mcp_servers ?? [],
  keyOf: (s: ListMCPServerItem) => s.server_name,
  nameOf: (s: ListMCPServerItem) => s.server_name,
  setEnabled: configApi.updateMCPServerEnabled,
  remove: configApi.deleteMCPServer,
}

const TRANSPORT_LABEL: Record<ListMCPServerItem['transport'], string> = {
  stdio: 'stdio',
  streamable_http: 'Streamable HTTP',
}

const PLACEHOLDER = `{
  "mcpServers": {
    "qiniu": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["qiniu-mcp-server"],
      "env": {"QINIU_ACCESS_KEY": "…", "QINIU_SECRET_KEY": "…"}
    }
  }
}`

function toolsSummary(tools: string[]): string {
  if (tools.length === 0) return '没有发现工具'
  const head = tools.slice(0, 4).join('、')
  return tools.length > 4 ? `${tools.length} 个工具：${head} 等` : `${tools.length} 个工具：${head}`
}

/** 与后端 MCPConfig 校验一致：顶层只有 mcpServers；stdio 需要 command，streamable_http 需要 url */
export function checkMcpConfig(text: string): {config: MCPConfig} | {error: string} {
  if (text.trim() === '') return {error: '请粘贴 MCP 配置 JSON'}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return {error: `不是有效的 JSON：${err instanceof Error ? err.message : '解析失败'}`}
  }
  if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) return {error: '顶层应是对象，形如 {"mcpServers": {…}}'}
  const extra = Object.keys(parsed).filter((k) => k !== 'mcpServers')
  if (extra.length > 0) return {error: `顶层只能有 mcpServers，多了：${extra.join('、')}`}
  const servers = (parsed as {mcpServers?: unknown}).mcpServers
  if (typeof servers !== 'object' || servers == null || Array.isArray(servers)) return {error: '缺少 mcpServers 对象'}
  const entries = Object.entries(servers as Record<string, unknown>)
  if (entries.length === 0) return {error: 'mcpServers 里至少要有一个服务器'}
  for (const [name, raw] of entries) {
    if (typeof raw !== 'object' || raw == null) return {error: `${name}：配置应是对象`}
    const server = raw as Record<string, unknown>
    const transport = server.transport ?? 'streamable_http'
    if (transport !== 'stdio' && transport !== 'streamable_http') return {error: `${name}：transport 只能是 stdio 或 streamable_http`}
    if (transport === 'stdio' && !server.command) return {error: `${name}：stdio 方式需要 command`}
    if (transport === 'streamable_http' && !server.url) return {error: `${name}：streamable_http 方式需要 url（未写 transport 时默认是它）`}
  }
  return {config: parsed as MCPConfig}
}

function AddMcpDialog({open, onOpenChange, onAdded}: {open: boolean; onOpenChange: (open: boolean) => void; onAdded: () => Promise<void>}) {
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const check = checkMcpConfig(text)
  const localError = touched && 'error' in check ? check.error : null

  const submit = async () => {
    setTouched(true)
    if ('error' in check) return
    setSubmitting(true)
    setServerError(null)
    try {
      await configApi.addMCPServer(check.config)
      await onAdded()
      toast.success(`已添加 MCP 服务器：${Object.keys(check.config.mcpServers).join('、')}`)
      setText('')
      setTouched(false)
      onOpenChange(false)
    } catch (err) {
      setServerError(errorMessage(err, '服务端拒绝了这份配置，请检查字段名与取值'))
    } finally {
      setSubmitting(false)
    }
  }

  const error = localError ?? serverError
  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>添加 MCP 服务器</DialogTitle>
          <DialogDescription>
            粘贴标准的 MCP JSON 配置，可一次添加多个。服务器连接后，它提供的工具会加入 Agent 的可用工具。
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label htmlFor="mcp-config" className="sr-only">MCP 配置 JSON</label>
          <Textarea
            id="mcp-config"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setServerError(null)
            }}
            onBlur={() => text.trim() && setTouched(true)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'mcp-config-error' : undefined}
            className="min-h-60 font-mono text-xs md:text-xs"
            disabled={submitting}
          />
          {error && (
            <p id="mcp-config-error" role="alert" className="mt-2 text-meta text-destructive">
              {serverError ? `添加失败：${serverError}` : error}
            </p>
          )}
          <DialogFooter className="mt-4">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>取消</Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden/>}
              {submitting ? '正在添加' : '添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function McpServerRow({server, toggling, onToggle, onDelete}: {
  server: ListMCPServerItem
  toggling?: boolean
  onToggle?: (enabled: boolean) => void
  onDelete?: () => void
}) {
  return (
    <ServerRow
      title={<span className="font-mono text-[13px]">{server.server_name}</span>}
      name={server.server_name}
      status={server.connection_status}
      error={server.error}
      enabled={server.enabled}
      toggling={toggling}
      meta={<span className="rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">{TRANSPORT_LABEL[server.transport] ?? server.transport}</span>}
      detail={server.connection_status === 'connected' ? toolsSummary(server.tools) : null}
      onToggle={onToggle}
      onDelete={onDelete}
    />
  )
}

export function McpSection() {
  const list = useServerList(MCP_LIST)
  const [adding, setAdding] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ListMCPServerItem | null>(null)

  return (
    <section aria-labelledby="settings-mcp-title">
      <SectionHeader
        id="settings-mcp-title"
        title="MCP 服务器"
        description="通过 MCP 接入的外部工具。停用后，下一次运行起不再提供该服务器的工具。"
        action={
          <Button type="button" size="sm" onClick={() => setAdding(true)} disabled={list.phase.phase !== 'ready'}>
            <Plus aria-hidden/>
            添加服务器
          </Button>
        }
      />
      <div className="py-2">
        {list.phase.phase === 'loading' && <ListSkeleton/>}
        {list.phase.phase === 'error' && <div className="py-3"><LoadError message={list.phase.message} onRetry={list.reload}/></div>}
        {list.phase.phase === 'ready' && list.items.length === 0 && (
          <div className="py-3"><EmptyList>还没有 MCP 服务器。点击“添加服务器”粘贴配置。</EmptyList></div>
        )}
        {list.phase.phase === 'ready' && list.items.length > 0 && (
          <ul className="divide-y">
            {list.items.map((server) => (
              <McpServerRow
                key={server.server_name}
                server={server}
                toggling={list.toggling.has(server.server_name)}
                onToggle={(enabled) => void list.toggle(server, enabled)}
                onDelete={() => setPendingDelete(server)}
              />
            ))}
          </ul>
        )}
      </div>
      <AddMcpDialog open={adding} onOpenChange={setAdding} onAdded={list.refresh}/>
      <DeleteDialog
        title={pendingDelete ? `删除 MCP 服务器「${pendingDelete.server_name}」？` : null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => (pendingDelete ? list.remove(pendingDelete) : Promise.resolve())}
      />
    </section>
  )
}

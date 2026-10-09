'use client'

import {useState} from 'react'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
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
import {Input} from '@/components/ui/input'
import {configApi} from '@/lib/api/config'
import type {ListA2AServerItem} from '@/lib/api/types'
import {checkHttpUrl, errorMessage, LoadError, SectionHeader} from './form'
import {DeleteDialog, EmptyList, ListSkeleton, ServerRow, useServerList} from './server-list'

const A2A_LIST = {
  load: async () => (await configApi.getA2AServers())?.a2a_servers ?? [],
  keyOf: (s: ListA2AServerItem) => s.id,
  nameOf: (s: ListA2AServerItem) => s.name || s.base_url,
  setEnabled: configApi.updateA2AServerEnabled,
  remove: configApi.deleteA2AServer,
}

function capabilities(server: ListA2AServerItem): string {
  const parts: string[] = []
  if (server.input_modes.length > 0) parts.push(`输入 ${server.input_modes.join('、')}`)
  if (server.output_modes.length > 0) parts.push(`输出 ${server.output_modes.join('、')}`)
  parts.push(server.streaming ? '支持流式' : '不支持流式')
  return parts.join('；')
}

function AddA2aDialog({open, onOpenChange, onAdded}: {open: boolean; onOpenChange: (open: boolean) => void; onAdded: () => Promise<void>}) {
  const [url, setUrl] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const localError = touched ? checkHttpUrl(url) : null

  const submit = async () => {
    setTouched(true)
    if (checkHttpUrl(url)) return
    setSubmitting(true)
    setServerError(null)
    try {
      await configApi.addA2AServer({base_url: url.trim()})
      await onAdded()
      toast.success('已添加远程 Agent')
      setUrl('')
      setTouched(false)
      onOpenChange(false)
    } catch (err) {
      setServerError(errorMessage(err, '服务端拒绝了这个地址'))
    } finally {
      setSubmitting(false)
    }
  }

  const error = localError ?? (serverError ? `添加失败：${serverError}` : null)
  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>添加远程 Agent</DialogTitle>
          <DialogDescription>
            填写远程 Agent 的基础地址。添加时不检查连通性；列表会读取它的 Agent Card 显示名称与能力，读取失败时显示为不可用。
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <label htmlFor="a2a-url" className="text-sm font-medium">地址</label>
          <Input
            id="a2a-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setServerError(null)
            }}
            onBlur={() => url.trim() && setTouched(true)}
            placeholder="https://example.com/weather-agent"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'a2a-url-error' : undefined}
            className="mt-1.5 font-mono text-[13px] md:text-[13px]"
            disabled={submitting}
          />
          {error && <p id="a2a-url-error" role="alert" className="mt-2 text-meta text-destructive">{error}</p>}
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

export function A2aServerRow({server, toggling, onToggle, onDelete}: {
  server: ListA2AServerItem
  toggling?: boolean
  onToggle?: (enabled: boolean) => void
  onDelete?: () => void
}) {
  const {visibility} = useDeveloperMode()
  const name = server.name || (visibility.connectionSettings ? server.base_url : '远程 Agent')
  return (
    <ServerRow
      title={name}
      name={name}
      status={server.connection_status}
      error={server.error}
      enabled={server.enabled}
      toggling={toggling}
      detail={
        <>
          {visibility.connectionSettings && <span className="block truncate font-mono" title={server.base_url}>{server.base_url}</span>}
          {server.description && <span className="block">{server.description}</span>}
          {visibility.connectionSettings && <span className="block">{capabilities(server)}</span>}
        </>
      }
      onToggle={onToggle}
      onDelete={onDelete}
    />
  )
}

export function A2aSection() {
  const {visibility} = useDeveloperMode()
  const list = useServerList(A2A_LIST)
  const [adding, setAdding] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ListA2AServerItem | null>(null)

  return (
    <section aria-labelledby="settings-a2a-title">
      <SectionHeader
        id="settings-a2a-title"
        title={visibility.connectionSettings ? '远程 Agent（A2A）' : '远程协作'}
        description={visibility.connectionSettings ? '通过 A2A 协议接入的远程 Agent，Agent 可以把子任务委托给它们。停用后，下一次运行起不再提供。' : '已配置的远程协作能力及连接状态。'}
        action={
          visibility.connectionSettings && <Button type="button" size="sm" onClick={() => setAdding(true)} disabled={list.phase.phase !== 'ready'}>
            <Plus aria-hidden/>
            添加远程 Agent
          </Button>
        }
      />
      <div className="py-2">
        {list.phase.phase === 'loading' && <ListSkeleton/>}
        {list.phase.phase === 'error' && <div className="py-3"><LoadError message={list.phase.message} onRetry={list.reload}/></div>}
        {list.phase.phase === 'ready' && list.items.length === 0 && (
          <div className="py-3"><EmptyList>{visibility.connectionSettings ? '还没有远程 Agent。点击“添加远程 Agent”填写地址。' : '还没有配置远程协作。'}</EmptyList></div>
        )}
        {list.phase.phase === 'ready' && list.items.length > 0 && (
          <ul className="divide-y">
            {list.items.map((server) => (
              <A2aServerRow
                key={server.id}
                server={server}
                toggling={list.toggling.has(server.id)}
                onToggle={(enabled) => void list.toggle(server, enabled)}
                onDelete={() => setPendingDelete(server)}
              />
            ))}
          </ul>
        )}
      </div>
      <AddA2aDialog open={visibility.connectionSettings && adding} onOpenChange={setAdding} onAdded={list.refresh}/>
      <DeleteDialog
        title={visibility.connectionSettings && pendingDelete ? `删除远程 Agent「${pendingDelete.name || pendingDelete.base_url}」？` : null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => (pendingDelete ? list.remove(pendingDelete) : Promise.resolve())}
      />
    </section>
  )
}

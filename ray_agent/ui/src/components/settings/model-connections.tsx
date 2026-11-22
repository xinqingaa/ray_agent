import {useEffect, useRef, useState} from 'react'
import {toast} from 'sonner'
import {Button} from '@/components/ui/button'
import {Coins, FileText, Pencil, Plus, RefreshCw} from '@/components/ui/icons'
import {isOfficialDeepSeek, MODEL_CONNECTIONS_CHANGED, modelConnectionsApi} from '@/lib/api/model-connections'
import type {ConnectionSource, ProviderStatus} from '@/lib/api/types'
import {isDesktop, openModelConfig} from '@/lib/platform'
import {useBuiltinCatalog} from '@/hooks/use-builtin-catalog'
import {presets} from './provider-presets'
import {failure, openProvider, protocolLabels, ProviderEditor, ProviderMark, ProviderResult, type ProviderApi, type ProviderEdit} from './provider-editor'
import {SettingsCard} from './settings-row'
import './model-connections.css'

export function ModelConnections({initial, onChange, voiceOn, onEditingChange, onDirtyChange, api = modelConnectionsApi}: {
  initial: ConnectionSource | null
  onChange: (source: ConnectionSource) => void
  voiceOn?: boolean
  onEditingChange: (editing: boolean) => void
  onDirtyChange: (dirty: boolean) => void
  api?: ProviderApi
}) {
  const [source, setSource] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<ProviderEdit | null>(null)
  const list = useRef<HTMLElement>(null)
  const focusTarget = useRef<string | null>(null)
  const [returning, setReturning] = useState(false)
  const catalog = useBuiltinCatalog(api.catalog)
  useEffect(() => {
    if (editor || focusTarget.current === null) return
    const controls = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[data-provider-edit]') ?? [])
    const button = controls.find(item => item.dataset.providerEdit === focusTarget.current) ?? controls.at(-1)
    focusTarget.current = null
    button?.focus({preventScroll: true})
  }, [editor])
  useEffect(() => {setSource(initial)}, [initial])
  const publish = (next: ConnectionSource) => {
    setSource(next)
    onChange(next)
    if (api === modelConnectionsApi) window.dispatchEvent(new Event(MODEL_CONNECTIONS_CHANGED))
  }
  const reload = async () => {
    setBusy(true)
    try {publish(await api.get())}
    catch (error) {toast.error(failure(error).text)}
    finally {setBusy(false)}
  }
  const open = (original?: ProviderStatus) => {
    if (!source?.version) return
    focusTarget.current = original?.name ?? ''
    setReturning(false)
    setEditor(openProvider(api, source.version, original))
    onEditingChange(true)
  }
  const close = () => {
    setReturning(true)
    setEditor(null)
    onEditingChange(false)
    onDirtyChange(false)
  }
  const providers = source?.providers ?? []
  if (editor) return <div className="settings-detail-enter h-full min-h-0">
    <ProviderEditor editor={editor} taken={providers.map(item => item.name)} api={api} catalog={catalog.models} catalogError={catalog.error} onRetryCatalog={catalog.retry} onClose={close}
      onSaved={next => {close(); publish(next)}} onDirtyChange={onDirtyChange}/>
  </div>
  return <section ref={list} aria-label="模型连接" className={returning ? 'provider-settings settings-detail-enter' : 'provider-settings'}>
    <div className="provider-file">
      <FileText className="size-4 shrink-0" aria-hidden/>
      <code title={source?.path}>{source?.path ?? '配置文件'}</code>
      <Button type="button" size="sm" variant="outline" disabled={!isDesktop()}
        onClick={() => void openModelConfig().catch(error => toast.error(failure(error).text))}>打开配置文件</Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="重新读取配置文件" disabled={busy}
        onClick={() => void reload()}><RefreshCw aria-hidden/></Button>
    </div>
    {source?.issue && <ProviderResult note={{text: source.issue, failed: true}}/>}
    {!source?.issue && !providers.length && <p className="mt-3 text-meta text-muted-foreground">暂无模型连接。</p>}
    {source?.notices?.map(notice => <p key={notice} className="mt-2 text-meta text-state-waiting">{notice}</p>)}
    {providers.length > 0 && <ul aria-label="提供商" className="mt-3 space-y-2">
      {providers.map(provider => {
        const kind = provider.kind ?? 'compatible'
        const label = kind === 'compatible' ? provider.name : presets[kind].label
        const custom = Object.values(provider.custom_models ?? {})
        const count = (provider.configured_models ?? provider.models ?? []).length + custom.length
        const voice = voiceOn && isOfficialDeepSeek(provider)
        return <li key={provider.name}>
          <SettingsCard
            mark={<ProviderMark kind={kind}/>}
            title={<>
              <strong className="text-sm font-medium break-all">{label}</strong>
              {kind !== 'compatible' && ![kind, 'gpt'].includes(provider.name) && <code className="font-mono text-xs text-faint">{provider.name}</code>}
              {provider.issue
                ? <span className="provider-unavailable">不可用</span>
                : <span className="text-meta text-muted-foreground">{count} 个模型{voice && ' · 语音转写'}</span>}
            </>}
            detail={<>
              <span className="block break-all font-mono text-xs">{provider.base_url?.replace(/^https?:\/\//, '')} · {protocolLabels[provider.api_protocol]}
                {provider.key_hint ? <> · {provider.key_hint}</> : !provider.requires_key ? ' · 无密钥' : ''}</span>
              {custom.some(model => !model.rates) && <span className="mt-1 flex items-center gap-1">
                <Coins aria-hidden className="size-3 shrink-0"/>自定义模型未填写单价，用量只统计 Token
              </span>}
              {provider.issue && <ProviderResult note={{text: provider.issue, failed: true}}/>}
            </>}
            actions={<Button type="button" size="icon-sm" variant="ghost" disabled={!source?.version || busy}
              aria-label={`编辑 ${provider.name}`} data-provider-edit={provider.name}
              onClick={() => open(provider)}><Pencil aria-hidden/></Button>}
          />
        </li>
      })}
    </ul>}
    <Button type="button" size="sm" variant="outline" className="mt-3" disabled={!source?.version || !!source.issue || busy}
      data-provider-edit="" onClick={() => open()}><Plus aria-hidden/>添加提供商</Button>
  </section>
}

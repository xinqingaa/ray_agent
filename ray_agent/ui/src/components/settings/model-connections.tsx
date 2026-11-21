import {useEffect, useState, type ReactNode} from 'react'
import {toast} from 'sonner'
import {VendorIcon} from '@/components/vendor-icon'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {AlertCircle, Check, Coins, Download, FileText, Package, Pencil, Plus, RefreshCw, Sparkles, X} from '@/components/ui/icons'
import {Input} from '@/components/ui/input'
import {ApiError} from '@/lib/api/fetch'
import {isOfficialDeepSeek, MODEL_CONNECTIONS_CHANGED, modelConnectionsApi, type CustomModelDraft, type ProviderProbe} from '@/lib/api/model-connections'
import type {ConnectionSource, ProviderStatus} from '@/lib/api/types'
import {isDesktop, openModelConfig} from '@/lib/platform'
import {cn} from '@/lib/utils'
import {useUsagePreferences} from '@/hooks/use-usage-preferences'
import {SettingsCard} from './settings-row'
import './model-connections.css'

type Kind = NonNullable<ProviderProbe['kind']>
type Protocol = ProviderProbe['protocol']
type CustomRow = {id: string; value: CustomModelDraft}
type DraftRow = {original?: string; id: string; window: string; output: string; tools: boolean; vision: boolean; thinking: boolean;
  input: string; cached_input: string; outputRate: string}
type Editor = {original?: ProviderStatus; version: string}
type ProbeNote = {text: string; failed?: boolean}

const presets = {
  deepseek: {label: 'DeepSeek', address: 'https://api.deepseek.com', protocol: 'responses', models: ['deepseek-flash', 'deepseek-v4-pro']},
  openai: {label: 'OpenAI', address: 'https://api.openai.com/v1', protocol: 'responses', models: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-astra']},
  compatible: {label: 'OpenAI 兼容', address: '', protocol: 'chat_completions', models: []},
} satisfies Record<Kind, {label: string; address: string; protocol: Protocol; models: string[]}>

const protocolLabels: Record<Protocol, string> = {responses: 'Responses', chat_completions: 'Chat Completions'}
const capabilities = {tools: '工具调用', vision: '图片输入', thinking: '思考'} as const
const rateLabels = {input: '输入单价', cached_input: '缓存命中', outputRate: '输出单价'} as const
const knownModels: Record<string, string> = {
  'deepseek-flash': '1M · 384K 输出 · 图片',
  'deepseek-v4-pro': '1M · 384K 输出',
  'gpt-6.1-sol': '200K · 128K 输出 · 图片',
  'gpt-6-luna': '200K · 128K 输出 · 图片',
  'gpt-6-astra': '200K · 128K 输出 · 图片',
}
const known = (id: string) => Object.hasOwn(knownModels, id)
const kinds = Object.keys(presets) as Kind[]
const protocols = Object.keys(protocolLabels) as Protocol[]
const capKeys = Object.keys(capabilities) as (keyof typeof capabilities)[]
const rateKeys = Object.keys(rateLabels) as (keyof typeof rateLabels)[]
const namePattern = /^[A-Za-z0-9_-]{1,64}$/

function failure(error: unknown): ProbeNote {
  const upstream = error instanceof ApiError && error.details.upstream_status
  const message = error instanceof Error ? error.message : '操作失败'
  return {text: typeof upstream === 'number' && !message.includes(`HTTP ${upstream}`) ? `HTTP ${upstream} · ${message}` : message, failed: true}
}
function acceptedAddress(address: string) {
  try {
    const url = new URL(address.trim())
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  } catch {return false}
}
function ProviderMark({kind}: {kind: Kind}) {
  return kind === 'compatible' ? <Package className="size-4" aria-hidden/> : <VendorIcon vendor={kind}/>
}
function ProviderResult({note}: {note: ProbeNote}) {
  const Mark = note.failed ? AlertCircle : Check
  return <p role={note.failed ? 'alert' : 'status'} className={cn('provider-result', note.failed ? 'text-state-failed' : 'text-state-success')}>
    <Mark aria-hidden className="mt-0.5 size-3.5 shrink-0"/>{note.text}
  </p>
}

function Field({label, id, hint, children}: { label: string; id?: string; hint?: string; children: ReactNode }) {
  return <div className="provider-field">
    {id ? <label htmlFor={id}>{label}</label> : <span>{label}</span>}
    <div className="min-w-0">{children}</div>
    {hint && <p>{hint}</p>}
  </div>
}

function modelSize(value: string) {
  const parts = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(value.trim())
  if (!parts) return NaN
  return Number(parts[1]) * ({k: 1024, m: 1_000_000}[parts[2].toLowerCase()] ?? 1)
}
const sizeLabel = (value: number) => value >= 1_000_000 && value % 1_000_000 === 0 ? value / 1_000_000 + 'M'
  : value >= 1024 && value % 1024 === 0 ? value / 1024 + 'K' : String(value)

function customDraft(id = '', value?: CustomModelDraft): DraftRow {
  return {
    original: value ? id : undefined, id,
    window: value ? sizeLabel(value.context_window) : '128K', output: value ? sizeLabel(value.max_output) : '8K',
    tools: value?.tools ?? true, vision: value?.vision ?? false, thinking: value?.thinking ?? false,
    input: value?.rates?.input == null ? '' : String(value.rates.input),
    cached_input: value?.rates?.cached_input == null ? '' : String(value.rates.cached_input),
    outputRate: value?.rates?.output == null ? '' : String(value.rates.output),
  }
}
function validateCustom(draft: DraftRow, rows: CustomRow[]): {row: CustomRow} | {error: string} {
  const id = draft.id.trim()
  if (!id || id.length > 128 || /\s/.test(id)) return {error: '填写 1 至 128 个字符的模型 ID，不能含空白。'}
  if (known(id) || rows.some(row => row.id === id && row.id !== draft.original)) return {error: '这个模型已在列表中。'}
  const context_window = modelSize(draft.window)
  const max_output = modelSize(draft.output)
  if (!Number.isInteger(context_window) || context_window > 10_000_000 || context_window < 2 ||
    !Number.isInteger(max_output) || !(max_output > 0 && max_output < context_window * .95)) {
    return {error: '请填写有效的窗口与输出上限，输出须为输入留出空间。'}
  }
  const prices = [draft.input.trim(), draft.cached_input.trim(), draft.outputRate.trim()]
  if (prices.some(Boolean) && (!prices[0] || !prices[2] || prices.some(price => price && (!/^\d*(?:\.\d{1,8})?$/.test(price) || Number(price) > 1_000_000)))) {
    return {error: '请同时填写输入和输出单价，最多 8 位小数。缓存单价可留空。'}
  }
  return {row: {id, value: {
    context_window, max_output, tools: draft.tools, vision: draft.vision, thinking: draft.thinking,
    rates: prices.some(Boolean) ? {input: prices[0], cached_input: prices[1] || prices[0], output: prices[2]} : null,
  }}}
}

function CustomEditor({draft, onChange, onCancel, onApply, error}: {
  draft: DraftRow; onChange: (patch: Partial<DraftRow>) => void; onCancel: () => void; onApply: () => void; error: string | null
}) {
  return <div className="provider-custom-form">
    <label>模型 ID<Input autoFocus value={draft.id} placeholder="与上游请求里的 model 一致"
      onChange={event => onChange({id: event.target.value})}/></label>
    <div className="provider-custom-fields">
      <label>上下文窗口<Input value={draft.window} onChange={event => onChange({window: event.target.value})}/></label>
      <label>输出上限<Input value={draft.output} onChange={event => onChange({output: event.target.value})}/></label>
    </div>
    <div className="provider-actions" role="group" aria-label="能力">
      <span className="text-muted-foreground">能力</span>
      {capKeys.map(key => <button type="button" key={key} className="provider-chip" aria-pressed={draft[key]}
        onClick={() => onChange({[key]: !draft[key]})}>{capabilities[key]}</button>)}
    </div>
    <div className="provider-custom-fields">{rateKeys.map(key => <label key={key}>{rateLabels[key]}
      <Input value={draft[key]} inputMode="decimal" placeholder="可选" onChange={event => onChange({[key]: event.target.value})}/>
    </label>)}</div>
    <p className="text-xs text-muted-foreground">单价按美元 / 百万 Token。留空时只统计 Token。</p>
    {error && <p role="alert" className="text-xs text-state-failed">{error}</p>}
    <div className="provider-actions justify-end">
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>取消</Button>
      <Button type="button" size="sm" variant="outline" onClick={onApply}>{draft.original ? '应用修改' : '添加'}</Button>
    </div>
  </div>
}

function ProviderEditor({editor, taken, onClose, onSaved, onReload}: {
  editor: Editor; taken: string[]; onClose: () => void; onSaved: (source: ConnectionSource) => void; onReload: () => void
}) {
  const prior = editor.original
  const [kind, setKind] = useState<Kind>(prior?.kind ?? 'deepseek')
  const [name, setName] = useState(prior?.name ?? 'deepseek')
  const [address, setAddress] = useState(prior?.base_url ?? presets.deepseek.address)
  const [protocol, setProtocol] = useState<Protocol>(prior?.api_protocol ?? presets.deepseek.protocol)
  const [models, setModels] = useState<string[]>(prior ? prior.configured_models ?? prior.models ?? [] : [])
  const [rows, setRows] = useState<CustomRow[]>(Object.entries(prior?.custom_models ?? {}).map(([id, value]) => ({id, value})))
  const [requiresKey, setRequiresKey] = useState(prior?.requires_key ?? true)
  const [key, setKey] = useState<string | undefined>(prior?.has_key ? undefined : '')
  const [remote, setRemote] = useState<string[] | null>(null)
  const [custom, setCustom] = useState<DraftRow | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'saving' | 'testing' | 'models' | 'deleting' | null>(null)
  const [notice, setNotice] = useState<ProbeNote | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const normalizedName = name.trim()
  const showName = kind === 'compatible' || (!!prior && prior.name !== kind && prior.name !== 'gpt')
    || (!prior && taken.includes(kind))
  const validName = namePattern.test(normalizedName) && (!!prior || !taken.includes(normalizedName))
  const validAddress = acceptedAddress(address)
  const catalog = [...new Set([...presets[kind].models, ...models, ...(remote ?? []).filter(known)])]
  const selection = models.length + rows.length
  const body = (): ProviderProbe => ({
    name: prior?.name ?? (validName ? normalizedName : undefined),
    kind, base_url: address.trim(), protocol, models, requires_key: requiresKey,
    custom_models: Object.fromEntries(rows.map(({id, value}) => [id, value])),
    ...(key !== undefined && {api_key: key}),
  })
  const act = async (action: NonNullable<typeof busy>, task: () => Promise<void>) => {
    setBusy(action)
    setNotice(null)
    setConfirmDelete(false)
    try {await task()}
    catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true)
      setNotice(failure(error))
    } finally {setBusy(null)}
  }
  const preset = (next: Kind) => {
    if (next === kind) return
    setKind(next)
    setName(next === 'compatible' ? '' : next)
    setAddress(presets[next].address)
    setProtocol(presets[next].protocol)
    setModels([])
    setRequiresKey(next !== 'compatible')
    setRemote(null)
    setNotice(null)
  }
  const toggleModel = (id: string) => {
    setModels(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id])
    setNotice(null)
  }
  const editCustom = (id?: string, value?: CustomModelDraft) => {
    setCustom(customDraft(id, value))
    setCustomError(null)
  }
  const applyCustom = () => {
    if (!custom) return
    const result = validateCustom(custom, rows)
    if ('error' in result) {setCustomError(result.error); return}
    const row = result.row
    setRows(current => custom.original ? current.map(item => item.id === custom.original ? row : item) : [...current, row])
    setCustom(null)
    setNotice(null)
  }
  const fetchModels = () => void act('models', async () => {
    const result = await modelConnectionsApi.models({...body(), models: [], custom_models: {}})
    setRemote(result.models ?? [])
    setNotice({text: `已读取 ${result.models?.length ?? 0} 个模型 · ${result.elapsed_ms} ms`})
  })
  const canSave = validName && validAddress && selection > 0 && !custom && !conflict && !busy

  return <Dialog open onOpenChange={open => {if (!open && !busy) onClose()}}>
    <DialogContent className="provider-dialog max-h-[min(47rem,calc(100dvh-24px))] gap-0 overflow-hidden p-0 sm:max-w-[640px]" showCloseButton={!busy}>
      <DialogHeader className="provider-dialog-head">
        <span className="provider-mark"><Sparkles aria-hidden className="size-4"/></span>
        <div><DialogTitle>{prior ? '编辑提供商' : '添加提供商'}</DialogTitle>
          <DialogDescription>保存后写入配置文件，新运行生效</DialogDescription></div>
      </DialogHeader>
      <form className="provider-dialog-form" onSubmit={event => {
        event.preventDefault()
        if (!canSave) return
        void act('saving', async () => {
          const {name: _name, model: _model, ...draft} = body()
          onSaved(await modelConnectionsApi.save(normalizedName, {...draft, version: editor.version}))
          toast.success('已写入配置文件')
        })
      }}>
        <fieldset className="provider-fields" disabled={!!busy}>
          {!prior && <Field label="类型"><div className="provider-segment" role="group" aria-label="提供商类型">
            {kinds.map(id => <button key={id} type="button" aria-pressed={kind === id} onClick={() => preset(id)}>
              <ProviderMark kind={id}/>{presets[id].label}
            </button>)}
          </div></Field>}
          {showName && <Field label="名称" id="provider-name" hint="字母、数字、下划线或连字符，用作配置里的键名">
            <Input id="provider-name" required value={name} readOnly={!!prior} onChange={event => setName(event.target.value)} placeholder="例如 gateway"/>
            {!prior && taken.includes(normalizedName) && <p className="mt-1 text-xs text-state-failed">已有同名提供商。</p>}
          </Field>}
          <Field label="地址" id="provider-address">
            <Input id="provider-address" type="url" required value={address} onChange={event => {setAddress(event.target.value); setRemote(null); setNotice(null)}}
              placeholder="https://example.com/v1" spellCheck={false}/>
            {address.trim() && !validAddress && <p className="mt-1 text-xs text-state-failed">请输入有效的 HTTP 或 HTTPS 接口地址。</p>}
          </Field>
          <Field label="协议" hint="按上游文档选择。测试会显示上游返回的错误。">
            <div className="provider-segment" role="group" aria-label="协议">
              {protocols.map(id => <button key={id} type="button" aria-pressed={protocol === id}
                onClick={() => {setProtocol(id); setNotice(null)}}>{protocolLabels[id]}</button>)}
            </div>
          </Field>
          <Field label="密钥" id={key === undefined ? undefined : 'provider-key'} hint="密钥保存在本机配置文件。">
            <div className="provider-key-row">
              {key === undefined ? <>
                <code className="provider-key">{prior?.key_hint}</code>
                <Button type="button" size="sm" variant="ghost" onClick={() => setKey('')}>更换</Button>
              </> : <>
                <Input id="provider-key" type="password" autoComplete="new-password" value={key}
                  placeholder={requiresKey ? 'sk-…' : '无需密钥可留空'} onChange={event => {setKey(event.target.value); setNotice(null)}}/>
                {prior?.has_key && <Button type="button" size="sm" variant="ghost" onClick={() => setKey(undefined)}>保留原密钥</Button>}
              </>}
            </div>
            {(kind === 'compatible' || prior?.requires_key === false) && <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={requiresKey} onChange={event => setRequiresKey(event.target.checked)}/>此连接需要密钥
            </label>}
          </Field>
          <Field label="模型">
            {catalog.length > 0 && <div className="provider-catalog">
              <p className="provider-group-label">目录中的模型</p>
              {catalog.map(id => <button type="button" key={id} className="provider-model" aria-pressed={models.includes(id)} onClick={() => toggleModel(id)}>
                <span className="provider-check">{models.includes(id) && <Check className="size-3" aria-hidden/>}</span>
                <code>{id}</code><span className="provider-model-caps">{knownModels[id]}</span>
              </button>)}
            </div>}
            <p className="provider-group-label">自定义模型 <span>目录外模型按填写的能力使用</span></p>
            {rows.map(({id, value}) => <div key={id} className="provider-custom-row">
              <div className="min-w-0 flex-1">
                <code className="break-all">{id}</code>
                <p className="text-xs text-muted-foreground">{sizeLabel(value.context_window)} · {sizeLabel(value.max_output)} 输出
                  {capKeys.filter(part => value[part]).map(part => ' · ' + capabilities[part])}</p>
              </div>
              <span className="text-xs text-muted-foreground">{value.rates ? `$${value.rates.input} / $${value.rates.output}` : '未填写单价'}</span>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`编辑模型 ${id}`} disabled={!!custom}
                onClick={() => editCustom(id, value)}><Pencil aria-hidden/></Button>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`移除 ${id}`} disabled={!!custom}
                onClick={() => setRows(items => items.filter(item => item.id !== id))}><X aria-hidden/></Button>
            </div>)}
            {!rows.length && <p className="px-2 text-xs text-muted-foreground">没有自定义模型</p>}
            {custom ? <CustomEditor draft={custom} error={customError} onChange={patch => {
              setCustom(current => current && {...current, ...patch})
              setCustomError(null)
            }} onApply={applyCustom} onCancel={() => setCustom(null)}/> :
              <div className="provider-actions">
                <Button type="button" size="sm" variant="ghost" onClick={() => editCustom()}><Plus aria-hidden/>添加自定义模型</Button>
                <Button type="button" size="sm" variant="ghost" disabled={!validAddress} onClick={fetchModels}>
                  <Download aria-hidden/>{busy === 'models' ? '读取中…' : '从服务读取模型列表'}
                </Button>
              </div>}
            {remote && <div className="provider-remote">
              <span className="text-xs text-muted-foreground">{remote.length ? '上游返回' : '上游未返回模型'}</span>
              {remote.map(id => <button type="button" key={id} className="provider-chip" disabled={!!custom || models.includes(id) || rows.some(row => row.id === id)}
                onClick={() => known(id) ? toggleModel(id) : editCustom(id)}>{id}</button>)}
            </div>}
          </Field>
        </fieldset>
        <div className="provider-dialog-actions">
          {notice && <ProviderResult note={notice}/>}
          {conflict && <Button type="button" variant="outline" size="sm" onClick={onReload}>重新读取配置</Button>}
          {confirmDelete && <p role="alert" className="text-xs text-state-waiting">引用此提供商的会话需要换模型才能发起下一次运行。</p>}
          <DialogFooter className="flex-wrap">
            {prior && <Button type="button" variant="ghost" className="mr-auto text-state-failed" disabled={!!busy || conflict} onClick={() => {
              if (!confirmDelete) {setConfirmDelete(true); return}
              void act('deleting', async () => onSaved(await modelConnectionsApi.remove(prior.name, editor.version)))
            }}>{confirmDelete ? '确认删除' : '删除'}</Button>}
            <Button type="button" variant="outline" disabled={!!busy || !validAddress || !!custom || conflict} onClick={() => {
              void act('testing', async () => {
                const result = await modelConnectionsApi.test({...body(), model: models[0] ?? rows[0]?.id})
                setNotice({text: `连接正常 · ${result.method === 'models' ? '返回 ' + (result.models?.length ?? 0) + ' 个模型 · ' : ''}${result.elapsed_ms} ms`})
              })
            }}>{busy === 'testing' ? '测试中…' : '测试连接'}</Button>
            <Button type="button" variant="ghost" disabled={!!busy} onClick={onClose}>取消</Button>
            <Button type="submit" disabled={!canSave}>{busy === 'saving' ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}

export function ModelConnections({initial, onChange}: {
  initial: ConnectionSource | null
  onChange: (source: ConnectionSource) => void
}) {
  const [source, setSource] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [results, setResults] = useState<Record<string, ProbeNote>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const voiceOn = useUsagePreferences().value?.voice === 'deepseek'
  useEffect(() => {setSource(initial)}, [initial])
  const publish = (next: ConnectionSource) => {
    setSource(next)
    setResults({})
    onChange(next)
    window.dispatchEvent(new Event(MODEL_CONNECTIONS_CHANGED))
  }
  const reload = async () => {
    setBusy(true)
    try {publish(await modelConnectionsApi.get()); setEditor(null)}
    catch (error) {toast.error(failure(error).text)}
    finally {setBusy(false)}
  }
  const test = async (provider: ProviderStatus) => {
    if (!provider.base_url) return
    const models = provider.configured_models ?? provider.models ?? []
    const custom_models = provider.custom_models ?? {}
    setTesting(items => ({...items, [provider.name]: true}))
    let result: ProbeNote
    try {
      const response = await modelConnectionsApi.test({
        name: provider.name, kind: provider.kind, base_url: provider.base_url, protocol: provider.api_protocol,
        models, custom_models, requires_key: provider.requires_key, model: models[0] ?? Object.keys(custom_models)[0],
      })
      result = {text: `连接正常 · ${response.elapsed_ms} ms`}
    } catch (error) {result = failure(error)}
    finally {setTesting(items => ({...items, [provider.name]: false}))}
    setResults(items => ({...items, [provider.name]: result}))
  }
  const providers = source?.providers ?? []
  return <section aria-label="模型连接" className="provider-settings">
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
              {results[provider.name] && <ProviderResult note={results[provider.name]}/>}
            </>}
            actions={<>
              <Button type="button" size="sm" variant="ghost" aria-label={`测试 ${provider.name}`} disabled={!!provider.issue || !provider.base_url || testing[provider.name]}
                onClick={() => void test(provider)}>{testing[provider.name] ? '测试中…' : '测试'}</Button>
              <Button type="button" size="icon-sm" variant="ghost" disabled={!source?.version} aria-label={`编辑 ${provider.name}`}
                onClick={() => {if (source?.version) setEditor({version: source.version, original: provider})}}><Pencil aria-hidden/></Button>
            </>}
          />
        </li>
      })}
    </ul>}
    <Button type="button" size="sm" variant="outline" className="mt-3" disabled={!source?.version || !!source.issue}
      onClick={() => {if (source?.version) setEditor({version: source.version})}}><Plus aria-hidden/>添加提供商</Button>
    {editor && <ProviderEditor key={editor.original?.name ?? 'new'} editor={editor} taken={providers.map(item => item.name)}
      onClose={() => setEditor(null)} onReload={() => void reload()}
      onSaved={next => {setEditor(null); publish(next)}}/>}
  </section>
}

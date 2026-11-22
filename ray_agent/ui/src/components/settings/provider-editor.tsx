import {useEffect, useId, useMemo, useRef, useState, type ReactNode} from 'react'
import {toast} from 'sonner'
import {VendorIcon} from '@/components/vendor-icon'
import {Button} from '@/components/ui/button'
import {ArrowLeft, Package} from '@/components/ui/icons'
import {Input} from '@/components/ui/input'
import {ApiError} from '@/lib/api/fetch'
import {modelConnectionsApi, type CatalogModel, type CustomModelDraft, type ProbedModel, type ProviderProbe} from '@/lib/api/model-connections'
import type {ConnectionSource, ProviderStatus} from '@/lib/api/types'
import {presets, type Kind, type Protocol} from './provider-presets'
import {ProviderModelList, type ModelRow} from './provider-model-list'
import {ProviderResult, type ProbeNote} from './provider-result'
import {
  declarationDraft, draftFromCatalog, draftFromFacts, draftFromProbe, editedDraft, modelIdError, validateCustom, type ModelDraft,
} from './provider-models'

export {ProviderResult, type ProbeNote} from './provider-result'
export type ProviderApi = typeof modelConnectionsApi
type ReadResult = {details: ProbedModel[]; note: ProbeNote}
export type ProviderEdit = {original?: ProviderStatus; version: string; initialRead?: Promise<ReadResult>}

export const protocolLabels: Record<Protocol, string> = {responses: 'Responses', chat_completions: 'Chat Completions'}
const kinds = Object.keys(presets) as Kind[]
const protocols = Object.keys(protocolLabels) as Protocol[]
const namePattern = /^[A-Za-z0-9_-]{1,64}$/

export function failure(error: unknown): ProbeNote {
  const upstream = error instanceof ApiError && error.details.upstream_status
  const message = error instanceof Error ? error.message : '操作失败'
  return {text: typeof upstream === 'number' && !message.includes(`HTTP ${upstream}`) ? `HTTP ${upstream} · ${message}` : message, failed: true}
}

/** 保存失败时核心按模型 ID 返回的说明；只取字符串值，缺失时返回空对象。 */
export function serverModelErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {}
  const models = error.details.models
  if (!models || typeof models !== 'object') return {}
  return Object.fromEntries(Object.entries(models).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

export function readProviderModels(api: ProviderApi, request: ProviderProbe): Promise<ReadResult> {
  return api.models(request).then(result => {
    const details = result.model_details ?? []
    const count = details.length || new Set(result.models ?? []).size
    return {details, note: {text: count ? `已读取 ${count} 个模型 · ${result.elapsed_ms} ms` : '上游未返回模型。'}}
  }, error => ({details: [], note: {failed: true, text: `读取上游模型失败。${failure(error).text}`}}))
}

function acceptedAddress(address: string) {
  try {
    const url = new URL(address.trim())
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  } catch {return false}
}

/** 已保存的模型 ID：configured_models 与 custom_models 的键，二者都是启用状态的初值。 */
function savedIds(prior?: ProviderStatus): string[] {
  return [...new Set([...(prior?.configured_models ?? prior?.models ?? []), ...Object.keys(prior?.custom_models ?? {})])]
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const {[key]: _removed, ...rest} = record
  return rest
}

export function openProvider(api: ProviderApi, version: string, original?: ProviderStatus): ProviderEdit {
  const initialRead = original?.has_key && original.base_url && acceptedAddress(original.base_url)
    ? readProviderModels(api, {
      name: original.name, kind: original.kind, base_url: original.base_url, protocol: original.api_protocol,
      requires_key: original.requires_key, models: [], custom_models: {},
    }) : undefined
  return {original, version, initialRead}
}

export function ProviderMark({kind}: {kind: Kind}) {
  return kind === 'compatible' ? <Package className="size-4" aria-hidden/> : <VendorIcon vendor={kind}/>
}

function Field({label, id, hint, children}: {label: string; id?: string; hint?: string; children: ReactNode}) {
  return <div className="provider-field">
    {id ? <label htmlFor={id}>{label}</label> : <span>{label}</span>}
    <div className="min-w-0">{children}</div>
    {hint && <p>{hint}</p>}
  </div>
}

export function ProviderEditor({editor, taken, api, catalog, catalogError, onRetryCatalog, onClose, onSaved, onDirtyChange}: {
  editor: ProviderEdit
  taken: string[]
  api: ProviderApi
  /** 内置目录；null 表示尚未读取完成。模型能力与单价只来自这里。 */
  catalog: CatalogModel[] | null
  catalogError: string | null
  onRetryCatalog: () => void
  onClose: () => void
  onSaved: (source: ConnectionSource) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const prior = editor.original
  const [kind, setKind] = useState<Kind>(prior?.kind ?? 'deepseek')
  const [name, setName] = useState(prior?.name ?? 'deepseek')
  const [address, setAddress] = useState(prior?.base_url ?? presets.deepseek.address)
  const [protocol, setProtocol] = useState<Protocol>(prior?.api_protocol ?? presets.deepseek.protocol)
  const [requiresKey, setRequiresKey] = useState(prior?.requires_key ?? true)
  const [key, setKey] = useState<string | undefined>(prior?.has_key ? undefined : '')
  const [enabled, setEnabled] = useState(() => new Set(savedIds(prior)))
  const [baseEnabled] = useState(() => savedIds(prior).sort().join('\n'))
  const [drafts, setDrafts] = useState<Map<string, ModelDraft>>(() => new Map())
  const [draftsEdited, setDraftsEdited] = useState(false)
  const [probes, setProbes] = useState<Map<string, ProbedModel>>(() => new Map())
  const [extra, setExtra] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [locate, setLocate] = useState<{id: string} | null>(null)
  const [reading, setReading] = useState(Boolean(editor.initialRead))
  const [readNote, setReadNote] = useState<ProbeNote | null>(null)
  const [testNote, setTestNote] = useState<ProbeNote | null>(null)
  const [notice, setNotice] = useState<ProbeNote | null>(null)
  const [notes, setNotes] = useState<Record<string, ProbeNote>>({})
  const [checking, setChecking] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'saving' | 'testing' | 'deleting' | 'reloading' | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const readRevision = useRef(0)
  const back = useRef<HTMLButtonElement>(null)
  const uid = useId()

  useEffect(() => {back.current?.focus({preventScroll: true})}, [])
  useEffect(() => {
    let current = true
    void editor.initialRead?.then(result => {
      if (!current || readRevision.current !== 0) return
      setProbes(new Map(result.details.map(item => [item.id, item])))
      setReadNote(result.note)
      setReading(false)
    })
    return () => {current = false}
  }, [editor.initialRead])

  const normalizedName = name.trim()
  const showName = kind === 'compatible' || (!!prior && prior.name !== kind && prior.name !== 'gpt')
    || (!prior && taken.includes(kind))
  const validName = namePattern.test(normalizedName) && (!!prior || !taken.includes(normalizedName))
  const validAddress = acceptedAddress(address)
  const dirty = kind !== (prior?.kind ?? 'deepseek') || name !== (prior?.name ?? 'deepseek')
    || address !== (prior?.base_url ?? presets.deepseek.address) || protocol !== (prior?.api_protocol ?? presets.deepseek.protocol)
    || requiresKey !== (prior?.requires_key ?? true) || key !== (prior?.has_key ? undefined : '')
    || [...enabled].sort().join('\n') !== baseEnabled || draftsEdited || busy === 'saving' || busy === 'deleting'
  useEffect(() => {onDirtyChange(dirty)}, [dirty, onDirtyChange])

  const catalogById = useMemo(() => new Map((catalog ?? []).map(model => [model.id, model])), [catalog])
  const kindModels = (catalog ?? []).filter(model => model.vendor === kind)
  const saved = new Set(savedIds(prior))
  const savedCustom = prior?.custom_models ?? {}
  // 草稿的基础值：已保存的配置优先，其次上游读取结果，最后是目录外模型的保守默认。
  const baseDraft = (id: string): ModelDraft => {
    if (savedCustom[id]) return draftFromFacts(savedCustom[id])
    const probe = probes.get(id)
    return probe ? draftFromProbe(probe) : declarationDraft()
  }
  const draftFor = (id: string) => drafts.get(id) ?? baseDraft(id)
  // 目录读取中：不能判断归属，禁止保存。目录读取失败：已保存的模型按原归类提交，其余交给核心归类。
  const catalogPending = catalog === null && !catalogError
  const catalogOffline = catalog === null && catalogError !== null
  const unread = (id: string) => catalogOffline && saved.has(id) && !savedCustom[id] && !probes.has(id)
  const catalogSent = (id: string) => catalogById.has(id) || unread(id)
  const ids = [...new Set([...kindModels.map(model => model.id), ...savedIds(prior), ...probes.keys(), ...extra, ...enabled])]

  // 保存只提交启用的模型：目录模型只写 ID，目录外模型带上能力、档位与单价。
  const models: string[] = []
  const custom: [string, CustomModelDraft][] = []
  const errors = new Map<string, string>()
  for (const id of ids) {
    if (!enabled.has(id)) continue
    if (catalogSent(id)) {models.push(id); continue}
    const result = validateCustom(id, draftFor(id))
    if (result.value) custom.push([id, result.value])
    else errors.set(id, result.error)
  }
  const rows: ModelRow[] = catalogPending ? [] : ids.map(id => {
    const model = catalogById.get(id)
    const probe = probes.get(id)
    const claimedBy = probe?.claimed_by ?? null
    const isEnabled = enabled.has(id)
    return {
      id,
      origin: model ? '目录' : probe ? '上游' : unread(id) ? '已保存' : '自定义',
      unread: unread(id),
      catalog: !!model,
      view: model ? draftFromCatalog(model) : draftFor(id),
      enabled: isEnabled,
      fresh: !!probe && !claimedBy && !model && !saved.has(id),
      claimedBy,
      checkDisabled: !isEnabled && (claimedBy != null),
      editable: !model && !unread(id) && !(claimedBy != null && !isEnabled),
      checking: checking === id,
      note: notes[id],
      error: errors.get(id) ?? serverErrors[id] ?? (isEnabled && claimedBy != null ? `已由 ${claimedBy} 提供，请先取消勾选` : undefined),
    }
  })
  const firstError = rows.find(row => row.error)
  const freshCount = rows.filter(row => row.fresh).length
  const connection = (): ProviderProbe => ({
    name: prior?.name ?? (validName ? normalizedName : undefined),
    kind, base_url: address.trim(), protocol, requires_key: requiresKey,
    ...(key !== undefined && {api_key: key}),
  })
  const canSave = !catalogPending && validName && validAddress && enabled.size > 0 && errors.size === 0
    && !rows.some(row => row.enabled && row.claimedBy != null) && !conflict && !busy
  const busyText = {saving: '保存中…', testing: '测试中…', deleting: '删除中…', reloading: '读取中…'}
  const clearRemote = () => {
    readRevision.current += 1
    setProbes(new Map())
    setReading(false)
    setReadNote(null)
  }
  const connectionChanged = () => {clearRemote(); setTestNote(null)}
  const applyPreset = (next: Kind) => {
    if (next === kind) return
    setKind(next)
    setName(next === 'compatible' ? '' : next)
    setAddress(presets[next].address)
    setProtocol(presets[next].protocol)
    setRequiresKey(next !== 'compatible')
    // 切换类型时只保留非目录模型；目录模型属于原类型。
    setEnabled(current => new Set([...current].filter(id => !catalogById.has(id))))
    setQuery('')
    connectionChanged()
  }
  const toggle = (id: string) => {
    if (!enabled.has(id) && probes.get(id)?.claimed_by != null) return
    setTestNote(null)
    setServerErrors(current => withoutKey(current, id))
    if (enabled.has(id)) {
      setEnabled(current => {const next = new Set(current); next.delete(id); return next})
      return
    }
    setEnabled(current => new Set(current).add(id))
    // 启用时固化当时显示的值，保存结果与界面一致。
    if (!catalogSent(id) && !drafts.has(id)) setDrafts(current => new Map(current).set(id, baseDraft(id)))
  }
  const editRow = (id: string, patch: Partial<ModelDraft>) => {
    setDraftsEdited(true)
    setTestNote(null)
    setServerErrors(current => withoutKey(current, id))
    setDrafts(current => new Map(current).set(id, editedDraft(current.get(id) ?? baseDraft(id), patch)))
  }
  // 工具检测：支持则确认工具；不支持只给出原因与「关闭工具」，由用户确认，不改动工具开关。
  const closeTools = (id: string, base: ModelDraft) => {
    setDraftsEdited(true)
    setDrafts(current => new Map(current).set(id, editedDraft(current.get(id) ?? base, {tools: false})))
    setNotes(current => ({...current, [id]: {text: '已关闭工具调用，并已确认该模型不使用工具。需要时可重新开启。'}}))
  }
  const checkTools = (id: string) => {
    const base = draftFor(id)
    const checked = validateCustom(id, base)
    if (!checked.value) {
      setNotes(current => ({...current, [id]: {failed: true, text: checked.error}}))
      return
    }
    setChecking(id)
    setNotes(current => withoutKey(current, id))
    void api.toolCheck({...connection(), custom_models: {[id]: checked.value}, model: id}).then(result => {
      if (result.supported) {
        setDraftsEdited(true)
        setDrafts(current => new Map(current).set(id, editedDraft(current.get(id) ?? base, {tools: true})))
        setNotes(current => ({...current, [id]: {text: `上游接受工具定义，已确认支持工具调用 · ${result.elapsed_ms} ms`}}))
        return
      }
      const status = result.upstream_status ? `HTTP ${result.upstream_status}` : '未返回状态'
      setNotes(current => ({...current, [id]: {
        warning: true,
        text: `上游不接受工具定义（${status}）：${result.reason ?? '未返回原因'}。工具设置未改动，如不需要工具，请确认关闭。`,
        action: {label: '关闭工具', onClick: () => closeTools(id, base)},
      }}))
    }, error => {
      const note = failure(error)
      setNotes(current => ({...current, [id]: {...note, text: `${note.text}。可再次检测。`}}))
    }).finally(() => setChecking(current => current === id ? null : current))
  }
  const locateModel = (id: string) => {setQuery(''); setLocate({id})}
  const addModel = (id: string): string | null => {
    const error = modelIdError(id)
    if (error) return error
    if (!ids.includes(id)) setExtra(current => [...current, id])
    if (!enabled.has(id)) toggle(id)
    locateModel(id)
    return null
  }
  const fetchModels = async () => {
    const revision = ++readRevision.current
    setReading(true)
    setReadNote(null)
    const result = await readProviderModels(api, {...connection(), models: [], custom_models: {}})
    if (revision !== readRevision.current) return
    if (!result.note.failed) setProbes(new Map(result.details.map(item => [item.id, item])))
    setReadNote(result.note)
    setReading(false)
  }
  const act = async (action: NonNullable<typeof busy>, task: () => Promise<void>) => {
    setBusy(action)
    setNotice(null)
    setConfirmDelete(false)
    try {await task()}
    catch (error) {
      if (action === 'testing') setTestNote(failure(error))
      else {
        if (error instanceof ApiError && error.code === 'conflict') setConflict(true)
        setServerErrors(serverModelErrors(error))
        setNotice(failure(error))
      }
    } finally {setBusy(null)}
  }

  const catalogNote: ProbeNote = {
    warning: true,
    text: `内置目录未读取${catalogError ? `（${catalogError}）` : ''}：目录模型暂按自定义显示，能力与单价以核心保存结果为准。`,
    action: {label: '重试', onClick: onRetryCatalog},
  }

  return <section aria-labelledby={uid + '-title'} className="provider-detail">
    <header className="provider-detail-head">
      <Button ref={back} type="button" size="sm" variant="ghost" disabled={!!busy} onClick={onClose}><ArrowLeft aria-hidden/>返回提供商列表</Button>
      <div className="provider-detail-title">
        <span className="provider-mark"><ProviderMark kind={kind}/></span>
        <h2 id={uid + '-title'} className="min-w-0 break-all text-lg font-semibold tracking-tight">
          {prior ? `编辑 ${kind !== 'compatible' && [kind, 'gpt'].includes(prior.name) ? presets[kind].label : prior.name}` : '添加提供商'}
        </h2>
      </div>
    </header>
    <form className="provider-detail-form" onSubmit={event => {
      event.preventDefault()
      if (!canSave) return
      void act('saving', async () => {
        const {name: _name, ...draft} = connection()
        onSaved(await api.save(normalizedName, {...draft, models, custom_models: Object.fromEntries(custom), version: editor.version}))
        const added = [...models, ...custom.map(([id]) => id)].filter(id => !saved.has(id)).length
        toast.success(added ? `已写入配置文件，新增的 ${added} 个模型可在输入框的模型菜单中选择` : '已写入配置文件')
      })
    }}>
      <div className="provider-detail-scroll">
        <fieldset className="provider-fields" disabled={!!busy}>
          <h3 className="text-sm font-semibold">连接信息</h3>
          {prior?.issue && <ProviderResult note={{text: prior.issue, failed: true}}/>}
          {!prior && <Field label="类型"><div className="provider-segment" role="group" aria-label="提供商类型">
            {kinds.map(id => <button key={id} type="button" aria-pressed={kind === id} onClick={() => applyPreset(id)}>
              <ProviderMark kind={id}/>{presets[id].label}
            </button>)}
          </div></Field>}
          {showName && <Field label="名称" id={uid + '-name'} hint="字母、数字、下划线或连字符，用作配置里的键名">
            <Input id={uid + '-name'} required value={name} readOnly={!!prior} onChange={event => setName(event.target.value)} placeholder="例如 gateway"/>
            {!prior && normalizedName && !validName && <p className="mt-1 text-xs text-state-failed">
              {taken.includes(normalizedName) ? '已有同名提供商。' : '请填写有效的提供商名称。'}</p>}
          </Field>}
          <Field label="地址" id={uid + '-address'}>
            <Input id={uid + '-address'} type="url" required value={address}
              onChange={event => {setAddress(event.target.value); connectionChanged()}} placeholder="https://example.com/v1" spellCheck={false}/>
            {address.trim() && !validAddress && <p className="mt-1 text-xs text-state-failed">请输入有效的 HTTP 或 HTTPS 接口地址。</p>}
          </Field>
          <Field label="协议">
            <div className="provider-segment" role="group" aria-label="协议">
              {protocols.map(id => <button key={id} type="button" aria-pressed={protocol === id}
                onClick={() => {setProtocol(id); setTestNote(null)}}>{protocolLabels[id]}</button>)}
            </div>
          </Field>
          <Field label="密钥" id={key === undefined ? undefined : uid + '-key'}>
            <div className="provider-key-row">
              {key === undefined ? <>
                <code className="provider-key">{prior?.key_hint}</code>
                <Button type="button" size="sm" variant="ghost" onClick={() => {setKey(''); connectionChanged()}}>更换</Button>
              </> : <>
                <Input id={uid + '-key'} type="password" autoComplete="new-password" value={key}
                  placeholder={requiresKey ? 'sk-…' : '无需密钥可留空'} onChange={event => {setKey(event.target.value); connectionChanged()}}/>
                {prior?.has_key && <Button type="button" size="sm" variant="ghost" onClick={() => {setKey(undefined); connectionChanged()}}>保留原密钥</Button>}
              </>}
              <Button type="button" size="sm" variant="outline" disabled={!validAddress || !!busy || conflict || catalogPending} onClick={() => {
                setTestNote(null)
                void act('testing', async () => {
                  const result = await api.test({...connection(), models, custom_models: Object.fromEntries(custom), model: models[0] ?? custom[0]?.[0]})
                  setTestNote({text: `连接正常 · ${result.method === 'models' ? '返回 ' + (result.models?.length ?? 0) + ' 个模型 · ' : ''}${result.elapsed_ms} ms`})
                })
              }}>{busy === 'testing' ? busyText.testing : '测试连接'}</Button>
            </div>
            {(kind === 'compatible' || prior?.requires_key === false) && <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={requiresKey} onChange={event => {setRequiresKey(event.target.checked); connectionChanged()}}/>此连接需要密钥
            </label>}
            {testNote && <ProviderResult note={testNote}/>}
          </Field>
          {catalogPending
            ? <section className="provider-models"><ProviderResult note={{text: '正在读取内置目录…'}}/></section>
            : <ProviderModelList rows={rows} query={query} onQuery={next => {setQuery(next); setLocate(null)}} locate={locate}
              onToggle={toggle} onEdit={editRow} onCheck={checkTools} onAdd={addModel}
              onRead={() => void fetchModels()} reading={reading} canRead={validAddress && !conflict}
              readStatus={<>
                {catalogOffline && <ProviderResult note={catalogNote}/>}
                {readNote && <ProviderResult note={readNote}/>}
              </>} freshCount={freshCount}/>}
        </fieldset>
      </div>
      <footer className="provider-detail-actions">
        {notice && <ProviderResult note={notice}/>}
        {conflict && <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={!!busy}
          onClick={() => void act('reloading', async () => onSaved(await api.get()))}>{busy === 'reloading' ? busyText.reloading : '重新读取配置'}</Button>}
        {confirmDelete && <p role="alert" className="text-xs text-state-waiting">引用此提供商的会话需要换模型才能发起下一次运行。</p>}
        <div className="provider-detail-buttons">
          {prior && <Button type="button" size="sm" variant="ghost" className="mr-auto text-state-failed" disabled={!!busy || conflict} onClick={() => {
            if (!confirmDelete) {setConfirmDelete(true); return}
            void act('deleting', async () => onSaved(await api.remove(prior.name, editor.version)))
          }}>{busy === 'deleting' ? busyText.deleting : confirmDelete ? '确认删除' : '删除'}</Button>}
          {firstError && <Button type="button" size="sm" variant="ghost" className="text-state-failed" disabled={!!busy}
            onClick={() => locateModel(firstError.id)}>查看有误的模型</Button>}
          <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={onClose}>取消</Button>
          <Button type="submit" size="sm" disabled={!canSave}>{busy === 'saving' ? busyText.saving : '保存'}</Button>
        </div>
      </footer>
    </form>
  </section>
}

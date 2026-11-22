import {useEffect, useId, useRef, useState, type ReactNode} from 'react'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Collapsible, CollapsibleContent, CollapsibleTrigger, collapsibleChevron} from '@/components/ui/collapsible'
import {ChevronDown, Download, Plus, Search} from '@/components/ui/icons'
import {reasoningLabel, type UnconfirmedKey} from '@/lib/model-selection'
import {ProviderResult, type ProbeNote} from './provider-result'
import {
  capabilities, capKeys, EFFORT_LIMIT, effortError, factsLine, modelIdError, priceText, rateKeys, rateLabels, type ModelDraft,
} from './provider-models'

/** 列表中的一行：目录、上游或已保存的模型，展示与编辑都基于同一份草稿。 */
export type ModelRow = {
  id: string
  origin: '目录' | '上游' | '已保存' | '自定义'
  /** 目录未读取时已保存的模型：能力不可知，只读，以核心保存结果为准。 */
  unread: boolean
  catalog: boolean
  view: ModelDraft
  enabled: boolean
  fresh: boolean
  claimedBy: string | null
  checkDisabled: boolean
  editable: boolean
  checking: boolean
  error?: string
  note?: ProbeNote
}

function EffortsField({efforts, disabled, onChange}: {efforts: string[]; disabled: boolean; onChange: (efforts: string[]) => void}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()
  const add = () => {
    const value = text.trim()
    if (!value) return
    const message = efforts.includes(value) ? `思考档位「${value}」已存在。` : effortError([...efforts, value])
    if (message) {setError(message); return}
    onChange([...efforts, value])
    setText('')
    setError(null)
  }
  return <div className="provider-efforts">
    <span className="provider-field-label">思考档位</span>
    <div className="provider-effort-list">
      {efforts.length === 0 && <span className="text-meta text-muted-foreground">未声明档位，只能开关思考。</span>}
      {efforts.map(effort => <span key={effort} className="provider-effort">
        <code>{effort}</code>
        <button type="button" disabled={disabled} aria-label={`删除思考档位 ${effort}`}
          onClick={() => onChange(efforts.filter(item => item !== effort))}>×</button>
      </span>)}
    </div>
    <div className="provider-effort-add">
      <Input aria-label="添加思考档位" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
        placeholder={`如 high，最多 ${EFFORT_LIMIT} 个`} value={text} spellCheck={false} autoComplete="off" disabled={disabled}
        onChange={event => {setText(event.target.value); setError(null)}}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return
          event.preventDefault()
          add()
        }}/>
      <Button type="button" size="sm" variant="ghost" disabled={disabled || !text.trim()} onClick={add}><Plus aria-hidden/>添加档位</Button>
    </div>
    {error && <p id={errorId} role="alert" className="text-meta text-state-failed">{error}</p>}
  </div>
}

function Unconfirmed() {
  return <span className="provider-unconfirmed">能力未确认</span>
}

function ModelFields({view, disabled, errorId, onEdit}: {
  view: ModelDraft
  disabled: boolean
  errorId?: string
  onEdit: (patch: Partial<ModelDraft>) => void
}) {
  const unconfirmed = (key: UnconfirmedKey) => view.unconfirmed.includes(key)
  return <div className="provider-model-fields" role="group" aria-label="模型能力与单价" aria-describedby={errorId}>
    <div className="provider-custom-fields">
      <label><span className="provider-field-label">上下文窗口{unconfirmed('context_window') && <Unconfirmed/>}</span>
        <Input value={view.window} disabled={disabled} onChange={event => onEdit({window: event.target.value})}/></label>
      <label><span className="provider-field-label">输出上限{unconfirmed('max_output') && <Unconfirmed/>}</span>
        <Input value={view.output} disabled={disabled} onChange={event => onEdit({output: event.target.value})}/></label>
    </div>
    <div className="provider-capabilities" role="group" aria-label="能力">
      <span className="text-muted-foreground">能力</span>
      {capKeys.map(key => <span key={key} className="provider-chip-wrap">
        <button type="button" className="provider-chip" aria-pressed={view[key]} disabled={disabled}
          onClick={() => onEdit({[key]: !view[key]} as Partial<ModelDraft>)}>{capabilities[key]}</button>
        {unconfirmed(key) && <Unconfirmed/>}
      </span>)}
    </div>
    <EffortsField efforts={view.efforts} disabled={disabled} onChange={efforts => onEdit({efforts})}/>
    <div className="provider-custom-fields">{rateKeys.map(key => <label key={key}><span className="provider-field-label">{rateLabels[key]}</span>
      <span className="provider-rate">
        <span aria-hidden>$</span>
        <Input value={view[key]} inputMode="decimal" disabled={disabled} placeholder={key === 'cached_input' ? '同输入' : '可选'}
          aria-label={`${rateLabels[key]}（美元，每百万 Token）`} onChange={event => onEdit({[key]: event.target.value} as Partial<ModelDraft>)}/>
        <span aria-hidden>每百万 Token</span>
      </span>
    </label>)}</div>
  </div>
}

function ProviderModel({row, target, onToggle, onEdit, onCheck}: {
  row: ModelRow
  target: {id: string} | null
  onToggle: () => void
  onEdit: (patch: Partial<ModelDraft>) => void
  onCheck: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const checkbox = useRef<HTMLInputElement>(null)
  const uid = useId()
  const errorId = useId()
  useEffect(() => {
    if (!target) return
    checkbox.current?.scrollIntoView({block: 'nearest'})
    checkbox.current?.focus({preventScroll: true})
  }, [target])
  const {id, view, catalog, enabled, claimedBy, error, note, checking} = row
  return <li className="provider-model" data-invalid={Boolean(error)} data-enabled={enabled}>
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="provider-model-line">
        <input ref={checkbox} id={uid + '-check'} type="checkbox" className="provider-checkbox" checked={enabled}
          disabled={row.checkDisabled} aria-describedby={error ? errorId : undefined} onChange={onToggle}/>
        <div className="provider-model-info">
          <div className="provider-model-title">
            <label htmlFor={uid + '-check'} className="min-w-0 cursor-pointer"><code title={id}>{id}</code></label>
            <span className="provider-origin">{row.origin}</span>
            {row.fresh && <span className="provider-model-new">新</span>}
            {view.unconfirmed.length > 0 && !row.unread && <Unconfirmed/>}
            {claimedBy && <span className="provider-claimed">已由 {claimedBy} 提供</span>}
          </div>
          <p className="provider-model-meta">{row.unread ? <span>目录未读取，能力以核心保存结果为准</span> : factsLine(view, reasoningLabel)}</p>
        </div>
        <span className="provider-model-price tabular-nums" title={catalog ? undefined : '美元 / 每百万 Token'}>
          {row.unread ? '—' : priceText(view, catalog)}
        </span>
        <CollapsibleTrigger asChild>
          <Button type="button" size="icon-sm" variant="ghost" className="provider-model-expand"
            aria-label={`${expanded ? '收起' : '展开'}模型 ${id}`}>
            <ChevronDown className={collapsibleChevron} aria-hidden/>
          </Button>
        </CollapsibleTrigger>
      </div>
      {error && <p id={errorId} role="alert" className="provider-model-error">{error}</p>}
      <CollapsibleContent className="provider-model-detail">
        {catalog
          ? <p className="text-meta text-muted-foreground">能力与单价由内置目录提供，不能在这里修改。</p>
          : row.unread
            ? <p className="text-meta text-muted-foreground">目录未读取，无法显示此模型的能力与单价；保存后以核心结果为准。</p>
          : row.editable
            ? <>
              <ModelFields view={view} disabled={false} errorId={error ? errorId : undefined} onEdit={onEdit}/>
              <div className="provider-tool-check">
                <Button type="button" size="sm" variant="outline" disabled={checking} onClick={onCheck}>{checking ? '检测中…' : '检测'}</Button>
                <span className="text-meta text-muted-foreground">发送一次只含工具定义的请求，确认上游是否接受工具调用。</span>
                {note && <ProviderResult note={note}/>}
              </div>
            </>
            : <p className="text-meta text-muted-foreground">已由 {claimedBy} 提供。同一模型只能属于一个提供商，请先在对方取消勾选。</p>}
      </CollapsibleContent>
    </Collapsible>
  </li>
}

export function ProviderModelList({rows, query, onQuery, locate, onToggle, onEdit, onCheck, onAdd, onRead, reading, canRead, readStatus, freshCount}: {
  rows: ModelRow[]
  query: string
  onQuery: (query: string) => void
  locate: {id: string} | null
  onToggle: (id: string) => void
  onEdit: (id: string, patch: Partial<ModelDraft>) => void
  onCheck: (id: string) => void
  onAdd: (id: string) => string | null
  onRead: () => void
  reading: boolean
  canRead: boolean
  readStatus: ReactNode
  freshCount: number
}) {
  const title = useId()
  const addErrorId = useId()
  const [manual, setManual] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const add = () => {
    const id = manual.trim()
    const error = modelIdError(id) ?? onAdd(id)
    setManualError(error)
    if (!error) setManual('')
  }
  const search = query.trim().toLowerCase()
  const visible = rows.length > 8 && search ? rows.filter(row => row.id.toLowerCase().includes(search)) : rows
  return <section aria-labelledby={title} className="provider-models">
    <div className="provider-models-head">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 id={title} className="text-sm font-semibold">模型</h4>
        <span className="text-meta text-muted-foreground">已启用 {rows.filter(row => row.enabled).length} 个</span>
        {freshCount > 0 && <span className="text-meta text-signal" role="status">上游新增 {freshCount} 个</span>}
      </div>
      <Button type="button" size="sm" variant="outline" onClick={onRead} disabled={!canRead || reading}>
        <Download aria-hidden/>{reading ? '读取中…' : '从上游读取'}
      </Button>
    </div>
    {readStatus}
    {rows.length > 8 && <div className="provider-search">
      <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
      <Input type="search" aria-label="搜索模型" placeholder="搜索模型 ID" value={query} onChange={event => onQuery(event.target.value)}/>
    </div>}
    {visible.length > 0
      ? <ul aria-label="模型列表" className="provider-model-list">{visible.map(row => <ProviderModel key={row.id} row={row}
        target={locate?.id === row.id ? locate : null} onToggle={() => onToggle(row.id)}
        onEdit={patch => onEdit(row.id, patch)} onCheck={() => onCheck(row.id)}/>)}</ul>
      : <p className="px-2 py-2 text-meta text-muted-foreground">{rows.length ? '没有匹配的模型。' : '读取上游列表，或手动添加模型 ID。'}</p>}
    <div className="provider-manual">
      <Input aria-label="手动添加模型 ID" placeholder="输入模型 ID" value={manual} spellCheck={false} autoComplete="off"
        aria-invalid={manualError ? true : undefined} aria-describedby={manualError ? addErrorId : undefined}
        onChange={event => {setManual(event.target.value); setManualError(null)}}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return
          event.preventDefault()
          add()
        }}/>
      <Button type="button" size="sm" variant="ghost" onClick={add} disabled={!manual.trim()}><Plus aria-hidden/>添加模型</Button>
    </div>
    {manualError && <p id={addErrorId} role="alert" className="text-meta text-state-failed">{manualError}</p>}
  </section>
}

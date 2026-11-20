import {useEffect, useRef, useState} from 'react'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Search, Sparkles} from '@/components/ui/icons'
import {ApiError} from '@/lib/api/fetch'
import {skillsApi, type Skill, type SkillMarketItem, type SkillMarketPage, type SkillMarketTarget} from '@/lib/api/skills'

const REQUEST_KEY = 'rayagent:market-install'
const PAGE_SIZE = 25
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试'
const scopeLabel = (target: SkillMarketTarget) => target.workspace_id ? '当前工作区' : 'RayAgent 全局'

export function SkillMarket({active, workspaceId, installed, onInstalled}: {
  active: boolean
  workspaceId?: string
  installed: Skill[]
  onInstalled: (id?: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [summaries, setSummaries] = useState<Record<string, string | null | false>>({})
  const summaryCache = useRef<Record<string, string | null>>({})
  const [summaryRetry, setSummaryRetry] = useState(0)
  const [summaryUnsupported, setSummaryUnsupported] = useState(false)
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<(SkillMarketPage & {query: string; offset: number}) | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<SkillMarketItem | null>(null)
  const [targets, setTargets] = useState<SkillMarketTarget[] | null>(null)
  const [targetIndex, setTargetIndex] = useState(0)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState('')
  const [notice, setNotice] = useState('')
  const trigger = useRef<HTMLButtonElement | null>(null)
  const target = targets?.[targetIndex]

  useEffect(() => {
    if (!active) return
    let disposed = false
    const timer = setTimeout(() => {
      setLoading(true)
      setError('')
      skillsApi.market(query.trim(), offset).then(data => {
        if (!disposed) setPage({...data, query: query.trim(), offset})
      }).catch(reason => {
        if (!disposed) setError(errorText(reason))
      }).finally(() => {
        if (!disposed) setLoading(false)
      })
    }, query ? 300 : 0)
    return () => {disposed = true; clearTimeout(timer)}
  }, [active, query, offset, refresh])

  useEffect(() => {
    if (!active || !page || summaryUnsupported) return
    let disposed = false
    const ids = page.items.filter(item => !item.description && !Object.hasOwn(summaryCache.current, item.id)).map(item => item.id)
    async function loadDescriptions() {
      for (let index = 0; index < ids.length && !disposed; index += 8) {
        const batch = ids.slice(index, index + 8)
        const failed = Object.fromEntries(batch.map(id => [id, false] as const))
        try {
          const descriptions = await skillsApi.marketDescriptions(batch)
          if (disposed) return
          Object.assign(summaryCache.current, descriptions)
          setSummaries(current => ({...current, ...failed, ...descriptions}))
        } catch (reason) {
          if (disposed) return
          if (reason instanceof ApiError && (reason.status === 404 || reason.status === 405)) {
            setSummaryUnsupported(true)
            return
          }
          setSummaries(current => ({...current, ...failed}))
        }
      }
    }
    void loadDescriptions()
    return () => {disposed = true}
  }, [active, page, summaryRetry, summaryUnsupported])

  useEffect(() => {
    if (!selected) return
    let disposed = false
    skillsApi.marketTargets(workspaceId).then(list => {
      if (!disposed) setTargets(list)
    }).catch(reason => {
      if (!disposed) {setTargets([]); setInstallError(errorText(reason))}
    })
    return () => {disposed = true}
  }, [selected, workspaceId])

  async function install() {
    if (!selected || !target || installing) return
    setInstalling(true)
    setInstallError('')
    const signature = JSON.stringify([selected.id, target.workspace_id, target.target_id])
    let saved: {id?: string; signature?: string} = {}
    try {saved = JSON.parse(sessionStorage.getItem(REQUEST_KEY) || '{}')} catch { /* ignore unreadable recovery data */ }
    const id = saved.signature === signature && saved.id ? saved.id : crypto.randomUUID().replaceAll('-', '')
    sessionStorage.setItem(REQUEST_KEY, JSON.stringify({id, signature}))
    try {
      const op = await skillsApi.marketInstall(id, selected, target).catch(async reason => {
        const current = await skillsApi.operation(id).catch(() => null)
        if (current?.stage === 'completed' || current?.stage === 'failed') return current
        throw reason
      })
      if (['failed', 'interrupted', 'expired', 'cancelled'].includes(op.stage)) {
        sessionStorage.removeItem(REQUEST_KEY)
        throw new Error(op.error || '安装操作已失效，请重试')
      }
      if (op.stage !== 'completed') throw new Error('安装尚未完成，再次点击可查询或继续原安装')
      sessionStorage.removeItem(REQUEST_KEY)
      setSelected(null)
      setNotice(`已安装 ${op.result?.name || selected.name} · ${scopeLabel(target)}`)
      try {
        await onInstalled(op.result?.id)
      } catch {
        setNotice('安装已完成，请刷新已安装列表')
      }
    } catch (reason) {
      setInstallError(errorText(reason))
    } finally {
      setInstalling(false)
    }
  }

  const failedSummaries = page?.items.some(item => !item.description && summaries[item.id] === false)
  return <section id="skill-view-panel-market" role="tabpanel" aria-labelledby="skill-view-market" hidden={!active} className="skill-view-panel space-y-3">
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"/>
      <Input aria-label="搜索技能市场" placeholder="搜索技能市场" value={query}
        className="border-transparent bg-muted/60 pl-9 shadow-none"
        onChange={event => {setQuery(event.target.value); setOffset(0); setError(''); setLoading(true); setNotice('')}}/>
    </div>
    <div className="skill-market-meta">
      <span className="shrink-0">{(page?.query ?? query.trim()) ? '搜索结果' : '累计安装榜'} · skills.sh</span>
      <div role={error ? 'alert' : 'status'} className="flex min-w-0 items-center justify-end gap-1 overflow-hidden">
        {error ? <>
          <span className="truncate" title={error}>读取失败{page ? '，仍显示上次结果' : ''}</span>
          <Button variant="ghost" size="xs" onClick={() => setRefresh(value => value + 1)}>重试</Button>
        </> : loading ? <span>正在读取市场</span>
          : summaryUnsupported ? <span className="truncate" title="当前核心版本无法获取简介">当前核心版本无法获取简介，重启最新版 RayAgent 后再试。</span>
          : failedSummaries ? <>
            <span className="truncate">部分简介获取失败</span>
            <Button size="xs" variant="ghost" onClick={() => {
              setSummaries(current => Object.fromEntries(Object.entries(current).filter(([, value]) => value !== false)))
              setSummaryRetry(value => value + 1)
            }}>重试简介</Button>
          </> : notice ? <span className="truncate" title={notice}>{notice}</span>
          : page?.stale && <span className="truncate">缓存更新于 {new Date(page.updated_at * 1000).toLocaleString()}</span>}
      </div>
    </div>
    {!page && !error && <div className="skill-market-grid" aria-hidden>
      {Array.from({length: 9}, (_, index) => <div key={index} className="skill-market-card skill-market-placeholder">
        <div className="h-7 w-3/4 rounded bg-muted"/>
        <div className="h-[4.5em] rounded bg-muted/70"/>
        <div className="h-4 w-1/2 rounded bg-muted"/>
        <div className="mt-auto h-7 w-2/5 rounded bg-muted"/>
      </div>)}
    </div>}
    {page && page.items.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的 Skill</p>}
    {!!page?.items.length && <div className="skill-market-grid" aria-busy={loading}>
      {page.items.map((item, index) => {
        const matches = installed.filter(skill => skill.market?.id === item.id && skill.status === 'available')
        const scopes = [...new Set(matches.map(skill => skill.source.kind === 'workspace' ? '当前工作区' : 'RayAgent 全局'))]
        const description = item.description || summaries[item.id] || matches.find(skill => skill.description)?.description
        return <article key={item.id} data-market-id={item.id} className="skill-market-card">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><Sparkles className="size-3.5" aria-hidden/></span>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={item.name}>{item.name}</h2>
            {!page.query && <span className="shrink-0 text-xs tabular-nums text-faint" aria-label={`榜单第 ${page.offset + index + 1} 名`}>#{page.offset + index + 1}</span>}
          </div>
          <p className="h-[4.5em] text-xs leading-relaxed text-muted-foreground">
            <span className="line-clamp-3 break-words" title={description}>
              {description || (summaryUnsupported ? '当前核心不支持简介' : summaries[item.id] === false ? '简介获取失败'
                : summaries[item.id] === null ? '暂无简介' : '正在获取简介')}
            </span>
          </p>
          <div className="skill-market-source">
            <a className="block truncate rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={`https://www.skills.sh/${item.id}`} title={`在 skills.sh 查看 ${item.repository}`} target="_blank" rel="noopener noreferrer">{item.repository}</a>
            <p className="mt-1 truncate text-xs text-signal">{scopes.length > 0 && `已安装 · ${scopes.join('、')}`}</p>
          </div>
          <footer className="flex items-center justify-between gap-2">
            <span className="min-w-0 text-xs tabular-nums text-muted-foreground">安装量 {item.count_label || item.installs.toLocaleString()}</span>
            <Button size="sm" variant="outline" disabled={loading} aria-label={`安装 ${item.name}（${item.repository}）`} onClick={event => {
              trigger.current = event.currentTarget
              setTargets(null); setTargetIndex(0); setInstallError(''); setSelected(item)
            }}>安装</Button>
          </footer>
        </article>
      })}
    </div>}
    {page && (page.offset > 0 || page.has_more) && <div className="flex justify-end gap-2">
      <Button variant="ghost" size="sm" disabled={loading || page.offset === 0} onClick={() => {setLoading(true); setOffset(page.offset - PAGE_SIZE); setNotice('')}}>上一页</Button>
      <Button variant="ghost" size="sm" disabled={loading || !page.has_more} onClick={() => {setLoading(true); setOffset(page.offset + PAGE_SIZE); setNotice('')}}>下一页</Button>
    </div>}
    <Dialog open={active && !!selected} onOpenChange={open => {if (!open && !installing) setSelected(null)}}>
      <DialogContent className="grid h-[min(27rem,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] rounded-2xl" aria-describedby={undefined} onPointerDownOutside={event => event.preventDefault()} onCloseAutoFocus={event => {event.preventDefault(); trigger.current?.focus()}}>
        <DialogTitle>安装 {selected?.name}</DialogTitle>
        <div className="space-y-3 overflow-y-auto">
        <p className="text-sm text-muted-foreground">{selected?.repository}</p>
        {selected && (selected.description || summaries[selected.id]) && <p className="text-sm text-muted-foreground">{selected.description || summaries[selected.id]}</p>}
        {!targets ? <p role="status" className="text-sm text-muted-foreground">正在核对安装位置</p> :
          <fieldset className="space-y-2" disabled={installing}>
            <legend className="mb-2 text-sm font-medium">安装位置</legend>
            {targets.length === 0 && <p className="text-sm text-muted-foreground">当前没有可写的 Skill 目录</p>}
            {targets.map((option, index) => <label key={option.target_id} className="flex items-start gap-2 rounded-md border px-3 py-2">
              <input type="radio" name="skill-install-target" checked={index === targetIndex} onChange={() => setTargetIndex(index)}/>
              <span className="min-w-0 text-sm">{scopeLabel(option)}<span className="block break-all font-mono text-xs text-muted-foreground">{option.directory}/</span></span>
            </label>)}
          </fieldset>}
        {installError && <p role="alert" className="text-sm text-state-failed">{installError}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={installing} onClick={() => setSelected(null)}>取消</Button>
          <Button disabled={!target || installing} onClick={() => void install()}>{installing ? '正在安装' : '确认安装'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>
}

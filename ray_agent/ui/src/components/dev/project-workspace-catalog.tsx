'use client'

import {useState} from 'react'
import {Folder, PanelLeftClose, PanelLeftOpen, Settings, Plus} from 'lucide-react'
import {NavigationCreateButton, ProjectNavigation, type NavigationExpansion, type NavigationProject} from '@/components/project-navigation'
import {ChatInput} from '@/components/chat-input'
import {Button} from '@/components/ui/button'
import {Sheet, SheetContent, SheetTitle, SheetDescription} from '@/components/ui/sheet'
import {useIsMobile} from '@/hooks/use-mobile'
import {sessionItemStates} from '@/fixtures/states'

/** W11 主路径合成目录；不创建数据库记录、沙箱或调用发送接口。 */
export function ProjectWorkspaceCatalog() {
  const isMobile = useIsMobile()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [expansion, setExpansion] = useState<NavigationExpansion>({projects:true, conversations:true, items:{demo:true}})
  const [path, setPath] = useState('/')
  const [collapsed, setCollapsed] = useState(false)
  const [picker, setPicker] = useState(false)
  const [state, setState] = useState('ready')
  const [longList, setLongList] = useState(false)
  const [note, setNote] = useState('尚未发送；打开项目不会创建对话或沙箱。')
  const [tab, setTab] = useState<'conversations' | 'projects'>('conversations')
  const projects: NavigationProject[] = state === 'empty' ? [] : [{id:'demo',name:'RayAgent 实验项目',available:state !== 'unavailable',reason:'项目根目录不可用',conversations:[sessionItemStates.completed,sessionItemStates.waiting]}, ...(longList ? Array.from({length:40}, (_,i)=>({id:`project-${i}`,name:`研究项目 ${i+1}`,available:true,conversations:[]})) : [])]
  const inProject = path.startsWith('/projects/')
  const statusNotes: Record<string,string> = {unconfigured:'尚未配置项目根目录；请查看应用运行指南。',shared:'共享沙箱不支持挂载本机项目。',error:'读取项目失败；可重试。',unavailable:'项目目录不可用，历史仍可查看。',starting:'已受理，准备执行环境',waiting:'等待回复，占用该项目；另一对话发送会指出占用对话。',failed:'准备执行环境失败。草稿和已创建对话保留，可核对后重试。'}
  const navigation = <>
        <div className="flex h-9 shrink-0 items-center justify-between gap-1">
          {!collapsed && <button type="button" onClick={()=>setPath('/')} className="text-sm font-semibold">RayAgent</button>}
          <div className="flex items-center">
            {!collapsed && <NavigationCreateButton tab={tab} onIndependent={()=>setPath('/')} onOpenProject={()=>setPicker(true)}/>}
            <Button variant="ghost" size="icon-xs" aria-label={collapsed ? '恢复侧栏' : '收起侧栏'} onClick={()=>{if (isMobile) setMobileOpen(false); else setCollapsed(!collapsed)}}>{collapsed ? <PanelLeftOpen/> : <PanelLeftClose/>}</Button>
          </div>
        </div>
        {collapsed ? <div className="flex flex-1 flex-col gap-2"><Button variant="ghost" size="icon-sm" aria-label="新独立对话" title="新独立对话" onClick={()=>setPath('/')}><Plus/></Button><Button variant="ghost" size="icon-sm" aria-label="打开项目" title="打开项目" onClick={()=>setPicker(true)}><Folder/></Button></div> : <div className="min-h-0 flex-1"><ProjectNavigation projects={projects} conversations={[sessionItemStates.failed]} expansion={expansion} onExpansion={setExpansion} selectedProject={inProject ? path.split('/')[2] : null} selectedSession={path.startsWith('/sessions/') ? path.split('/')[2] : null} tab={tab} onTabChange={setTab} loading={state==='loading'} error={state==='error' ? '读取项目失败' : null} onRetry={()=>setState('ready')} onOpenProject={()=>setPicker(true)} onProjectSettings={()=>setNote('设置项目说明；新对话首次受理时保存快照。')} onArchive={()=>setNote('归档保留对话与宿主机文件；活动运行时返回冲突。')} onSessionDelete={()=>setNote('示例不删除数据')} onSessionRename={()=>setNote('示例不写入标题')} onNavigate={next=>{setPath(next); setTab(next.startsWith('/projects') ? 'projects' : tab); setMobileOpen(false)}} preview/></div>}
        <Button variant="ghost" size="sm" aria-label="设置" className="mt-2 shrink-0 justify-start"><Settings className="size-4"/>{!collapsed && '设置'}</Button>
  </>
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-meta">
      <span>合成状态：</span><select aria-label="工作区目录状态" value={state} onChange={e=>setState(e.target.value)} className="rounded-md border bg-background px-2 py-1">
        {['ready','loading','error','empty','unconfigured','shared','unavailable','starting','waiting','failed'].map(s=><option key={s} value={s}>{s}</option>)}
      </select>
      <Button size="sm" variant="outline" onClick={()=>setLongList(!longList)}>长项目列表</Button>
      <span className="text-faint">所有数据为合成；发送仅切换示例状态。</span>
    </div>
    <div className="flex h-[640px] min-h-0 overflow-hidden rounded-lg border bg-background max-md:h-[700px]">
      <aside className={`${collapsed ? 'w-12' : 'w-64'} hidden md:flex shrink-0 flex-col border-r bg-sidebar p-2`}>
        {navigation}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetContent side="left" className="w-72 bg-sidebar p-2 flex flex-col"><SheetTitle className="sr-only">项目与对话导航</SheetTitle><SheetDescription className="sr-only">合成工作区目录，不写入产品数据。</SheetDescription>{navigation}</SheetContent></Sheet>
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <Button variant="ghost" size="icon-xs" aria-label="打开侧栏" className="md:hidden" onClick={()=>setMobileOpen(true)}><PanelLeftOpen/></Button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{inProject ? 'RayAgent 实验项目' : path==='/' ? '独立对话' : '项目内对话'}</span>
          {inProject && <Button variant="ghost" size="sm" onClick={()=>setPath('/')}>关闭项目</Button>}
        </header>
        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
          {inProject && <><p className="truncate font-mono text-xs text-faint">/workspace/example · main</p><p className="text-meta text-muted-foreground">最近对话 · 查看全部</p><Button variant="ghost" className="w-full min-w-0 justify-start overflow-hidden" onClick={()=>setPath(`/sessions/${sessionItemStates.completed.session_id}`)}><span className="truncate">{sessionItemStates.completed.title}</span></Button></>}
          {statusNotes[state] && <p role="status" className="text-meta text-muted-foreground">{statusNotes[state]}</p>}
          {picker && <div className="rounded-md border p-3"><p className="mb-2 text-sm font-medium">打开项目</p><p className="mb-2 text-meta text-muted-foreground">{statusNotes[state] ?? '选择已有项目或添加目录；此处不发送消息。'}</p><Button size="sm" variant="outline" disabled={['unconfigured','shared','error'].includes(state)} onClick={()=>{setPath('/projects/demo');setPicker(false)}}>RayAgent 实验项目</Button><Button size="sm" variant="ghost" onClick={()=>setPicker(false)}>关闭</Button></div>}
          <p className="text-meta text-faint">{note}</p>
          <div className="mt-auto"><ChatInput draftScope={`catalog-workspace:${path}`} placeholder={inProject ? '在 RayAgent 实验项目中开始对话…' : '开始独立对话…'} disabled={inProject && state==='unavailable'} onSend={async()=>{setNote('合成：已受理，准备执行环境；没有调用产品发送接口。');setState('starting')}}/></div>
        </main>
      </div>
    </div>
  </div>
}

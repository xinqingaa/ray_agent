import {lazy, Suspense, useEffect} from 'react'
import {BrowserRouter, Navigate, Outlet, Route, Routes, useLocation} from 'react-router'
import {ThemeProvider} from 'next-themes'
import {Toaster} from '@/components/ui/sonner'
import {AppShell} from '@/components/app-shell'
import {CoreGate} from '@/components/core-gate'
import {HostBridge} from '@/components/host-bridge'
import {SettingsPageView} from '@/components/settings/settings-dialog'
import {SkillsPage} from '@/pages/skills'
import {HomePage} from '@/pages/home'
import {SessionPage} from '@/pages/session'
import {WorkspaceBackgroundPage, WorkspaceDirectoryPage, WorkspaceHomePage, WorkspaceLayout, WorkspaceSessionPage} from '@/pages/workspace'
import {WorkspaceKnowledgePage} from '@/components/workspace/knowledge-page'
import {RuntimeComponentsPage} from '@/components/settings/components-section'

const ComponentCatalog = import.meta.env.DEV
  ? lazy(() => import('@/components/dev/component-catalog').then(module => ({default: module.ComponentCatalog})))
  : null

const TITLES: Array<[RegExp, string]> = [
  [/^\/workspaces/, '工作区 · RayAgent'],
  [/^\/skills/, 'Skill · RayAgent'],
  [/^\/settings/, '设置 · RayAgent'],
  [/^\/dev\/components/, '组件状态目录 · RayAgent'],
]

function DocumentTitle() {
  const {pathname} = useLocation()
  useEffect(() => {
    document.title = TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? 'RayAgent'
  }, [pathname])
  return null
}

/** 业务页面都需要已就绪的核心；组件状态目录只用夹具，在核心门之外，普通浏览器也能打开。 */
function CoreApp() {
  return (
    <CoreGate>
      <HostBridge/>
      <Routes>
        <Route element={<AppShell><Outlet/></AppShell>}>
          <Route index element={<HomePage/>}/>
          <Route path="sessions" element={<Navigate to="/" replace/>}/>
          <Route path="sessions/:id" element={<SessionPage/>}/>
          <Route path="workspaces" element={<WorkspaceDirectoryPage/>}/>
          <Route path="workspaces/:id" element={<WorkspaceLayout/>}>
            <Route index element={<WorkspaceHomePage/>}/>
            <Route path="background" element={<WorkspaceBackgroundPage/>}/>
            <Route path="knowledge" element={<WorkspaceKnowledgePage/>}/>
            <Route path="sessions/:sid" element={<WorkspaceSessionPage/>}/>
          </Route>
          <Route path="skills" element={<SkillsPage/>}/>
          <Route path="components" element={<RuntimeComponentsPage/>}/>
          <Route path="settings" element={<SettingsPageView/>}/>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Route>
      </Routes>
    </CoreGate>
  )
}

export function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <BrowserRouter>
        <DocumentTitle/>
        <Routes>
          {ComponentCatalog && (
            <Route path="dev/components" element={
              <div className="h-full overflow-y-auto"><Suspense><ComponentCatalog/></Suspense></div>
            }/>
          )}
          <Route path="*" element={<CoreApp/>}/>
        </Routes>
      </BrowserRouter>
      <Toaster position="top-center" richColors/>
    </ThemeProvider>
  )
}

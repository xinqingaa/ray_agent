import {useEffect, useRef, useState, type ReactNode} from 'react'
import {toast} from 'sonner'
import {useDeveloperMode} from '@/hooks/use-developer-mode'
import type {HostPreferencesAccess} from '@/hooks/use-host-preferences'
import {configApi} from '@/lib/api/config'
import type {AgentConfig} from '@/lib/api/types'
import {errorMessage, SectionHeader} from './form'
import {HostPreferenceRows} from './host-preference-rows'
import {PreferenceReadError, PreferenceSwitch} from './preference-switch'
import {SettingsRow} from './settings-row'
import {VoiceSettings} from './voice-settings'

export type AgentPreferencesAccess = {
  load: () => Promise<AgentConfig>
  save: (config: AgentConfig) => Promise<AgentConfig>
}

const agentAccess = {load: configApi.getAgentConfig, save: configApi.updateAgentConfig}
const writes = new WeakMap<AgentPreferencesAccess, Promise<unknown>>()

function fromValues(standalone: boolean, base: AgentConfig): AgentConfig {
  return {...base, standalone_execution_enabled: standalone}
}

function StandaloneExecutionRow({access}: {access: AgentPreferencesAccess}) {
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [pending, setPending] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const inFlight = useRef(false)

  useEffect(() => {
    let active = true
    void Promise.resolve(writes.get(access)).then(() => access.load()).then(
      value => {if (active) setConfig(value)},
      reason => {if (active) setError(errorMessage(reason, '无法读取本机执行偏好'))},
    )
    return () => {active = false}
  }, [access, attempt])

  const update = async (checked: boolean) => {
    if (!config || inFlight.current) return
    inFlight.current = true
    setPending(checked)
    setError(null)
    const request = Promise.resolve(writes.get(access)).then(() => access.save(fromValues(checked, config)))
    writes.set(access, request.catch(() => {}))
    try {
      setConfig(await request)
    } catch (reason) {
      setError(errorMessage(reason, '无法保存本机执行偏好'))
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  const retry = () => {setError(null); setAttempt(count => count + 1)}
  const checked = pending ?? (config ? config.standalone_execution_enabled === true : null)
  const id = 'standalone-execution'
  return <SettingsRow id={id} htmlFor={id + '-switch'}
    title="独立对话本机执行" description="允许独立对话在自己的工作目录中使用 Shell 和脚本。"
    error={error && (config ? error : <PreferenceReadError message={error} onRetry={retry}/>)}
    control={<PreferenceSwitch id={id} checked={checked} pending={pending !== null} loading={!config && !error}
      onChange={value => void update(value)}/>}/>
}

function GeneralGroup({title, id, children}: {title: string; id: string; children: ReactNode}) {
  return <section aria-labelledby={id}>
    <h3 id={id} className="border-b border-border/70 pb-2 text-sm font-semibold">{title}</h3>
    <div className="divide-y divide-border/70">{children}</div>
  </section>
}

export function GeneralSection({hasUnsavedChanges, agent = agentAccess, host, voice = <VoiceSettings/>}: {
  hasUnsavedChanges: boolean
  agent?: AgentPreferencesAccess
  host?: HostPreferencesAccess
  voice?: ReactNode
}) {
  const {enabled, setEnabled} = useDeveloperMode()
  const changeDeveloperMode = (next: boolean) => {
    if (!next && hasUnsavedChanges) {
      toast.warning('请先保存或撤销设置修改，再关闭开发者模式。')
      return
    }
    setEnabled(next)
  }
  return <section aria-labelledby="settings-general-title">
    <SectionHeader id="settings-general-title" title="通用"/>
    <div className="space-y-5">
      <GeneralGroup title="对话" id="settings-general-conversation">
        <StandaloneExecutionRow access={agent}/>
        {voice}
      </GeneralGroup>
      <GeneralGroup title="通知" id="settings-general-notifications">
        <HostPreferenceRows access={host}/>
      </GeneralGroup>
      <GeneralGroup title="高级" id="settings-general-advanced">
        <SettingsRow id="developer-mode" htmlFor="developer-mode-switch" title="开发者模式"
          description="在会话中显示日志、终端、上下文容量与请求原文。"
          control={<PreferenceSwitch id="developer-mode" checked={enabled} onChange={changeDeveloperMode}/>}/>
      </GeneralGroup>
    </div>
  </section>
}

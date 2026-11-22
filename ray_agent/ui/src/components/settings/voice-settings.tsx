import {useState, type ReactNode} from 'react'
import {Button} from '@/components/ui/button'
import {Collapsible, CollapsibleContent} from '@/components/ui/collapsible'
import {Select} from '@/components/ui/select'
import {useVoiceModel, VoiceModelStatus} from '@/components/voice-model-status'
import {reloadUsagePreferences, setUsagePreferences, useUsagePreferences} from '@/hooks/use-usage-preferences'
import {useVoiceService, type VoiceServiceStatus} from '@/hooks/use-voice-service'
import type {UsagePreferences} from '@/lib/api/usage'
import {openSettingsSection} from '@/lib/settings-navigation'
import {VOICE_OPTIONS} from '@/lib/voice-options'
import {errorMessage} from './form'
import {SettingsRow, SettingsSegment} from './settings-row'

type VoicePreference = NonNullable<UsagePreferences['voice']>
type VoiceCategory = 'off' | 'local' | 'remote'

const CATEGORIES = [
  {value: 'off', label: '关闭'},
  {value: 'local', label: VOICE_OPTIONS.local.label},
  {value: 'remote', label: '远程'},
] as const
const REMOTE_SERVICES = [{id: 'deepseek', label: VOICE_OPTIONS.deepseek.label}]
const openProviders = () => openSettingsSection('llm')

function RemoteVoiceRow({status, disabled, onSelect, onConfigure}: {
  status: VoiceServiceStatus
  disabled?: boolean
  onSelect: () => void
  onConfigure: () => void
}) {
  return <SettingsRow id="voice-remote-service" htmlFor="voice-remote-select" title="远程服务" className="py-2.5"
    description={VOICE_OPTIONS.deepseek.description}
    control={<div className="flex flex-wrap items-center gap-2">
      <Select id="voice-remote-select" label="远程服务" value="deepseek" options={REMOTE_SERVICES}
        className="mt-0 w-28" disabled={disabled} onChange={onSelect}/>
      {status.phase === 'loading' && <span role="status" className="text-meta text-muted-foreground">正在读取连接…</span>}
      {status.phase === 'ready' && <span role="status" className="text-meta text-state-success">已配置</span>}
      {status.phase === 'unconfigured' && <span role="status" className="text-meta text-muted-foreground">未配置</span>}
      {status.phase === 'error' && <span role="status" title={status.message} className="text-meta text-state-failed">连接状态读取失败</span>}
      {(status.phase === 'unconfigured' || status.phase === 'error') &&
        <Button type="button" size="xs" variant="outline" onClick={onConfigure}>前往模型提供商</Button>}
    </div>}/>
}

export function VoiceSettingRow({voice, disabled, error, retry, localModel, remote, onChange, onConfigure = openProviders}: {
  voice: VoicePreference | null
  disabled?: boolean
  error?: string | null
  retry?: () => void
  localModel?: ReactNode
  remote: VoiceServiceStatus
  onChange: (next: VoicePreference) => void
  onConfigure?: () => void
}) {
  const category: VoiceCategory | null = voice === 'deepseek' ? 'remote' : voice
  return <div>
    <SettingsRow id="voice-provider" title="语音转文字" error={error}
      control={retry
        ? <Button type="button" variant="outline" size="sm" onClick={retry}>重试</Button>
        : <SettingsSegment<VoiceCategory> label="语音转文字" value={category} options={CATEGORIES}
          onChange={next => onChange(next === 'remote' ? 'deepseek' : next)} disabled={disabled}/>}/>
    <Collapsible open={category === 'local'}>
      <CollapsibleContent className="rounded-lg bg-muted px-3">
        <SettingsRow id="voice-local-model" title="本地模型" description={VOICE_OPTIONS.local.description} className="py-2.5"
          control={<div className="text-meta text-muted-foreground">{localModel}</div>}/>
      </CollapsibleContent>
    </Collapsible>
    <Collapsible open={category === 'remote'}>
      <CollapsibleContent className="rounded-lg bg-muted px-3">
        <RemoteVoiceRow status={remote} disabled={disabled} onSelect={() => onChange('deepseek')} onConfigure={onConfigure}/>
      </CollapsibleContent>
    </Collapsible>
  </div>
}

export function VoiceSettings() {
  const {value, error: loadError} = useUsagePreferences()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const voice = value?.voice ?? null
  const model = useVoiceModel(voice === 'local', true)
  const remote = useVoiceService(voice === 'deepseek')
  const change = async (next: VoicePreference) => {
    if (voice === next || !value || busy) return
    setBusy(true)
    setError(null)
    try {await setUsagePreferences({voice: next})}
    catch (reason) {setError(errorMessage(reason, '保存失败'))}
    finally {setBusy(false)}
  }
  return <VoiceSettingRow voice={voice} disabled={!value || busy} error={error || loadError} remote={remote}
    retry={loadError && !value ? () => void reloadUsagePreferences() : undefined}
    localModel={<VoiceModelStatus model={model}/>}
    onChange={next => void change(next)}/>
}

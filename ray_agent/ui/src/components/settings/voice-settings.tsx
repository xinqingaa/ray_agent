import {useState} from 'react'
import {Button} from '@/components/ui/button'
import {useVoiceModel, VoiceModelStatus} from '@/components/voice-model-status'
import {reloadUsagePreferences, setUsagePreferences, useUsagePreferences} from '@/hooks/use-usage-preferences'
import type {UsagePreferences} from '@/lib/api/usage'
import {VOICE_OPTIONS} from '@/lib/voice-options'
import {errorMessage} from './form'
import {SettingsRow, SettingsSegment} from './settings-row'

export function VoiceSettings() {
  const {value, error: loadError} = useUsagePreferences()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const voice = value ? value.voice ?? null : null
  const model = useVoiceModel(voice === 'local', true)
  const change = async (next: NonNullable<UsagePreferences['voice']>) => {
    if (voice === next || !value || busy) return
    setBusy(true)
    setError(null)
    try {await setUsagePreferences({voice: next})}
    catch (reason) {setError(errorMessage(reason, '保存失败'))}
    finally {setBusy(false)}
  }
  const failure = error || loadError
  return <SettingsRow
    id="voice-provider"
    title="语音转文字"
    description={<div className="space-y-1">
      <p>文字填入输入框，发送前可以修改。</p>
      <p><span className="font-medium">{VOICE_OPTIONS.local.label}</span> · {VOICE_OPTIONS.local.description}</p>
      {voice === 'local' && <VoiceModelStatus model={model}/>}
      <p><span className="font-medium">{VOICE_OPTIONS.deepseek.label}</span> · {VOICE_OPTIONS.deepseek.description}</p>
      <p>关闭后隐藏输入框的麦克风。</p>
    </div>}
    error={failure}
    control={loadError && !value
      ? <Button type="button" variant="outline" size="sm" onClick={() => void reloadUsagePreferences()}>重试</Button>
      : <SettingsSegment
        label="语音转文字"
        value={voice}
        options={[{value: 'local', label: VOICE_OPTIONS.local.label}, {value: 'deepseek', label: VOICE_OPTIONS.deepseek.label},
          {value: 'off', label: '关闭'}]}
        onChange={next => void change(next)}
        disabled={!value || busy}
      />}
  />
}

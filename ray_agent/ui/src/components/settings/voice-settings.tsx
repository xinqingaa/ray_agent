import {useState} from 'react'
import {Button} from '@/components/ui/button'
import {reloadUsagePreferences, setUsagePreferences, useUsagePreferences} from '@/hooks/use-usage-preferences'
import {errorMessage} from './form'
import {SettingsRow, SettingsSegment} from './settings-row'

const DESCRIPTION = {
  unset: '默认在输入框显示麦克风，首次使用时确认。',
  deepseek: '录音在点完成后发送给 DeepSeek 转写，按时长计费，计入用量。',
  off: '输入框不显示麦克风。',
} as const

/** 语音转文字偏好：未选择（null）时两项都不选中，输入框仍显示麦克风。 */
export function VoiceSettings() {
  const {value, error: loadError} = useUsagePreferences()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const voice = value ? value.voice ?? null : null
  const change = async (next: 'deepseek' | 'off') => {
    if (voice === next || !value || busy) return
    setBusy(true)
    setError(null)
    try {await setUsagePreferences({voice: next})}
    catch (reason) {setError(errorMessage(reason, '保存失败'))}
    finally {setBusy(false)}
  }
  const description = voice == null ? DESCRIPTION.unset : DESCRIPTION[voice]
  const failure = error || loadError
  return <SettingsRow
    id="voice-provider"
    title="语音转文字"
    description={<>文字填入输入框，发送前可以修改。{description}</>}
    error={failure}
    control={loadError && !value
      ? <Button type="button" variant="outline" size="sm" onClick={() => void reloadUsagePreferences()}>重试</Button>
      : <SettingsSegment
        label="语音转文字"
        value={voice}
        options={[{value: 'deepseek', label: 'DeepSeek'}, {value: 'off', label: '关闭'}]}
        onChange={next => void change(next)}
        disabled={!value || busy}
      />}
  />
}

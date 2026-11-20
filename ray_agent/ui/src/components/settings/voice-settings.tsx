import {useState} from 'react'
import {Button} from '@/components/ui/button'
import {VendorIcon} from '@/components/vendor-icon'
import {reloadUsagePreferences, setUsagePreferences, useUsagePreferences} from '@/hooks/use-usage-preferences'
import {errorMessage} from './form'
import './model-connections.css'

export function VoiceSettings() {
  const {value, error: loadError} = useUsagePreferences()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const voice = value?.voice ?? 'off'
  const change = async (next: 'deepseek' | 'off') => {
    if (voice === next || !value || busy) return
    setBusy(true)
    setError(null)
    try {await setUsagePreferences({voice: next})}
    catch (reason) {setError(errorMessage(reason, '保存失败'))}
    finally {setBusy(false)}
  }
  return <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-5">
    <div>
      <h3 id="voice-provider" className="text-sm font-medium">语音转文字</h3>
      <p id="voice-provider-hint" className="mt-1 text-xs text-muted-foreground">
        {voice === 'deepseek' ? '点「完成」后将录音发送给 DeepSeek，按时长计费。' : '可启用 DeepSeek，在对话输入框中录音并转写。'}
      </p>
      {(error || loadError) && <p role="alert" className="mt-1 text-xs text-state-failed">{error || loadError}</p>}
    </div>
    {loadError && !value ? <Button type="button" variant="outline" size="sm" onClick={() => void reloadUsagePreferences()}>重试</Button> :
      <div className="provider-segment" role="group" aria-labelledby="voice-provider" aria-describedby="voice-provider-hint">
        <button type="button" aria-pressed={voice === 'deepseek'} disabled={!value || busy} onClick={() => void change('deepseek')}>
          <VendorIcon vendor="deepseek"/>DeepSeek
        </button>
        <button type="button" aria-pressed={voice === 'off'} disabled={!value || busy} onClick={() => void change('off')}>关闭</button>
      </div>}
  </div>
}

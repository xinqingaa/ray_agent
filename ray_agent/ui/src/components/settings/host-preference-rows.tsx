import {useState} from 'react'
import {Switch} from '@/components/ui/switch'
import {useHostPreferences} from '@/hooks/use-host-preferences'
import type {HostPreferences} from '@/lib/platform'
import {SettingsRow} from './settings-row'

type Key = keyof HostPreferences

/**
 * 桌面宿主偏好：任务完成通知、退出前确认。开关即时写回宿主，不经过底部保存条；
 * 写入失败时开关保持原值（偏好只在宿主确认后更新），并在所在行显示原因。
 */
export function HostPreferenceRows() {
  const {preferences, available, error, update} = useHostPreferences()
  const [pending, setPending] = useState<Key | null>(null)
  const [lastKey, setLastKey] = useState<Key | null>(null)
  // 读取失败时两行都提示；写入失败只在刚操作的那一行提示。
  const errorFor = (key: Key) => (error && (lastKey === key || (available && preferences == null)) ? error : null)
  const toggle = async (key: Key, checked: boolean) => {
    setPending(key)
    setLastKey(key)
    await update({[key]: checked})
    setPending(null)
  }
  const disabled = !available || preferences == null || pending !== null
  const unavailable = !available && <span className="block">需要在 RayAgent 桌面应用中设置。</span>

  return (
    <>
      <SettingsRow
        id="host-notify-on-finish"
        htmlFor="host-notify-on-finish-switch"
        title="任务完成时通知"
        description={<>
          你不在这个对话时，用系统通知告诉你结果。任务完成或需要你处理时发出。
          {available && <span className="block">若没有收到通知，请到系统设置的「通知」中检查 RayAgent。</span>}
          {unavailable}
        </>}
        error={errorFor('notifyOnFinish')}
        control={
          <Switch
            id="host-notify-on-finish-switch"
            aria-labelledby="host-notify-on-finish-title"
            checked={preferences?.notifyOnFinish ?? false}
            disabled={disabled}
            onCheckedChange={checked => void toggle('notifyOnFinish', checked)}
          />
        }
      />
      <SettingsRow
        id="host-confirm-before-quit"
        htmlFor="host-confirm-before-quit-switch"
        title="退出前确认"
        description={<>
          有任务在运行时，退出应用前先确认。通过 ⌘Q 或菜单退出时生效；关闭窗口只会隐藏应用。
          {unavailable}
        </>}
        error={errorFor('confirmBeforeQuit')}
        control={
          <Switch
            id="host-confirm-before-quit-switch"
            aria-labelledby="host-confirm-before-quit-title"
            checked={preferences?.confirmBeforeQuit ?? false}
            disabled={disabled}
            onCheckedChange={checked => void toggle('confirmBeforeQuit', checked)}
          />
        }
      />
    </>
  )
}

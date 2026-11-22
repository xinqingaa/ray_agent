import {useHostPreferences, type HostPreferencesAccess} from '@/hooks/use-host-preferences'
import {PreferenceReadError, PreferenceSwitch} from './preference-switch'
import {SettingsRow} from './settings-row'

const ROWS = [
  {key: 'notifyOnFinish', id: 'host-notify-on-finish', title: '任务完成时通知', description: '你未在查看该对话时，通过系统通知告知任务结果或需要你处理的事项。'},
  {key: 'confirmBeforeQuit', id: 'host-confirm-before-quit', title: '退出前确认', description: '使用 ⌘Q 或菜单退出时，若还有任务在运行，先向你确认。'},
] as const

export function HostPreferenceRows({access}: {access?: HostPreferencesAccess}) {
  const {preferences, available, loadError, errors, pending, reload, update} = useHostPreferences(access)
  return ROWS.map(({key, id, title, description}, index) => <SettingsRow key={key}
    id={id}
    htmlFor={id + '-switch'}
    title={title}
    description={available ? description : '需要在 RayAgent 桌面应用中设置。'}
    error={errors[key] ?? (loadError && index === 0 ? <PreferenceReadError message={loadError} onRetry={reload}/> : null)}
    control={<PreferenceSwitch id={id} checked={pending[key] ?? preferences?.[key] ?? null}
      loading={available && !preferences && !loadError} pending={pending[key] !== undefined}
      onChange={checked => void update(key, checked)}/>}
  />)
}

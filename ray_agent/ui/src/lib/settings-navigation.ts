/** 设置页分区键，与 settings-view 的分区一一对应。 */
export type SettingsSectionKey = 'general' | 'workspace' | 'appearance' | 'llm' | 'usage' | 'tool-policy' | 'mcp' | 'a2a' | 'data'

export const OPEN_SETTINGS_EVENT = 'rayagent:open-settings'

export function isSettingsPath(pathname: string) {
  return /^\/settings\/?$/.test(pathname)
}

export function settingsHref(section: SettingsSectionKey = 'general') {
  return `/settings?${new URLSearchParams({section})}`
}

export function settingsEntry(location: {pathname: string; search: string; hash: string; state: unknown}) {
  return {settingsSource: {href: location.pathname + location.search + location.hash, state: location.state}}
}

export function settingsSource(state: unknown) {
  if (!state || typeof state !== 'object' || !('settingsSource' in state)) return null
  const source = state.settingsSource
  if (!source || typeof source !== 'object' || !('href' in source) || !('state' in source)) return null
  if (typeof source.href !== 'string' || !/^\/(?!\/)[^\\]*$/.test(source.href)) return null
  const pathname = source.href.split(/[?#]/, 1)[0]
  if (isSettingsPath(pathname)) return null
  return {href: source.href, pathname, state: source.state}
}

export function openSettingsSection(section?: SettingsSectionKey) {
  window.dispatchEvent(new CustomEvent<{section?: SettingsSectionKey}>(OPEN_SETTINGS_EVENT, {detail: {section}}))
}

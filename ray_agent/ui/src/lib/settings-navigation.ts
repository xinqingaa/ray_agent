/** 设置页分区键，与 settings-view 的分区一一对应。 */
export type SettingsSectionKey = 'general' | 'workspace' | 'appearance' | 'llm' | 'usage' | 'tool-policy' | 'mcp' | 'a2a' | 'data'

export const OPEN_SETTINGS_EVENT = 'rayagent:open-settings'

/**
 * 在覆盖应用的设置弹层中打开指定分区。外壳里的设置入口负责接收；
 * 设置页没有挂载时（例如直接访问 /settings）事件无人处理，调用方应只在会话界面使用。
 */
export function openSettingsSection(section?: SettingsSectionKey) {
  window.dispatchEvent(new CustomEvent<{section?: SettingsSectionKey}>(OPEN_SETTINGS_EVENT, {detail: {section}}))
}

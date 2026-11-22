import type {AgentPreferencesAccess} from '@/components/settings/general-section'
import type {HostPreferencesAccess} from '@/hooks/use-host-preferences'
import type {AgentConfig} from '@/lib/api/types'

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function createGeneralSettingsFixture() {
  let config: AgentConfig = {max_iterations: 42, max_retries: 4, max_search_results: 7, standalone_execution_enabled: false}
  let preferences = {notifyOnFinish: true, confirmBeforeQuit: true}
  let failNextAgentSave = true

  const agent: AgentPreferencesAccess = {
    load: async () => {await delay(900); return config},
    save: async next => {
      await delay(700)
      if (next.max_iterations !== config.max_iterations || next.max_retries !== config.max_retries ||
          next.max_search_results !== config.max_search_results) throw new Error('其余配置的原值未透传。')
      if (failNextAgentSave) {
        failNextAgentSave = false
        throw new Error('无法保存本机执行偏好，请重试。')
      }
      config = next
      return config
    },
  }

  const host: HostPreferencesAccess = {
    available: () => true,
    load: async () => {await delay(900); return preferences},
    save: async patch => {
      await delay(700)
      preferences = {...preferences, ...patch}
      return preferences
    },
  }
  return {agent, host}
}

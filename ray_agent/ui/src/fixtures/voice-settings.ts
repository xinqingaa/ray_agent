import type {useVoiceModel} from '@/components/voice-model-status'
import type {ComponentView} from '@/lib/api/components'
import {VOICE_COMPONENT_ID} from '@/lib/voice-options'

export function voiceModelFixture(state: ComponentView['state']): ReturnType<typeof useVoiceModel> {
  const item: ComponentView = {
    component_id: VOICE_COMPONENT_ID,
    state,
    target_version: 'whisper-small-q5_1',
    update_available: false,
    platform: 'macos-arm64',
    size: 190085487,
  }
  return {item, items: [item], busy: null, error: null, refresh() {}, act: async () => {}}
}

export const voiceLevelsFixture = [0.08, 0.26, 0.57, 0.36, 0.75, 0.98, 0.42, 0.59, 0.38, 0.77, 0.35, 0.12]

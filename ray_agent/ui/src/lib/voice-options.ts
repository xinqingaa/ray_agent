export const VOICE_COMPONENT_ID = 'whisper-asr'

export const VOICE_OPTIONS = {
  local: {
    label: '本地',
    description: '免费离线转写普通话和英语，录音留在设备上。',
  },
  deepseek: {
    label: 'DeepSeek',
    description: '支持普通话、粤语和英语等语言，录音会上传至 DeepSeek，按时长计费。',
  },
} as const

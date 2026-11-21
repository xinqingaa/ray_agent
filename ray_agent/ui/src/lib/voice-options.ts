export const VOICE_COMPONENT_ID = 'whisper-asr'

export const VOICE_OPTIONS = {
  local: {
    label: '本机',
    description: '识别普通话和英语，免费，录音留在设备上。首次需下载模型，之后可离线使用。模型占用磁盘，转写时使用本机内存。',
  },
  deepseek: {
    label: 'DeepSeek 云端',
    description: '支持普通话、粤语、英语等更多语言。点完成后联网上传录音，按时长计费。本机无需加载识别模型。',
  },
} as const

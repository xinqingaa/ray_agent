import type {ProviderProbe} from '@/lib/api/model-connections'

export type Kind = NonNullable<ProviderProbe['kind']>
export type Protocol = ProviderProbe['protocol']

/** 提供商类型的连接预设：名称、默认地址与协议。模型能力与单价不在这里，来自内置目录。 */
export const presets = {
  deepseek: {label: 'DeepSeek', address: 'https://api.deepseek.com', protocol: 'responses'},
  openai: {label: 'OpenAI', address: 'https://api.openai.com/v1', protocol: 'responses'},
  compatible: {label: 'OpenAI 兼容', address: '', protocol: 'chat_completions'},
} satisfies Record<Kind, {label: string; address: string; protocol: Protocol}>

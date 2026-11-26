export const OPENAI_LONG_CONTEXT_THRESHOLD = 272_000

const SUPPRESS_WARNING_KEY = 'rayagent:suppress-openai-long-context-warning'

export function isOpenAiCatalogModel(model: {id?: string; vendor?: string} | null | undefined): boolean {
  return Boolean(model && (model.vendor === 'openai' || /^gpt-/i.test(model.id ?? '')))
}

export function isOpenAiLongContextWarningSuppressed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SUPPRESS_WARNING_KEY) === 'true'
  } catch {
    return false
  }
}

export function suppressOpenAiLongContextWarning(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SUPPRESS_WARNING_KEY, 'true')
  } catch {
    // 忽略本地存储不可用场景，仍允许当前流程继续切换
  }
}

export function resetOpenAiLongContextWarning(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(SUPPRESS_WARNING_KEY)
  } catch {
    // ignore
  }
}

export function shouldWarnOpenAiLongContext(params: {
  fromModelId?: string | null
  toModel?: {id?: string; vendor?: string} | null
  contextTokens?: number | null
  suppressed?: boolean
}): boolean {
  const {fromModelId, toModel, contextTokens, suppressed = false} = params
  if (suppressed) return false
  if (contextTokens == null || contextTokens <= OPENAI_LONG_CONTEXT_THRESHOLD) return false
  if (!isOpenAiCatalogModel(toModel) || !toModel?.id) return false
  return toModel.id !== fromModelId
}

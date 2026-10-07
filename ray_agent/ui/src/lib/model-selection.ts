import type {ModelCatalog} from '@/lib/api/types'
export type CatalogModel = ModelCatalog['models'][number]
export type ModelSelection = {model: string; reasoning: string}
export const thinkingOptions = (model: CatalogModel) => model.reasoning_options.filter(option => option.enabled)
export function selectModel(previous: ModelSelection, source: CatalogModel | undefined, target: CatalogModel): ModelSelection {
  const compatible = source?.reasoning_family != null && source.reasoning_family === target.reasoning_family && target.choices.includes(previous.reasoning)
  return {model: target.id, reasoning: compatible ? previous.reasoning : target.default_choice}
}

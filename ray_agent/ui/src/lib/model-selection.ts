import type {ModelCatalog} from '@/lib/api/types'
export type CatalogModel = ModelCatalog['models'][number]
export type ModelSelection = {model: string; reasoning: string}
export type VendorId = string

export const thinkingOptions = (model: CatalogModel) => model.reasoning_options.filter(option => option.enabled)

export function selectModel(previous: ModelSelection, source: CatalogModel | undefined, target: CatalogModel): ModelSelection {
  const compatible = source?.reasoning_family != null && source.reasoning_family === target.reasoning_family && target.choices.includes(previous.reasoning)
  return {model: target.id, reasoning: compatible ? previous.reasoning : target.default_choice}
}

export function vendorOf(modelId: string, models: CatalogModel[]): VendorId | null {
  return models.find(model => model.id === modelId)?.vendor ?? null
}

export function vendorTabs(models: CatalogModel[]): {id: VendorId; label: string}[] {
  const vendors = new Map<string, string>()
  for (const model of models) vendors.set(model.vendor, model.vendor_label)
  return [...vendors].map(([id, label]) => ({id, label}))
}

export function modelsForVendor(models: CatalogModel[], vendor: VendorId): CatalogModel[] {
  return models.filter(model => model.vendor === vendor)
}

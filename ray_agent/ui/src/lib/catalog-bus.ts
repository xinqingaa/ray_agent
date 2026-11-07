export type CatalogHint = {kind: 'session'; id: string}

type Listener = (hint: CatalogHint) => void

const listeners = new Set<Listener>()

export function emitCatalog(hint: CatalogHint) {
  for (const listener of listeners) listener(hint)
}

export function subscribeCatalog(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

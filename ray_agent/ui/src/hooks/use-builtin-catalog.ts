import {useEffect, useState} from 'react'
import {modelConnectionsApi, type CatalogModel} from '@/lib/api/model-connections'

type CatalogState = {models: CatalogModel[] | null; error: string | null}

/** 读取内置模型目录；能力与单价只以它为准。models 为 null 表示尚未读取成功，retry 在失败后重新读取。 */
export function useBuiltinCatalog(load: () => Promise<{models?: CatalogModel[]}> = modelConnectionsApi.catalog): CatalogState & {retry: () => void} {
  const [state, setState] = useState<CatalogState>({models: null, error: null})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setState(previous => previous.error ? {models: null, error: null} : previous)
    load().then(
      result => {if (current) setState({models: result.models ?? [], error: null})},
      (reason: unknown) => {
        if (current) setState({models: null, error: reason instanceof Error ? reason.message : '内置目录读取失败'})
      },
    )
    return () => {current = false}
  }, [load, attempt])
  return {...state, retry: () => setAttempt(value => value + 1)}
}

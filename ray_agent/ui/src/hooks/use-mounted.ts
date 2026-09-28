import {useSyncExternalStore} from 'react'

const subscribe = () => () => {}

/** 服务端渲染与首次水合时为 false，客户端挂载后为 true；用于只能在浏览器确定的内容 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false)
}

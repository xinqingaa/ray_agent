import type {Metadata} from 'next'
import {notFound} from 'next/navigation'
import {ComponentCatalog} from '@/components/dev/component-catalog'

export const metadata: Metadata = {
  title: '组件状态目录 · RayAgent',
}

/** 组件状态目录：只在开发模式可访问，生产构建返回 404 */
export default function ComponentCatalogPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <ComponentCatalog/>
}

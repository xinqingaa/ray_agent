'use client'

import {use, useEffect} from 'react'
import {SessionDetailView} from '@/components/session-detail-view'

/** 初始消息由发起页受理；进入或刷新只读详情，不自动发消息。 */
export default function SessionDetailPage({params}: {params: Promise<{id: string}>}) {
  const {id} = use(params)
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('init')) {
      url.searchParams.delete('init')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    }
  }, [id])
  return <SessionDetailView key={id} sessionId={id}/>
}

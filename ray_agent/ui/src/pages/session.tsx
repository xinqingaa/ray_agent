import {SessionDetailView} from '@/components/session-detail-view'
import {useParams} from '@/lib/navigation'

/** 初始消息由发起页受理；进入或刷新只读详情，不自动发消息。 */
export function SessionPage() {
  const {id = ''} = useParams()
  return <SessionDetailView key={id} sessionId={id}/>
}

import {SessionDetailView} from '@/components/session-detail-view'
import {useTaskInspector} from '@/components/task-layout'
import {useCanonicalSessionRoute} from '@/hooks/use-canonical-session-route'
import {useParams} from '@/lib/navigation'

/** 初始消息由发起页受理；进入或刷新只读详情，不自动发消息。 */
export function SessionPage() {
  const {id = ''} = useParams()
  useCanonicalSessionRoute(id, null)
  return <IndependentSession key={id} sessionId={id}/>
}

function IndependentSession({sessionId}: {sessionId: string}) {
  const inspector = useTaskInspector(false)
  return <SessionDetailView sessionId={sessionId} inspector={inspector}/>
}

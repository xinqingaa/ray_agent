import {Info} from 'lucide-react'
import {SectionHeader} from './form'

/** 工具审批策略分区的位置；内容与接口由 W7.2 实现 */
export function ToolPolicySection() {
  return (
    <section aria-labelledby="settings-tool-policy-title">
      <SectionHeader
        id="settings-tool-policy-title"
        title="工具策略"
        description="按工具来源设置执行前是否需要你批准。"
      />
      <div className="py-5">
        <p className="flex max-w-prose gap-2.5 rounded-lg border border-dashed px-4 py-3.5 text-meta text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden/>
          <span>
            工具审批策略尚未实现，当前所有工具调用都会直接执行。实现后可以在这里为内置、MCP 与 A2A 工具分别选择“直接执行”或“执行前询问”。
          </span>
        </p>
      </div>
    </section>
  )
}

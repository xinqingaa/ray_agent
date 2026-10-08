import {cn} from '@/lib/utils'

/** 一笔路径形成 R：闭合的执行回路向右下延伸为下一步。 */
export function BrandMark({className}: {className?: string}) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('size-6 shrink-0', className)} aria-hidden="true">
      <path
        d="M8 24.75V7.25h9a5.5 5.5 0 0 1 0 11H8"
        stroke="currentColor"
        strokeWidth="3.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m16.5 18.25 7.5 6.5"
        className="text-signal"
        stroke="currentColor"
        strokeWidth="3.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

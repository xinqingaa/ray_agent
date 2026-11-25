import {useLayoutEffect, useState, type RefObject} from 'react'
import {cn} from '@/lib/utils'

export type SegmentThumbRect = {left: number; top: number; width: number; height: number}

const SELECTED = ':scope > [aria-checked="true"], :scope > [aria-selected="true"], :scope > [aria-current="page"]'

function sameRect(a: SegmentThumbRect | null, b: SegmentThumbRect | null) {
  if (a === b) return true
  if (!a || !b) return false
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

/**
 * 图标展开型分段（如右侧工作台与顶栏视图切换）在切换瞬间预计算稳态几何：
 * 通过减去当前正在过渡的标签盒宽、再按选中态加上稳态 scrollWidth，
 * 避免 ResizeObserver 在标签展开的每一帧都重启滑块 CSS 过渡。
 */
function measureSteadyRect(root: HTMLElement, selected: HTMLElement): SegmentThumbRect {
  const items = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.getAttribute('aria-hidden') !== 'true',
  )
  const labelTextWidth = (label: HTMLElement) => {
    const inner = label.firstElementChild instanceof HTMLElement ? label.firstElementChild : null
    return Math.max(label.scrollWidth, inner?.scrollWidth ?? 0)
  }

  const hasExpandingLabels = items.some(item => {
    const label = item.querySelector<HTMLElement>('[data-segment-label]')
    return Boolean(label && labelTextWidth(label) > 0)
  })
  if (!hasExpandingLabels) {
    return {left: selected.offsetLeft, top: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight}
  }

  const rootStyle = window.getComputedStyle(root)
  const gap = Number.parseFloat(rootStyle.columnGap || rootStyle.gap || '0') || 0
  const labelGap = Number.parseFloat(root.dataset.segmentLabelGap ?? '6') || 6

  const steadyWidth = (item: HTMLElement, isSelected: boolean) => {
    const label = item.querySelector<HTMLElement>('[data-segment-label]')
    if (!label) return item.offsetWidth
    const labelStyle = window.getComputedStyle(label)
    const currentMargin = (Number.parseFloat(labelStyle.marginLeft || '0') || 0)
      + (Number.parseFloat(labelStyle.marginRight || '0') || 0)
    const baseWidth = Math.max(0, item.offsetWidth - label.offsetWidth - currentMargin)
    return Math.round(isSelected ? baseWidth + labelTextWidth(label) + labelGap : baseWidth)
  }

  const first = items[0]
  let left = first ? first.offsetLeft : selected.offsetLeft
  for (const item of items) {
    if (item === selected) {
      return {
        left: Math.round(left),
        top: selected.offsetTop,
        width: steadyWidth(item, true),
        height: selected.offsetHeight,
      }
    }
    left += steadyWidth(item, false) + gap
  }
  return {left: selected.offsetLeft, top: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight}
}

/**
 * 分段控件滑块的位置：贴合当前选中项的实际偏移与尺寸（随字号、换行与内容变化重新测量），
 * 不假设等宽分栏。选中项用 aria-checked、aria-selected 或 aria-current="page" 标记；根节点需为定位上下文。
 */
export function useSegmentThumb(rootRef: RefObject<HTMLElement | null>, selectedKey: string | null, optionKeys: string): SegmentThumbRect | null {
  const [thumb, setThumb] = useState<SegmentThumbRect | null>(null)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const selected = root.querySelector<HTMLElement>(SELECTED)
      const next = selected ? measureSteadyRect(root, selected) : null
      setThumb(previous => (sameRect(previous, next) ? previous : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    Array.from(root.children).forEach(child => observer.observe(child))
    return () => observer.disconnect()
  }, [rootRef, selectedKey, optionKeys])
  return thumb
}

/**
 * 滑块本体：位置与尺寸用 transform 与 width/height 过渡，曲线与时长取动效 token；减少动态效果时直接跳到位。
 * 放在根节点的第一个子元素位置，层级在按钮之下。
 */
export function SegmentThumb({thumb, className}: {thumb: SegmentThumbRect | null; className?: string}) {
  if (!thumb) return null
  return <span aria-hidden="true" className={cn(
    'pointer-events-none absolute left-0 top-0 -z-10 transition-[transform,width,height] duration-(--motion-mid) ease-(--motion-ease) motion-reduce:transition-none',
    className,
  )} style={{transform: `translate(${thumb.left}px, ${thumb.top}px)`, width: thumb.width, height: thumb.height}}/>
}

'use client'
import {useEffect, useRef} from 'react'

/** 编辑视图关闭外，应用链接及离开页面同样保护草稿。 */
export function useUnsavedNavigation(isDirty: () => boolean, active = true) {
  const read = useRef(isDirty)
  useEffect(() => {
    read.current = isDirty
  }, [isDirty])
  useEffect(() => {
    if (!active) return
    const beforeUnload = (event:BeforeUnloadEvent) => {if(read.current()){event.preventDefault();event.returnValue=''}}
    const click = (event:MouseEvent) => {
      const link=(event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null
      if(!link || link.target==='_blank' || event.ctrlKey || event.metaKey || event.shiftKey || link.hasAttribute('download'))return
      const destination=new URL(link.href,location.href)
      if(destination.href===location.href || (destination.pathname===location.pathname && destination.search===location.search && destination.hash))return
      if(read.current() && !window.confirm('有未保存的修改，放弃修改并离开？')){event.preventDefault();event.stopPropagation()}
    }
    window.addEventListener('beforeunload',beforeUnload)
    document.addEventListener('click',click,true)
    return ()=>{window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('click',click,true)}
  },[active])
}

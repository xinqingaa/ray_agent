/**
 * 组件使用的导航接口；路由实现只在这里接入，检查脚本整体替换本模块即可。
 */
import {forwardRef, useMemo, type AnchorHTMLAttributes} from 'react'
import {Link as RouterLink, useLocation, useNavigate} from 'react-router'

export {useParams} from 'react-router'

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {href: string; replace?: boolean}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({href, ...props}, ref) {
  return <RouterLink ref={ref} to={href} {...props}/>
})

export function useRouter() {
  const navigate = useNavigate()
  return useMemo(() => ({
    push: (href: string) => {void navigate(href)},
    replace: (href: string) => {void navigate(href, {replace: true})},
    back: () => {void navigate(-1)},
  }), [navigate])
}

export function usePathname() {
  return useLocation().pathname
}

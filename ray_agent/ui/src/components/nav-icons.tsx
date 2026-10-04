/** 侧栏与顶栏用的线框图标。加号画在图形里面，不单独再放一个加号。 */

export function NewChatIcon({className}: {className?: string}) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M4.9 1.65h6.2a2.45 2.45 0 0 1 2.45 2.45v4.05a2.45 2.45 0 0 1-2.45 2.45H7.2L4.9 13.2 5.2 10.6H4.9a2.45 2.45 0 0 1-2.45-2.45V4.1a2.45 2.45 0 0 1 2.45-2.45Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M8 4.3v3.65M6.15 6.12h3.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

export function NewProjectIcon({className}: {className?: string}) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <path d="M1.7 4.15c0-.64.52-1.15 1.15-1.15h2.6l1.05 1.2h6.65c.63 0 1.15.52 1.15 1.15v5.45c0 .63-.52 1.15-1.15 1.15H2.85c-.63 0-1.15-.52-1.15-1.15V4.15Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/>
      <path d="M1.7 6.2h12.6" stroke="currentColor" strokeWidth="1.35"/>
      <circle cx="12.45" cy="12.15" r="3.35" className="fill-foreground"/>
      <path d="M12.45 10.55v3.2M10.85 12.15h3.2" fill="none" className="stroke-sidebar" strokeWidth="1.35" strokeLinecap="round"/>
    </svg>
  )
}

export function MemoryIcon({className}: {className?: string}) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <rect x="2.15" y="1.65" width="8.7" height="11.1" rx="1.2" stroke="currentColor" strokeWidth="1.35"/>
      <rect x="4.35" y="3.15" width="8.7" height="11.1" rx="1.2" className="fill-background" stroke="currentColor" strokeWidth="1.35"/>
      <path d="M6.7 8.15h4.15" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/>
    </svg>
  )
}

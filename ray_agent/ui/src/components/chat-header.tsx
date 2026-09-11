'use client'

import Link from 'next/link'

export function ChatHeader() {
  return (
    <header className="flex items-center w-full py-2 px-4 z-50">
      {/* Logo占位符 */}
      <Link href="/" className="block bg-white w-[80px] h-9 rounded-md"/>
    </header>
  )
}

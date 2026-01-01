'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  
  return (
    <div className="flex w-full h-full bg-[#040404]">
      {/* Settings Sidebar (二级导航) */}
      <aside className="w-[240px] border-r border-[#333] flex flex-col bg-[#040404] flex-shrink-0">
        <div className="h-[45px] flex items-center px-4 border-b border-[#333]">
          <span className="text-sm font-medium text-[#EDEDED]">Settings</span>
        </div>
        
        <div className="py-3 px-2">
          <div className="px-2 mb-2 text-xs font-semibold text-[#6D7177] uppercase tracking-wider">
            Workspace
          </div>
          
          <Link 
            href="/settings/connect"
            className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
              pathname?.startsWith('/settings/connect') 
                ? 'bg-[#2C2C2C] text-[#EDEDED]' 
                : 'text-[#9B9B9B] hover:bg-[#1A1A1A] hover:text-[#EDEDED]'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
               <path d="M12.25 7H1.75M7 1.75V12.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Import Settings</span>
          </Link>
        </div>
      </aside>

      {/* 右侧具体内容 */}
      <section className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {children}
      </section>
    </div>
  )
}


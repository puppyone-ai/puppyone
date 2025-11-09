'use client'

import { useAuth } from '../supabase/SupabaseAuthProvider'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { HeaderBar } from '../../components/HeaderBar'
import { ProjectGrid } from '../../components/ProjectGrid'
import { mockProjects } from '../../lib/mock'

export default function ProjectsPage() {
  const { session, isAuthReady } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isAuthReady && !session) router.replace('/login')
  }, [isAuthReady, session, router])

  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a', color: '#ddd' }}>
      {session && (
        <HeaderBar userAvatarUrl={(session.user as any)?.user_metadata?.avatar_url || (session.user as any)?.user_metadata?.picture} />
      )}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1f1f1f', background: '#0b0b0b', fontSize: 12, color: '#aaa' }}>
        All Projects
      </div>
      <ProjectGrid projects={mockProjects} />
    </main>
  )
}



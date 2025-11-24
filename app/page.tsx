'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function Page() {
  const router = useRouter()

  useEffect(() => {
      router.replace('/projects')
  }, [router])

  return (
    <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 16,
            letterSpacing: 1,
            color: '#d4d4d8',
          }}
        >
      Redirecting…
        </div>
  )
}
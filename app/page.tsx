'use client'
import { useRouter } from 'next/navigation'
import { useAuth } from './supabase/SupabaseAuthProvider'
import { useEffect } from 'react'

export default function Page() {
  const { session, userId, signOut, isAuthReady } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isAuthReady && !session) {
      router.replace('/login')
    }
    if (isAuthReady && session) {
      router.replace('/projects')
    }
  }, [isAuthReady, session, router])

  const sidebarItems = [
    { label: 'api_keys', access: 'Restricted' },
    { label: 'credit_balance', access: 'Unrestricted', isActive: true },
    { label: 'credit_ledger', access: 'Unrestricted' },
    { label: 'credit_usage_by_prefix', access: 'Unrestricted' },
    { label: 'messages' },
    { label: 'profiles' },
    { label: 'subscriptions' },
    { label: 'threads' },
  ]

  const columnHeaders = [
    { label: 'user_id', type: 'uuid' },
    { label: 'balance', type: 'int8', align: 'right' },
  ]

  const tableRows = [
    { userId: 'b0ff5b56-6888-478e-8645-70a1df6473d1', balance: '60078' },
    { userId: '12f5b8d8-4c76-4d60-a1ec-5c2d54b0dba1', balance: '92' },
    { userId: '07fbbf2a-1f20-4ba3-a1df-b822cf13f1b6', balance: '48' },
    { userId: '1e9e6dd0-3b8a-4c0d-95d5-fd008909a7c4', balance: '60' },
    { userId: 'a0f4c0c9-5e0b-4a05-b7d3-f8cd73096d73', balance: '40' },
    { userId: 'a5c7b658-5b1c-4a0e-b0c7-742e4bf5d4b0', balance: '100' },
    { userId: '0b9fc1f9-3b1e-4d9c-821c-734b6f2e1a5c', balance: '64' },
    { userId: 'c3b91998-67b9-4e0a-bd00-7b0f6940fbf1', balance: '79' },
    { userId: 'e4f9d6df-68e9-490f-9057-209d32fa3209', balance: '0' },
    { userId: 'f0f5d662-016c-42d8-929c-0c15f0d49b0d', balance: '94' },
  ]

  const overlayMessage = !isAuthReady ? 'Loading…' : session ? 'Redirecting…' : undefined

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#050505',
        color: '#f4f4f5',
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          height: 48,
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(180deg, #101214 0%, #090a0b 100%)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background:
                'radial-gradient(circle at top left, rgba(82,225,168,0.7), rgba(59,169,172,0.4), rgba(45,104,157,0.4))',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontSize: 14, color: '#fafafa' }}>PuppyPuppyHappyHappy</span>
            <span style={{ fontSize: 12, color: '#71717a' }}>deepwidenresearch</span>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              borderRadius: 6,
              backgroundColor: 'rgba(34,197,94,0.15)',
              color: '#86efac',
              fontSize: 11,
              fontWeight: 600,
              textTransform: 'uppercase',
            }}
          >
            <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22c55e' }} />
            Production
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            style={{
              height: 28,
              padding: '0 10px',
              borderRadius: 6,
              border: '1px solid rgba(148,163,184,0.3)',
              backgroundColor: 'transparent',
              color: '#e2e8f0',
              fontSize: 12,
              letterSpacing: 0.3,
            }}
          >
            Connect
          </button>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background:
                'radial-gradient(circle at 30% 30%, rgba(245,158,11,0.85), rgba(190,24,93,0.6), rgba(14,116,144,0.6))',
            }}
          />
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <aside
          style={{
            width: 240,
            backgroundColor: '#0d0f12',
            borderRight: '1px solid rgba(255,255,255,0.04)',
            padding: '16px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 11, letterSpacing: 1.1, color: '#71717a', textTransform: 'uppercase' }}>
            schema public
          </div>
          <button
            style={{
              height: 32,
              borderRadius: 6,
              border: '1px dashed rgba(148,163,184,0.4)',
              backgroundColor: 'transparent',
              color: '#94a3b8',
              fontSize: 12,
            }}
          >
            New table
          </button>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sidebarItems.map((item) => (
              <div
                key={item.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 8px',
                  borderRadius: 6,
                  backgroundColor: item.isActive ? 'rgba(82,82,91,0.18)' : 'transparent',
                  color: item.isActive ? '#f8fafc' : '#cbd5f5',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <span>{item.label}</span>
                {item.access && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 999,
                      backgroundColor:
                        item.access === 'Restricted' ? 'rgba(248,113,113,0.16)' : 'rgba(34,197,94,0.12)',
                      color: item.access === 'Restricted' ? '#f87171' : '#86efac',
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                    }}
                  >
                    {item.access}
                  </span>
                )}
              </div>
            ))}
          </div>
        </aside>

        <section style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#0a0c0f' }}>
          <div
            style={{
              padding: '12px 18px 0',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              backgroundColor: '#0e1014',
            }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              {['public.messages', 'public.api_keys', 'public.credit_balance', 'public.credit_ledger', 'public.threads', 'public.credit_usage_by_prefix', 'public.subscriptions'].map(
                (tab) => (
                  <div
                    key={tab}
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      borderRadius: 6,
                      backgroundColor:
                        tab === 'public.credit_balance' ? 'rgba(12,200,151,0.16)' : 'transparent',
                      color: tab === 'public.credit_balance' ? '#5eead4' : '#94a3b8',
                      border:
                        tab === 'public.credit_balance'
                          ? '1px solid rgba(34,197,94,0.35)'
                          : '1px solid transparent',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tab}
                  </div>
                ),
              )}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 16,
                paddingBottom: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 500 }}>public.credit_balance</div>
                <span
                  style={{
                    fontSize: 12,
                    color: '#71717a',
                    padding: '2px 6px',
                    borderRadius: 6,
                    backgroundColor: 'rgba(255,255,255,0.04)',
                  }}
                >
                  uuid uuid
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  style={{
                    padding: '6px 10px',
                    fontSize: 12,
                    borderRadius: 6,
                    border: '1px solid rgba(148,163,184,0.3)',
                    backgroundColor: 'transparent',
                    color: '#cbd5f5',
                  }}
                >
                  Enable Realtime
                </button>
                <button
                  style={{
                    padding: '6px 10px',
                    fontSize: 12,
                    borderRadius: 6,
                    border: '1px solid rgba(82,82,91,0.7)',
                    backgroundColor: '#181b21',
                    color: '#f4f4f5',
                    fontWeight: 500,
                  }}
                >
                  Security Definer view
                </button>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: '#a5b4fc',
                  }}
                >
                  <span>Role</span>
                  <div
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      backgroundColor: 'rgba(59,130,246,0.15)',
                      color: '#bfdbfe',
                    }}
                  >
                    postgres
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 18px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 2fr) 120px',
                padding: '0 12px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                fontSize: 12,
                color: '#71717a',
              }}
            >
              {columnHeaders.map((column) => (
                <div
                  key={column.label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: column.align === 'right' ? 'flex-end' : 'flex-start',
                    paddingBottom: 10,
                  }}
                >
                  {column.label}
                  <span style={{ marginLeft: 6, fontSize: 11, color: '#3f3f46' }}>{column.type}</span>
                </div>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', marginTop: 6 }}>
              {tableRows.map((row) => (
                <div
                  key={row.userId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 2fr) 120px',
                    padding: '10px 12px',
                    borderRadius: 6,
                    backgroundColor: 'rgba(17,24,39,0.36)',
                    marginBottom: 6,
                    fontSize: 13,
                    color: '#f8fafc',
                  }}
                >
                  <div
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.userId}
                  </div>
                  <div style={{ textAlign: 'right', letterSpacing: 0.4 }}>{row.balance}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {overlayMessage && (
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
          {overlayMessage}
        </div>
      )}
    </main>
  );
}


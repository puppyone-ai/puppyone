'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '../../supabase/SupabaseAuthProvider'
import { 
  getTools, deleteTool, updateTool,
  getMcpV2Instances, getBoundTools,
  createMcpV2, deleteMcpV2,
  createBindings, deleteBinding,
  type Tool, type McpV2Instance, type BoundTool,
} from '../../../lib/mcpApi'

// ============================================================================
// 常量配置
// ============================================================================
const TOOL_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  get_data_schema: { label: 'Schema', color: '#67e8f9', bg: 'rgba(6, 182, 212, 0.15)' },
  query_data: { label: 'Query', color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.15)' },
  get_all_data: { label: 'Get All', color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.15)' },
  preview: { label: 'Preview', color: '#a78bfa', bg: 'rgba(139, 92, 246, 0.15)' },
  select: { label: 'Select', color: '#a78bfa', bg: 'rgba(139, 92, 246, 0.15)' },
  create: { label: 'Create', color: '#34d399', bg: 'rgba(16, 185, 129, 0.15)' },
  update: { label: 'Update', color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)' },
  delete: { label: 'Delete', color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)' },
}

// ============================================================================
// 类型
// ============================================================================
interface McpWithBindings extends McpV2Instance {
  boundTools: BoundTool[]
}

type Props = {
  onBack: () => void
  onNavigateToTable?: (tableId: number) => void
}

// ============================================================================
// 主组件
// ============================================================================
export function ToolsContentView({ onBack, onNavigateToTable }: Props) {
  const { session } = useAuth()
  
  // 核心数据
  const [tools, setTools] = useState<Tool[]>([])
  const [servers, setServers] = useState<McpWithBindings[]>([])
  const [loading, setLoading] = useState(true)
  
  // 视图状态：null = Library，string = Server apiKey
  const [activeServer, setActiveServer] = useState<string | null>(null)
  
  // Modal 状态（统一管理）
  const [modal, setModal] = useState<
    | null 
    | { type: 'create-server' }
    | { type: 'add-tools'; serverKey: string }
  >(null)
  const [modalInput, setModalInput] = useState('')

  // 加载数据
  useEffect(() => {
    if (session?.user?.id) loadData()
  }, [session?.user?.id])

  const loadData = async () => {
    setLoading(true)
    try {
      const [toolsRes, serversRes] = await Promise.all([getTools(), getMcpV2Instances()])
      setTools(toolsRes || [])
      
      // 并行加载每个 server 的 bindings
      const serversWithBindings = await Promise.all(
        serversRes.map(async s => ({
          ...s,
          boundTools: await getBoundTools(s.api_key).catch(() => [])
        }))
      )
      setServers(serversWithBindings)
    } catch (e) {
      console.error('Load failed', e)
    } finally {
      setLoading(false)
    }
  }

  // 当前选中的 Server 对象
  const currentServer = activeServer ? servers.find(s => s.api_key === activeServer) : null

  // ==================== Actions ====================
  
  const createServer = async () => {
    if (!modalInput.trim()) return
    try {
      const newServer = await createMcpV2({ name: modalInput.trim() })
      setServers(prev => [...prev, { ...newServer, boundTools: [] }])
      setActiveServer(newServer.api_key)
      setModal(null)
      setModalInput('')
    } catch (e) {
      alert('创建失败')
    }
  }

  const removeServer = async (key: string) => {
    if (!confirm('确定删除此 Server？')) return
    try {
      await deleteMcpV2(key)
      setServers(prev => prev.filter(s => s.api_key !== key))
      if (activeServer === key) setActiveServer(null)
    } catch (e) {
      alert('删除失败')
    }
  }

  const removeTool = async (toolId: number) => {
    if (!confirm('确定删除此 Tool？')) return
    try {
      await deleteTool(toolId)
      setTools(prev => prev.filter(t => t.id !== toolId))
      loadData() // 刷新绑定
    } catch (e) {
      alert('删除失败')
    }
  }

  const bindTool = async (serverKey: string, toolId: number) => {
    try {
      await createBindings(serverKey, [{ tool_id: toolId, status: true }])
      loadData()
    } catch (e) {
      alert('绑定失败')
    }
  }

  const unbindTool = async (serverKey: string, toolId: number) => {
    try {
      await deleteBinding(serverKey, toolId)
      loadData()
    } catch (e) {
      alert('解绑失败')
    }
  }

  const copyServerUrl = (key: string) => {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
    navigator.clipboard.writeText(`${base}/api/v1/mcp/server/${key}`)
    alert('已复制!')
  }

  // ==================== Render ====================

  if (loading) {
    return <div style={styles.loading}>Loading...</div>
  }

  return (
    <div style={styles.container}>
      {/* ===== 左侧导航 ===== */}
      <aside style={styles.sidebar}>
        <header style={styles.sidebarHeader}>
          <button onClick={onBack} style={styles.backBtn}>←</button>
          <span style={styles.sidebarTitle}>TOOLS & MCP</span>
        </header>

        <nav style={styles.nav}>
          {/* Library */}
          <section style={styles.section}>
            <div style={styles.sectionLabel}>LIBRARY</div>
            <div 
              style={{ ...styles.navItem, ...(activeServer === null ? styles.navItemActive : {}) }}
              onClick={() => setActiveServer(null)}
            >
              <span>📚</span>
              <span style={{ flex: 1 }}>All Tools</span>
              <span style={styles.badge}>{tools.length}</span>
            </div>
          </section>

          {/* MCP Servers */}
          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionLabel}>MCP SERVERS</span>
              <button style={styles.addBtn} onClick={() => setModal({ type: 'create-server' })}>+</button>
            </div>
            {servers.map(s => (
              <div
                key={s.api_key}
                style={{ ...styles.navItem, ...(activeServer === s.api_key ? styles.navItemActive : {}) }}
                onClick={() => setActiveServer(s.api_key)}
              >
                <span style={{ ...styles.statusDot, background: s.status ? '#22c55e' : '#525252' }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name || 'Unnamed'}
                </span>
                <span style={styles.badge}>{s.boundTools.length}</span>
              </div>
            ))}
            {servers.length === 0 && <div style={styles.emptyHint}>暂无 Server</div>}
          </section>

          {/* Sandboxes (Coming Soon) */}
          <section style={{ ...styles.section, opacity: 0.4 }}>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionLabel}>SANDBOXES</span>
              <span style={styles.soonBadge}>SOON</span>
            </div>
            <div style={{ ...styles.navItem, cursor: 'not-allowed' }}>
              <span>📦</span>
              <span>Python Sandbox</span>
            </div>
          </section>
        </nav>
      </aside>

      {/* ===== 右侧主内容 ===== */}
      <main style={styles.main}>
        {activeServer === null ? (
          // Library View
          <LibraryView 
            tools={tools} 
            servers={servers}
            onDelete={removeTool}
            onBind={bindTool}
            onNavigateToTable={onNavigateToTable}
          />
        ) : currentServer ? (
          // Server View
          <ServerView
            server={currentServer}
            allTools={tools}
            onDelete={() => removeServer(currentServer.api_key)}
            onUnbind={(toolId: number) => unbindTool(currentServer.api_key, toolId)}
            onAddTools={() => setModal({ type: 'add-tools', serverKey: currentServer.api_key })}
            onCopyUrl={() => copyServerUrl(currentServer.api_key)}
          />
        ) : (
          <div style={styles.loading}>Server not found</div>
        )}
      </main>

      {/* ===== Modal ===== */}
      {modal && (
        <div style={styles.modalOverlay} onClick={() => { setModal(null); setModalInput('') }}>
          <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
            {modal.type === 'create-server' && (
              <>
                <div style={styles.modalTitle}>创建 MCP Server</div>
                <input
                  autoFocus
                  value={modalInput}
                  onChange={e => setModalInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createServer()}
                  placeholder="Server 名称"
                  style={styles.input}
                />
                <div style={styles.modalActions}>
                  <button style={styles.btnSecondary} onClick={() => setModal(null)}>取消</button>
                  <button style={styles.btnPrimary} onClick={createServer}>创建</button>
                </div>
              </>
            )}
            {modal.type === 'add-tools' && (
              <>
                <div style={styles.modalTitle}>添加 Tools 到 Server</div>
                <input
                  autoFocus
                  value={modalInput}
                  onChange={e => setModalInput(e.target.value)}
                  placeholder="搜索..."
                  style={styles.input}
                />
                <div style={styles.toolList}>
                  {tools
                    .filter(t => !servers.find(s => s.api_key === modal.serverKey)?.boundTools.some(b => b.tool_id === t.id))
                    .filter(t => t.name.toLowerCase().includes(modalInput.toLowerCase()))
                    .map(t => (
                      <div key={t.id} style={styles.toolListItem}>
                        <span style={{ flex: 1 }}>{t.name}</span>
                        <button 
                          style={styles.btnSmall}
                          onClick={() => { bindTool(modal.serverKey, t.id); setModal(null) }}
                        >
                          添加
                        </button>
                      </div>
                    ))
                  }
                </div>
                <div style={styles.modalActions}>
                  <button style={styles.btnSecondary} onClick={() => setModal(null)}>关闭</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 子视图：Library
// ============================================================================
function LibraryView({ tools, servers, onDelete, onBind, onNavigateToTable }: any) {
  return (
    <div style={styles.view}>
      <header style={styles.viewHeader}>
        <div>
          <h1 style={styles.viewTitle}>Tools Library</h1>
          <p style={styles.viewSubtitle}>管理所有数据工具</p>
        </div>
      </header>
      <div style={styles.cardGrid}>
        {tools.length === 0 ? (
          <div style={styles.emptyState}>暂无 Tools</div>
        ) : (
          tools.map((tool: Tool) => (
            <ToolCard 
              key={tool.id} 
              tool={tool} 
              servers={servers}
              onDelete={() => onDelete(tool.id)}
              onBind={(serverKey: string) => onBind(serverKey, tool.id)}
              onNavigateToTable={onNavigateToTable}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 子视图：Server Detail
// ============================================================================
function ServerView({ server, allTools, onDelete, onUnbind, onAddTools, onCopyUrl }: any) {
  return (
    <div style={styles.view}>
      <header style={styles.serverHeader}>
        <div style={styles.serverInfo}>
          <div style={styles.serverIcon}>📡</div>
          <div>
            <h1 style={styles.viewTitle}>{server.name || 'Unnamed Server'}</h1>
            <div style={styles.serverMeta}>
              <span style={styles.statusOnline}>● Online</span>
              <button style={styles.linkBtn} onClick={onCopyUrl}>复制 URL</button>
            </div>
          </div>
        </div>
        <button style={styles.btnDanger} onClick={onDelete}>删除 Server</button>
      </header>

      <div style={styles.toolsSection}>
        <div style={styles.toolsSectionHeader}>
          <span>已绑定的 Tools ({server.boundTools.length})</span>
          <button style={styles.btnPrimary} onClick={onAddTools}>+ 添加</button>
        </div>
        
        {server.boundTools.length === 0 ? (
          <div style={styles.emptyState}>
            <p>此 Server 暂无 Tools</p>
            <button style={styles.linkBtn} onClick={onAddTools}>从 Library 添加</button>
          </div>
        ) : (
          <div style={styles.cardGrid}>
            {server.boundTools.map((bt: BoundTool) => {
              const tool = allTools.find((t: Tool) => t.id === bt.tool_id) || bt
              return (
                <ToolCard 
                  key={bt.tool_id} 
                  tool={{ ...tool, id: bt.tool_id }}
                  compact
                  onDelete={() => onUnbind(bt.tool_id)}
                  deleteLabel="移除"
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 通用组件：Tool Card
// ============================================================================
function ToolCard({ tool, servers, compact, onDelete, onBind, onNavigateToTable, deleteLabel }: any) {
  const [showMenu, setShowMenu] = useState(false)
  const config = TOOL_TYPE_CONFIG[tool.type] || TOOL_TYPE_CONFIG.query_data

  return (
    <div style={styles.card}>
      {/* Type Badge */}
      <div style={{ ...styles.typeBadge, background: config.bg, color: config.color }}>
        {config.label}
      </div>

      {/* Name & Description */}
      <div style={styles.cardName}>{tool.name}</div>
      {!compact && (
        <div style={styles.cardDesc}>{tool.description || '无描述'}</div>
      )}

      {/* Actions */}
      <div style={styles.cardActions}>
        {onNavigateToTable && tool.table_id && (
          <button style={styles.iconBtn} onClick={() => onNavigateToTable(tool.table_id)} title="查看表">↗</button>
        )}
        {servers && (
          <div style={{ position: 'relative' }}>
            <button style={styles.iconBtn} onClick={() => setShowMenu(!showMenu)} title="添加到 Server">+</button>
            {showMenu && (
              <div style={styles.dropdown}>
                {servers.map((s: McpWithBindings) => (
                  <div key={s.api_key} style={styles.dropdownItem} onClick={() => { onBind(s.api_key); setShowMenu(false) }}>
                    {s.name || 'Unnamed'}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <button style={{ ...styles.iconBtn, color: '#ef4444' }} onClick={onDelete} title={deleteLabel || '删除'}>
          {deleteLabel === '移除' ? '−' : '✕'}
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// 样式
// ============================================================================
const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', height: '100%', background: '#0a0a0c' },
  loading: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252' },
  
  // Sidebar
  sidebar: { width: 240, borderRight: '1px solid #222', background: '#111', display: 'flex', flexDirection: 'column' },
  sidebarHeader: { height: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: '1px solid #222' },
  backBtn: { background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16 },
  sidebarTitle: { fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: 1 },
  nav: { flex: 1, overflow: 'auto', padding: 12 },
  section: { marginBottom: 20 },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  sectionLabel: { fontSize: 10, fontWeight: 600, color: '#555', letterSpacing: 0.5 },
  addBtn: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14 },
  navItem: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, cursor: 'pointer', color: '#999', fontSize: 13 },
  navItemActive: { background: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  statusDot: { width: 6, height: 6, borderRadius: '50%' },
  badge: { fontSize: 11, color: '#555' },
  emptyHint: { fontSize: 12, color: '#444', padding: '4px 8px', fontStyle: 'italic' },
  soonBadge: { fontSize: 9, background: '#222', color: '#666', padding: '1px 4px', borderRadius: 2 },

  // Main
  main: { flex: 1, overflow: 'auto' },
  view: { padding: 24 },
  viewHeader: { marginBottom: 24 },
  viewTitle: { fontSize: 20, fontWeight: 600, color: '#eee', margin: 0 },
  viewSubtitle: { fontSize: 13, color: '#666', margin: '4px 0 0' },

  // Server Header
  serverHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, padding: 16, background: '#151518', borderRadius: 8 },
  serverInfo: { display: 'flex', gap: 12 },
  serverIcon: { width: 48, height: 48, borderRadius: 8, background: 'linear-gradient(135deg, #2563eb, #1e40af)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 },
  serverMeta: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 },
  statusOnline: { fontSize: 12, color: '#22c55e' },
  linkBtn: { background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 12 },

  // Tools Section
  toolsSection: { marginTop: 16 },
  toolsSectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, fontSize: 14, color: '#aaa' },

  // Card Grid
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 },
  emptyState: { gridColumn: '1 / -1', textAlign: 'center', padding: 40, color: '#555' },

  // Card
  card: { background: '#18181b', border: '1px solid #2a2a2a', borderRadius: 8, padding: 14, position: 'relative' },
  typeBadge: { display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, marginBottom: 8, textTransform: 'uppercase' },
  cardName: { fontSize: 14, fontWeight: 500, color: '#eee', marginBottom: 4 },
  cardDesc: { fontSize: 12, color: '#666', marginBottom: 8, lineHeight: 1.4 },
  cardActions: { display: 'flex', gap: 4, position: 'absolute', top: 12, right: 12 },
  iconBtn: { background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 14, padding: 4 },
  dropdown: { position: 'absolute', top: '100%', right: 0, background: '#222', border: '1px solid #333', borderRadius: 4, minWidth: 120, zIndex: 10 },
  dropdownItem: { padding: '6px 10px', fontSize: 12, color: '#ccc', cursor: 'pointer' },

  // Buttons
  btnPrimary: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  btnSecondary: { background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  btnDanger: { background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  btnSmall: { background: 'transparent', border: '1px solid #444', color: '#60a5fa', borderRadius: 3, padding: '2px 8px', fontSize: 11, cursor: 'pointer' },

  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modalBox: { background: '#1a1a1d', border: '1px solid #333', borderRadius: 8, padding: 20, width: 360 },
  modalTitle: { fontSize: 14, fontWeight: 600, color: '#eee', marginBottom: 12 },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  input: { width: '100%', padding: '8px 10px', background: '#222', border: '1px solid #333', borderRadius: 4, color: '#eee', fontSize: 13, outline: 'none' },
  toolList: { maxHeight: 240, overflow: 'auto', marginTop: 8 },
  toolListItem: { display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #222', fontSize: 13, color: '#ccc' },
}

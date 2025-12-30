'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '../../supabase/SupabaseAuthProvider'
import { 
  getTools, 
  deleteTool,
  getMcpV2Instances,
  getBoundTools,
  deleteMcpV2,
  type Tool,
  type McpV2Instance,
  type BoundTool,
} from '../../../lib/mcpApi'
import { ToolsSidebar } from './ToolsSidebar'
import { LibraryView } from './LibraryView'
import { ServerView } from './ServerView'

type ToolsManagerProps = {
  onBack: () => void
  onNavigateToTable?: (tableId: number) => void
}

// MCP 实例及其绑定的 tools
interface McpWithBindings extends McpV2Instance {
  boundTools: BoundTool[]
}

// 视图状态
type ViewMode = { type: 'library' } | { type: 'server'; apiKey: string }

export function ToolsManager({ onBack, onNavigateToTable }: ToolsManagerProps) {
  const { session } = useAuth()
  const userId = session?.user?.id
  
  // 状态
  const [currentView, setCurrentView] = useState<ViewMode>({ type: 'library' })
  const [tools, setTools] = useState<Tool[]>([])
  const [mcpInstances, setMcpInstances] = useState<McpWithBindings[]>([])
  const [loading, setLoading] = useState(true)

  // 初始化加载
  useEffect(() => {
    if (userId) {
      refreshAll()
    }
  }, [userId])

  const refreshAll = async () => {
    setLoading(true)
    try {
      const [toolsData, instancesData] = await Promise.all([
        getTools(),
        getMcpV2Instances()
      ])
      
      setTools(toolsData || [])
      
      const instancesWithBindings = await Promise.all(
        instancesData.map(async (instance) => {
          try {
            const boundTools = await getBoundTools(instance.api_key)
            return { ...instance, boundTools }
          } catch {
            return { ...instance, boundTools: [] }
          }
        })
      )
      setMcpInstances(instancesWithBindings)
    } catch (e) {
      console.error('Failed to load data', e)
    } finally {
      setLoading(false)
    }
  }

  // --- Actions ---

  const handleMcpCreated = (newMcp: McpV2Instance) => {
    // Add new MCP to list and switch view
    const mcpWithBindings: McpWithBindings = { ...newMcp, boundTools: [] }
    setMcpInstances(prev => [...prev, mcpWithBindings])
    setCurrentView({ type: 'server', apiKey: newMcp.api_key })
  }

  const handleDeleteMcp = async (apiKey: string) => {
    if (!confirm('Delete this MCP instance?')) return
    try {
      await deleteMcpV2(apiKey)
      setMcpInstances(prev => prev.filter(m => m.api_key !== apiKey))
      if (currentView.type === 'server' && currentView.apiKey === apiKey) {
        setCurrentView({ type: 'library' })
      }
    } catch (e) {
      console.error('Failed to delete MCP', e)
      alert('Error deleting MCP instance')
    }
  }

  const handleDeleteTool = async (toolId: number) => {
    if (!confirm('Delete this tool?')) return
    try {
      await deleteTool(toolId)
      setTools(prev => prev.filter(t => t.id !== toolId))
      refreshAll() // 刷新绑定关系 (因为删除 tool 可能影响 bindings)
    } catch (e) {
      console.error('Failed to delete tool', e)
      alert('Error deleting tool')
    }
  }

  // 渲染
  return (
    <div style={{ display: 'flex', height: '100%', background: '#0a0a0c' }}>
      {/* Sub-Sidebar (二级导航) */}
      <ToolsSidebar 
        currentView={currentView}
        onChangeView={setCurrentView}
        toolsCount={tools.length}
        mcpInstances={mcpInstances}
        onShowCreateFlow={() => {
          // 切换到 Library 视图，提示用户选择 tools
          setCurrentView({ type: 'library' })
        }}
      />

      {/* Main Content (Stage) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252' }}>
            Loading...
          </div>
        ) : currentView.type === 'library' ? (
          <LibraryView 
            tools={tools} 
            mcpInstances={mcpInstances}
            onDeleteTool={handleDeleteTool}
            onNavigateToTable={onNavigateToTable}
            onRefresh={refreshAll}
            onMcpCreated={handleMcpCreated}
          />
        ) : (
          <ServerView 
            server={mcpInstances.find(m => m.api_key === (currentView as any).apiKey)!}
            allTools={tools}
            onDeleteServer={handleDeleteMcp}
            onRefresh={refreshAll}
          />
        )}
      </div>
    </div>
  )
}


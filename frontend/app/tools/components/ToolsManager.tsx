'use client'

import { useState } from 'react'
import { 
  deleteTool,
  deleteMcpV2,
  type McpV2Instance,
} from '../../../lib/mcpApi'
import { useAllTools, useMcpInstances, refreshToolsAndMcp } from '../../../lib/hooks/useData'
import { ToolsSidebar } from './ToolsSidebar'
import { LibraryView } from './LibraryView'
import { ServerView } from './ServerView'

type ToolsManagerProps = {
  onBack: () => void
  onNavigateToTable?: (tableId: number) => void
}

// 视图状态
type ViewMode = { type: 'library' } | { type: 'server'; apiKey: string }

export function ToolsManager({ onBack, onNavigateToTable }: ToolsManagerProps) {
  // 视图状态
  const [currentView, setCurrentView] = useState<ViewMode>({ type: 'library' })
  
  // 使用 SWR hooks（自动缓存，30秒内不重复请求）
  const { tools, isLoading: toolsLoading, refresh: refreshTools } = useAllTools()
  const { instances, isLoading: instancesLoading, refresh: refreshInstances } = useMcpInstances()
  
  const loading = toolsLoading || instancesLoading

  // --- Actions ---

  const handleMcpCreated = (newMcp: McpV2Instance) => {
    // 刷新实例列表并切换视图
    refreshInstances()
    setCurrentView({ type: 'server', apiKey: newMcp.api_key })
  }

  const handleDeleteMcp = async (apiKey: string) => {
    if (!confirm('Delete this MCP instance?')) return
    try {
      await deleteMcpV2(apiKey)
      refreshInstances()
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
      // 刷新 tools 和当前选中 server 的 bound tools
      refreshToolsAndMcp(currentView.type === 'server' ? currentView.apiKey : undefined)
    } catch (e) {
      console.error('Failed to delete tool', e)
      alert('Error deleting tool')
    }
  }

  const handleRefresh = () => {
    refreshTools()
    refreshInstances()
  }

  // 渲染
  return (
    <div style={{ display: 'flex', height: '100%', background: '#0a0a0c' }}>
      {/* Sub-Sidebar (二级导航) */}
      <ToolsSidebar 
        currentView={currentView}
        onChangeView={setCurrentView}
        toolsCount={tools.length}
        mcpInstances={instances}
        loading={loading}
        onShowCreateFlow={() => {
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
            mcpInstances={instances}
            onDeleteTool={handleDeleteTool}
            onNavigateToTable={onNavigateToTable}
            onRefresh={handleRefresh}
            onMcpCreated={handleMcpCreated}
          />
        ) : (
          <ServerView 
            server={instances.find(m => m.api_key === currentView.apiKey)}
            allTools={tools}
            onDeleteServer={handleDeleteMcp}
            onRefresh={handleRefresh}
          />
        )}
      </div>
    </div>
  )
}

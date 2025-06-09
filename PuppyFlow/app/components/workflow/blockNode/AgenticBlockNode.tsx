'use client'
import { NodeProps, Node, useReactFlow } from '@xyflow/react'
import React, { useRef, useEffect, useState, useCallback } from 'react'

export type AgenticBlockNodeData = {
  label: string,
  state: 'idle' | 'thinking' | 'moving',
  lastMoveDirection: 'up' | 'down' | 'left' | 'right' | null,
  moveCount: number,
  decisionInterval: number, // 决策间隔（毫秒）
  behaviorMode: 'explorer' | 'gatherer' | 'patrol' | 'avoider', // 行为模式
  memory: string[], // 访问过的节点ID记录
  interests: string[], // 感兴趣的关键词
  modeHistory: { mode: string, timestamp: number, duration: number }[], // 模式切换历史
  lastModeSwitch: number, // 上次模式切换时间
  frustrationLevel: number, // 挫折感水平 (0-1)
  explorationProgress: number, // 探索进度 (0-1)
}

type AgenticBlockNodeProps = NodeProps<Node<AgenticBlockNodeData>>

// 移动动作函数 - 封装了5像素移动的逻辑
const moveActions = {
  up: (currentPosition: { x: number, y: number }) => ({ 
    x: currentPosition.x, 
    y: currentPosition.y - 5 
  }),
  down: (currentPosition: { x: number, y: number }) => ({ 
    x: currentPosition.x, 
    y: currentPosition.y + 5 
  }),
  left: (currentPosition: { x: number, y: number }) => ({ 
    x: currentPosition.x - 5, 
    y: currentPosition.y 
  }),
  right: (currentPosition: { x: number, y: number }) => ({ 
    x: currentPosition.x + 5, 
    y: currentPosition.y 
  }),
}

// 计算两点间距离
const calculateDistance = (pos1: { x: number, y: number }, pos2: { x: number, y: number }): number => {
  return Math.sqrt(Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.y - pos1.y, 2))
}

// 计算方向向量
const calculateDirection = (from: { x: number, y: number }, to: { x: number, y: number }): 'up' | 'down' | 'left' | 'right' => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left'
  } else {
    return dy > 0 ? 'down' : 'up'
  }
}

// 内容相关性分析 - 简单的关键词匹配
const analyzeContentRelevance = (content: string, interests: string[]): number => {
  if (!content || interests.length === 0) return 0
  
  const contentLower = content.toLowerCase()
  let relevanceScore = 0
  
  interests.forEach(interest => {
    if (contentLower.includes(interest.toLowerCase())) {
      relevanceScore += 1
    }
  })
  
  return relevanceScore / interests.length // 归一化到0-1
}

// 环境感知系统
const perceiveEnvironment = (
  currentNodeId: string, 
  currentPosition: { x: number, y: number },
  allNodes: Node[],
  interests: string[],
  memory: string[]
) => {
  const otherNodes = allNodes.filter(node => 
    node.id !== currentNodeId && 
    node.type !== 'agentic' // 排除其他agentic节点
  )
  
  const perceptionData = otherNodes.map(node => {
    const distance = calculateDistance(currentPosition, node.position)
    const direction = calculateDirection(currentPosition, node.position)
    const content = String(node.data?.content || node.data?.label || '')
    const relevance = analyzeContentRelevance(content, interests)
    const visited = memory.includes(node.id)
    
    return {
      id: node.id,
      type: node.type,
      position: node.position,
      distance,
      direction,
      content,
      relevance,
      visited,
      // 综合兴趣度：相关性高、距离适中、未访问过的节点更有吸引力
      attractiveness: relevance * (visited ? 0.3 : 1.0) * (1 / (1 + distance / 100))
    }
  })
  
  return perceptionData.sort((a, b) => b.attractiveness - a.attractiveness)
}

// 智能决策引擎
const makeIntelligentDecision = (
  currentState: AgenticBlockNodeData,
  currentPosition: { x: number, y: number },
  allNodes: Node[],
  currentNodeId: string
): { direction: 'up' | 'down' | 'left' | 'right', newMode?: string, shouldSwitchMode: boolean } => {
  const { behaviorMode, interests, memory, lastModeSwitch } = currentState
  const directions: ('up' | 'down' | 'left' | 'right')[] = ['up', 'down', 'left', 'right']
  
  // 环境感知
  const perception = perceiveEnvironment(currentNodeId, currentPosition, allNodes, interests, memory)
  
  // 检查是否需要切换模式
  const newMode = decideBehaviorMode(currentState, perception, allNodes)
  const shouldSwitchMode = newMode !== behaviorMode
  
  // 使用新模式进行决策
  const activeMode = shouldSwitchMode ? newMode : behaviorMode
  
  let direction: 'up' | 'down' | 'left' | 'right'
  
  // 根据行为模式做决策
  switch (activeMode) {
    case 'explorer': {
      // 探索模式：优先去未访问的区域
      const unvisitedNodes = perception.filter(p => !p.visited)
      if (unvisitedNodes.length > 0) {
        direction = unvisitedNodes[0].direction
      } else {
        // 如果都访问过了，随机移动
        direction = directions[Math.floor(Math.random() * directions.length)]
      }
      break
    }
    
    case 'gatherer': {
      // 聚集模式：向最感兴趣的内容移动
      const interestingNodes = perception.filter(p => p.relevance > 0)
      if (interestingNodes.length > 0) {
        direction = interestingNodes[0].direction
      } else {
        // 没有感兴趣的内容，探索模式
        direction = directions[Math.floor(Math.random() * directions.length)]
      }
      break
    }
    
    case 'patrol': {
      // 巡逻模式：在高价值节点间巡逻
      const highValueNodes = perception.filter(p => p.attractiveness > 0.3)
      if (highValueNodes.length > 0) {
        // 选择一个还没访问或很久没访问的高价值节点
        const target = highValueNodes.find(p => !p.visited) || highValueNodes[0]
        direction = target.direction
      } else {
        // 没有高价值节点，随机巡逻
        direction = directions[Math.floor(Math.random() * directions.length)]
      }
      break
    }
    
    case 'avoider': {
      // 避让模式：避开拥挤区域，寻找空旷地带
      const nearbyNodes = perception.filter(p => p.distance < 100)
      if (nearbyNodes.length > 2) {
        // 计算相对空旷的方向
        const directionCrowdedness = {
          up: nearbyNodes.filter(p => p.direction === 'up').length,
          down: nearbyNodes.filter(p => p.direction === 'down').length,
          left: nearbyNodes.filter(p => p.direction === 'left').length,
          right: nearbyNodes.filter(p => p.direction === 'right').length,
        }
        
        // 选择最不拥挤的方向
        const leastCrowdedDirection = Object.entries(directionCrowdedness)
          .sort(([,a], [,b]) => a - b)[0][0] as 'up' | 'down' | 'left' | 'right'
        
        direction = leastCrowdedDirection
      } else {
        // 不拥挤，随机移动
        direction = directions[Math.floor(Math.random() * directions.length)]
      }
      break
    }
    
    default: {
      // 默认行为：简单的反向移动逻辑
      let availableDirections = directions
      if (currentState.lastMoveDirection) {
        if (Math.random() > 0.3) {
          availableDirections = directions.filter(dir => dir !== currentState.lastMoveDirection)
        }
      }
      direction = availableDirections[Math.floor(Math.random() * availableDirections.length)]
      break
    }
  }
  
  return { direction, newMode: shouldSwitchMode ? newMode : undefined, shouldSwitchMode }
}

// 模式切换决策引擎
const decideBehaviorMode = (
  currentData: AgenticBlockNodeData,
  perception: any[],
  allNodes: Node[]
): 'explorer' | 'gatherer' | 'patrol' | 'avoider' => {
  const { 
    behaviorMode, 
    memory, 
    moveCount, 
    lastModeSwitch, 
    frustrationLevel,
    explorationProgress,
    interests 
  } = currentData
  
  const now = Date.now()
  const timeSinceLastSwitch = now - lastModeSwitch
  const minSwitchInterval = 10000 // 最少10秒才能切换模式
  
  // 如果刚切换过模式，保持当前模式
  if (timeSinceLastSwitch < minSwitchInterval) {
    return behaviorMode
  }
  
  // 计算环境特征
  const totalNodes = allNodes.filter(n => n.type !== 'agentic').length
  const visitedRatio = memory.length / Math.max(totalNodes, 1)
  const interestingNodesNearby = perception.filter(p => p.relevance > 0 && p.distance < 150).length
  const crowdedArea = perception.filter(p => p.distance < 100).length > 3
  const hasUnexploredAreas = perception.filter(p => !p.visited).length > 0
  
  // 模式切换逻辑
  switch (behaviorMode) {
    case 'explorer': {
      // 探索者 → 聚集者：发现了感兴趣的内容
      if (interestingNodesNearby > 0 && visitedRatio > 0.3) {
        return 'gatherer'
      }
      // 探索者 → 巡逻者：探索得差不多了
      if (visitedRatio > 0.7) {
        return 'patrol'
      }
      // 探索者 → 避让者：区域太拥挤
      if (crowdedArea && frustrationLevel > 0.6) {
        return 'avoider'
      }
      return 'explorer'
    }
    
    case 'gatherer': {
      // 聚集者 → 探索者：附近没有感兴趣的内容了
      if (interestingNodesNearby === 0 && hasUnexploredAreas) {
        return 'explorer'
      }
      // 聚集者 → 巡逻者：收集得差不多了
      if (visitedRatio > 0.8) {
        return 'patrol'
      }
      // 聚集者 → 避让者：太拥挤了
      if (crowdedArea && frustrationLevel > 0.7) {
        return 'avoider'
      }
      return 'gatherer'
    }
    
    case 'patrol': {
      // 巡逻者 → 探索者：发现新的未探索区域
      if (hasUnexploredAreas && visitedRatio < 0.9) {
        return 'explorer'
      }
      // 巡逻者 → 聚集者：发现新的感兴趣内容
      if (interestingNodesNearby > 1) {
        return 'gatherer'
      }
      // 巡逻者 → 避让者：巡逻区域太拥挤
      if (crowdedArea) {
        return 'avoider'
      }
      return 'patrol'
    }
    
    case 'avoider': {
      // 避让者 → 探索者：找到空旷区域，挫折感降低
      if (!crowdedArea && frustrationLevel < 0.3 && hasUnexploredAreas) {
        return 'explorer'
      }
      // 避让者 → 聚集者：在空旷区域发现感兴趣内容
      if (!crowdedArea && interestingNodesNearby > 0) {
        return 'gatherer'
      }
      // 避让者 → 巡逻者：环境稳定了
      if (!crowdedArea && frustrationLevel < 0.2) {
        return 'patrol'
      }
      return 'avoider'
    }
    
    default:
      return 'explorer'
  }
}

// 更新挫折感和探索进度
const updateEmotionalState = (
  currentData: AgenticBlockNodeData,
  perception: any[],
  moveSuccess: boolean
): { frustrationLevel: number, explorationProgress: number } => {
  let { frustrationLevel, explorationProgress } = currentData
  
  // 挫折感更新逻辑
  if (moveSuccess) {
    // 成功移动，降低挫折感
    frustrationLevel = Math.max(0, frustrationLevel - 0.05)
    
    // 如果发现了感兴趣的内容，大幅降低挫折感
    const foundInteresting = perception.some(p => p.relevance > 0 && p.distance < 50)
    if (foundInteresting) {
      frustrationLevel = Math.max(0, frustrationLevel - 0.2)
    }
  } else {
    // 移动受阻或无效，增加挫折感
    frustrationLevel = Math.min(1, frustrationLevel + 0.1)
  }
  
  // 如果周围太拥挤，增加挫折感
  const crowded = perception.filter(p => p.distance < 80).length > 3
  if (crowded) {
    frustrationLevel = Math.min(1, frustrationLevel + 0.05)
  }
  
  // 探索进度更新
  const totalNodes = perception.length + currentData.memory.length
  const visitedNodes = currentData.memory.length
  explorationProgress = totalNodes > 0 ? visitedNodes / totalNodes : 0
  
  return { frustrationLevel, explorationProgress }
}

function AgenticBlockNode({ 
  id, 
  data: { 
    label, 
    state, 
    lastMoveDirection, 
    moveCount, 
    decisionInterval,
    behaviorMode = 'explorer',
    memory = [],
    interests = ['AI', '智能', 'data', '数据', 'text', '文本', 'code', '代码'],
    modeHistory = [],
    lastModeSwitch = Date.now(),
    frustrationLevel = 0,
    explorationProgress = 0,
  } 
}: AgenticBlockNodeProps) {
  const { getNode, setNodes, getNodes } = useReactFlow()
  const [currentState, setCurrentState] = useState<'idle' | 'thinking' | 'moving'>(state || 'idle')
  const [thinkingDots, setThinkingDots] = useState('')
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const thinkingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // 确保决策间隔有默认值
  const effectiveDecisionInterval = decisionInterval || 3000

  // 思考动画效果
  useEffect(() => {
    if (currentState === 'thinking') {
      thinkingIntervalRef.current = setInterval(() => {
        setThinkingDots(prev => {
          if (prev.length >= 3) return ''
          return prev + '.'
        })
      }, 300)
    } else {
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current)
        thinkingIntervalRef.current = null
      }
      setThinkingDots('')
    }

    return () => {
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current)
      }
    }
  }, [currentState])

  // 执行移动动作
  const executeMove = useCallback((direction: 'up' | 'down' | 'left' | 'right', newMode?: string, shouldSwitchMode?: boolean) => {
    const currentNode = getNode(id)
    if (!currentNode) return

    const newPosition = moveActions[direction](currentNode.position)
    
    // 检查是否接近某个节点，如果是则记录到记忆中
    const allNodes = getNodes()
    const nearbyNodes = allNodes.filter(node => {
      if (node.id === id || node.type === 'agentic') return false
      const distance = calculateDistance(newPosition, node.position)
      return distance < 50 // 50像素内认为是"访问"了该节点
    })
    
    const currentData = currentNode.data as AgenticBlockNodeData
    const newMemory = [...currentData.memory]
    let moveSuccess = true
    
    nearbyNodes.forEach(node => {
      if (!newMemory.includes(node.id)) {
        newMemory.push(node.id)
        // 限制记忆长度，保持最近的20个
        if (newMemory.length > 20) {
          newMemory.shift()
        }
      }
    })
    
    // 环境感知用于情感状态更新
    const perception = perceiveEnvironment(id, newPosition, allNodes, currentData.interests, newMemory)
    
    // 更新情感状态
    const { frustrationLevel, explorationProgress } = updateEmotionalState(
      currentData,
      perception,
      moveSuccess
    )
    
    // 处理模式切换
    const now = Date.now()
    let updatedModeHistory = [...currentData.modeHistory]
    let updatedBehaviorMode = currentData.behaviorMode
    let updatedLastModeSwitch = currentData.lastModeSwitch
    
    if (shouldSwitchMode && newMode) {
      // 记录当前模式的持续时间
      const currentModeDuration = now - currentData.lastModeSwitch
      updatedModeHistory.push({
        mode: currentData.behaviorMode,
        timestamp: currentData.lastModeSwitch,
        duration: currentModeDuration
      })
      
      // 限制历史记录长度
      if (updatedModeHistory.length > 10) {
        updatedModeHistory.shift()
      }
      
      updatedBehaviorMode = newMode as 'explorer' | 'gatherer' | 'patrol' | 'avoider'
      updatedLastModeSwitch = now
    }
    
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            position: newPosition,
            data: {
              ...node.data,
              lastMoveDirection: direction,
              moveCount: ((node.data as AgenticBlockNodeData).moveCount || 0) + 1,
              state: 'idle',
              memory: newMemory,
              behaviorMode: updatedBehaviorMode,
              modeHistory: updatedModeHistory,
              lastModeSwitch: updatedLastModeSwitch,
              frustrationLevel,
              explorationProgress,
            }
          }
        }
        return node
      })
    )
    
    setCurrentState('idle')
  }, [id, getNode, setNodes, getNodes])

  // 主要的决策和移动循环
  useEffect(() => {
    const startDecisionCycle = () => {
      intervalRef.current = setInterval(() => {
        // 开始思考阶段
        setCurrentState('thinking')
        
        // 思考时间（500-1500ms随机）
        const thinkingTime = 500 + Math.random() * 1000
        
        setTimeout(() => {
          // 做出智能决策
          const currentNode = getNode(id)
          if (!currentNode) return
          
          const allNodes = getNodes()
          const { direction, newMode, shouldSwitchMode } = makeIntelligentDecision(
            currentNode.data as AgenticBlockNodeData,
            currentNode.position,
            allNodes,
            id
          )
          
          // 进入移动阶段
          setCurrentState('moving')
          
          // 执行移动（延迟200ms模拟移动动画）
          setTimeout(() => {
            executeMove(direction, newMode, shouldSwitchMode)
          }, 200)
          
        }, thinkingTime)
        
      }, effectiveDecisionInterval)
    }

    startDecisionCycle()

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [id, effectiveDecisionInterval, getNode, executeMove, getNodes])

  // 获取状态颜色
  const getStateColor = () => {
    switch (currentState) {
      case 'thinking': return 'bg-yellow-500'
      case 'moving': return 'bg-green-500'
      default: return 'bg-blue-500'
    }
  }

  // 获取状态文本
  const getStateText = () => {
    switch (currentState) {
      case 'thinking': return `分析中${thinkingDots}`
      case 'moving': return '移动中'
      default: return '待机'
    }
  }

  // 获取行为模式显示文本
  const getBehaviorModeText = () => {
    switch (behaviorMode) {
      case 'explorer': return '🔍 探索者'
      case 'gatherer': return '🧲 聚集者'  
      case 'patrol': return '👮 巡逻者'
      case 'avoider': return '🏃 避让者'
      default: return '🤖 智能体'
    }
  }

  // 获取情感状态颜色
  const getFrustrationColor = () => {
    if (frustrationLevel < 0.3) return 'text-green-400'
    if (frustrationLevel < 0.7) return 'text-yellow-400'
    return 'text-red-400'
  }

  // 获取探索进度颜色
  const getProgressColor = () => {
    if (explorationProgress < 0.3) return 'bg-red-500'
    if (explorationProgress < 0.7) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  return (
    <div 
      className={`
        relative min-w-[200px] min-h-[160px] 
        bg-gray-800 border-2 border-gray-600 rounded-lg
        shadow-lg transition-all duration-200
        ${currentState === 'moving' ? 'scale-105' : 'scale-100'}
        ${frustrationLevel > 0.7 ? 'border-red-500' : ''}
      `}
      style={{
        pointerEvents: 'none', // 不可交互
      }}
    >
      {/* 头部状态栏 */}
      <div className={`
        flex items-center justify-between p-2 rounded-t-lg
        ${getStateColor()} text-white text-sm font-medium
      `}>
        <span>{getBehaviorModeText()}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs">{getStateText()}</span>
          {currentState === 'thinking' && (
            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
          )}
        </div>
      </div>

      {/* 主体内容 */}
      <div className="p-3 text-gray-300">
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span>移动次数:</span>
            <span className="text-blue-400">{moveCount || 0}</span>
          </div>
          <div className="flex justify-between">
            <span>上次方向:</span>
            <span className="text-green-400">
              {lastMoveDirection ? 
                { up: '↑', down: '↓', left: '←', right: '→' }[lastMoveDirection] 
                : '-'
              }
            </span>
          </div>
          <div className="flex justify-between">
            <span>访问记录:</span>
            <span className="text-purple-400">{memory.length}/20</span>
          </div>
          <div className="flex justify-between">
            <span>挫折感:</span>
            <span className={getFrustrationColor()}>
              {Math.round(frustrationLevel * 100)}%
            </span>
          </div>
        </div>

        {/* 探索进度条 */}
        <div className="mt-2 text-xs">
          <div className="flex justify-between mb-1">
            <span className="text-gray-400">探索进度:</span>
            <span className="text-cyan-400">{Math.round(explorationProgress * 100)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-1.5">
            <div 
              className={`h-1.5 rounded-full transition-all duration-300 ${getProgressColor()}`}
              style={{ width: `${explorationProgress * 100}%` }}
            />
          </div>
        </div>

        {/* 兴趣关键词显示 */}
        <div className="mt-2 text-xs">
          <div className="text-gray-400 mb-1">兴趣关键词:</div>
          <div className="flex flex-wrap gap-1">
            {interests.slice(0, 3).map((interest, index) => (
              <span key={index} className="px-1 py-0.5 bg-gray-700 rounded text-xs text-cyan-400">
                {interest}
              </span>
            ))}
            {interests.length > 3 && (
              <span className="text-gray-500">+{interests.length - 3}</span>
            )}
          </div>
        </div>

        {/* 模式切换历史 */}
        {modeHistory.length > 0 && (
          <div className="mt-2 text-xs">
            <div className="text-gray-400 mb-1">最近模式:</div>
            <div className="flex gap-1">
              {modeHistory.slice(-3).map((history, index) => (
                <span key={index} className="px-1 py-0.5 bg-gray-600 rounded text-xs text-gray-300">
                  {history.mode === 'explorer' ? '🔍' : 
                   history.mode === 'gatherer' ? '🧲' : 
                   history.mode === 'patrol' ? '👮' : '🏃'}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 状态指示器 */}
        <div className="mt-3 flex justify-center">
          <div className="flex gap-1">
            {['idle', 'thinking', 'moving'].map((stateType) => (
              <div
                key={stateType}
                className={`
                  w-2 h-2 rounded-full transition-all duration-200
                  ${currentState === stateType ? 'bg-white' : 'bg-gray-600'}
                `}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 移动轨迹可视化 */}
      {currentState === 'moving' && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 border-2 border-green-400 rounded-lg animate-pulse" />
          {lastMoveDirection && (
            <div className={`
              absolute text-green-400 text-2xl font-bold
              ${lastMoveDirection === 'up' ? 'top-0 left-1/2 transform -translate-x-1/2 -translate-y-full' : ''}
              ${lastMoveDirection === 'down' ? 'bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full' : ''}
              ${lastMoveDirection === 'left' ? 'left-0 top-1/2 transform -translate-x-full -translate-y-1/2' : ''}
              ${lastMoveDirection === 'right' ? 'right-0 top-1/2 transform translate-x-full -translate-y-1/2' : ''}
            `}>
              {{ up: '↑', down: '↓', left: '←', right: '→' }[lastMoveDirection]}
            </div>
          )}
        </div>
      )}

      {/* 思考气泡效果 */}
      {currentState === 'thinking' && (
        <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 pointer-events-none">
          <div className="bg-yellow-400 text-gray-800 px-2 py-1 rounded-full text-xs font-medium animate-bounce">
            💭 分析环境
          </div>
        </div>
      )}

      {/* 模式切换提示 */}
      {modeHistory.length > 0 && Date.now() - lastModeSwitch < 2000 && (
        <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 pointer-events-none">
          <div className="bg-purple-500 text-white px-2 py-1 rounded-full text-xs font-medium animate-pulse">
            🔄 切换到{getBehaviorModeText()}
          </div>
        </div>
      )}

      {/* 挫折感高时的视觉效果 */}
      {frustrationLevel > 0.8 && (
        <div className="absolute -top-6 -right-2 pointer-events-none">
          <div className="text-red-500 text-lg animate-bounce">😤</div>
        </div>
      )}
    </div>
  )
}

export default AgenticBlockNode 
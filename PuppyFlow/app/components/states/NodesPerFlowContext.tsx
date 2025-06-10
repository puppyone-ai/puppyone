import React, { useState, useCallback, useEffect, createContext, useContext, ReactElement} from 'react'
import { useReactFlow, Position } from '@xyflow/react'
import useManageReactFlowUtils from '../hooks/useManageReactFlowUtils'

export type nodesPerFlowContextType = {
    activatedNodes: Set<string>,
    activatedEdges: Set<string>,
    activatedHandle: {nodeId: string, position: Position} | null,
    preventInactivated: boolean, 
    isOnConnect: boolean, 
    isOnGeneratingNewNode: boolean,
    activateNode: (nodeId: string, addToSelection?: boolean, byHover?: boolean) => void,
    inactivateNode: (nodeId: string) => void,
    activateMultipleNodes: (nodeIds: string[]) => void,
    inactivateMultipleNodes: (nodeIds: string[]) => void,
    isNodeActivated: (nodeId: string) => boolean,
    clearNodeActivation: () => void,
    toggleNodeActivation: (nodeId: string) => void,
    activateEdge: (edgeId: string, addToSelection?: boolean) => void,
    inactivateEdge: (edgeId: string) => void,
    activateMultipleEdges: (edgeIds: string[]) => void,
    inactivateMultipleEdges: (edgeIds: string[]) => void,
    isEdgeActivated: (edgeId: string) => boolean,
    clearEdgeActivation: () => void,
    isHandleActivated: (nodeId: string, position: Position) => boolean,
    clearHandleActivation: () => void,
    clearAll: () => void, 
    generateNewNode: () => void,
    finishGeneratingNewNode: () => void,
    preventActivateOtherNodesWhenConnectStart: () => void, 
    allowActivateOtherNodesWhenConnectEnd: () => void, 
    preventInactivateNode: () => void, 
    allowInactivateNodeWhenClickOutside: () => void, 
    manageNodeasInput: (nodeId: string) => void, 
    manageNodeasOutput: (nodeId: string) => void, 
    manageNodeasLocked: (nodeId: string) => void, 
    setNodeEditable: (nodeId: string) => void, 
    setNodeUneditable: (nodeId: string) => void, 
    editNodeLabel: (nodeId: string, newLabel: string) => void, 
    setHandleActivated: (nodeId: string, handlePosition: Position | null) => void
}

const initialNodesPerFlowContext: nodesPerFlowContextType = {
    activatedNodes: new Set<string>(), 
    activatedEdges: new Set<string>(),
    activatedHandle: null,
    preventInactivated: false, 
    isOnConnect: false, 
    isOnGeneratingNewNode: false,
    activateNode: (nodeId: string, addToSelection?: boolean, byHover?: boolean) => {}, 
    inactivateNode: (nodeId: string) => {}, 
    activateMultipleNodes: (nodeIds: string[]) => {},
    inactivateMultipleNodes: (nodeIds: string[]) => {},
    isNodeActivated: (nodeId: string) => false,
    clearNodeActivation: () => {},
    toggleNodeActivation: (nodeId: string) => {},
    activateEdge: (edgeId: string, addToSelection?: boolean) => {},
    inactivateEdge: (edgeId: string) => {},
    activateMultipleEdges: (edgeIds: string[]) => {},
    inactivateMultipleEdges: (edgeIds: string[]) => {},
    isEdgeActivated: (edgeId: string) => false,
    clearEdgeActivation: () => {},
    isHandleActivated: (nodeId: string, position: Position) => false,
    clearHandleActivation: () => {},
    clearAll: () => {}, 
    generateNewNode: () => {},
    finishGeneratingNewNode: () => {},
    preventActivateOtherNodesWhenConnectStart: () => {}, 
    allowActivateOtherNodesWhenConnectEnd: () => {}, 
    preventInactivateNode: () => {}, 
    allowInactivateNodeWhenClickOutside: () => {}, 
    manageNodeasInput: (nodeId: string) => {}, 
    manageNodeasOutput: (nodeId: string) => {}, 
    manageNodeasLocked: (nodeId: string) => {}, 
    setNodeEditable: (nodeId: string) => {}, 
    setNodeUneditable: (nodeId: string) => {}, 
    editNodeLabel: (nodeId: string, newLabel: string) => {}, 
    setHandleActivated: (nodeId: string, handlePosition: Position | null) => {}
}

export const NodesPerFlowContext = createContext<nodesPerFlowContextType>(initialNodesPerFlowContext)

export function NodesPerFlowUtils() {
    const [activatedNodes, setActivatedNodes] = useState<Set<string>>(new Set<string>())
    const [activatedEdges, setActivatedEdges] = useState<Set<string>>(new Set<string>())
    const [activatedHandle, setActivatedHandle] = useState<{nodeId: string, position: Position} | null>(null)
    const [preventInactivated, setPreventInactivated] = useState(false)
    const [isOnConnect, setIsOnConnect] = useState(false)
    const [isOnGeneratingNewNode, setIsOnGeneratingNewNode] = useState(false)
    const {getNode, setNodes} = useReactFlow()
    const {judgeNodeIsEdgeNode} = useManageReactFlowUtils()

    // 检查节点是否已激活
    const isNodeActivated = useCallback((nodeId: string): boolean => {
        return activatedNodes.has(nodeId)
    }, [activatedNodes])

    // 激活单个节点
    const activateNode = useCallback((nodeId: string, addToSelection: boolean = false, byHover: boolean = false) => {
        if (isOnGeneratingNewNode) return
        if (!isOnConnect) {
            setActivatedNodes(prev => {
                const newSet = addToSelection ? new Set(prev) : new Set<string>()
                newSet.add(nodeId)
                return newSet
            })
            // 只有悬停激活时才重置preventInactivated
            if (byHover) setPreventInactivated(false)
        }
    }, [isOnGeneratingNewNode, isOnConnect])

    // 失活单个节点
    const inactivateNode = useCallback((nodeId: string) => {
        if (!preventInactivated) {
            setActivatedNodes(prev => {
                const newSet = new Set(prev)
                newSet.delete(nodeId)
                return newSet
            })
        }
    }, [preventInactivated])

    // 批量激活多个节点
    const activateMultipleNodes = useCallback((nodeIds: string[]) => {
        if (isOnGeneratingNewNode) return
        if (!isOnConnect) {
            const validNodeIds = nodeIds.filter(id => !judgeNodeIsEdgeNode(id))
            setActivatedNodes(new Set(validNodeIds))
            setPreventInactivated(false)
        }
    }, [judgeNodeIsEdgeNode, isOnGeneratingNewNode, isOnConnect])

    // 批量失活多个节点
    const inactivateMultipleNodes = useCallback((nodeIds: string[]) => {
        if (!preventInactivated) {
            setActivatedNodes(prev => {
                const newSet = new Set(prev)
                nodeIds.forEach(id => newSet.delete(id))
                return newSet
            })
        }
    }, [preventInactivated])

    // 切换节点激活状态
    const toggleNodeActivation = useCallback((nodeId: string) => {
        if (isOnGeneratingNewNode) return
        if (!isOnConnect) {
            setActivatedNodes(prev => {
                const newSet = new Set(prev)
                if (newSet.has(nodeId)) {
                    newSet.delete(nodeId)
                } else {
                    newSet.add(nodeId)
                }
                return newSet
            })
            setPreventInactivated(false)
        }
    }, [isOnGeneratingNewNode, isOnConnect])

    // 清除所有节点激活状态
    const clearNodeActivation = useCallback(() => {
        setActivatedNodes(new Set<string>())
    }, [])

    // 检查edge是否已激活
    const isEdgeActivated = useCallback((edgeId: string): boolean => {
        return activatedEdges.has(edgeId)
    }, [activatedEdges])

    // 激活单个edge
    const activateEdge = useCallback((edgeId: string, addToSelection?: boolean) => {
       
        if (!judgeNodeIsEdgeNode(edgeId) || isOnGeneratingNewNode) return
        if (!isOnConnect) {
            // 检查是否有其他edge node已经被点击
            const hasClickedEdge = Array.from(activatedEdges).some(id => id !== edgeId)
            if (hasClickedEdge) return

            setActivatedEdges(prev => {
                const newSet = addToSelection ? new Set(prev) : new Set<string>()
                newSet.add(edgeId)
                return newSet
            })
        }
    }, [judgeNodeIsEdgeNode, isOnGeneratingNewNode, isOnConnect, activatedEdges])

    // 失活单个edge
    const inactivateEdge = useCallback((edgeId: string) => {
        setActivatedEdges(prev => {
            const newSet = new Set(prev)
            newSet.delete(edgeId)
            return newSet
        })
    }, [])

    // 批量激活多个edges
    const activateMultipleEdges = useCallback((edgeIds: string[]) => {
        if (isOnGeneratingNewNode) return
        if (!isOnConnect) {
            const validEdgeIds = edgeIds.filter(id => judgeNodeIsEdgeNode(id))
            setActivatedEdges(new Set(validEdgeIds))
        }
    }, [judgeNodeIsEdgeNode, isOnGeneratingNewNode, isOnConnect])

    // 批量失活多个edges
    const inactivateMultipleEdges = useCallback((edgeIds: string[]) => {
        setActivatedEdges(prev => {
            const newSet = new Set(prev)
            edgeIds.forEach(id => newSet.delete(id))
            return newSet
        })
    }, [])

    // 清除所有edge激活状态
    const clearEdgeActivation = useCallback(() => {
        setActivatedEdges(new Set<string>())
    }, [])

    // 修改clearAll函数
    const clearAll = useCallback(() => {
        setActivatedNodes(new Set<string>())
        setActivatedEdges(new Set<string>())
        setActivatedHandle(null)
        setIsOnConnect(false)
        setPreventInactivated(false)
        setIsOnGeneratingNewNode(false)
    }, [])

    const generateNewNode = useCallback(() => {
        setIsOnGeneratingNewNode(true)
    }, [])

    const finishGeneratingNewNode = useCallback(() => {
        setIsOnGeneratingNewNode(false)
    }, [])

    const preventActivateOtherNodesWhenConnectStart = useCallback(() => {
        setIsOnConnect(true)
    }, [])

    const allowActivateOtherNodesWhenConnectEnd = useCallback(() => {
        setIsOnConnect(false)
    }, [])

    const preventInactivateNode = useCallback(() => {
        setPreventInactivated(true)
    }, [])

    const allowInactivateNodeWhenClickOutside = useCallback(() => {
        setPreventInactivated(false)
    }, [])

    // for individual node
    const manageNodeasInput = useCallback((nodeId: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? 
            {...node, data: {...node.data, isInput: !node.data.isInput, isOutput: false}}
        : node))
    }, [setNodes])

    const manageNodeasOutput = useCallback((nodeId: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? 
            {...node, data: {...node.data, isOutput: !node.data.isOutput, isInput: false}}
        : node))
    }, [setNodes])

    const manageNodeasLocked = useCallback((nodeId: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? 
            {...node, data: {...node.data, locked: !node.data.locked}}
        : node))
    }, [setNodes])

    const setNodeEditable = useCallback((nodeId: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? {...node, data: {...node.data, editable: true}} : node))
    }, [setNodes])

    const setNodeUneditable = useCallback((nodeId: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? {...node, data: {...node.data, editable: false}} : node))
    }, [setNodes])

    const editNodeLabel = useCallback((nodeId: string, newLabel: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? {...node, data: {...node.data, label: newLabel}} : node))
    }, [setNodes])

    // 检查特定handle是否激活
    const isHandleActivated = useCallback((nodeId: string, position: Position): boolean => {
        return activatedHandle?.nodeId === nodeId && activatedHandle?.position === position
    }, [activatedHandle])

    // 清除handle激活状态
    const clearHandleActivation = useCallback(() => {
        setActivatedHandle(null)
    }, [])

    const setHandleActivated = useCallback((nodeId: string, handlePosition: Position | null) => {
        if (handlePosition === null) {
            setActivatedHandle(null)
        } else {
            setActivatedHandle({nodeId, position: handlePosition})
            // 同时激活节点以保持向后兼容性
            setActivatedNodes(prev => {
                const newSet = new Set(prev)
                newSet.add(nodeId)
                return newSet
            })
        }
    }, [])

    return {
        activatedNodes, 
        activatedEdges,
        activatedHandle,
        preventInactivated, 
        isOnConnect, 
        isOnGeneratingNewNode, 
        activateNode, 
        activateEdge, 
        inactivateNode, 
        activateMultipleNodes,
        inactivateMultipleNodes,
        isNodeActivated,
        clearNodeActivation,
        toggleNodeActivation,
        inactivateEdge,
        activateMultipleEdges,
        inactivateMultipleEdges,
        isEdgeActivated,
        clearEdgeActivation, 
        isHandleActivated,
        clearHandleActivation,
        clearAll, 
        generateNewNode, 
        finishGeneratingNewNode, 
        preventActivateOtherNodesWhenConnectStart, 
        allowActivateOtherNodesWhenConnectEnd, 
        preventInactivateNode, 
        allowInactivateNodeWhenClickOutside, 
        manageNodeasInput, 
        manageNodeasOutput, 
        manageNodeasLocked, 
        setNodeEditable, 
        setNodeUneditable, 
        editNodeLabel, 
        setHandleActivated
    }
}   


type providerType = {
    children?: ReactElement | null
}

export const NodesPerFlowContextProvider = ({children}: providerType): ReactElement => {
    return (
        <NodesPerFlowContext.Provider value={NodesPerFlowUtils()}>
            {children}
        </NodesPerFlowContext.Provider>
        )
}


export const useNodesPerFlowContext = () => {
    return useContext(NodesPerFlowContext)
}


import React, { useState, useCallback, useEffect, createContext, useContext, ReactElement} from 'react'
import { useReactFlow, Position } from '@xyflow/react'
import useManageReactFlowUtils from '../hooks/useManageReactFlowUtils'

export type nodesPerFlowContextType = {
    activatedNode: {id: string, HandlePosition: Position | null} | null, 
    activatedEdge: string | null,
    preventInactivated: boolean, 
    isOnConnect: boolean, 
    isOnGeneratingNewNode: boolean,
    activateNode: (nodeId: string) => void, 
    inactivateNode: (nodeId: string) => void,
    // clearNodeActivation: () => void,
    activateEdge: (edgeId: string) => void,
    clearEdgeActivation: () => void,
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
    // showNodeEditableState: (nodeId: string) => void, 
    setHandleActivated: (nodeId: string, handlePosition: Position | null) => void
}

const initialNodesPerFlowContext: nodesPerFlowContextType = {
    activatedNode: null, 
    activatedEdge: null,
    preventInactivated: false, 
    isOnConnect: false, 
    isOnGeneratingNewNode: false,
    activateNode: (nodeId: string) => {}, 
    inactivateNode: (nodeId: string) => {}, 
    // clearNodeActivation: () => {},
    activateEdge: (edgeId: string) => {},
    clearEdgeActivation: () => {},
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
    // showNodeEditableState: (nodeId: string) => {}, 
    setHandleActivated: (nodeId: string, handlePosition: Position | null) => {}

}

export const NodesPerFlowContext = createContext<nodesPerFlowContextType>(initialNodesPerFlowContext)

export function NodesPerFlowUtils() {
    const [activatedNode, setActivatedNode] = useState<{id: string, HandlePosition: Position | null} | null>(null)
    const [activatedEdge, setActivatedEdge] = useState<string | null>(null)
    const [preventInactivated, setPreventInactivated] = useState(false)
    const [isOnConnect, setIsOnConnect] = useState(false)
    const [isOnGeneratingNewNode, setIsOnGeneratingNewNode] = useState(false)
    const {getNode, setNodes} = useReactFlow()
    const {judgeNodeIsEdgeNode} = useManageReactFlowUtils()

    // useEffect(() => {
    //     console.log(activatedNode, "activatedNode")
    // }, [activatedNode])

    const activateNode = (nodeId: string) => {
        // console.log(activatedNode, nodeId, "activate node")
        if (activatedNode?.id === nodeId) return
        if (judgeNodeIsEdgeNode(nodeId)) return
        if (isOnGeneratingNewNode) return
        if (!isOnConnect) {
            // console.log(nodeId, "activate node hihi")
            setActivatedNode({id: nodeId, HandlePosition: null})
            // setNodes(nodes => nodes.map(node => node.id !== nodeId ? {...node, data: {...node.data, ActiveHandle: null}} : node))
            setPreventInactivated(false)
        }
    }

    const inactivateNode = useCallback((nodeId: string) => {
        if (!preventInactivated) {
            setActivatedNode(null)
        }
    }, [])

    // const clearNodeActivation = useCallback(() => {
    //     setActivatedNode(null)
    //     // setNodes(nodes => nodes.map(node => judgeNodeIsEdgeNode(node.id) ? node : {...node, data: {...node.data, ActiveHandle: null}})) 
    // }, [])

    const activateEdge = useCallback((edgeId: string) => {
        
        if (!judgeNodeIsEdgeNode(edgeId) || isOnGeneratingNewNode) return
        if (!isOnConnect) {
            setActivatedEdge(edgeId)
        }
    }, [])

    const clearEdgeActivation = useCallback(() => {
        setActivatedEdge(null)
    }, [])

    // clear all , no matter if it is connected or not
    const clearAll = useCallback(() => {
        setActivatedNode(null)
        setActivatedEdge(null)
        setIsOnConnect(false)
        setPreventInactivated(false)
        setIsOnGeneratingNewNode(false)
        // setNodes(nodes => nodes.map(node => ({...node, data: {...node.data, ActiveHandle: null}})))
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
    }, [])

    const manageNodeasOutput = useCallback((nodeId: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? 
            {...node, data: {...node.data, isOutput: !node.data.isOutput, isInput: false}}
        : node))
    }, [])

    const manageNodeasLocked = useCallback((nodeId: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? 
            {...node, data: {...node.data, locked: !node.data.locked}}
        : node))
    }, [])

    const setNodeEditable = useCallback((nodeId: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? {...node, data: {...node.data, editable: true}} : node))
    }, [])

    const setNodeUneditable = useCallback((nodeId: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? {...node, data: {...node.data, editable: false}} : node))
    }, [])

    
    const editNodeLabel = useCallback((nodeId: string, newLabel: string) => {
        setNodes(nodes => nodes.map(node => node.id === nodeId ? {...node, data: {...node.data, label: newLabel}} : node))
    }, [])

    // const showNodeEditableState = useCallback((nodeId: string) => {
    //     const node = getNode(nodeId)
    //     return node?.data?.editable ?? false
    // }, [])

    const setHandleActivated = useCallback((nodeId: string, handlePosition: Position | null) => {
        // setNodes(nodes => nodes.map(node => node.id === nodeId ? {...node, data: {...node.data, ActiveHandle: handlePosition}} : node))
        setActivatedNode({id: nodeId, HandlePosition: handlePosition})
    }, [])

    return {activatedNode, activatedEdge, preventInactivated, isOnConnect, isOnGeneratingNewNode, activateNode, activateEdge, inactivateNode, clearEdgeActivation, clearAll, generateNewNode, finishGeneratingNewNode, preventActivateOtherNodesWhenConnectStart, allowActivateOtherNodesWhenConnectEnd, preventInactivateNode, allowInactivateNodeWhenClickOutside, manageNodeasInput, manageNodeasOutput, manageNodeasLocked, setNodeEditable, setNodeUneditable, editNodeLabel, setHandleActivated}
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


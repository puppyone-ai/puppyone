import React from 'react'
import {createContext, useContext, useState, useEffect, ReactElement} from 'react'
import { Position, Node, Edge } from '@xyflow/react'
import { initialNodes } from '../workflow/InitialNodes'
import { initialEdges } from '../workflow/InitialEdges'




export type handleState = {
    isConnected: boolean,
    activated: boolean,
}

export type nodeState = {
    id: string,
    activated: boolean,
    locked: boolean,
    isInput: boolean,
    isOutput: boolean,
    editable: boolean,
    preventInactivated: boolean,
    TopSrcHandle: handleState,
    BottomSrcHandle: handleState,
    LeftSrcHandle: handleState,
    RightSrcHandle: handleState,
}


type nodesContextType = {
    nodes: nodeState[],
    isOnConnect: boolean,
    totalCount: number,
    activatedEdge: string,
    addCount: (countNumber?: number) => void,
    addNode: (nodeid: string) => Promise<void>,
    deleteNode: (nodeid: string) => void,
    searchNode: (nodeid: string) => nodeState | null,
    activateNode: (nodeid: string) => Promise<void>,
    inactivateNode: (nodeid: string) => Promise<void>,
    preventActivateNode: () => void, // focus on isOnConnect
    allowActivateNode: () => void, // focus on isOnConnect
    lockNode: (nodeid:string) => void, // focus on single node prop: locked
    unlockNode: (nodeid: string) => void, // focus on single node prop: locked
    markNodeAsInput: (nodeid: string) => void, // focus on single node prop: isInput
    unmarkNodeAsInput: (nodeid: string) => void, // focus on single node prop: isInput
    markNodeAsOutput: (nodeid: string) => void, // focus on single node prop: isOutput
    unmarkNodeAsOutput: (nodeid: string) => void, // focus on single node prop: isOutput 
    allowEditLabel: (nodeid: string) => void, // focus on single node prop: editable , when allow editable, node can be edited its label / rename it
    disallowEditLabel: (nodeid: string) => void, // focus on single node prop: editable , when disallow editable, node can't be edited its label / rename it
    setHandleConnected: (nodeid: string, handlePosition: Position) => void,  // focus on handleProps: isConnected
    setHandleDisconnected: (nodeid: string, handlePosition: Position) => void,  // focus on handleProps: isConnected
    activateHandle: (nodeid: string, handlePosition: Position) => void,  // focus on handleProps: activated
    inactivateHandle:  (nodeid: string, handlePosition: Position) => void,  // focus on handleProps: activated
    preventInactivateNode: (nodeid: string) => void, // focus on nodeProps: preventInactivated
    allowInactivateNode: (nodeid: string) => void, // focus on nodeProps: preventInactivated
    activateEdgeNode: (edgeNodeid: string) => void,
    clear: () => void,
    restore: (initialNodes: Node[], initialEdges: Edge[], prevTotalCount: number | undefined) => void,
}




export const NodeContext = createContext<nodesContextType>(
    {
        nodes: [],
        isOnConnect: false,
        totalCount: 0,
        activatedEdge: "-1",
        addCount: (countNumber: number | undefined = 1) => {},
        addNode: async (nodeid) => {},
        deleteNode: (nodeid) => {},
        searchNode: (nodeid) => null,
        activateNode: async (nodeid) => {},
        inactivateNode: async (nodeid) => {},
        preventActivateNode: () => {},
        allowActivateNode: () => {},
        lockNode: (nodeid:string) => {},
        unlockNode: (nodeid: string) => {},
        markNodeAsInput: (nodeid: string) => {},
        unmarkNodeAsInput: (nodeid: string) => {},
        markNodeAsOutput: (nodeid: string) => {},
        unmarkNodeAsOutput: (nodeid: string) => {},
        allowEditLabel: (nodeid: string) => {},
        disallowEditLabel: (nodeid: string) => {},
        setHandleConnected: (nodeid, handlePosition) => {},
        setHandleDisconnected:(nodeid, handlePosition) => {},
        activateHandle: (nodeid: string, handlePosition: Position) => {},
        inactivateHandle:  (nodeid: string, handlePosition: Position) => {},
        preventInactivateNode: (nodeid: string) => {}, // focus on nodeProps: preventInactivated
        allowInactivateNode: (nodeid: string) => {}, // focus on nodeProps: preventInactivated
        activateEdgeNode: (edgeNodeid: string) => {},
        clear: () => {},
        restore: (initialNodes, initialEdges, prevTotalCount) => {}
    }
)

export function NodeProps() {
    const [nodes, setNodes] = useState<nodeState[]>([])
    const [isOnConnect, setIsOnConnect] = useState(false)
    const [totalCount, setTotalCount] = useState(0)
    const [activatedEdge, setEdgeActivate] = useState("-1")

    const addCount = (countNumber: number | undefined = 1) => {
        setTotalCount(c => c + countNumber)
    }

    let isAddingNode = false;
    useEffect(() => {
        restore(initialNodes, initialEdges, undefined)
        // console.log("end running restore")
    }, [])

    const addNode = async (nodeid: string) => {
        const sameNode = nodes.filter(node => node.id === nodeid)
        if (sameNode.length !== 0) return
        const newNode = {id:nodeid, 
                        activated: false,
                        preventInactivated: false, 
                        locked: false,
                        isInput: false,
                        isOutput: false,
                        editable: false,
                        TopSrcHandle: {isConnected: false, activated: false},
                        BottomSrcHandle: {isConnected: false, activated: false},
                        LeftSrcHandle: {isConnected: false, activated: false},
                        RightSrcHandle: {isConnected: false, activated: false}}
        setNodes(prevNodes => [...prevNodes, newNode] )
        // console.log(nodeid, "add node !")
    }

    

    // const addNode = async (nodeid: string) => {
    // if (isAddingNode) return;
    // isAddingNode = true;

    // console.log(nodeid, "add node !");
    // const sameNode = nodes.filter(node => node.id === nodeid);
    // if (sameNode.length !== 0) {
    //     isAddingNode = false;
    //     return;
    // }
    
    // const newNode = {id: nodeid, 
    //                  activated: false, 
    //                  TopSrcHandle: {isConnected: false},
    //                  BottomSrcHandle: {isConnected: false},
    //                  LeftSrcHandle: {isConnected: false},
    //                  RightSrcHandle: {isConnected: false}};
    
    // setNodes(prevNodes => {
    //     isAddingNode = false;
    //     return [...prevNodes, newNode];
    // });

    // console.log("add this node")
    // };


    const deleteNode = (nodeid:string) => {
        setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeid))
    }

    const searchNode = (nodeid: string) => {
        const targetNode = nodes.filter(node => node.id === nodeid)
        if (!targetNode.length) return null
        return targetNode[0]
    }

    const activateNode = async (nodeid: string) => {
        // console.log(`starting activate Node ${nodeid}`, nodes)
        // console.log(isOnConnect ? "prevent activate" : "allow activate")
        if (isOnConnect) return
        const targetNode = searchNode(nodeid)
        if (!targetNode || targetNode.activated) return

        setNodes(prevNodes => prevNodes.map(node => ({...node,
            activated: (node.id === nodeid ? true : false),
            preventInactivated: false,
            TopSrcHandle: {...node.TopSrcHandle, activated: false},
            BottomSrcHandle: {...node.BottomSrcHandle, activated: false},
            LeftSrcHandle: {...node.LeftSrcHandle, activated:false},
            RightSrcHandle: {...node.RightSrcHandle, activated: false}
        })))
    }

    const inactivateNode = async (nodeid: string) => {
        const targetNode = searchNode(nodeid)
        // console.log("targetNode", targetNode, "want to inactivate it")
        if (!targetNode || targetNode.preventInactivated) {
            // console.log("reject inactivate node")
            return
        }
        setNodes(prevNodes => prevNodes.map(node => ({...node,
            activated: (node.id === nodeid ? false : node.activated),
            preventInactivated: (node.id === nodeid ? false : node.preventInactivated),
            editable: (node.id === nodeid ? false : node.editable),
            TopSrcHandle: {...node.TopSrcHandle, activated: (node.id === nodeid ? false : node.TopSrcHandle.activated)},
            BottomSrcHandle: {...node.BottomSrcHandle, activated: (node.id === nodeid ? false : node.BottomSrcHandle.activated)},
            LeftSrcHandle: {...node.LeftSrcHandle, activated: (node.id === nodeid ? false : node.LeftSrcHandle.activated)},
            RightSrcHandle: {...node.RightSrcHandle, activated: (node.id === nodeid ? false : node.RightSrcHandle.activated)},
        })))
        // console.log(`disactivated node ${nodeid}`)
    }

    const preventActivateNode = () => {
        // console.log("I am on preventing others nodes from activation !")
        setIsOnConnect(true)
    }

    const allowActivateNode = () => {
        // console.log("now, you are allowed to activate nodes")
        setIsOnConnect(false)
    }

    const lockNode = (nodeid:string) => {
        const targetNode = searchNode(nodeid)
        if (!targetNode) return
        setNodes(prevNodes => 
            (prevNodes.map(node => node.id === nodeid ? {...node,locked: true, isInput: false, isOutput: false} : node))
        )
    }

    const unlockNode = (nodeid: string) => {
        const targetNode = searchNode(nodeid)
        if (!targetNode) return
        setNodes(prevNodes => 
            (prevNodes.map(node => node.id === nodeid ? {...node,locked: false} : node))
        )
    }

    const markNodeAsInput = (nodeid: string) => {
        const targetNode = searchNode(nodeid)
        if (!targetNode) return
        setNodes(prevNodes => prevNodes.map(node => node.id === nodeid ? {...node, isInput: true, isOutput: false, locked: false} : node))
    }

    const unmarkNodeAsInput = (nodeid: string) => {
        const targetNode = searchNode(nodeid)
        if (!targetNode) return
        setNodes(prevNodes => prevNodes.map(node => node.id === nodeid ? {...node, isInput: false} : node))
    }

    const markNodeAsOutput = (nodeid: string) => {
        const targetNode = searchNode(nodeid)
        if (!targetNode) return
        setNodes(prevNodes => prevNodes.map(node => node.id === nodeid ? {...node, isOutput: true, isInput: false, locked: false} : node))
    }

    const unmarkNodeAsOutput = (nodeid: string) => {
        const targetNode = searchNode(nodeid)
        if (!targetNode) return
        setNodes(prevNodes => prevNodes.map(node => node.id === nodeid ? {...node, isOutput: false} : node))
    }

    const allowEditLabel = (nodeid: string) => {
        setNodes(prevNodes => prevNodes.map(node => node.id === nodeid ? {...node, editable: true} : node))
    }

    const disallowEditLabel = (nodeid: string) => {
        setNodes(prevNodes => prevNodes.map(node => node.id === nodeid ? {...node, editable: false} : node))
    }

    const setHandleConnected = (nodeid: string, handlePosition: Position) => {
        const targetNode = nodes.filter(node => node.id === nodeid)
        const remainNode = nodes.filter(node => node.id !== nodeid)
        // console.log(nodes, targetNode, remainNode)
        if (!targetNode.length) return
        switch (handlePosition) {
            case Position.Top:
                targetNode.forEach(node => node.TopSrcHandle.isConnected = true)
                break
            case Position.Bottom:
                targetNode.forEach(node => node.BottomSrcHandle.isConnected = true)
                break
            case Position.Left:
                targetNode.forEach(node => node.LeftSrcHandle.isConnected = true)
                break
            case Position.Right:
                targetNode.forEach(node => node.RightSrcHandle.isConnected = true)
                break 
        }
        // console.log(targetNode)
        setNodes([...targetNode, ...remainNode])
    }

    // const setHandleDisconnected = (nodeid: string, handlePosition: Position) => {
    //     const targetNode = nodes.filter(node => node.id === nodeid)
    //     const remainNode = nodes.filter(node => node.id !== nodeid)
    //     if (!targetNode.length) return
    //     console.log(handlePosition)
    //     switch (handlePosition) {
    //         case Position.Top:
    //             targetNode.forEach(node => node.TopSrcHandle.isConnected = false)
    //             break
    //         case Position.Bottom:
    //             targetNode.forEach(node => node.BottomSrcHandle.isConnected = false)
    //             break

    //         case Position.Left:
    //             targetNode.forEach(node => node.LeftSrcHandle.isConnected = false)
    //             break
    //         case Position.Right:
    //             targetNode.forEach(node => node.RightSrcHandle.isConnected = false)
    //             break 
    //     }
    //     console.log(targetNode, "already disconnected")
    //     setNodes([...targetNode, ...remainNode])
    // }


    const setHandleDisconnected = (nodeid: string, handlePosition: Position) => {
        setNodes(prevNodes => {
            return prevNodes.map(node => {
                if (node.id === nodeid) {
                    const updatedNode = { ...node };
                    switch (handlePosition) {
                        case Position.Top:
                            updatedNode.TopSrcHandle = { ...updatedNode.TopSrcHandle, isConnected: false };
                            break;
                        case Position.Bottom:
                            updatedNode.BottomSrcHandle = { ...updatedNode.BottomSrcHandle, isConnected: false };
                            break;
                        case Position.Left:
                            updatedNode.LeftSrcHandle = { ...updatedNode.LeftSrcHandle, isConnected: false };
                            break;
                        case Position.Right:
                            updatedNode.RightSrcHandle = { ...updatedNode.RightSrcHandle, isConnected: false };
                            break;
                    }
                    return updatedNode;
                }
                return node;
            });
        });
    };
    

    const activateHandle = (nodeid: string, handlePosition: Position) => {
        const targetNode = searchNode(nodeid)
        if (!targetNode) return
        activateEdgeNode("-1")
        if (!targetNode?.activated) return
        
        setNodes(prevNodes => prevNodes.map(node => ({
            ...node,
            TopSrcHandle: {...node.TopSrcHandle, activated: handlePosition === Position.Top && node.id === nodeid ? true : false},
            BottomSrcHandle: {...node.BottomSrcHandle, activated: handlePosition === Position.Bottom && node.id === nodeid ? true : false},
            LeftSrcHandle: {...node.LeftSrcHandle, activated: handlePosition === Position.Left && node.id === nodeid ? true : false},
            RightSrcHandle: {...node.RightSrcHandle, activated: handlePosition === Position.Right && node.id === nodeid ? true : false}
        })
        ))
        
    }

    const inactivateHandle = (nodeid: string, handlePosition: Position) => {
        const targetNode = searchNode(nodeid)
        if (!targetNode?.activated) return
        setNodes(prevNodes => prevNodes.map(node => ({
            ...node,
            TopSrcHandle: {...node.TopSrcHandle, activated: handlePosition === Position.Top && node.id === nodeid ? false : node.TopSrcHandle.activated},
            BottomSrcHandle: {...node.BottomSrcHandle, activated: handlePosition === Position.Bottom && node.id === nodeid ? false : node.BottomSrcHandle.activated},
            LeftSrcHandle: {...node.LeftSrcHandle, activated: handlePosition === Position.Left && node.id === nodeid ? false : node.LeftSrcHandle.activated},
            RightSrcHandle: {...node.RightSrcHandle, activated: handlePosition === Position.Right && node.id === nodeid ? false : node.RightSrcHandle.activated}
        })
        ))
    }

    const preventInactivateNode = (nodeid: string) => {
        // console.log("start to prevent inactivate node", nodeid)
        const targetNode = searchNode(nodeid)
        if (!targetNode) {
            // console.log(targetNode, "targetNode is not activated, reject prevent inactivate")
           
            return
        }
        setNodes(prevNodes => prevNodes.map(node => ({
            ...node,
            preventInactivated: node.id === nodeid ? true : node.preventInactivated
        })
    ))
        // console.log("successfully prevent inactivate node", nodeid, "done")
    }

    const allowInactivateNode = (nodeid: string) => {
        const targetNode = searchNode(nodeid)
        if (!targetNode) return
        setNodes(prevNodes => prevNodes.map(node => ({
            ...node,
            preventInactivated: node.id === nodeid ? false : node.preventInactivated
        })
    ))
    }


    const activateEdgeNode = (edgeNodeid: string) => {
        if (edgeNodeid === "-1") {
            setEdgeActivate("-1") 
            return 
        }
        // console.log(activatedEdge, "this edge is activated!!!")
        setEdgeActivate(prevEdgeNodeId => prevEdgeNodeId === edgeNodeid ? "-1" : edgeNodeid)
    }

    const clear = () => {
        // not include clear locked, isInput, isOutput !!!
        // console.log("hihi")
        setNodes(prevNodes => prevNodes.map(node => ({...node, 
            activated: false,
            preventInactivated: false,
            editable: false,
            TopSrcHandle: {...node.TopSrcHandle, activated: false},
            BottomSrcHandle: {...node.BottomSrcHandle, activated: false},
            LeftSrcHandle: {...node.LeftSrcHandle, activated: false},
            RightSrcHandle: {...node.RightSrcHandle, activated: false}})))
        
        activateEdgeNode("-1")
    }

    const restore = (prevNodes: Node[], prevEdges: Edge[], prevTotalCount: number | undefined) => {
        // console.log("start to restore", prevNodes, prevEdges)
        let lastnodes: nodeState[] = prevNodes.filter(node => !isNaN(parseInt(node.id)) && String(parseInt(node.id)) === node.id).map(node => ({
            id: node.id,
            activated: false,
            preventInactivated: false,
            // 后期应该会有储存的locked, isInput, isOutput，这个时候需要从储存中读取这些值
            locked: Boolean(node.data?.locked),
            isInput: Boolean(node.data?.isInput),
            isOutput: Boolean(node.data?.isOutput),
            editable: false,
            TopSrcHandle: {isConnected: false, activated: false},
            BottomSrcHandle: {isConnected: false, activated: false},
            LeftSrcHandle: {isConnected: false, activated: false},
            RightSrcHandle: {isConnected: false, activated: false},
        }))
        // console.log(lastnodes, "ohoh")

        for (let edge of prevEdges){
            if (!edge.sourceHandle) continue
            const sourceNode = lastnodes.filter(node => node.id === edge.source)
            // const targetNode = lastnodes.filter(node => node.id === edge.target)
            if (!sourceNode.length) continue
            switch (edge.sourceHandle) {
                case `${edge.source}-a`:
                    sourceNode[0].TopSrcHandle.isConnected = true
                    // targetNode[0].BottomSrcHandle = {isConnected: true}
                    break
                case `${edge.source}-b`:
                    sourceNode[0].RightSrcHandle.isConnected = true
                    // targetNode[0].LeftSrcHandle = {isConnected: true}
                    break 
                case `${edge.source}-c`:
                    sourceNode[0].BottomSrcHandle.isConnected = true
                    // targetNode[0].TopSrcHandle = {isConnected: true}
                    break 
                case `${edge.source}-d`:
                    sourceNode[0].LeftSrcHandle.isConnected = true
                    // targetNode[0].RightSrcHandle = {isConnected: true}
                    break
            }
            const remainNodes = lastnodes.filter(node => node.id !== edge.source)
            lastnodes = [...remainNodes, sourceNode[0]]
        }

        // for (let node of nodes) {
        //     const target = lastnodes.filter(n => n.id === node.id)
        //     if (target.length === 0) lastnodes.push(node)
        // }
        // console.log(lastnodes, "lastnodes successfully restored")
        setNodes(lastnodes)
        setTotalCount(prevTotalCount ?? lastnodes.length)
    }

    return {nodes, 
            isOnConnect,
            totalCount,
            activatedEdge,
            addCount,
            addNode, 
            deleteNode, 
            searchNode, 
            activateNode, 
            inactivateNode, 
            preventActivateNode,
            allowActivateNode,
            lockNode,
            unlockNode,
            markNodeAsInput,
            unmarkNodeAsInput,
            markNodeAsOutput,
            unmarkNodeAsOutput,
            allowEditLabel,
            disallowEditLabel,
            setHandleConnected,
            setHandleDisconnected,
            activateHandle,
            inactivateHandle,
            preventInactivateNode,
            allowInactivateNode,
            activateEdgeNode,
            clear,
            restore}

    
}

type providerType = {
    children?: ReactElement | null
}

export const NodeContextProvider = ({children}: providerType): ReactElement => {
    return (
        <NodeContext.Provider value={NodeProps()}>
            {children}
        </NodeContext.Provider>
        )
}


export const useNodeContext = () => {
    return useContext(NodeContext)
}
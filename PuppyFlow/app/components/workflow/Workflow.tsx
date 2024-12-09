'use client'
import React, { useCallback, useEffect, useState, useRef} from 'react'
import { initialNodes } from './InitialNodes'
import {ReactFlow,
    addEdge, 
    Background, 
    Connection,
    Edge,
    Node,
    useEdgesState,
    useNodesState, 
    BackgroundVariant,
    MarkerType,
    Position, 
    useReactFlow} from '@xyflow/react'
import TextBlockNode from './nodes/TextBlockNode'
import { initialEdges } from './InitialEdges'
import '@xyflow/react/dist/style.css';
import WebLinkNode from './nodes/WebLinkNode'
import AddNodeButton from './buttonControllers/AddNodeButton'
import Upbar from '../upbar/Upbar'
import ModeController from '../upbar/topRightToolBar/ModeController'
import { nodeState, useNodeContext } from '../states/NodeContext'
import JsonBlockNode from './nodes/JsonNode'
import LoadConfig from './edges/configNodes/LoadConfig'
import ChunkingConfig from './edges/configNodes/ChunkingConfig'
import CodeConfig from './edges/configNodes/CodeConfig'
import GenerateConfig from './edges/configNodes/GenerateConfig'
import ChooseConfig from './edges/configNodes/ChooseConfig'
import SourceToConfigEdge from './edges/SourceToConfigEdge'
import LLMConfig from './edges/configNodes/LLMConfig'
import SearchConfig from './edges/configNodes/SearchConfig'
import SwitchNode from './nodes/SwitchNode'
import FileNode from './nodes/FileNode'
import VectorNode from './nodes/VectorNode'
import VectorDatabaseNode from './nodes/VectorDatabaseNode'
import StructuredTextDatabaseNode from './nodes/StructuredTextDatabaseNode'
import EmbeddingConfig from './edges/configNodes/EmbeddingConfig'
import ResultBlockNode from './nodes/ResultNode'
import ConfigToTargetEdge from './edges/ConfigToTargetEdge'
import ModifyConfig from './edges/configNodes/ModifyConfig'
import useManageReactFlowUtils from '../hooks/useManageReactFlowUtils'
import { markerEnd } from './edges/ConfigToTargetEdge'


const nodeTypes = {
    'text': TextBlockNode,
    'none': ResultBlockNode,
    'switch': SwitchNode,
    'file': FileNode,
    'weblink': WebLinkNode,
    'structured': JsonBlockNode,
    'vector': VectorNode,
    'vector_database': VectorDatabaseNode,
    'database': StructuredTextDatabaseNode,
    'load': LoadConfig,
    'chunk': ChunkingConfig,
    'code': CodeConfig,
    'generate': GenerateConfig,
    'llm': LLMConfig,
    'search': SearchConfig,
    'embedding': EmbeddingConfig,
    'modify': ModifyConfig,
    'choose': ChooseConfig,
}

const edgeTypes = {
  'STC': SourceToConfigEdge,
  'CTT': ConfigToTargetEdge,
}

const fitViewOptions = {
  maxZoom: 0.7,

}

function Workflow() {


  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [newConnectedEdge, setNewConnectedEdge] = useState<Edge | null>(null)
  const connectingNodeId = useRef<string | null>(null)
  const connectingHandleId = useRef<string | null>(null)
  const {setHandleConnected, preventActivateNode, allowActivateNode, isOnConnect, searchNode, addNode, nodes: newNodes, activateNode, preventInactivateNode,
    inactivateNode, clear, activateHandle, addCount, totalCount, activateEdgeNode
  } = useNodeContext()
  const {screenToFlowPosition, getEdge, getNode, getViewport, getZoom} = useReactFlow()
  const {zoomOnScroll, lockZoom, freeZoom} = useManageReactFlowUtils()

  // useEffect(() => {
  //   console.log(getZoom())
  // }, [getZoom()])
  
  // useEffect(() => {
  //   // 定义事件处理函数
  //   const handleTouchStart = (event) => {
  //     // 这里可以调用你的 onConnectStart 函数
  //     onConnectStart(event, { handleType: 'source' });
  //   };

  //   // 添加被动事件监听器
  //   document.addEventListener('touchstart', handleTouchStart, { passive: true });

  //   // 在组件卸载时移除事件监听器
  //   return () => {
  //     document.removeEventListener('touchstart', handleTouchStart);
  //   };
  // }, [])


  // useEffect(() => {
  //   const onMouseUp = (event: MouseEvent) => {
  //     console.log(event)
  //     allowActivateNode()
  //   }

  //   document.addEventListener('mouseup', onMouseUp)
  //   // 清理函数，用于移除事件监听器
  //   return () => {
  //     document.removeEventListener('mouseup', onMouseUp);
  //   };
  // }, [])




  useEffect(() => {
    if (!newConnectedEdge) return
    // console.log(newConnectedEdge, newNodes, edges, "start to connect handle")
    let currentReferenceNode = searchNode(newConnectedEdge.source);
    // console.log(currentReferenceNode)
    if (!currentReferenceNode) return
    // 防止是因为删除edge产生的副作用
    if (!getEdge(newConnectedEdge.id)) return

    if (newConnectedEdge.sourceHandle) {
      let sourceHandlePosition: Position | null
      switch (newConnectedEdge.sourceHandle) {
        case `${newConnectedEdge.source}-a`:
          sourceHandlePosition = Position.Top
          break
        case `${newConnectedEdge.source}-b`:
          sourceHandlePosition = Position.Right
          break
        case `${newConnectedEdge.source}-c`:
          sourceHandlePosition = Position.Bottom
          break
        case `${newConnectedEdge.source}-d`:
          sourceHandlePosition = Position.Left
          break
        default:
          sourceHandlePosition = null
      }
      // console.log(`connected handle is ${sourceHandlePosition}`, searchNode(newConnectedEdge.source))
      if (sourceHandlePosition) {
        setHandleConnected(newConnectedEdge.source, sourceHandlePosition)
      }
    }
    
  }, [edges, newConnectedEdge])

  const [connectionLineStyle, setConnectionLineStyle] = useState<React.CSSProperties>({
    strokeWidth: "3px",
    stroke: "#FFA73D",
  })
  const onConnect = useCallback((connection: Connection) => {
    // console.log(connection, "connection start")
    // if (!connection.source) return
    // allowActivateNode()
    // connectingNodeId.current = null
    // connectingHandleId.current = null
    const targetNodeType = getNode(connection.target)?.type
    const sourceNodeType = getNode(connection.source)?.type
    const targetIsEdgeNode = targetNodeType === 'load' ||
    targetNodeType === 'chunk' ||
    targetNodeType === 'code' ||
    targetNodeType === 'generate' ||
    targetNodeType === 'llm' ||
    targetNodeType === 'search' ||
    targetNodeType === 'embedding' ||
    targetNodeType === 'modify' ||
    targetNodeType === 'choose'
    const sourceIsEdgeNode = sourceNodeType === 'load' ||
    sourceNodeType === 'chunk' ||
    sourceNodeType === 'code' ||
    sourceNodeType === 'generate' ||
    sourceNodeType === 'llm' ||
    sourceNodeType === 'search' ||
    sourceNodeType === 'embedding' ||
    sourceNodeType === 'modify' ||
    sourceNodeType === 'choose'
    if (targetIsEdgeNode && sourceIsEdgeNode ||
      !targetIsEdgeNode && !sourceIsEdgeNode
    ) return
    const edge: Edge = {...connection, 
                        id: `connection-${Date.now()}`, 
                        type: !sourceIsEdgeNode && targetIsEdgeNode ? 'STC' : 'CTT', 
                        markerEnd: !sourceIsEdgeNode && targetIsEdgeNode ? undefined : markerEnd
                      }
    
    
    setEdges((prevEdges:Edge[]) => addEdge(edge, prevEdges))
    // console.log(edge, "you are  generating edge")
   
    setNewConnectedEdge(edge)
  
    
    allowActivateNode()
    // console.log(edges)

  }, [setEdges])

  const onConnectStart = (event: MouseEvent | TouchEvent, {nodeId, handleId, handleType }: { nodeId:string | null, handleId: string | null, handleType: 'target' | 'source' | null }) => {
    event.preventDefault()
    event.stopPropagation()
    if (nodeId) preventInactivateNode(nodeId)
    preventActivateNode()
    
    // console.log(isOnConnect)
    if (handleType === 'target') {
      setConnectionLineStyle({
        strokeWidth: "3px",
        stroke: "transparent",
      })
    }
    else {
      setConnectionLineStyle({
        strokeWidth: "3px",
        stroke: "#FFA73D",
      })
      // connectingNodeId.current = nodeId
      // connectingHandleId.current = handleId
    }
  }

  const onConnectEnd = (event: MouseEvent | TouchEvent) => {
    event.preventDefault()
    event.stopPropagation()
    // console.log(event.target)
    // if (connectingNodeId.current && connectingHandleId.current) {
    //   const target = event.target as unknown as HTMLElement
    //   if (!target) {
    //     connectingNodeId.current = null 
    //     connectingHandleId.current = null
    //   }
    //   else {
    //     const targetIsPane = target.classList.contains('react-flow__pane');
    //     if (targetIsPane && event instanceof MouseEvent) {
    //     const id = `${totalCount + 1}`
    //     const newNode = {
    //       id,
    //       position: screenToFlowPosition({
    //         x: event.clientX,
    //         y: event.clientY,
    //       }),
    //       type: "textBlock",
    //       data: {
    //             textContent: ""
    //       }
    //     }
    //     addCount()
    //     addNode(newNode.id)
    //     setNodes(nds => nds.concat(newNode))
    //     setEdges((eds) => eds.concat({
    //       id: `edge${connectingNodeId.current}-${newNode.id}-${Date.now()}`,
    //       source: connectingNodeId.current!,
    //       target: newNode.id,
    //       type: 'LLM',
    //       sourceHandle: connectingHandleId.current!,
    //       markerEnd: {
    //           type: MarkerType.Arrow,
    //           width: 10,
    //           height: 30,
    //           color: "#4599DF"
    //         },
    //   })) 

    //     const handlePosition = connectingHandleId.current === `${connectingNodeId.current}-a`? Position.Top :  connectingHandleId.current === `${connectingNodeId.current}-b` ? Position.Right :
    //     connectingHandleId.current === `${connectingNodeId.current}-c` ? Position.Bottom : connectingHandleId.current === `${connectingNodeId.current}-d` ? Position.Left : null
    //     if (handlePosition) setHandleConnected(connectingNodeId.current, handlePosition)
    //     allowActivateNode()
    //   }
      
    //   }

    // }
    allowActivateNode()

  }

  const bringToFront = (event: React.MouseEvent<Element, MouseEvent>, id:string) => {
   
   
    setNodes((nds) => {
      const nodeIndex = nds.findIndex((node) => node.id === id);
      const node = nds[nodeIndex];
      const newNodes = [...nds];
      newNodes.splice(nodeIndex, 1);
      newNodes.push(node);
      return newNodes;
    });
    
    const target = event.target as unknown as HTMLElement
    if (target.id === "edgeMenu") {
      return
    }

    // then activate node
    // console.log(`reenter this node`)
    activateNode(id)

  };

  const onNodeMouseLeave = (id: string) => {
    // if (isOnConnect) return
    // console.log(searchNode(id), "when mouse leave")
    if (searchNode(id)?.preventInactivated) return
    inactivateNode(id)
    
  }

  const onNodeClick = (id: string) => {
      // const targetNode = searchNode(id)
      // console.log(targetNode)
      // if (!targetNode) return
      // if (!targetNode.activated) activateNode(id)
      activateNode(id)
      // activateEdgeNode(id)
  }

  const onPaneClick = () => {
    clear()
    allowActivateNode()
  }

  

  
  return (
    
    <div className='w-full h-full overflow-hidden'>
        <ReactFlow id="flowChart"
         nodes={nodes}
         edges={edges}
         nodeTypes={nodeTypes}
         edgeTypes={edgeTypes}
         fitViewOptions={fitViewOptions}
         onNodesChange={onNodesChange}
         onEdgesChange={onEdgesChange}
         onConnect={onConnect}
         onNodeMouseEnter={(event, node) => {
          bringToFront(event, node.id)
          // if (node.type === "text") {
          //   lockZoom()
          // }
         }}
         onNodeMouseLeave={(event, node) => {
          onNodeMouseLeave(node.id)
          // if (node.type === "text") {
          //   freeZoom()
          // }
         }}
         onNodeClick={(event, node) => onNodeClick(node.id)}
        //  onDelete={onDelete}
         onConnectStart={onConnectStart}
         onConnectEnd={onConnectEnd}
         onPaneClick={onPaneClick}
         connectionLineStyle={connectionLineStyle}
         snapToGrid={true}
         snapGrid={[16, 16]}
         fitView
        
         minZoom={0.7}           // 最小缩放级别
         maxZoom={1.5} 
         zoomOnScroll={zoomOnScroll ?? true}
         
         >
          <Upbar />
          <Background color="#646464" variant={BackgroundVariant.Dots} gap={16}/>
        </ReactFlow>
    </div>
  )
}

export default Workflow
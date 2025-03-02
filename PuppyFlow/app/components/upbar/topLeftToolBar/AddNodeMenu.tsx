import React, {useEffect, useState, useCallback, useRef} from 'react'
import { useReactFlow } from '@xyflow/react';
// import { useNodeContext } from '../../states/NodeContext';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import { nanoid } from 'nanoid';
import { Transition } from '@headlessui/react'

type menuProps = {
    selectedMenu: number,
    clearMenu: () => void,
    // onMenuButtonClick: (nodeType: string) => void,
}

export type nodeSmallProps = {
  nodeid: string,
  nodeType: string,
}

type menuNameType = null | "Textsub1" | "StructuredTextsub1" | "Filesub1" | "Switchsub1" | "VectorDatabasesub1" | "Otherssub1"


function NodeMenu({selectedMenu, clearMenu}: menuProps) {

  const {getNodes, setNodes, screenToFlowPosition, getZoom} = useReactFlow()
  // const {addNode, nodes, totalCount, addCount, allowActivateNode, clear} = useNodeContext()
  const { allowActivateOtherNodesWhenConnectEnd, clearAll, preventActivateOtherNodesWhenConnectStart, generateNewNode, finishGeneratingNewNode, isOnGeneratingNewNode} = useNodesPerFlowContext()
  const [node, setNode] = useState<nodeSmallProps | null>(null)
  // const [isAdd, setIsAdd] = useState(false)
  

  // for drag and drop purpose
  const [isDragging, setIsDragging] = useState(false);
  const [draggedNodeType, setDraggedNodeType] = useState<string | null>(null);
  const [mousePosition, setMousePosition] = useState<{x: number, y: number} | null>(null);
  const [lastMousePosition, setLastMousePosition] = useState<{x: number, y: number} | null>(null);
  // const lastMousePositionRef = useRef<{x: number, y: number} | null>(null);

  const handleMouseDown = useCallback((nodeType: string) => {
    setIsDragging(true);
    setDraggedNodeType(nodeType);
    generateNewNode()
    clearMenu()
  }, []);


  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (isDragging) {
      setMousePosition({ x: event.clientX, y: event.clientY });
    }
  }, [isDragging]);



  const handleMouseSettlePosition = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (isDragging && draggedNodeType) {
      const newNodeId = nanoid(6);
      // const newNodeId = `node-${Date.now()}`
      // const newNodeId = `${totalCount + 1}`;
      // if (!mousePosition) return
      const position = screenToFlowPosition({
        x: event.clientX - 32 * getZoom(),
        y: event.clientY - 32 * getZoom(),
      });
      setNode({nodeid: newNodeId, nodeType: draggedNodeType});
      // setIsAdd(false);
      setMousePosition(position);
      // setLastMousePosition(position)
      
    }
  }, [isDragging, draggedNodeType]);

  // 新增：右键点击事件处理函数
  const handleRightClick = useCallback((event: MouseEvent) => {
    event.preventDefault();
    if (isOnGeneratingNewNode) {
      // 重置状态
      setIsDragging(false);
      setDraggedNodeType(null);
      setMousePosition(null);
      setNode(null);
      clearAll();
      console.log('Node generation cancelled');
    }
  }, [isOnGeneratingNewNode]);

      
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove as unknown as EventListener);
      document.addEventListener('click', handleMouseSettlePosition as unknown as EventListener);
      document.addEventListener('contextmenu', handleRightClick as unknown as EventListener); // 新增监听右键点击
      return () => {
        document.removeEventListener('mousemove', handleMouseMove as unknown as EventListener);
        document.removeEventListener('click', handleMouseSettlePosition as unknown as EventListener);
        document.removeEventListener('contextmenu', handleRightClick as unknown as EventListener); // 移除监听
      };
    }
  }, [isDragging, handleMouseMove, handleMouseSettlePosition, handleRightClick]);


//   const handleMouseMove = useCallback((event: MouseEvent) => {
//     if (isDragging) {
//         // 更新最后的鼠标位置
//         lastMousePositionRef.current = {
//             x: event.clientX,
//             y: event.clientY
//         };
//         setMousePosition({ x: event.clientX, y: event.clientY });
//     }
// }, [isDragging]);

// const handleMouseSettlePosition = useCallback((event: React.MouseEvent) => {
//     if (isDragging && draggedNodeType && lastMousePositionRef.current) {
//         event.preventDefault();
//         event.stopPropagation();
        
//         const newNodeId = nanoid(6);
//         // 使用记录的最后位置，而不是 click 事件的位置
//         const position = screenToFlowPosition({
//             x: lastMousePositionRef.current.x - 32 * getZoom(),
//             y: lastMousePositionRef.current.y - 32 * getZoom(),
            
//         });
      
//         setNode({nodeid: newNodeId, nodeType: draggedNodeType});
//         setMousePosition(position);
//     }
// }, [isDragging, draggedNodeType, screenToFlowPosition, getZoom]);

// useEffect(() => {
//     if (isDragging) {
//         const handleMouseMoveEvent = (e: MouseEvent) => handleMouseMove(e);
//         const handleMouseSettleEvent = (e: MouseEvent) => {
//             const reactEvent = e as unknown as React.MouseEvent;
//             handleMouseSettlePosition(reactEvent);
//         };

//         document.addEventListener('mousemove', handleMouseMoveEvent);
//         document.addEventListener('click', handleMouseSettleEvent);
        
//         return () => {
//             document.removeEventListener('mousemove', handleMouseMoveEvent);
//             document.removeEventListener('click', handleMouseSettleEvent);
//             // 清理最后位置记录
//             lastMousePositionRef.current = null;
//         };
//     }
// }, [isDragging, handleMouseMove, handleMouseSettlePosition]);
  
  /*
    0: Text + TextSubMenu
    1: StructuredText + StructuredTextSubMenu
    2: Vector + VectorSubMenu
    3: Switch + SwitchSubMenu
    4: Database + DatabaseSubMenu
    5: Others + OtherNodesSubMenu  
  */
  const [selectedNodeMenuSubMenu, setSelectedNodeMenuSubMenu] = useState(-1)

  // useEffect(() => {
  //   console.log("mousePosition", mousePosition)
  // }, [mousePosition])

  useEffect(() => {

    if (!node || !isOnGeneratingNewNode) return

  
    if (mousePosition) {
      console.log("mousePosition will be set", mousePosition)
      const defaultNodeContent = node.nodeType === "switch" ? "OFF" : ""
      new Promise(resolve => {
        setNodes(prevNodes => {
            resolve(null);  // 在状态更新完成后解析 Promise
            return [
                ...prevNodes,
                {
                    id: node.nodeid,
                    position: mousePosition,
                    data: { 
                      content: defaultNodeContent,
                      label: node.nodeid,
                      isLoading: false,
                      locked: false,
                      isInput: false,
                      isOutput: false,
                      editable: false,
                     },
                    type: node.nodeType,
                }
            ];
        });
    }).then(() => {
        
      setNode(null);
      setIsDragging(false);
      setDraggedNodeType(null);
      setMousePosition(null);
       
    }).finally(() => {
      clearAll()
      
    });
    }
  }, [node, isOnGeneratingNewNode])

  useEffect(() => {
    if (selectedMenu === 0) {
      setSelectedNodeMenuSubMenu(-1)
    }
  } , [selectedMenu])



  const manageNodeMenuSubMenu = (menuName: menuNameType) => {
    let value = -1
    if (menuName === null) {
      setSelectedNodeMenuSubMenu(-1)
      return
    }
    switch (menuName) {
      case  "Textsub1":
        value = 0
        break
      case "StructuredTextsub1":
        value = 1
        break
      case "Filesub1":
        value = 2
        break
      case "Switchsub1":
        value = 3
        break
      // case 'Databasesub1':
      //   value = 4
      //   break
      case 'VectorDatabasesub1':
        value = 4
        break
      case 'Otherssub1':
        value = 5
        break
      default:
        value = -1
        break
    }
    setSelectedNodeMenuSubMenu(value)
    return
  }


  //  渲染拖拽指示器
   const renderDragIndicator = () => {
    if (!isDragging || !draggedNodeType || !mousePosition || !isOnGeneratingNewNode || node ) return <></>;

    const getNodeIcon = () => {
      switch (draggedNodeType) {
        case "text":
          return (
            <span className="bg-gradient-to-r from-blue-400 to-blue-600 text-transparent bg-clip-text text-[24px]">
              Aa
            </span>
          );
        case "structured":
          return (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="structuredGradient" x1="2" y1="2" x2="22" y2="22">
                  <stop offset="0%" stopColor="#A78BFA" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
              </defs>
              <rect x="2" y="2" width="20" height="20" rx="3" stroke="url(#structuredGradient)" strokeWidth="1.5"/>
              <rect x="5" y="6" width="14" height="2.5" rx="1" fill="url(#structuredGradient)"/>
              <rect x="5" y="11" width="11" height="2.5" rx="1" fill="url(#structuredGradient)"/>
              <rect x="5" y="16" width="8" height="2.5" rx="1" fill="url(#structuredGradient)"/>
            </svg>
          );
        case "file":
          return (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#gradient1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#22C55E" />
                  <stop offset="100%" stopColor="#16A34A" />
                </linearGradient>
              </defs>
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
              <polyline points="13 2 13 9 20 9"></polyline>
            </svg>
          );
        case "weblink":
          return (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#gradient2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#F59E0B" />
                  <stop offset="100%" stopColor="#D97706" />
                </linearGradient>
              </defs>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
          );
        default:
          return null;
      }
    };

    return (
      <div
        style={{
          position: 'fixed',
          width: '64px',  // 固定宽度
          height: '64px', // 固定高度
          left: mousePosition.x + 32 * getZoom(),
          top: mousePosition.y + 32 * getZoom(),
          pointerEvents: 'none',
          zIndex: 100000,
          transform: 'translate(-50%, -50%)'
        }}
        className="flex items-center justify-center bg-[#1C1D1F] rounded-lg border border-[#6D7177]"
      >
        {getNodeIcon()}
      </div>
    );
  };

  return (
        <>
          <Transition
    show={selectedMenu === 1}
    enter="transition duration-100 ease-out"
    enterFrom="transform opacity-0 translate-y-[-10px]"
    enterTo="transform opacity-100 translate-y-0"
    leave="transition duration-75 ease-in"
    leaveFrom="transform opacity-100 translate-y-0"
    leaveTo="transform opacity-0 translate-y-[-10px]"
  >
    <ul id="nodeMenu" className={`will-change-auto bg-[#1c1d1f] rounded-[16px] border-solid border-[1.5px] border-[#3e3e41] absolute top-[62px] left-[37px] z-[10000] text-white flex flex-col gap-[16px] p-[14px] transition-all duration-300 ease-in-out transform origin-top pointer-events-auto shadow-lg min-w-[384px] backdrop-blur-sm bg-opacity-95`} onMouseLeave={() => manageNodeMenuSubMenu(null)} >
      
      {/* First Section Title */}
      <div className="flex items-center gap-3 px-2 group">
        <span className="text-[11px] font-medium text-gray-500 whitespace-nowrap flex items-center gap-2">
          <div className="w-1 h-1 rounded-full bg-blue-500"></div>
          Text Elements
        </span>
        <div className="h-[1px] flex-grow bg-gradient-to-r from-gray-600 to-transparent opacity-50"></div>
      </div>

      {/* First Row - Text Elements */}
      <div className="grid grid-cols-2 gap-[12px] px-1">
        <button className={`group w-[180px] h-[64px] bg-[#2A2B2D] rounded-[10px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#2563EB] hover:shadow-blue-500/20 hover:shadow-lg transition-all duration-200 relative overflow-hidden`} 
        onMouseEnter={() => {manageNodeMenuSubMenu("Textsub1")}}
        onMouseLeave={() => {manageNodeMenuSubMenu(null)}}
        onClick={(event)=> {
          event.preventDefault()
          event.stopPropagation()
          handleMouseDown("text")
        }}>
          <div className='absolute inset-0 bg-gradient-to-r from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200'></div>
          <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center text-[20px] font-[500] rounded-[8px] shadow-inner relative'>
            <span className="bg-gradient-to-r from-blue-400 to-blue-600 text-transparent bg-clip-text group-hover:scale-110 transition-transform duration-200">Aa</span>
          </div>
          <div className='flex flex-col items-start relative'>
            <div className='text-[14px] font-[600] text-white group-hover:text-white transition-colors'>Text</div>
            <div className='text-[11px] font-[400] text-gray-400 group-hover:text-gray-200 transition-colors'>Basic text node</div>
          </div>
        </button>

        <button className={`group w-[180px] h-[64px] bg-[#2A2B2D] rounded-[10px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#2563EB] hover:shadow-blue-500/20 hover:shadow-lg transition-all duration-200 relative overflow-hidden`} 
        onMouseEnter={() => {manageNodeMenuSubMenu("StructuredTextsub1")}}
        onMouseLeave={() => {manageNodeMenuSubMenu(null)}}
        onClick={(event)=> {
          event.preventDefault()
          event.stopPropagation()
          handleMouseDown("structured")
        }}>
          <div className='absolute inset-0 bg-gradient-to-r from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200'></div>
          <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center rounded-[8px] shadow-inner relative'>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="structuredGradient" x1="2" y1="2" x2="22" y2="22">
                  <stop offset="0%" stopColor="#A78BFA" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
              </defs>
              {/* Main container with clearer border */}
              <rect x="2" y="2" width="20" height="20" rx="3" stroke="url(#structuredGradient)" strokeWidth="1.5" strokeOpacity="0.5"/>
              
              {/* Top line - longest */}
              <rect x="5" y="6" width="14" height="2.5" rx="1" fill="url(#structuredGradient)" fillOpacity="0.9"/>
              
              {/* Middle line - medium */}
              <rect x="5" y="11" width="11" height="2.5" rx="1" fill="url(#structuredGradient)" fillOpacity="0.6"/>
              
              {/* Bottom line - shortest */}
              <rect x="5" y="16" width="8" height="2.5" rx="1" fill="url(#structuredGradient)" fillOpacity="0.3"/>
            </svg>
          </div>
          <div className='flex flex-col items-start relative'>
            <div className='text-[13px] font-[600] text-white leading-tight'>Structured Text</div>
            <div className='text-[11px] font-[400] text-gray-400 group-hover:text-gray-200'>JSON format</div>
          </div>
        </button>
      </div>

      {/* Second Section Title */}
      <div className="flex items-center gap-3 px-2 group mt-1">
        <span className="text-[11px] font-medium text-gray-500 whitespace-nowrap flex items-center gap-2">
          <div className="w-1 h-1 rounded-full bg-orange-500"></div>
          External Resources
        </span>
        <div className="h-[1px] flex-grow bg-gradient-to-r from-gray-600 to-transparent opacity-50"></div>
      </div>

      {/* Second Row - Resource Elements */}
      <div className="grid grid-cols-2 gap-[12px] px-1">
        <button className={`w-[180px] h-[64px] bg-[#2A2B2D] rounded-[10px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#2563EB] hover:shadow-blue-500/20 hover:shadow-lg transition-all duration-200`} 
        onMouseEnter={() => {manageNodeMenuSubMenu("Filesub1")}}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          handleMouseDown("file")
        }}>
          <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center rounded-[8px] shadow-inner'>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="url(#gradient1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="gradient1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#22C55E" />
                  <stop offset="100%" stopColor="#16A34A" />
                </linearGradient>
              </defs>
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
              <polyline points="13 2 13 9 20 9"></polyline>
            </svg>
          </div>
          <div className='flex flex-col items-start'>
            <div className='text-[14px] font-[600] text-white'>File</div>
            <div className='text-[11px] font-[400] text-gray-400'>Upload & Process</div>
          </div>
        </button>

        <button className='w-[180px] h-[64px] bg-[#2A2B2D] rounded-[10px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#2563EB] hover:shadow-blue-500/20 hover:shadow-lg transition-all duration-200' 
        onClick={(event)=> {
          event.preventDefault()
          event.stopPropagation()
          handleMouseDown("weblink")
        }}>
          <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center rounded-[8px] shadow-inner'>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="url(#gradient2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <defs>
                <linearGradient id="gradient2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#F59E0B" />
                  <stop offset="100%" stopColor="#D97706" />
                </linearGradient>
              </defs>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
          </div>
          <div className='flex flex-col items-start'>
            <div className='text-[14px] font-[600] text-white'>Weblink</div>
            <div className='text-[11px] font-[400] text-gray-400'>URL resource</div>
          </div>
        </button>
      </div>

    </ul>
      </Transition>
        {renderDragIndicator()}
        </>
  )
}

export default NodeMenu
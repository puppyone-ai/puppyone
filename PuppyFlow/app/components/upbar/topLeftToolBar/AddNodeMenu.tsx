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

    // const addNodeAndSetFlag = async () => {
    //   await addNode(node.nodeid); // 假设 addNode 返回一个 Promise
    //   setIsAdd(true);
    // };

    // if (!isAdd) {
    //   addNodeAndSetFlag()
    //   addCount()
    // }

   
    //   if (mousePosition) {
    //     // console.log(nodes)
    //   // const location = Math.random() * 500;
    //   setNodes(prevNodes => [
    //     ...prevNodes,
    //     {
    //         id: node.nodeid,
    //         position: mousePosition,
    //         data: { 
    //           content: "",
    //           label: node.nodeid,
    //           isLoading: false,
    //           locked: false,
    //           isInput: false,
    //           isOutput: false,
    //           editable: false,
    //          },
    //         type: node.nodeType,
    //     }
    // ]);
    //   setNode(null)
    //   // setIsAdd(false)
    //   setIsDragging(false)
    //   setDraggedNodeType(null)
    //   setMousePosition(null)
    //   // allowActivateOtherNodesWhenConnectEnd()
    //   clearAll()

    // }
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

    

  


    let renderSvgName: string
    switch (draggedNodeType) {
      case "text":
        renderSvgName = "textblocknodePrototype.svg"
        break
      case "structured":
        renderSvgName = "structurednodePrototype.svg"
        break
      case "file":
        renderSvgName = "filenodePrototype.svg"
        break
      case "switch":
        // 还没设定呢！！
        renderSvgName = ""
        break
      case "database":
        renderSvgName = "structureddbNodePrototype.svg"
        break 
      case "vector_database":
        renderSvgName = "vectordbNodePrototype.svg"
        break
      case "vector":
        renderSvgName = "vectornodePrototype.svg"
        break
      case "weblink":
        renderSvgName = "weblinkNodePrototype.svg"
        break
      default:
        renderSvgName = ""
        break
    }

    return (
      <div
        style={{
          position: 'fixed',
          width: `${getZoom() * 186}px`,
          height: `${getZoom() * 96}px`,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          left: mousePosition.x + 93 * getZoom(),
          top: mousePosition.y + 48 * getZoom(),
          pointerEvents: 'none',
          zIndex: 100000,
          fontSize: "8px",
          fontFamily: "JetBrains Mono",
          background: '#1C1D1F',
          color: '#CDCDCD',
          borderRadius: '8px',
          borderColor: "2px solid #6D7177",
          transform: 'translate(-50%, -50%)'
        }}
      >
        <img src={renderSvgName} alt="text block Node Prototype" width={getZoom() * 186} height={getZoom() * 96} style={{
          pointerEvents: 'none'
        }}/>
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
    <ul id="nodeMenu" className={`will-change-auto bg-[#1c1d1f] rounded-[16px] border-solid border-[1.5px] border-[#3e3e41] absolute top-[62px] left-[37px] z-[10000] text-white flex flex-col justify-evenly items-center gap-[10px] p-[10px] transition-all duration-300 ease-in-out transform origin-top pointer-events-auto`} onMouseLeave={() => manageNodeMenuSubMenu(null)} >
    
      <li>
          <button id="" className={`w-[180px] h-[57px] bg-[#3E3E41] rounded-[8px] flex flex-row items-start gap-[16px] p-[6px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-main-blue transition-colors`} 
          onMouseEnter={() => {manageNodeMenuSubMenu("Textsub1")}}
          onMouseLeave={() => {manageNodeMenuSubMenu(null)}}
          onClick={(event)=> {
            event.preventDefault()
            event.stopPropagation()
            handleMouseDown("text")
          }}>
          <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[18px] font-[400] rounded-[5px]'>Aa</div>
          <div className='text-[12px] font-[500] pt-1'>Text</div>
          </button> 
  </li> 
  <li>
      <button id="" className={`w-[180px] h-[57px] bg-[#3E3E41] rounded-[8px] flex flex-row items-start gap-[16px] p-[6px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-main-blue transition-colors`} 
      onMouseEnter={() => {manageNodeMenuSubMenu("StructuredTextsub1")}}
      onMouseLeave={() => {manageNodeMenuSubMenu(null)}}
      onClick={(event)=> {
        event.preventDefault()
        event.stopPropagation()
        handleMouseDown("structured")
      }}>
      <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[16px] font-[400] rounded-[5px]'> {"{Aa}"}
      </div>
      <div className='text-[12px] font-[500] pt-1'>Structured Text</div>
      </button> 
  </li> 
  {/* <li>
    <button className={`w-[180px] h-[57px] bg-[#3E3E41] rounded-[5px] flex flex-row items-start gap-2 p-[6px] font-plus-jakarta-sans text-[#CDCDCD] ${selectedNodeMenuSubMenu === 2 ? "bg-main-blue" : ""}`} 
    onMouseEnter={() => {manageNodeMenuSubMenu("Filesub1")}}
    onClick={(event) => {
      event.preventDefault()
      event.stopPropagation()
      // setNode({nodeid: `${getNodes().length + 1}`, nodeType: "dataBase"})
      // setNode({nodeid: `${totalCount + 1}`, nodeType: "file"})
      // setIsAdd(false)
      handleMouseDown("file")
    }}>
    <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[18px] font-[400] rounded-[5px]'>
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="18" viewBox="0 0 22 18" fill="none">
    <path d="M0.5 0.5H14.1667L21.25 17.5H0.5V0.5Z" stroke="#CDCDCD"/>
    <rect x="0.5" y="4.5" width="21" height="13" fill="#1C1D1F" stroke="#CDCDCD"/>
    </svg>
      </div>
      <div className='text-[12px] font-[700] pt-1'>File</div>
    </button>
  </li> */}
  {/* <li>
    <button className={`w-[180px] h-[57px] bg-[#3E3E41] rounded-[8px] flex flex-row items-start  gap-[16px] p-[6px] font-plus-jakarta-sans text-[#CDCDCD] ${selectedNodeMenuSubMenu === 3 ? "bg-main-blue" : ""}`} 
    onMouseEnter={() => {manageNodeMenuSubMenu("Switchsub1")}}
    onClick={(event) => {
      event.preventDefault()
      event.stopPropagation()
      // setNode({nodeid: `${getNodes().length + 1}`, nodeType: "dataBase"})
      // setNode({nodeid: `${totalCount + 1}`, nodeType: "switch"})
      // setIsAdd(false)
      handleMouseDown("switch")
    }}>
    <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[18px] font-[400] rounded-[5px]'>
      <svg xmlns="http://www.w3.org/2000/svg" width="25" height="14" viewBox="0 0 25 14" fill="none">
      <rect x="0.5" y="0.5" width="24" height="13" rx="6.5" stroke="#CDCDCD"/>
      <rect x="14.5" y="3.5" width="7" height="7" rx="3.5" stroke="#CDCDCD"/>
    </svg>
      </div>
      <div className='text-[12px] font-[500] pt-1'>Switch</div>
    </button>
  </li> */}
  {/* <li>
    <button className={`w-[180px] h-[57px] bg-[#3E3E41] rounded-[5px] flex flex-row items-start justify-between gap-2 p-[6px] font-plus-jakarta-sans text-[#CDCDCD] ${selectedNodeMenuSubMenu === 4 ? "bg-main-blue" : ""}`}
     onMouseEnter={() => {manageNodeMenuSubMenu("Databasesub1")}}>
    <div className='flex gap-2'>
      <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[18px] font-[400] rounded-[5px]'>
        <svg xmlns="http://www.w3.org/2000/svg" width="21" height="25" viewBox="0 0 21 25" fill="none">
        <path d="M20.4881 4.5C20.4881 4.95825 20.2808 5.43269 19.8289 5.90651C19.3745 6.38288 18.6934 6.83464 17.8133 7.22491C16.0545 8.00486 13.5898 8.5 10.8407 8.5C8.0917 8.5 5.62693 8.00486 3.86815 7.22491C2.98812 6.83464 2.30696 6.38288 1.85261 5.90651C1.40069 5.43269 1.19336 4.95825 1.19336 4.5C1.19336 4.04175 1.40069 3.56731 1.85261 3.09349C2.30696 2.61712 2.98812 2.16536 3.86815 1.77509C5.62693 0.995135 8.0917 0.5 10.8407 0.5C13.5898 0.5 16.0545 0.995135 17.8133 1.77509C18.6934 2.16536 19.3745 2.61712 19.8289 3.09349C20.2808 3.56731 20.4881 4.04175 20.4881 4.5Z" stroke="#CDCDCD"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M0.693237 15C0.693278 17.2091 5.2364 19 10.8406 19C16.4448 19 20.988 17.2091 20.988 15H19.988C19.988 15.1831 19.8979 15.4628 19.5088 15.8254C19.1182 16.1894 18.4985 16.5633 17.6492 16.8981C15.9564 17.5653 13.5496 18 10.8406 18C8.13163 18 5.72483 17.5653 4.03206 16.8981C3.1827 16.5633 2.56304 16.1894 2.17245 15.8254C1.78338 15.4628 1.69325 15.1831 1.69324 15H0.693237Z" fill="#CDCDCD"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M0.693359 10.0002C0.6934 12.2094 5.23652 14.0002 10.8407 14.0002C16.445 14.0002 20.9881 12.2094 20.9881 10.0002H19.9881C19.9881 10.1834 19.898 10.463 19.5089 10.8256C19.1183 11.1897 18.4987 11.5635 17.6493 11.8983C15.9565 12.5656 13.5497 13.0002 10.8407 13.0002C8.13175 13.0002 5.72495 12.5656 4.03218 11.8983C3.18282 11.5635 2.56316 11.1897 2.17258 10.8256C1.7835 10.463 1.69337 10.1834 1.69336 10.0002H0.693359Z" fill="#CDCDCD"/>
        <path fillRule="evenodd" clipRule="evenodd" d="M0.701806 20C0.696112 20.0619 0.693237 20.1241 0.693237 20.1866C0.693237 22.6719 5.23637 24.6866 10.8406 24.6866C16.4449 24.6866 20.988 22.6719 20.988 20.1866C20.988 20.1241 20.9851 20.0619 20.9794 20H19.9709C19.9826 20.0647 19.988 20.1269 19.988 20.1866C19.988 20.4818 19.8573 20.8388 19.4669 21.2481C19.0717 21.6624 18.4524 22.0811 17.6105 22.4545C15.9293 23.2 13.5366 23.6866 10.8406 23.6866C8.14466 23.6866 5.75197 23.2 4.07073 22.4545C3.22881 22.0811 2.60952 21.6624 2.2143 21.2481C1.82396 20.8388 1.69324 20.4818 1.69324 20.1866C1.69324 20.1269 1.69859 20.0647 1.71035 20H0.701806Z" fill="#CDCDCD"/>
        <path d="M20.4806 20.4999L20.4806 4.69347" stroke="#CDCDCD"/>
        <path d="M1.20056 20.4999L1.20056 4.69347" stroke="#CDCDCD"/>
        </svg>
        </div>
        <div className='text-[12px] font-[700] pt-1'>Database</div>
    </div>
    <div className='h-full w-[12px] flex items-center justify-center'>
    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="14" viewBox="0 0 7 14" fill="none">
          <path d="M1 1L6 7L1 13" stroke="#CDCDCD" strokeWidth="1.5"/>
        </svg>
    </div>
    </button>
    <DatabaseSubMenu selectedMenu={selectedNodeMenuSubMenu === 4 ? 1 : 0} 
    handleMouseDown={handleMouseDown}/>
  </li>  */}
  {/* <li>
        <button id="" className={`w-[180px] h-[57px] bg-[#3E3E41] rounded-[8px] flex flex-row items-start justify-between gap-[16px] p-[6px] font-plus-jakarta-sans text-[#CDCDCD] ${selectedNodeMenuSubMenu === 4 ? "bg-main-blue" : ""}`} 
        onMouseEnter={() => {manageNodeMenuSubMenu("VectorDatabasesub1")}}
        onClick={(event)=> {
          event.preventDefault()
          event.stopPropagation()
          // setNode({nodeid: `${totalCount + 1}`, nodeType: "vector_database"})
          // setIsAdd(false)
          handleMouseDown("vector_database")
        }}>
        <div className='flex gap-[16px]'>
        <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[18px] font-[400] rounded-[5px]'>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="31" viewBox="0 0 14 31" fill="none">
          <path d="M11.4999 20.2173C11.4999 20.3604 11.4366 20.5346 11.2452 20.7353C11.0513 20.9386 10.7471 21.1444 10.3328 21.3281C9.50551 21.695 8.32759 21.9346 6.99997 21.9346C5.67235 21.9346 4.49443 21.695 3.66715 21.3281C3.25286 21.1444 2.94862 20.9386 2.75474 20.7353C2.5633 20.5346 2.5 20.3604 2.5 20.2173C2.5 20.0742 2.5633 19.9 2.75474 19.6993C2.94862 19.496 3.25286 19.2902 3.66715 19.1065C4.49443 18.7396 5.67235 18.5 6.99997 18.5C8.32759 18.5 9.50551 18.7396 10.3328 19.1065C10.7471 19.2902 11.0513 19.496 11.2452 19.6993C11.4366 19.9 11.4999 20.0742 11.4999 20.2173Z" stroke="#CDCDCD"/>
          <path fillRule="evenodd" clipRule="evenodd" d="M2 25.3911C2.00002 26.4796 4.23857 27.362 6.99997 27.362C9.76136 27.362 11.9999 26.4796 11.9999 25.3911H10.9613C10.9513 25.4017 10.9394 25.4136 10.9252 25.4267C10.7951 25.548 10.5524 25.7032 10.1688 25.8544C9.40749 26.1545 8.28754 26.362 6.99997 26.362C5.7124 26.362 4.59245 26.1545 3.83118 25.8544C3.44757 25.7032 3.20482 25.548 3.07471 25.4267C3.06058 25.4136 3.04866 25.4017 3.03863 25.3911H2ZM2.98881 25.4556C2.98866 25.4556 2.9893 25.4539 2.99121 25.4505C2.98992 25.4539 2.98896 25.4556 2.98881 25.4556ZM11.0087 25.4505C11.0106 25.4539 11.0113 25.4556 11.0111 25.4556C11.011 25.4556 11.01 25.4539 11.0087 25.4505Z" fill="#CDCDCD"/>
          <path fillRule="evenodd" clipRule="evenodd" d="M2 22.9275C2.00002 24.016 4.23857 24.8984 6.99997 24.8984C9.76136 24.8984 11.9999 24.016 11.9999 22.9275H10.9613C10.9513 22.9381 10.9394 22.9499 10.9252 22.9631C10.7951 23.0844 10.5524 23.2396 10.1688 23.3908C9.40749 23.6909 8.28754 23.8984 6.99997 23.8984C5.7124 23.8984 4.59245 23.6909 3.83118 23.3908C3.44757 23.2396 3.20482 23.0844 3.07471 22.9631C3.06058 22.9499 3.04866 22.9381 3.03863 22.9275H2ZM2.98881 22.992C2.98866 22.992 2.9893 22.9903 2.99121 22.9869C2.98992 22.9903 2.98896 22.992 2.98881 22.992ZM11.0087 22.9869C11.0106 22.9903 11.0113 22.992 11.0111 22.992C11.011 22.992 11.01 22.9903 11.0087 22.9869Z" fill="#CDCDCD"/>
          <path fillRule="evenodd" clipRule="evenodd" d="M2.00422 27.8547C2.00142 27.8852 2 27.9159 2 27.9467C2 29.1713 4.23856 30.164 6.99997 30.164C9.76138 30.164 11.9999 29.1713 11.9999 27.9467C11.9999 27.9159 11.9985 27.8852 11.9957 27.8547H10.9516C10.9716 27.8823 10.9835 27.9039 10.9904 27.9188C10.9965 27.932 10.9986 27.94 10.9994 27.9432L10.9999 27.9462L10.9999 27.9467L10.9999 27.9472L10.9994 27.9502C10.9986 27.9533 10.9965 27.9614 10.9904 27.9746C10.9778 28.0018 10.9482 28.0517 10.8834 28.1196C10.7486 28.2609 10.5063 28.4336 10.1301 28.6004C9.38034 28.9329 8.27451 29.164 6.99997 29.164C5.72543 29.164 4.61959 28.9329 3.86985 28.6004C3.49368 28.4336 3.2513 28.2609 3.11656 28.1196C3.05178 28.0517 3.02216 28.0018 3.00958 27.9746C3.00348 27.9614 3.00131 27.9533 3.00058 27.9502L3.00004 27.9472L3 27.9467L3.00004 27.9462L3.00058 27.9432C3.00131 27.94 3.00348 27.932 3.00958 27.9188C3.01644 27.9039 3.02838 27.8823 3.04834 27.8547H2.00422Z" fill="#CDCDCD"/>
          <path d="M11.5002 27.9773L11.4998 20.4773" stroke="#CDCDCD"/>
          <path d="M2.5 27.9773L2.5 20.4773" stroke="#CDCDCD"/>
          <path d="M0 14L4.59725 13.5543L1.91262 9.79581L0 14ZM6.7675 8.67451L2.69695 11.582L3.16194 12.233L7.2325 9.32549L6.7675 8.67451Z" fill="#CDCDCD"/>
          <path d="M7 9V2" stroke="#CDCDCD" strokeWidth="1.5"/>
          <path d="M7 -8.9407e-08L4.6906 4L9.3094 4L7 -8.9407e-08Z" fill="#CDCDCD"/>
          <path d="M7 9L2 12.5" stroke="#CDCDCD" strokeWidth="1.5"/>
          <path d="M14 14L9.40275 13.5543L12.0874 9.79581L14 14ZM7.2325 8.67451L11.3031 11.582L10.8381 12.233L6.7675 9.32549L7.2325 8.67451Z" fill="#CDCDCD"/>
          <path d="M7 9L12 12.5" stroke="#CDCDCD" strokeWidth="1.5"/>
          </svg>
      </div>
      <div className='text-[12px] font-[500] pt-1'>Vector DB</div>
        </div>
        
        </button> 
  </li> */}


  {/* <li>
          <button className={`w-[180px] h-[57px] bg-[#3E3E41] rounded-[5px] flex flex-row items-start gap-2 p-[6px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-main-blue transition-colors`} 
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            handleMouseDown("file")
          }}>
          <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[18px] font-[400] rounded-[5px]'>
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="18" viewBox="0 0 22 18" fill="none">
          <path d="M0.5 0.5H14.1667L21.25 17.5H0.5V0.5Z" stroke="#CDCDCD"/>
          <rect x="0.5" y="4.5" width="21" height="13" fill="#1C1D1F" stroke="#CDCDCD"/>
          </svg>
            </div>
            <div className='text-[12px] font-[500] pt-1'>File</div>
          </button>
        </li>
        <li>
            <button id="" className='w-[180px] h-[57px] bg-[#3E3E41] rounded-[5px] flex flex-row items-start gap-2 p-[6px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-main-blue transition-colors' onClick={(event)=> {
              event.preventDefault()
              event.stopPropagation()
              handleMouseDown("weblink")
            }}>
            <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[16px] font-[400] rounded-[5px]'>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="23" viewBox="0 0 24 23" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M14.5965 10.2725C14.4386 10.0347 14.2537 9.80936 14.0418 9.60053C12.3803 7.96313 9.6864 7.96313 8.02487 9.60053L3.69489 13.8676C2.03335 15.505 2.03336 18.1598 3.69489 19.7972C5.35642 21.4346 8.0503 21.4346 9.71184 19.7972L12.5341 17.0159L11.4658 15.963L8.64345 18.7443C7.57197 19.8002 5.83476 19.8002 4.76328 18.7443C3.6918 17.6884 3.6918 15.9764 4.76328 14.9205L9.09326 10.6534C10.1647 9.59749 11.902 9.59749 12.9734 10.6534C13.1896 10.8664 13.3621 11.1061 13.4911 11.3618L14.5965 10.2725Z" fill="#CDCDCD"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M9.46603 12.4973C9.62388 12.735 9.80877 12.9604 10.0207 13.1692C11.6822 14.8066 14.3761 14.8066 16.0376 13.1692L20.3676 8.90215C22.0291 7.26475 22.0291 4.60999 20.3676 2.97259C18.7061 1.33519 16.0122 1.33519 14.3507 2.97259L11.5284 5.75391L12.5967 6.80678L15.4191 4.02547C16.4905 2.96955 18.2277 2.96955 19.2992 4.02546C20.3707 5.08138 20.3707 6.79336 19.2992 7.84927L14.9692 12.1164C13.8978 13.1723 12.1605 13.1723 11.0891 12.1164C10.8729 11.9034 10.7004 11.6636 10.5714 11.408L9.46603 12.4973Z" fill="#CDCDCD"/>
            </svg>
            </div>
            <div className='text-[12px] font-[500] pt-1'>Weblink</div>
            </button> 
        </li> */}

        
        
  {/* <li>
    <button className={`w-[180px] h-[57px] bg-[#3E3E41] rounded-[5px] flex flex-row items-start justify-between gap-[16px] p-[6px] font-plus-jakarta-sans text-[#CDCDCD] ${selectedNodeMenuSubMenu === 5 ? "bg-main-blue" : ""}`}
     onMouseEnter={() => {manageNodeMenuSubMenu("Otherssub1")}}>
    <div className='flex gap-[16px]'>
      <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[18px] font-[400] rounded-[5px]'>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="12" viewBox="0 0 20 12" fill="none">
          <rect width="4" height="4" fill="#CDCDCD"/>
          <rect x="8" width="4" height="4" fill="#CDCDCD"/>
          <rect x="16" width="4" height="4" fill="#CDCDCD"/>
          <rect y="8" width="4" height="4" fill="#CDCDCD"/>
          <rect x="8" y="8" width="4" height="4" fill="#CDCDCD"/>
          <rect x="16" y="8" width="4" height="4" fill="#CDCDCD"/>
        </svg>
        </div>
        <div className='text-[12px] font-[500] pt-1'>Others</div>
    </div>
    <div className='h-full w-[12px] flex items-center justify-center'>
    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="14" viewBox="0 0 7 14" fill="none">
          <path d="M1 1L6 7L1 13" stroke="#CDCDCD" strokeWidth="1.5"/>
        </svg>
    </div>
    </button>
    <OtherNodesSubMenu selectedMenu={selectedNodeMenuSubMenu === 5 ? 1 : 0} 
    handleMouseDown={handleMouseDown}/>
  </li> */}

      </ul>
      </Transition>
        {renderDragIndicator()}
        </>
  )
}

export default NodeMenu
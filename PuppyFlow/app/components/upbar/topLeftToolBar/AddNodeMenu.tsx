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
        renderSvgName = "data:image/svg+xml;utf8,<svg width='186' height='96' viewBox='0 0 186 96' fill='none' xmlns='http://www.w3.org/2000/svg'><rect x='1' y='1' width='184' height='94' rx='7' fill='%231C1D1F' stroke='%236D7077' stroke-width='2'/></svg>";
        break
      case "structured":
        renderSvgName = "data:image/svg+xml;utf8,<svg width='186' height='96' viewBox='0 0 186 96' fill='none' xmlns='http://www.w3.org/2000/svg'><rect x='1' y='1' width='184' height='94' rx='7' fill='%231C1D1F' stroke='%236D7077' stroke-width='2'/><path d='M175.5 77.0796C175.5 77.3727 175.262 77.7614 174.598 78.1065C173.959 78.4388 173.041 78.6592 172 78.6592C170.959 78.6592 170.041 78.4388 169.402 78.1065C168.738 77.7614 168.5 77.3727 168.5 77.0796C168.5 76.7865 168.738 76.3978 169.402 76.0527C170.041 75.7204 170.959 75.5 172 75.5C173.041 75.5 173.959 75.7204 174.598 76.0527C175.262 76.3978 175.5 76.7865 175.5 77.0796Z' stroke='%236D7177'/><path fill-rule='evenodd' clip-rule='evenodd' d='M168 81.9319C168 82.9528 169.791 83.7804 172 83.7804C174.209 83.7804 176 82.9528 176 81.9319H174.982C174.94 81.9948 174.808 82.1466 174.409 82.3312C173.844 82.5923 172.993 82.7804 172 82.7804C171.007 82.7804 170.156 82.5923 169.591 82.3312C169.192 82.1466 169.06 81.9948 169.018 81.9319H168Z' fill='%236D7177'/><path fill-rule='evenodd' clip-rule='evenodd' d='M168 79.6213C168 80.6422 169.791 81.4698 172 81.4698C174.209 81.4698 176 80.6422 176 79.6213H174.982C174.94 79.6842 174.808 79.836 174.409 80.0207C173.844 80.2817 172.993 80.4698 172 80.4698C171.007 80.4698 170.156 80.2817 169.591 80.0207C169.192 79.836 169.06 79.6842 169.018 79.6213H168Z' fill='%236D7177'/><path fill-rule='evenodd' clip-rule='evenodd' d='M168.003 84.2427C168.001 84.2712 168 84.2999 168 84.3288C168 85.4773 169.791 86.4084 172 86.4084C174.209 86.4084 176 85.4773 176 84.3288C176 84.2999 175.999 84.2712 175.997 84.2427H174.97C174.997 84.2938 175 84.3248 175 84.3288C175 84.3407 174.971 84.5982 174.367 84.912C173.813 85.2003 172.977 85.4084 172 85.4084C171.023 85.4084 170.187 85.2003 169.633 84.912C169.029 84.5982 169 84.3407 169 84.3288C169 84.3248 169.003 84.2938 169.03 84.2427H168.003Z' fill='%236D7177'/><path d='M175.8 84.4736V77.1689' stroke='%236D7177'/><path d='M168.2 84.4736V77.1689' stroke='%236D7177'/><path d='M154.961 75.0195C154.961 75.4206 155.062 75.7057 155.266 75.875C155.469 76.0469 155.691 76.1471 155.934 76.1758V76.6328C155.47 76.5859 155.086 76.4492 154.781 76.2227C154.479 75.9987 154.328 75.6289 154.328 75.1133V74.3086C154.328 74.0247 154.284 73.8008 154.195 73.6367C154.034 73.3372 153.724 73.1628 153.266 73.1133V72.668C153.727 72.6133 154.036 72.4427 154.195 72.1562C154.284 71.9974 154.328 71.7695 154.328 71.4727V70.8359C154.328 70.3464 154.434 69.9583 154.645 69.6719C154.858 69.3854 155.288 69.2148 155.934 69.1602V69.6055C155.514 69.6419 155.23 69.8268 155.082 70.1602C155.001 70.3424 154.961 70.5951 154.961 70.918V71.3555C154.961 71.7461 154.913 72.0456 154.816 72.2539C154.642 72.6315 154.303 72.8438 153.801 72.8906C154.301 72.9349 154.639 73.1536 154.816 73.5469C154.913 73.763 154.961 74.0573 154.961 74.4297V75.0195ZM159.66 72.6484L158.789 70.1133L157.863 72.6484H159.66ZM158.383 69.2617H159.262L161.344 75H160.492L159.91 73.2812H157.641L157.02 75H156.223L158.383 69.2617ZM162.496 73.8867C162.496 74.0898 162.57 74.25 162.719 74.3672C162.867 74.4844 163.043 74.543 163.246 74.543C163.493 74.543 163.733 74.4857 163.965 74.3711C164.355 74.181 164.551 73.8698 164.551 73.4375V72.8711C164.465 72.9258 164.354 72.9714 164.219 73.0078C164.083 73.0443 163.951 73.0703 163.82 73.0859L163.395 73.1406C163.139 73.1745 162.948 73.2279 162.82 73.3008C162.604 73.4232 162.496 73.6185 162.496 73.8867ZM164.199 72.4648C164.361 72.444 164.469 72.3763 164.523 72.2617C164.555 72.1992 164.57 72.1094 164.57 71.9922C164.57 71.7526 164.484 71.5794 164.312 71.4727C164.143 71.3633 163.9 71.3086 163.582 71.3086C163.215 71.3086 162.954 71.4076 162.801 71.6055C162.715 71.7148 162.659 71.8776 162.633 72.0938H161.977C161.99 71.5781 162.156 71.2201 162.477 71.0195C162.799 70.8164 163.173 70.7148 163.598 70.7148C164.09 70.7148 164.49 70.8086 164.797 70.9961C165.102 71.1836 165.254 71.4753 165.254 71.8711V74.2812C165.254 74.3542 165.268 74.4128 165.297 74.457C165.328 74.5013 165.392 74.5234 165.488 74.5234C165.52 74.5234 165.555 74.5221 165.594 74.5195C165.633 74.5143 165.674 74.5078 165.719 74.5V75.0195C165.609 75.0508 165.526 75.0703 165.469 75.0781C165.411 75.0859 165.333 75.0898 165.234 75.0898C164.992 75.0898 164.816 75.0039 164.707 74.832C164.65 74.7409 164.609 74.612 164.586 74.4453C164.443 74.6328 164.237 74.7956 163.969 74.9336C163.701 75.0716 163.405 75.1406 163.082 75.1406C162.694 75.1406 162.376 75.0234 162.129 74.7891C161.884 74.5521 161.762 74.2565 161.762 73.9023C161.762 73.5143 161.883 73.2135 162.125 73C162.367 72.7865 162.685 72.6549 163.078 72.6055L164.199 72.4648ZM168.188 72.8906C167.688 72.8438 167.35 72.6328 167.176 72.2578C167.079 72.0495 167.031 71.7487 167.031 71.3555V70.918C167.031 70.5742 166.991 70.3138 166.91 70.1367C166.764 69.819 166.48 69.6419 166.059 69.6055V69.1602C166.73 69.2148 167.186 69.4232 167.426 69.7852C167.582 70.0169 167.66 70.3672 167.66 70.8359V71.4727C167.66 71.7643 167.704 71.9909 167.793 72.1523C167.954 72.4466 168.266 72.6185 168.727 72.668V73.1133C168.268 73.1602 167.957 73.3359 167.793 73.6406C167.704 73.8073 167.66 74.0299 167.66 74.3086V75.1133C167.66 75.6393 167.508 76.0117 167.203 76.2305C166.901 76.4492 166.52 76.5833 166.059 76.6328V76.1758C166.337 76.1393 166.569 76.0273 166.754 75.8398C166.939 75.6549 167.031 75.3815 167.031 75.0195V74.4297C167.031 74.0547 167.079 73.7604 167.176 73.5469C167.353 73.1536 167.69 72.9349 168.188 72.8906Z' fill='%236D7177'/></svg>";
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
        renderSvgName = "data:image/svg+xml;utf8,<svg width='186' height='96' viewBox='0 0 186 96' fill='none' xmlns='http://www.w3.org/2000/svg'><rect x='1' y='1' width='184' height='94' rx='7' fill='%231C1D1F' stroke='%236D7077' stroke-width='2'/><path d='M175.5 78.0796C175.5 78.3727 175.262 78.7614 174.598 79.1065C173.959 79.4388 173.041 79.6592 172 79.6592C170.959 79.6592 170.041 79.4388 169.402 79.1065C168.738 78.7614 168.5 78.3727 168.5 78.0796C168.5 77.7865 168.738 77.3978 169.402 77.0527C170.041 76.7204 170.959 76.5 172 76.5C173.041 76.5 173.959 76.7204 174.598 77.0527C175.262 77.3978 175.5 77.7865 175.5 78.0796Z' stroke='%236D7177'/><path fill-rule='evenodd' clip-rule='evenodd' d='M168 82.9319C168 83.9528 169.791 84.7804 172 84.7804C174.209 84.7804 176 83.9528 176 82.9319H174.982C174.94 82.9948 174.808 83.1466 174.409 83.3312C173.844 83.5923 172.993 83.7804 172 83.7804C171.007 83.7804 170.156 83.5923 169.591 83.3312C169.192 83.1466 169.06 82.9948 169.018 82.9319H168Z' fill='%236D7177'/><path fill-rule='evenodd' clip-rule='evenodd' d='M168 80.6213C168 81.6422 169.791 82.4698 172 82.4698C174.209 82.4698 176 81.6422 176 80.6213H174.982C174.94 80.6842 174.808 80.836 174.409 81.0207C173.844 81.2817 172.993 81.4698 172 81.4698C171.007 81.4698 170.156 81.2817 169.591 81.0207C169.192 80.836 169.06 80.6842 169.018 80.6213H168Z' fill='%236D7177'/><path fill-rule='evenodd' clip-rule='evenodd' d='M168.003 85.2427C168.001 85.2712 168 85.2999 168 85.3288C168 86.4773 169.791 87.4084 172 87.4084C174.209 87.4084 176 86.4773 176 85.3288C176 85.2999 175.999 85.2712 175.997 85.2427H174.97C174.997 85.2938 175 85.3248 175 85.3288C175 85.3407 174.971 85.5982 174.367 85.912C173.813 86.2003 172.977 86.4084 172 86.4084C171.023 86.4084 170.187 86.2003 169.633 85.912C169.029 85.5982 169 85.3407 169 85.3288C169 85.3248 169.003 85.2938 169.03 85.2427H168.003Z' fill='%236D7177'/><path d='M175.8 85.4736V78.1689' stroke='%236D7177'/><path d='M168.2 85.4736V78.1689' stroke='%236D7177'/><path d='M162 70.9997L160.268 73.9997L163.732 73.9997L162 70.9997Z' fill='%236D7177'/><path d='M157 81.0002L160.448 80.666L158.434 77.8471L157 81.0002ZM161.826 77.1847L159.023 79.1868L159.371 79.675L162.174 77.6729L161.826 77.1847Z' fill='%236D7177'/><path d='M162 77.4287V72.4287' stroke='%236D7177' stroke-width='1.2'/><path d='M162 77.4287L158.429 79.9287' stroke='%236D7177' stroke-width='1.2'/><path d='M167 81.0002L163.552 80.666L165.566 77.8471L167 81.0002ZM162.174 77.1847L164.977 79.1868L164.629 79.675L161.826 77.6729L162.174 77.1847Z' fill='%236D7177'/><path d='M162 77.4287L165.571 79.9287' stroke='%236D7177' stroke-width='1.2'/></svg>";
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
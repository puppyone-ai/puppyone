import React, { useState, useEffect, useMemo, CSSProperties, useRef } from 'react'
import { Position, useNodesData, useReactFlow, MarkerType } from '@xyflow/react'
import { useNodeContext } from '../../states/NodeContext'
import ModifySubMenu from './ModifySubMenu'
import ChunkingSubMenu from './ChunkingSubMenu'
import SearchSubMenu from './SearchSubMenu'
import SaveIntoSubMenu from './SaveIntoSubMenu'
import OthersSubMenu from './OthersSubMenu'

type EdgeMenuProps = {
    nodeType: string,
    position: Position,
    sourceNodeId: string,
    handleId: string | undefined,
}

export type menuNameType = null | "LLMsub1" | "Modifysub1" | "Chunkingsub1" | "ChunkingOtherssub2" | "Searchsub1" | "SaveIntosub1"| "Codesub1" | "Otherssub1" | "Embeddingsub1" | "ChooseSub1" | "LoadSub1"

function EdgeMenu1({nodeType, sourceNodeId}: EdgeMenuProps) {

    
    
    // TextBlock menu onClick function
    // get source node info
    const {getNode, getNodes, getEdges, setNodes, setEdges, screenToFlowPosition} = useReactFlow()
    

    /*
    select subMenu:0:LLM + LLM submenu 
    1: modify + modifySubMenu 
    2. chunking + chunking subMenu 
    3. chunking + chunking subMenu + chunking others subMenu
    4. Search + Search SubMenu
    5. Save into + Save Into subMenu
    6. Code + Code SubMenu
    7. Others + Others subMenu
    */
    const [selectedSubMenu, setSelectedSubMenu] = useState(-1)
    const edgeMenuRef = useRef<HTMLUListElement>(null)
    // console.log(sourceNode)

    const {setHandleConnected, searchNode, totalCount, addCount, inactivateNode, allowActivateNode, clear} = useNodeContext()
    const [edgeMenuStyle, setEdgeMenuStyle] = useState<CSSProperties>({
        height: "0px",
        visibility: "hidden",
        border: "none",
    })

    useEffect(() => {
        const newEdgeMenuStyle = updateEdgeMenuStyle()
        setEdgeMenuStyle(newEdgeMenuStyle)
    
    }, [
        searchNode(sourceNodeId)?.BottomSrcHandle.activated, 
        searchNode(sourceNodeId)?.LeftSrcHandle.activated,
        searchNode(sourceNodeId)?.RightSrcHandle.activated,
        searchNode(sourceNodeId)?.TopSrcHandle.activated
    ])

    const createNewConnection = (edgeType: string, subMenuType: string | null = null) => {
        const sourceNode = getNode(sourceNodeId)
        // console.log(sourceNode)
        if (!sourceNode) return
        const node = searchNode(sourceNodeId)
        if (!node?.activated) return

        const handlePosition = node.TopSrcHandle.activated ? Position.Top :
        node.BottomSrcHandle.activated ? Position.Bottom :
        node.LeftSrcHandle.activated ? Position.Left :
        node.RightSrcHandle.activated ? Position.Right :
        null

        if (!handlePosition) return

        const handleId = handlePosition === Position.Top ? `${sourceNodeId}-a` : handlePosition === Position.Right ? `${sourceNodeId}-b` : 
        handlePosition === Position.Bottom ? `${sourceNodeId}-c` :
        handlePosition === Position.Left ? `${sourceNodeId}-d` :
        ""
        let xshift, yshift
        // this is target button size
        const defaultTargetWidth = edgeType === "load" ?80 :
            edgeType === "embedding" ? 80:
            edgeType === "llm" ? 80 : 
            edgeType === "modify" ? 80 :
            edgeType === "chunk" ? 80 :
            edgeType === "search" ? 80 :
            edgeType === "code" ? 80 :
            edgeType === "generate" ? 80 :
            edgeType === "choose" ? 80 :
            edgeType === "load" ? 80 :
            80

        const defaultTargetHeight = 48;
        
        const defaultSourceNodeWidth = sourceNode.type === "text" ? 240 :
        sourceNode.type === "structured" ? 240 :
        sourceNode.type === "none" ? 240 :
        sourceNode.type === "switch" ? 128 :
        sourceNode.type === "file" ? 176 :
        sourceNode.type === "weblink" ? 176 :
        sourceNode.type === "vector" ? 176 :
        sourceNode.type === "vector_database" ? 176 :
        sourceNode.type === "database" ? 176 :
        176

        const defaultSourceNodeHeight = sourceNode.type === "text" ? 304 :
        sourceNode.type === "structured" ? 304 :
        sourceNode.type === "none" ? 304 :
        sourceNode.type === "switch" ? 176 :
        sourceNode.type === "file" ? 176 :
        sourceNode.type === "weblink" ? 176 :
        sourceNode.type === "vector" ? 176 :
        sourceNode.type === "vector_database" ? 176 :
        sourceNode.type === "database" ? 176 :
        176

        const defaultEdgeConfigNodeContent = edgeType === "load" ? "" :
        edgeType === "embedding" ? "" :
        edgeType === "llm" ? 
                (
        `[
  {"role": "system",
   "content": "You are an AI"},
  {"role": "user",
   "content": "Introduce yourself"}
]`):
        edgeType === "chunk" && subMenuType === "chunk-Bycharacter" ? 
        (`[",",";","\\n"]`):
        edgeType === "chunk" && subMenuType === "chunk-Bylength" ? "":
        edgeType === "chunk" && subMenuType === "chunk-Auto" ? "":
        edgeType === "chunk" && subMenuType === "chunk-ForHTML" ? 
        (`["h1", "heading 1"]`):
        edgeType === "chunk" && subMenuType === "chunk-ForMarkdown" ? 
        (`["h1", "heading 1"]`):
        edgeType === "chunk" && subMenuType === "chunk-ByLLM" ? "":
        edgeType === "search" ? "" :
        edgeType === "code" ? "" :
        edgeType === "generate" ? "" :
        edgeType === "choose" ? "" : 
        edgeType === "load" ? "" :
        ""

        if (sourceNode && sourceNode.measured?.height && sourceNode.measured.width) {

         xshift = 
        handlePosition === Position.Top || handlePosition === Position.Bottom ? sourceNode.measured.width / 2 - defaultTargetWidth / 2:
        handlePosition === Position.Left ? -sourceNode.measured.width / 2 - defaultTargetWidth :
        handlePosition === Position.Right ? sourceNode.measured.width * 3 / 2 : 
        0;

         yshift = 
        handlePosition === Position.Left || handlePosition === Position.Right ? sourceNode.measured.height / 2 - defaultTargetHeight / 2:
        handlePosition === Position.Top ? - sourceNode.measured.height / 2 - defaultTargetHeight / 2 :
        handlePosition === Position.Bottom ? sourceNode.measured.height * 3 / 2 : 
        0;

        }
        else {
            xshift = handlePosition === Position.Top || handlePosition === Position.Bottom ? defaultSourceNodeWidth / 2 - defaultTargetWidth / 2 :
            handlePosition === Position.Left ? - defaultSourceNodeWidth / 2 - defaultTargetWidth :
            handlePosition === Position.Right ? defaultSourceNodeWidth * 3 / 2 : 
            0;
    
             yshift = 
            handlePosition === Position.Left || handlePosition === Position.Right ? defaultSourceNodeHeight / 2 - defaultTargetHeight / 2:
            handlePosition === Position.Top ? -defaultSourceNodeHeight / 2 - defaultTargetHeight :
            handlePosition === Position.Bottom ? defaultSourceNodeHeight * 3 / 2 : 
            0;
        }

        const newNode = {
            id: `${edgeType}-${Date.now()}`,
            type: edgeType,
            position:{
                x: sourceNode.position.x + xshift,
                y: sourceNode.position.y + yshift
            },
            data: {
                subMenuType: subMenuType,
                content: defaultEdgeConfigNodeContent,
                ...(edgeType === "code" && {code: `def func(arg_1):\n    # write your code here\n    return`})
            }
        }

        // console.log(sourceNode, newNode)
   
        setNodes((nodes) => nodes.concat(newNode))
        setEdges((edges) => edges.concat({
            id: `connection-${Date.now()}`,
            source: sourceNode.id,
            target: newNode.id,
            type: "STC",
            sourceHandle: handleId,
        }))
    
       setHandleConnected(sourceNodeId, handlePosition)
       allowActivateNode()
       clear()
       
       
    }

    const updateEdgeMenuStyle = (): CSSProperties => {
        const sourceNode = searchNode(sourceNodeId)
        const node = getNode(sourceNodeId)
        // console.log(node?.measured)
        const defaultNodeWidth = node?.type === "text" ? 240 :
        node?.type === "structured" ? 240 :
        node?.type === "none" ? 240 :
        node?.type === "switch" ? 128 :
        node?.type === "file" ? 176 :
        node?.type === "weblink" ? 176 :
        node?.type === "vector" ? 176 :
        node?.type === "vector_database" ? 176 :
        node?.type === "database" ? 176 :
        176

        const defaultNodeHeight = node?.type === "text" ? 304 :
        node?.type === "structured" ? 304 :
        node?.type === "none" ? 304 :
        node?.type === "switch" ? 176 :
        node?.type === "file" ? 176 :
        node?.type === "weblink" ? 176 :
        node?.type === "vector" ? 176 :
        node?.type === "vector_database" ? 176 :
        node?.type === "database" ? 176 :
        176

        // const menuWidth = 120
        // const menuHeight = 300
        // if (edgeMenuRef.current) {
        //     console.log(edgeMenuRef.current.clientHeight, edgeMenuRef.current.clientWidth)
        // }

        let menuWidth = nodeType === "text" ? 137 : 
                        nodeType === "structured" ? 137 :
                        nodeType === "file" ? 137 :
                        nodeType === "switch" ? 137 :
                        nodeType === "database" ? 137 :
                        137

        let menuHeight = nodeType === "text" ? 288 : 
                         nodeType === "structured" ? 324 :
                         nodeType === "file" ? 88 :
                         nodeType === "switch" ? 42 :
                         nodeType === "database" ? 88 :
                         288

        // if (edgeMenuRef.current) {
        //     menuWidth = edgeMenuRef.current.clientWidth
        //     menuHeight = edgeMenuRef.current.clientHeight
        // }

        if (!sourceNode || !node || !sourceNode.activated) return {
            height: "0px",
            visibility: "hidden",
            border: "none",
        }
        if (sourceNode.TopSrcHandle.activated) {
            return node.measured?.width && node.measured.height ? 
            {   left: `${node.measured.width / 2 - menuWidth / 2}px`,
                top: `${- 20 - menuHeight }px`} :
            {
                left: `${defaultNodeWidth / 2 - menuWidth / 2}px`,
                top: `${- 20 - menuHeight}px`
            }
        }
        if (sourceNode.BottomSrcHandle.activated) {
            return node.measured?.width && node.measured.height ? {
                left: `${node.measured.width / 2 - menuWidth / 2}px`,
                bottom: `${-20 - menuHeight}px`
            } : {
                left: `${defaultNodeWidth / 2 - menuWidth / 2}px`,
                bottom: `${-20 - menuHeight}px`
            } 
        }
        if (sourceNode.LeftSrcHandle.activated) {
            return node.measured?.width && node.measured.height ? {
                left: `${-20 - menuWidth}px`,
                top: `${node.measured.height / 2 - menuHeight / 2}px`
            } : {
                left: `${-20 - menuWidth}px`,
                top: `${defaultNodeHeight / 2  - menuHeight / 2}px`
            }
        }
        if (sourceNode.RightSrcHandle.activated) {
            return node.measured?.width && node.measured.height ? {
                right: `${-20 - menuWidth}px`,
                top: `${node.measured.height / 2 - menuHeight / 2}px`,
            } : {
                right: `${-20 - menuWidth}px`,
                top: `${defaultNodeHeight / 2 - menuHeight / 2}px`
            }
        }
        return {
            height: "0px",
            visibility: "hidden",
            border: "none",
        }
    } 


    
   

    const manageTextNodeSubMenu = (menuName: menuNameType) => {
        let value = -1
        if (!menuName) {
            setSelectedSubMenu(-1)
            return
        }
        switch (menuName) {
            case "LLMsub1":
                value = 0
                break
            case "Modifysub1":
                value = 1
                break
            case "Chunkingsub1":
                value = 2
                break
            case "ChunkingOtherssub2":
                value = 3
                break
            case "Searchsub1":
                value = 4
                break
            case "SaveIntosub1":
                value = 5
                break
            case "Codesub1":
                value = 6
                break
            case "Otherssub1":
                value = 7
                break
            case "Embeddingsub1":
                value = 8
                break
            case "ChooseSub1":
                value = 9
                break
            case "LoadSub1":
                value = 10
                break
            default:
                value = -1
        }

        setSelectedSubMenu(value)
        return
    }
    

    switch (nodeType) {
        case 'text':
            return (
            <ul ref={edgeMenuRef} id="edgeMenu" className={` bg-[#1c1d1f] rounded-[8px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] gap-[6px] p-[6px] items-center`} style={{
                position: "absolute",
                visibility: "visible",
                ...edgeMenuStyle
            }
            } 
            onMouseLeave={() => manageTextNodeSubMenu(null)}>
            <li className='mb-[10px]'>
                <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 0 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`}
                onMouseEnter={() => manageTextNodeSubMenu("LLMsub1")}
                 onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('llm')
                }}>
                <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                 
                <img src="openai.svg" alt="llm logo" />
                </div>
                <div className='text-[12px] font-[700] flex items-center justify-center h-full'>LLM</div>
                </button>
            </li> 
            <li>
                <button className={`w-[125px] h-[30px] ${selectedSubMenu === 1 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("Modifysub1")}
                onClick={(event) => {
                
                    event.preventDefault()
                    event.stopPropagation()
                    // console.warn(position, "this position")
                    // createNewConnection('Load')
                }}>
                <div className='flex items-center gap-[11px] flex-1'>
                <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="12" viewBox="0 0 10 12" fill="none">
                <rect x="0.75" y="0.75" width="8.5" height="10.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                <path d="M6.5 4.5L3.5 7.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                </svg>
                </div>
                <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Modify</div>
                </div>
                <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 1? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                </svg>
                </div>
                </button>
                <ModifySubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 1 ? 1 : 0} createNewConnection={createNewConnection}/>
            </li> 
            <li className='mb-[10px]'>
                <button className={`w-[125px] h-[30px] ${selectedSubMenu === 2 || selectedSubMenu === 3 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("Chunkingsub1")}
                >
                  

                <div className='flex items-center gap-[11px] flex-1'>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <img src="chunking.svg" alt="chunking logo" />
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Chunking</div>
                </div>
                <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 2 || selectedSubMenu === 3? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                </svg>
                </div>
                </button>
                <ChunkingSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 2 || selectedSubMenu === 3 ? 1 : 0} manageTextNodeSubMenu={manageTextNodeSubMenu} selectedSubMenu={selectedSubMenu} createNewConnection={createNewConnection} />
            </li>   
            <li className='mb-[10px]'>
                <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 4 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("Searchsub1")}
                >
                <div className='flex items-center gap-[11px] flex-1'>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M6 6L14.0002 13.9999" stroke="#CDCDCD" strokeWidth="2"/>
                    <circle cx="5.5" cy="5.5" r="4.5" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="2"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Search</div>
                </div>
                <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 4? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                </svg>
                </div>
                </button>
                <SearchSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 4 ? 1 : 0} createNewConnection={createNewConnection}/>
            </li> 
            {/* <li>
                <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 5 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("SaveIntosub1")}
                >
               

                <div className='flex items-center gap-[11px] flex-1'>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="11" viewBox="0 0 16 11" fill="none">
                    <path d="M3 0L5.3094 4H0.690599L3 0ZM2.6 7V3.6H3.4V7H2.6Z" fill="#CDCDCD"/>
                    <path d="M7 2H8.2C9.88016 2 10.7202 2 11.362 2.32698C11.9265 2.6146 12.3854 3.07354 12.673 3.63803C13 4.27976 13 5.11984 13 6.8V9" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M9 9H7.8C6.11984 9 5.27976 9 4.63803 8.67302C4.07354 8.3854 3.6146 7.92646 3.32698 7.36197C3 6.72024 3 5.88016 3 4.2V2" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M13 11L10.6906 7L15.3094 7L13 11ZM13.4 4L13.4 7.4L12.6 7.4L12.6 4L13.4 4Z" fill="#CDCDCD"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Save into</div>
                </div>
                <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 5? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                </svg>
                </div>
                </button>
                <SaveIntoSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 5 ? 1 : 0} />
            </li> */}
            <li>
                <button className={`w-[125px] h-[30px] ${selectedSubMenu === 9 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("ChooseSub1")}
                onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('choose')
                }}>
                <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 12V7" stroke="#D9D9D9" strokeWidth="2"/>
                <path d="M10 2V7L2 7V2" stroke="#D9D9D9" strokeWidth="1.5"/>
                <path d="M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                <path d="M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                </svg>
                </div>
                <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Choose</div>
                </button>
            </li>
            <li>
                <button className={`w-[125px] h-[30px] ${selectedSubMenu === 6 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("Codesub1")}
                onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('code')
                }}>
                <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="9" viewBox="0 0 16 9" fill="none">
                <path d="M3.65714 0H5.48571L1.82857 4.5L5.48571 9H3.65714L0 4.5L3.65714 0Z" fill="#D9D9D9"/>
                <path d="M12.3429 0H10.5143L14.1714 4.5L10.5143 9H12.3429L16 4.5L12.3429 0Z" fill="#D9D9D9"/>
                <rect x="4.57129" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                <rect x="10.0571" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                <rect x="7.31445" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                </svg>
                </div>
                <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Code</div>
                </button>
            </li>
            <li>
                <button className={`w-[125px] h-[30px] ${selectedSubMenu === 7 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("Otherssub1")}
                >
                

                <div className='flex items-center gap-[11px] flex-1'>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6" fill="none">
                    <rect width="2" height="2" fill="#D9D9D9"/>
                    <rect x="4" width="2" height="2" fill="#D9D9D9"/>
                    <rect x="8" width="2" height="2" fill="#D9D9D9"/>
                    <rect y="4" width="2" height="2" fill="#D9D9D9"/>
                    <rect x="4" y="4" width="2" height="2" fill="#D9D9D9"/>
                    <rect x="8" y="4" width="2" height="2" fill="#D9D9D9"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Others</div>
                </div>
                <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 7? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                </svg>
                </div>
                </button>
                <OthersSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 7 ? 1 : 0} />
            </li>
            </ul>
            )
        case 'structured':
            return (
                <ul ref={edgeMenuRef} id="edgeMenu" className={` bg-[#1c1d1f] rounded-[8px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] gap-[6px] p-[6px] items-center`} style={{
                    position: "absolute",
                    visibility: "visible",
                    ...edgeMenuStyle
                }
                } 
                onMouseLeave={() => manageTextNodeSubMenu(null)}>
                <li className='mb-[10px]'>
                    <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 0 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`}
                    onMouseEnter={() => manageTextNodeSubMenu("LLMsub1")}
                     onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('llm')
                    }}>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                     
                    <img src="openai.svg" alt="llm logo" />
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>LLM</div>
                    </button>
                </li> 
                <li>
                    <button className={`w-[125px] h-[30px] ${selectedSubMenu === 1 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("Modifysub1")}
                    onClick={(event) => {
                    
                        event.preventDefault()
                        event.stopPropagation()
                        // console.warn(position, "this position")
                        // createNewConnection('Load')
                    }}>
                    <div className='flex items-center gap-[11px] flex-1'>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="12" viewBox="0 0 10 12" fill="none">
                    <rect x="0.75" y="0.75" width="8.5" height="10.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M6.5 4.5L3.5 7.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Modify</div>
                    </div>
                    <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                    <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 1? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                    </svg>
                    </div>
                    </button>
                    <ModifySubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 1 ? 1 : 0} createNewConnection={createNewConnection}/>
                </li> 
                <li className='mb-[10px]'>
                    <button className={`w-[125px] h-[30px] ${selectedSubMenu === 2 || selectedSubMenu === 3 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("Chunkingsub1")}
                    >
                      
    
                    <div className='flex items-center gap-[11px] flex-1'>
                        <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                        <img src="chunking.svg" alt="chunking logo" />
                        </div>
                        <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Chunking</div>
                    </div>
                    <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                    <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 2 || selectedSubMenu === 3? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                    </svg>
                    </div>
                    </button>
                    <ChunkingSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 2 || selectedSubMenu === 3 ? 1 : 0} manageTextNodeSubMenu={manageTextNodeSubMenu} selectedSubMenu={selectedSubMenu} createNewConnection={createNewConnection} />
                </li> 
                <li>
                    <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 8 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`}
                    onMouseEnter={() => manageTextNodeSubMenu("Embeddingsub1")}
                     onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('embedding')
                    }}>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M0 14L4.59725 13.5543L1.91262 9.79581L0 14ZM6.7675 8.67451L2.69695 11.582L3.16194 12.233L7.2325 9.32549L6.7675 8.67451Z" fill="#CDCDCD"/>
                        <path d="M7 9V2" stroke="#CDCDCD" strokeWidth="1.5"/>
                        <path d="M7 0L4.6906 4L9.3094 4L7 0Z" fill="#CDCDCD"/>
                        <path d="M7 9L2 12.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                        <path d="M14 14L9.40275 13.5543L12.0874 9.79581L14 14ZM7.2325 8.67451L11.3031 11.582L10.8381 12.233L6.7675 9.32549L7.2325 8.67451Z" fill="#CDCDCD"/>
                        <path d="M7 9L12 12.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                        </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Embedding</div>
                    </button>
                </li>     
                <li className='mb-[10px]'>
                    <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 4 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("Searchsub1")}
                    >
                    <div className='flex items-center gap-[11px] flex-1'>
                        <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15" fill="none">
                        <path d="M6 6L14.0002 13.9999" stroke="#CDCDCD" strokeWidth="2"/>
                        <circle cx="5.5" cy="5.5" r="4.5" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="2"/>
                        </svg>
                        </div>
                        <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Search</div>
                    </div>
                    <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                    <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 4? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                    </svg>
                    </div>
                    </button>
                    <SearchSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 4 ? 1 : 0} createNewConnection={createNewConnection}/>
                </li> 
                {/* <li>
                    <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 5 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("SaveIntosub1")}
                    >
                   
    
                    <div className='flex items-center gap-[11px] flex-1'>
                        <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="11" viewBox="0 0 16 11" fill="none">
                        <path d="M3 0L5.3094 4H0.690599L3 0ZM2.6 7V3.6H3.4V7H2.6Z" fill="#CDCDCD"/>
                        <path d="M7 2H8.2C9.88016 2 10.7202 2 11.362 2.32698C11.9265 2.6146 12.3854 3.07354 12.673 3.63803C13 4.27976 13 5.11984 13 6.8V9" stroke="#CDCDCD" strokeWidth="1.5"/>
                        <path d="M9 9H7.8C6.11984 9 5.27976 9 4.63803 8.67302C4.07354 8.3854 3.6146 7.92646 3.32698 7.36197C3 6.72024 3 5.88016 3 4.2V2" stroke="#CDCDCD" strokeWidth="1.5"/>
                        <path d="M13 11L10.6906 7L15.3094 7L13 11ZM13.4 4L13.4 7.4L12.6 7.4L12.6 4L13.4 4Z" fill="#CDCDCD"/>
                        </svg>
                        </div>
                        <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Save into</div>
                    </div>
                    <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                    <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 5? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                    </svg>
                    </div>
                    </button>
                    <SaveIntoSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 5 ? 1 : 0} />
                </li> */}
                <li>
                    <button className={`w-[125px] h-[30px] ${selectedSubMenu === 9 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("ChooseSub1")}
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('choose')
                    }}>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 12V7" stroke="#D9D9D9" strokeWidth="2"/>
                    <path d="M10 2V7L2 7V2" stroke="#D9D9D9" strokeWidth="1.5"/>
                    <path d="M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                    <path d="M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Choose</div>
                    </button>
                </li>
                <li>
                    <button className={`w-[125px] h-[30px] ${selectedSubMenu === 6 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("Codesub1")}
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('code')
                    }}>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="9" viewBox="0 0 16 9" fill="none">
                    <path d="M3.65714 0H5.48571L1.82857 4.5L5.48571 9H3.65714L0 4.5L3.65714 0Z" fill="#D9D9D9"/>
                    <path d="M12.3429 0H10.5143L14.1714 4.5L10.5143 9H12.3429L16 4.5L12.3429 0Z" fill="#D9D9D9"/>
                    <rect x="4.57129" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                    <rect x="10.0571" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                    <rect x="7.31445" y="4" width="1.37143" height="1.5" fill="#D9D9D9"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Code</div>
                    </button>
                </li>
                <li>
                    <button className={`w-[125px] h-[30px] ${selectedSubMenu === 7 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("Otherssub1")}
                    >
                    
    
                    <div className='flex items-center gap-[11px] flex-1'>
                        <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="6" viewBox="0 0 10 6" fill="none">
                        <rect width="2" height="2" fill="#D9D9D9"/>
                        <rect x="4" width="2" height="2" fill="#D9D9D9"/>
                        <rect x="8" width="2" height="2" fill="#D9D9D9"/>
                        <rect y="4" width="2" height="2" fill="#D9D9D9"/>
                        <rect x="4" y="4" width="2" height="2" fill="#D9D9D9"/>
                        <rect x="8" y="4" width="2" height="2" fill="#D9D9D9"/>
                        </svg>
                        </div>
                        <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Others</div>
                    </div>
                    <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                    <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 7? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                    </svg>
                    </div>
                    </button>
                    <OthersSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 7 ? 1 : 0} />
                </li>
                </ul>
            )
        case 'database':
            return (
            <ul ref={edgeMenuRef} id="edgeMenu" className={` bg-[#1c1d1f] rounded-[8px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] gap-[6px] p-[6px] items-center`} style={{
                position: "absolute",
                visibility: "visible",
                ...edgeMenuStyle
            }
            } 
            onMouseLeave={() => manageTextNodeSubMenu(null)}>
              
            <li className='mb-[10px]'>
                <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 4 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("Searchsub1")}
                >
                <div className='flex items-center gap-[11px] flex-1'>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15" fill="none">
                    <path d="M6 6L14.0002 13.9999" stroke="#CDCDCD" strokeWidth="2"/>
                    <circle cx="5.5" cy="5.5" r="4.5" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="2"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Search</div>
                </div>
                <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 4? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                </svg>
                </div>
                </button>
                <SearchSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 4 ? 1 : 0} createNewConnection={createNewConnection}/>
            </li> 
            {/* <li>
                <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 5 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("SaveIntosub1")}
                >
               

                <div className='flex items-center gap-[11px] flex-1'>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="11" viewBox="0 0 16 11" fill="none">
                    <path d="M3 0L5.3094 4H0.690599L3 0ZM2.6 7V3.6H3.4V7H2.6Z" fill="#CDCDCD"/>
                    <path d="M7 2H8.2C9.88016 2 10.7202 2 11.362 2.32698C11.9265 2.6146 12.3854 3.07354 12.673 3.63803C13 4.27976 13 5.11984 13 6.8V9" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M9 9H7.8C6.11984 9 5.27976 9 4.63803 8.67302C4.07354 8.3854 3.6146 7.92646 3.32698 7.36197C3 6.72024 3 5.88016 3 4.2V2" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M13 11L10.6906 7L15.3094 7L13 11ZM13.4 4L13.4 7.4L12.6 7.4L12.6 4L13.4 4Z" fill="#CDCDCD"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Save into</div>
                </div>
                <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 5? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                </svg>
                </div>
                </button>
                <SaveIntoSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 5 ? 1 : 0} />
            </li> */}
            <li>
                <button className={`w-[125px] h-[30px] ${selectedSubMenu === 9 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                onMouseEnter={() => manageTextNodeSubMenu("ChooseSub1")}
                onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    createNewConnection('choose')
                }}>
                <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 12V7" stroke="#D9D9D9" strokeWidth="2"/>
                <path d="M10 2V7L2 7V2" stroke="#D9D9D9" strokeWidth="1.5"/>
                <path d="M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                <path d="M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                </svg>
                </div>
                <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Choose</div>
                </button>
            </li>
            </ul>)
        case 'switch':
            return (
                <ul ref={edgeMenuRef} id="edgeMenu" className={` bg-[#1c1d1f] rounded-[8px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] gap-[6px] p-[6px] items-center`} style={{
                    position: "absolute",
                    visibility: "visible",
                    ...edgeMenuStyle
                }
                } 
                onMouseLeave={() => manageTextNodeSubMenu(null)}>
                  
                {/* <li>
                    <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 5 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("SaveIntosub1")}
                    >
                   
    
                    <div className='flex items-center gap-[11px] flex-1'>
                        <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="11" viewBox="0 0 16 11" fill="none">
                        <path d="M3 0L5.3094 4H0.690599L3 0ZM2.6 7V3.6H3.4V7H2.6Z" fill="#CDCDCD"/>
                        <path d="M7 2H8.2C9.88016 2 10.7202 2 11.362 2.32698C11.9265 2.6146 12.3854 3.07354 12.673 3.63803C13 4.27976 13 5.11984 13 6.8V9" stroke="#CDCDCD" strokeWidth="1.5"/>
                        <path d="M9 9H7.8C6.11984 9 5.27976 9 4.63803 8.67302C4.07354 8.3854 3.6146 7.92646 3.32698 7.36197C3 6.72024 3 5.88016 3 4.2V2" stroke="#CDCDCD" strokeWidth="1.5"/>
                        <path d="M13 11L10.6906 7L15.3094 7L13 11ZM13.4 4L13.4 7.4L12.6 7.4L12.6 4L13.4 4Z" fill="#CDCDCD"/>
                        </svg>
                        </div>
                        <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Save into</div>
                    </div>
                    <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                    <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 5? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                    </svg>
                    </div>
                    </button>
                    <SaveIntoSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 5 ? 1 : 0} />
                </li> */}
                <li>
                    <button className={`w-[125px] h-[30px] ${selectedSubMenu === 9 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("ChooseSub1")}
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('choose')
                    }}>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 12V7" stroke="#D9D9D9" strokeWidth="2"/>
                    <path d="M10 2V7L2 7V2" stroke="#D9D9D9" strokeWidth="1.5"/>
                    <path d="M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                    <path d="M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Choose</div>
                    </button>
                </li>
                </ul>
            )
        case 'file':
            return (
                <ul ref={edgeMenuRef} id="edgeMenu" className={` bg-[#1c1d1f] rounded-[8px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] gap-[6px] p-[6px] items-center`} style={{
                    position: "absolute",
                    visibility: "visible",
                    ...edgeMenuStyle
                }
                } 
                onMouseLeave={() => manageTextNodeSubMenu(null)}>
                
                <li className='mb-[10px]'>
                    <button className={`w-[125px] h-[30px] ${selectedSubMenu === 10 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("LoadSub1")}
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        // createNewConnection('load')
                    }}>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="10" viewBox="0 0 13 10" fill="none">
                    <rect x="0.75" y="0.75" width="5.5" height="8.5" stroke="#D9D9D9" strokeWidth="1.5"/>
                    <path d="M13 5L9 2.6906V7.3094L13 5ZM9 5.4H9.4V4.6H9V5.4Z" fill="#D9D9D9"/>
                    <path d="M6 5H10" stroke="#D9D9D9" strokeWidth="1.5"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Load</div>
                    </button>
                </li>
                {/* <li>
                    <button className={`w-[125px] h-[30px]  ${selectedSubMenu === 5 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("SaveIntosub1")}
                    >
                   
    
                    <div className='flex items-center gap-[11px] flex-1'>
                        <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="11" viewBox="0 0 16 11" fill="none">
                        <path d="M3 0L5.3094 4H0.690599L3 0ZM2.6 7V3.6H3.4V7H2.6Z" fill="#CDCDCD"/>
                        <path d="M7 2H8.2C9.88016 2 10.7202 2 11.362 2.32698C11.9265 2.6146 12.3854 3.07354 12.673 3.63803C13 4.27976 13 5.11984 13 6.8V9" stroke="#CDCDCD" strokeWidth="1.5"/>
                        <path d="M9 9H7.8C6.11984 9 5.27976 9 4.63803 8.67302C4.07354 8.3854 3.6146 7.92646 3.32698 7.36197C3 6.72024 3 5.88016 3 4.2V2" stroke="#CDCDCD" strokeWidth="1.5"/>
                        <path d="M13 11L10.6906 7L15.3094 7L13 11ZM13.4 4L13.4 7.4L12.6 7.4L12.6 4L13.4 4Z" fill="#CDCDCD"/>
                        </svg>
                        </div>
                        <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Save into</div>
                    </div>
                    <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="10" viewBox="0 0 7 10" fill="none">
                    <path d="M1 1L5 5L1 9" stroke={selectedSubMenu === 5? "#1C1D1F":"#CDCDCD"} strokeWidth="2"/>
                    </svg>
                    </div>
                    </button>
                    <SaveIntoSubMenu nodeType={nodeType} sourceNodeId={sourceNodeId} showMenu={selectedSubMenu === 5 ? 1 : 0} />
                </li> */}
                <li>
                    <button className={`w-[125px] h-[30px] ${selectedSubMenu === 9 ? "bg-main-orange text-[#1C1D1F]" : "bg-[#3E3E41] text-[#CDCDCD]"} rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans py-[3px] pl-[3px] cursor-pointer`} 
                    onMouseEnter={() => manageTextNodeSubMenu("ChooseSub1")}
                    onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        createNewConnection('choose')
                    }}>
                    <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 12V7" stroke="#D9D9D9" strokeWidth="2"/>
                    <path d="M10 2V7L2 7V2" stroke="#D9D9D9" strokeWidth="1.5"/>
                    <path d="M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                    <path d="M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                    </svg>
                    </div>
                    <div className='text-[12px] font-[700] flex items-center justify-center h-full'>Choose</div>
                    </button>
                </li>
                </ul>
            )
        case 'webLink':
            return (
                <></>
            )
    }
}

export default EdgeMenu1
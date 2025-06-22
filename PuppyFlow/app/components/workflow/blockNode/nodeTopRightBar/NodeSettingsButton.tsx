// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import { Position } from '@xyflow/react'
import React, {useState, useRef, useEffect} from 'react'
import { useReactFlow } from '@xyflow/react'
import TextNodeSettingMenu from './nodeSettingMenu/TextNodeSettingMenu' 
import JsonNodeSettingMenu from './nodeSettingMenu/JsonNodeSettingMenu'
import FileNodeSettingMenu from './nodeSettingMenu/FileNodeSettingMenu'
import WebLinkNodeSettingMenu from './nodeSettingMenu/WebLinkNodeSettingMenu'
import DatabaseNodeSettingMenu from './nodeSettingMenu/DatabaseNodeSettingMenu'
type settingControllerProps = {
    nodeid: string,
}

function NodeSettingsController({nodeid}: settingControllerProps) {

    const [isHovered, setHovered] = useState(false)
    const settingControllerRef = useRef<HTMLButtonElement | null>(null)
    const componentRef = useRef<HTMLDivElement | null>(null)
    const [showSettingMenu, setShowSettingMenu] = useState(0) // for toolbar
    // const {searchNode, inactivateHandle} = useNodeContext()
    const {activatedNode, setHandleActivated} = useNodesPerFlowContext()
    const {getNode} = useReactFlow()
  

    useEffect(() => {
        const currRef = componentRef.current;
    
        const closeSettings = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (currRef && !currRef.contains(target) && showSettingMenu !== 0) {
                setShowSettingMenu(0);
            }
        };
    
        if (showSettingMenu !== 0) {
            document.addEventListener('click', closeSettings);
        }
    
        return () => {
            document.removeEventListener('click', closeSettings);
        };
    }, [showSettingMenu]);


    useEffect(() => {
        if (activatedNode?.id !== nodeid) {
            setShowSettingMenu(0)
        }
    }, [activatedNode?.id])
    


    const manageSettings = () => {
        const target = getNode(nodeid)
        if (target) {
            
            // if (target.TopSrcHandle.activated) inactivateHandle(nodeid, Position.Top)
            // else if (target.RightSrcHandle.activated) inactivateHandle(nodeid, Position.Right)
            // else if (target.BottomSrcHandle.activated) inactivateHandle(nodeid, Position.Bottom)
            // else if (target.LeftSrcHandle.activated) inactivateHandle(nodeid, Position.Left)
            setHandleActivated(nodeid, null)
            
            setShowSettingMenu(prev => prev === 0 ? 1 : 0)
        }
        
    }

    const clearMenu = () => {
        setShowSettingMenu(0)
    }

    const onMouseEnter = () => {
        setHovered(true)
    }

    const onMouseLeave = () => {
        setHovered(false)
    }


    const renderSettingMenu = () => {
        const parentNodeType = getNode(nodeid)?.type
        switch (parentNodeType) {
            case "text":
                return <TextNodeSettingMenu showSettingMenu={showSettingMenu} clearMenu={clearMenu} nodeid={nodeid}/>
            case "structured":
                return <JsonNodeSettingMenu showSettingMenu={showSettingMenu} clearMenu={clearMenu} nodeid={nodeid}/>
            case "file":
                return <FileNodeSettingMenu showSettingMenu={showSettingMenu} clearMenu={clearMenu} nodeid={nodeid}/>
            case "weblink":
                return <WebLinkNodeSettingMenu showSettingMenu={showSettingMenu} clearMenu={clearMenu} nodeid={nodeid}/>
            case "database":
            case "vector_database":
                return <DatabaseNodeSettingMenu showSettingMenu={showSettingMenu} clearMenu={clearMenu} nodeid={nodeid}/>
            default:
                return <TextNodeSettingMenu showSettingMenu={showSettingMenu} clearMenu={clearMenu} nodeid={nodeid}/>
        }
    }

    const fillColor = isHovered || showSettingMenu ? "#BEBEBE" : "#6D7177"


  return(
    <div ref={componentRef} style={{ position: 'relative', isolation: 'isolate' }}>
     <button ref={settingControllerRef} className={`flex items-center justify-center ${isHovered || showSettingMenu ? "bg-[#3E3E41]" : ""} w-[24px] h-[24px] rounded-[8px]`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onClick={manageSettings}>
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="2" viewBox="0 0 11 2" fill="none">
        <path d="M0 0H2V2H0V0Z" fill={fillColor}/>
        <path d="M9 0H11V2H9V0Z" fill={fillColor}/>
        <path d="M4.5 0H6.5V2H4.5V0Z" fill={fillColor}/>
        </svg>
    </button>
    <div style={{ position: 'fixed', zIndex: 20000 }}>
      {renderSettingMenu()}
    </div>
    </div>
   )
}

export default NodeSettingsController
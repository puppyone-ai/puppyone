import { Handle, Position, NodeProps, Node, } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, {useState, useEffect, useMemo, useCallback} from 'react'
import ModifyCopyConfigMenu from '@/app/components/workflow/edgesNode/edgeNodeConfig/ModifyCopyConfigMenu'
import ModifyTextConfigMenu from '@/app/components/workflow/edgesNode/edgeNodeConfig/ModifyTextConfigMenu'
import ModifyStructuredConfigMenu from '@/app/components/workflow/edgesNode/edgeNodeConfig/ModifyStructuredConfigMenu'
import Modify2StructuredConfigMenu from '@/app/components/workflow/edgesNode/edgeNodeConfig/Modify2StructuredConfigMenu'
import Modify2TextConfigMenu from '@/app/components/workflow/edgesNode/edgeNodeConfig/Modify2TextConfigMenu'
import ModifyGetConfigMenu from '@/app/components/workflow/edgesNode/edgeNodeConfig/ModifyGetConfigMenu'
import { useReactFlow } from '@xyflow/react'

export type ModifyConfigNodeData = {
    subMenuType: string | null,
    content: string | null,
    looped: boolean | undefined,
    content_type: "list" | "dict" | null,
    extra_configs: {
        index: number | undefined,   
        key: string | undefined,
        params:{
            path:(string|number)[]
        }
    },
    resultNode: string | null
}

type ModifyConfigNodeProps = NodeProps<Node<ModifyConfigNodeData>>

function ModifyConfig({data: {subMenuType}, isConnectable, id}: ModifyConfigNodeProps) {

    const {isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll} = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const [isAdd, setIsAdd] = useState(false)
    const {getNode, getInternalNode} = useReactFlow()
    
    useEffect(() => {
        console.log(getInternalNode(id))
    }, [])

    const MODIFY_GET_TYPE="get"
    const MODIFY_DEL_TYPE="delete"
    const MODIFY_REPL_TYPE="replace"

    const selectModifyMenuType = () => {
        switch (subMenuType) {
            case 'modify-copy':
                return (<ModifyCopyConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'modify-text':
                return (<ModifyTextConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'modify-structured':
                return (<ModifyStructuredConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'modify-get':
                return (<ModifyGetConfigMenu 
                        show={activatedEdge === id} 
                        parentId={id} 
                        type={MODIFY_GET_TYPE} 
                        MODIFY_GET_TYPE={MODIFY_GET_TYPE} 
                        MODIFY_DEL_TYPE={MODIFY_DEL_TYPE} 
                        MODIFY_REPL_TYPE={MODIFY_REPL_TYPE}/>)
            case 'modify-delete':
                return (<ModifyGetConfigMenu 
                        show={activatedEdge === id} 
                        parentId={id} 
                        type={MODIFY_DEL_TYPE} 
                        MODIFY_GET_TYPE={MODIFY_GET_TYPE} 
                        MODIFY_DEL_TYPE={MODIFY_DEL_TYPE} 
                        MODIFY_REPL_TYPE={MODIFY_REPL_TYPE}/>)
            case 'modify-replace':
                return (<ModifyGetConfigMenu 
                        show={activatedEdge === id} 
                        parentId={id} 
                        type={MODIFY_REPL_TYPE} 
                        MODIFY_GET_TYPE={MODIFY_GET_TYPE} 
                        MODIFY_DEL_TYPE={MODIFY_DEL_TYPE} 
                        MODIFY_REPL_TYPE={MODIFY_REPL_TYPE}/>)
            case 'modify-convert2text':
                return (<Modify2TextConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'modify-convert2structured':
                return (<Modify2StructuredConfigMenu show={activatedEdge === id} parentId={id} />)
            default:
                return (<></>)
        }
    }

    const onClickButton = () => {
        if (isOnGeneratingNewNode) return
        if (activatedEdge === id) {
            clearEdgeActivation()
        }
        else {
            clearAll()
            activateEdge(id)
        }
    }


    return (
        <div className='p-[3px] w-[80px] h-[48px]'>
        <button className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"} group ${isOnGeneratingNewNode ? "pointer-events-none" : ""}`} onClick={onClickButton}>
                Modify

                <Handle id={`${id}-a`} className='edgeSrcHandle handle-with-icon handle-top' type='source' position={Position.Top} />
                <Handle id={`${id}-b`} className='edgeSrcHandle handle-with-icon handle-right' type='source' position={Position.Right} />
                <Handle id={`${id}-c`} className='edgeSrcHandle handle-with-icon handle-bottom' type='source' position={Position.Bottom} />
                <Handle id={`${id}-d`} className='edgeSrcHandle handle-with-icon handle-left' type='source' position={Position.Left} />
                <Handle
                id={`${id}-a`}
                type="target"
                position={Position.Top}
                style={{
                position: "absolute",
                width: "calc(100%)",
                height: "calc(100%)",
                top: "0",
                left: "0",
                borderRadius: "0",
                transform: "translate(0px, 0px)",
                background: "transparent",
                // border: isActivated ? "1px solid #4599DF" : "none",
                border: "3px solid transparent",
                zIndex: !isOnConnect ? "-1" : "1",
                // maybe consider about using stored isActivated
                }}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
            <Handle
                id={`${id}-b`}
                type="target"
                position={Position.Right}
                style={{
                position: "absolute",
                width: "calc(100%)",
                height: "calc(100%)",
                top: "0",
                left: "0",
                borderRadius: "0",
                transform: "translate(0px, 0px)",
                background: "transparent",
                // border: isActivated ? "1px solid #4599DF" : "none",
                border: "3px solid transparent",
                zIndex: !isOnConnect ? "-1" : "1",
                // maybe consider about using stored isActivated
                }}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
            <Handle
                id={`${id}-c`}
                type="target"
                position={Position.Bottom}
                style={{
                position: "absolute",
                width: "calc(100%)",
                height: "calc(100%)",
                top: "0",
                left: "0",
                borderRadius: "0",
                transform: "translate(0px, 0px)",
                background: "transparent",
                // border: isActivated ? "1px solid #4599DF" : "none",
                border: "3px solid transparent",
                zIndex: !isOnConnect ? "-1" : "1",
                // maybe consider about using stored isActivated
                }}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
            <Handle
                id={`${id}-d`}
                type="target"
                position={Position.Left}
                style={{
                position: "absolute",
                width: "calc(100%)",
                height: "calc(100%)",
                top: "0",
                left: "0",
                borderRadius: "0",
                transform: "translate(0px, 0px)",
                background: "transparent",
                // border: isActivated ? "1px solid #4599DF" : "none",
                border: "3px solid transparent",
                zIndex: !isOnConnect ? "-1" : "1",
                // maybe consider about using stored isActivated
                }}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
        </button>
        {selectModifyMenuType()}
        </div>
    )
}

export default ModifyConfig

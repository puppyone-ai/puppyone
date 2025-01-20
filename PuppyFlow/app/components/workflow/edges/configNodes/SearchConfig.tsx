import { Handle, Position, NodeProps, Node, } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, {useState} from 'react'
import SearchPerplexityConfigMenu from '@/app/components/menu/configMenu/SearchPerplexityConfigMenu'
import SearchGoogleConfigMenu from '@/app/components/menu/configMenu/SearchGoogleConfigMenu'
import SearchByVectorConfigMenu from '@/app/components/menu/configMenu/SearchByVectorConfigMenu'
import { useReactFlow } from '@xyflow/react'

export type SearchConfigNodeData = {
    subMenuType: string | null
    top_k: number | undefined,
    content: string | null,
    looped: boolean | undefined,
    query_id: {id: string, label: string} | undefined,
    vector_db: {id: string, label: string} | undefined,
    extra_configs: {
        model: "llama-3.1-sonar-small-128k-online" | "llama-3.1-sonar-large-128k-online" | "llama-3.1-sonar-huge-128k-online" | undefined,
        threshold: number | undefined
    },
    resultNode: string | null
}

type SearchConfigNodeProps = NodeProps<Node<SearchConfigNodeData>>

function SearchConfig({data: {subMenuType}, isConnectable, id}: SearchConfigNodeProps) {

    const {isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll} = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const {getNode} = useReactFlow()
    const selectSearchMenuType = () => {
        switch (subMenuType) {
            case 'search-Vector':
                return (<SearchByVectorConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'search-Elastic':
                return (<></>)
            case 'search-Perplexity':
                return (<SearchPerplexityConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'search-Google':
                return (<SearchGoogleConfigMenu show={activatedEdge === id} parentId={id}/>)
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
        <button className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[12px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"} group ${isOnGeneratingNewNode ? "pointer-events-none" : ""}`} onClick={onClickButton}>
                Search
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
        {selectSearchMenuType()}
        </div>
    )
}

export default SearchConfig
import { Handle, Position, NodeProps, Node, } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, {useState, useEffect, useMemo, useCallback} from 'react'
import ChunkingAutoConfigMenu from '@/app/components/menu/configMenu/ChunkingAutoConfigMenu'
import ChunkingByLengthConfigMenu from '@/app/components/menu/configMenu/ChunkingByLengthConfigMenu'
import ChunkingByCharacterConfigMenu from '@/app/components/menu/configMenu/ChunkingByCharacterConfigMenu'
import ChunkingByLLMConfigMenu from '@/app/components/menu/configMenu/ChunkingByLLMConfigMenu'
import ChunkingForHTMLConfigMenu from '@/app/components/menu/configMenu/ChunkingForHTMLConfigMenu'
import ChunkingForMarkdownConfigMenu from '@/app/components/menu/configMenu/ChunkingForMarkdownConfigMenu'
import { useReactFlow } from '@xyflow/react'

export type ChunkingConfigNodeData = {
    looped: boolean | undefined,
    subMenuType: string | null,
    sub_chunking_mode: "size" | "tokenizer" | undefined, // make sure the tokenizer is a valid name
    content: string | null, // for delimiters (jsonEditor) and prompt (textEditor)
    extra_configs: {
        model: "gpt-4o" | "gpt-4-turbo" | "gpt-4o-mini"  | undefined,
        chunk_size: number | undefined,
        overlap: number | undefined,
        handle_half_word: boolean | undefined,
    }
    resultNode: string | null,
}

type ChunkingConfigNodeProps = NodeProps<Node<ChunkingConfigNodeData>>

function ChunkingConfig({data: {subMenuType}, isConnectable, id}: ChunkingConfigNodeProps) {

    const {isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll} = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const {getNode} = useReactFlow()
    



    const selectChunkingMenuType = () => {
        switch (subMenuType) {
            case 'chunk-Auto':
                return (<ChunkingAutoConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'chunk-Bylength':
                return (<ChunkingByLengthConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'chunk-Bycharacter':
                return (<ChunkingByCharacterConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'chunk-ByLLM':
                return (<ChunkingByLLMConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'chunk-ForHTML':
                return (<ChunkingForHTMLConfigMenu show={activatedEdge === id} parentId={id} />)
            case 'chunk-ForMarkdown':
                return (<ChunkingForMarkdownConfigMenu show={activatedEdge === id} parentId={id} />)
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
                Chunking
                
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
            
        {selectChunkingMenuType()}
        </div>
    )
}

export default ChunkingConfig
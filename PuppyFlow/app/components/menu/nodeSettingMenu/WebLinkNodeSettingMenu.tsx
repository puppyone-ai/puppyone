import React,{useEffect, useState} from 'react'
import { useNodeContext } from '../../states/NodeContext'
import { useReactFlow , Position} from '@xyflow/react'
import { flushSync } from 'react-dom';

type WebLinkNodeSettingMenuProps = {
    showSettingMenu: number,
    clearMenu: () => void,
    nodeid: string,

}

function WebLinkNodeSettingMenu({showSettingMenu, clearMenu, nodeid}:  WebLinkNodeSettingMenuProps) {

    const {nodes, searchNode, deleteNode, lockNode, unlockNode,setHandleDisconnected, clear, markNodeAsInput, unmarkNodeAsInput, markNodeAsOutput, unmarkNodeAsOutput, allowEditLabel, disallowEditLabel, preventInactivateNode} = useNodeContext()
    const {setNodes, setEdges, getEdges}  = useReactFlow()
    // 0 未开始， 1待开始 ， 2 完成步骤1:disconnect handle ， 3 完成步骤二：delete node in the context 3. 完成步骤3: 在reactflow中删除节点和连线
    const [deleteState, setDeleteState] = useState(0)


    // 处理 onDelete node
    useEffect(() => {
        if (deleteState === 1) {
                const prevEdges = getEdges();
                const preDeletedpartialEdge = prevEdges.filter(edge => edge.target === nodeid);
                console.log(preDeletedpartialEdge);
        
                // 1. 处理 inactivate connections
                for (let edge of preDeletedpartialEdge) {
                    const possibleOtherConnections = prevEdges.filter(e => 
                        e.source === edge.source && 
                        e.sourceHandle === edge.sourceHandle && 
                        e.target !== edge.target
                    );
                    console.log(possibleOtherConnections);
                    if (!possibleOtherConnections.length && edge.sourceHandle) {
                        console.log(edge.source, edge.sourceHandle, "should inactivate");
                        let sourceHandlePosition: Position | null = null;
                        switch (edge.sourceHandle) {
                            case `${edge.source}-a`: sourceHandlePosition = Position.Top; break;
                            case `${edge.source}-b`: sourceHandlePosition = Position.Right; break;
                            case `${edge.source}-c`: sourceHandlePosition = Position.Bottom; break;
                            case `${edge.source}-d`: sourceHandlePosition = Position.Left; break;
                        }
                        if (sourceHandlePosition) {
                            flushSync(() => {
                                setHandleDisconnected(edge.source, sourceHandlePosition!);
                            })
                            
                        }
                    }
                   
                
        }
        setDeleteState(2)
    }

    else if (deleteState === 2)  {
        console.log(nodes)
        deleteNode(nodeid)
        setEdges(prevEdges => prevEdges.filter(edge => edge.source !== nodeid && edge.target !== nodeid));
        setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeid));
        setDeleteState(0)

    }
    }, [deleteState])

    const manageLock = () => {
        if (searchNode(nodeid)?.locked) unlockNode(nodeid)
        else lockNode(nodeid)
    }


    const manageEditLabel = () => {
        allowEditLabel(nodeid)
        preventInactivateNode(nodeid)
        clearMenu()
    }

  return (
    <ul className={`flex flex-col absolute top-[21px] bg-[#3E3E41] rounded-[4px] left-0 z-[20000] ${showSettingMenu ? "" : "hidden"}`}>
        <li>
            <button className='flex flex-row items-center justify-start px-[11px] pt-[6px] pb-[2px] gap-[6px] w-[108px] h-[24px] bg-[#3E3E41] border-none rounded-t-[4px] '>
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="12" viewBox="0 0 10 12" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M5.97054 5.39628C5.90535 5.2987 5.8305 5.20586 5.74599 5.11919C5.00688 4.36117 3.80854 4.36117 3.06942 5.11919L1.33828 6.8946C0.599166 7.65262 0.599166 8.8816 1.33828 9.63962C2.07739 10.3976 3.27573 10.3976 4.01485 9.63962L5.14305 8.48257L4.44493 7.76659L3.31672 8.92365C2.96317 9.28624 2.38996 9.28624 2.0364 8.92364C1.68285 8.56105 1.68285 7.97317 2.0364 7.61058L3.76755 5.83516C4.1211 5.47257 4.69431 5.47257 5.04787 5.83517C5.13556 5.9251 5.2015 6.02889 5.24569 6.13967L5.97054 5.39628Z" fill="#BEBEBE"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M3.81025 6.60441C3.8754 6.70192 3.95021 6.79468 4.03467 6.8813C4.77378 7.63931 5.97212 7.63932 6.71123 6.8813L8.44238 5.10589C9.18149 4.34787 9.18149 3.11888 8.44237 2.36087C7.70326 1.60285 6.50492 1.60285 5.76581 2.36087L4.63745 3.51808L5.33557 4.23406L6.46393 3.07684C6.81748 2.71425 7.3907 2.71425 7.74425 3.07684C8.0978 3.43944 8.0978 4.02732 7.74425 4.38991L6.01311 6.16532C5.65956 6.52792 5.08634 6.52792 4.73279 6.16532C4.64516 6.07545 4.57925 5.97175 4.53506 5.86106L3.81025 6.60441Z" fill="#BEBEBE"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[10px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                Update Link
            </div>
            </button>
        </li>
        <li>
            <button className='flex flex-row items-center justify-start px-[11px] gap-[8px] w-[108px] h-[20px] bg-[#3E3E41]'
            onClick={manageLock}>
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
            <rect y="4" width="8" height="5" fill="#BEBEBE"/>
            <rect x="1.75" y="0.75" width="4.5" height="6.5" rx="2.25" stroke="#BEBEBE" strokeWidth="1.5"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[10px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                {searchNode(nodeid)?.locked ? "Unlock it" :"Lock it"}
            </div>
            </button>
        </li>
        <li>
            <div className='h-[1px] w-[91px] bg-[#D9D9D9] mx-[8px] my-[5px]'></div>
        </li>
        <li>
            <button className='renameButton flex flex-row items-center justify-start px-[11px] py-[2px] gap-[8px] w-[108px] h-[20px] bg-[#3E3E41]'
            onClick={manageEditLabel}>
            <div className='renameButton flex items-center justify-center'>
            <svg className='renameButton' xmlns="http://www.w3.org/2000/svg" width="9" height="10" viewBox="0 0 9 10" fill="none">
            <path d="M7 0.5L9.00006 2.50006L4.5 7L2.5 5L7 0.5Z" fill="#BEBEBE"/>
            <path d="M2 5.5L4 7.5L1 8.5L2 5.5Z" fill="#BEBEBE"/>
            </svg>
            </div>
            <div className='renameButton font-plus-jakarta-sans text-[10px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                rename
            </div>
            </button>
        </li>
        <li >
            <button className='flex flex-row items-center justify-start px-[11px] pt-[2px] pb-[6px] gap-[8px] w-[108px] h-[24px] bg-[#3E3E41] rounded-b-[4px]' onClick={()=> setDeleteState(1)}>
                <div className='flex items-center justify-center'>
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M9 1L1 9" stroke="#BEBEBE" strokeWidth="2"/>
                <path d="M9 9L1 1" stroke="#BEBEBE" strokeWidth="2"/>
                </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[10px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                Delete
            </div>
            </button>
        </li>
    </ul>
  )
}

export default WebLinkNodeSettingMenu

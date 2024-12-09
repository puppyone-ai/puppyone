import React,{useEffect, useState} from 'react'
import { useNodeContext } from '../../states/NodeContext'
import { useReactFlow , Position} from '@xyflow/react'
import { flushSync } from 'react-dom';

type DatabaseNodeSettingMenuProps = {
    showSettingMenu: number,
    clearMenu: () => void,
    nodeid: string,

}

function DatabaseNodeSettingMenu({showSettingMenu, clearMenu, nodeid}: DatabaseNodeSettingMenuProps) {

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


    const manageOutput = () => {
        if (searchNode(nodeid)?.isOutput) unmarkNodeAsOutput(nodeid)
        else markNodeAsOutput(nodeid)
    }

    const manageEditLabel = () => {
        allowEditLabel(nodeid)
        preventInactivateNode(nodeid)
        clearMenu()
    }

  return (
    <ul className={`flex flex-col absolute top-[21px] bg-[#3E3E41] rounded-[4px] left-0 z-[20000] ${showSettingMenu ? "" : "hidden"}`}>
        <li>
            <button className='flex flex-row items-center justify-start px-[11px] pt-[6px] pb-[2px] gap-[5px] w-[108px] h-[24px] bg-[#3E3E41] border-none rounded-t-[4px] '
            >
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="12" viewBox="0 0 11 12" fill="none">
            <path d="M4 7.5L7 4.5" stroke="#BEBEBE" strokeWidth="1.5"/>
            <rect x="6.75" y="1.25" width="3.5" height="3.5" stroke="#BEBEBE" strokeWidth="1.5"/>
            <rect x="0.75" y="7.25" width="3.5" height="3.5" stroke="#BEBEBE" strokeWidth="1.5"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[10px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                Link
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

export default DatabaseNodeSettingMenu
import React,{useEffect, useState} from 'react'
// import { useNodeContext } from '../../states/NodeContext'
import { useReactFlow , Position} from '@xyflow/react'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'

type TextNodeSettingMenuProps = {
    showSettingMenu: number,
    clearMenu: () => void,
    nodeid: string,

}

function TextNodeSettingMenu({showSettingMenu, clearMenu, nodeid}: TextNodeSettingMenuProps) {

    // const {nodes, searchNode, deleteNode, lockNode, unlockNode,setHandleDisconnected, clear, markNodeAsInput, unmarkNodeAsInput, markNodeAsOutput, unmarkNodeAsOutput, allowEditLabel, disallowEditLabel, preventInactivateNode} = useNodeContext()
    const { manageNodeasInput, manageNodeasLocked, manageNodeasOutput, setNodeEditable, preventInactivateNode} = useNodesPerFlowContext()
    const {setNodes, setEdges, getEdges, getNode}  = useReactFlow()
    // 0 未开始， 1待开始 ， 2 完成步骤1:disconnect handle ， 3 完成步骤二：delete node in the context 3. 完成步骤3: 在reactflow中删除节点和连线
    // const [deleteState, setDeleteState] = useState(0)


    // 处理 onDelete node
    // useEffect(() => {
    //     if (deleteState === 1) {
    //             const prevEdges = getEdges();
    //             const preDeletedpartialEdge = prevEdges.filter(edge => edge.target === nodeid);
    //             // console.log(preDeletedpartialEdge);
        
    //             // 1. 处理 inactivate connections
    //             for (let edge of preDeletedpartialEdge) {
    //                 const possibleOtherConnections = prevEdges.filter(e => 
    //                     e.source === edge.source && 
    //                     e.sourceHandle === edge.sourceHandle && 
    //                     e.target !== edge.target
    //                 );
    //                 // console.log(possibleOtherConnections);
    //                 if (!possibleOtherConnections.length && edge.sourceHandle) {
    //                     // console.log(edge.source, edge.sourceHandle, "should inactivate");
    //                     let sourceHandlePosition: Position | null = null;
    //                     switch (edge.sourceHandle) {
    //                         case `${edge.source}-a`: sourceHandlePosition = Position.Top; break;
    //                         case `${edge.source}-b`: sourceHandlePosition = Position.Right; break;
    //                         case `${edge.source}-c`: sourceHandlePosition = Position.Bottom; break;
    //                         case `${edge.source}-d`: sourceHandlePosition = Position.Left; break;
    //                     }
    //                     if (sourceHandlePosition) {
    //                         flushSync(() => {
    //                             setHandleDisconnected(edge.source, sourceHandlePosition!);
    //                         })
                            
    //                     }
    //                 }
                   
                
    //     }
    //     setDeleteState(2)
    // }

    // else if (deleteState === 2)  {
    //     // console.log(nodes)
    //     deleteNode(nodeid)
    //     setEdges(prevEdges => prevEdges.filter(edge => edge.source !== nodeid && edge.target !== nodeid));
    //     setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeid));
    //     setDeleteState(0)

    // }
    // }, [deleteState])
    const deleteNode = () => {
        setEdges(prevEdges => prevEdges.filter(edge => edge.source !== nodeid && edge.target !== nodeid));
        setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeid));
    }

    // const manageLock = () => {
    //     if (searchNode(nodeid)?.locked) unlockNode(nodeid)
    //     else lockNode(nodeid)
    // }

    // const manageInput = () => {
    //     if (searchNode(nodeid)?.isInput) unmarkNodeAsInput(nodeid)
    //     else markNodeAsInput(nodeid)
    // }

    // const manageOutput = () => {
    //     if (searchNode(nodeid)?.isOutput) unmarkNodeAsOutput(nodeid)
    //     else markNodeAsOutput(nodeid)
    // }

    const manageEditLabel = () => {
        setNodeEditable(nodeid)
        preventInactivateNode()
        clearMenu()
    }

  return (
    <ul className={`flex flex-col absolute top-[24px] py-[8px] w-[128px] bg-[#3E3E41] rounded-[4px] left-0 z-[20000] ${showSettingMenu ? "" : "hidden"}`}>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px]  gap-[8px] w-full h-[24px] bg-[#3E3E41] border-none rounded-t-[4px]'
            onClick={()=> manageNodeasInput(nodeid)}>
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M3 2L5.5 4L3 6V2Z" fill="#BEBEBE"/>
            <path d="M3 4H0" stroke="#BEBEBE" strokeWidth="1.5"/>
            <path d="M4 0H8V8H4V6.5H6.5V1.5H4V0Z" fill="#BEBEBE"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                {getNode(nodeid)?.data?.isInput ? "unset input" :"set as input"}
            </div>
            </button>
        </li>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px] gap-[8px] w-full h-[24px] bg-[#3E3E41] border-none'
            onClick={()=> manageNodeasOutput(nodeid)}>
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M5.5 2L8 4L5.5 6V2Z" fill="#BEBEBE"/>
            <path d="M6 4H3" stroke="#BEBEBE" strokeWidth="1.5"/>
            <path d="M0 0H4V1.5H1.5V6.5H4V8H0V0Z" fill="#BEBEBE"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                {getNode(nodeid)?.data?.isOutput ? "unset output" :"set as output"}
            </div>
            </button>
        </li>
        <li>
            <button className='flex flex-row items-center justify-start px-[16px] gap-[8px] w-full h-[24px] bg-[#3E3E41]'
            onClick={()=> manageNodeasLocked(nodeid)}>
            <div className='flex items-center justify-center'>
            <svg xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
            <rect y="4" width="8" height="5" fill="#BEBEBE"/>
            <rect x="1.75" y="0.75" width="4.5" height="6.5" rx="2.25" stroke="#BEBEBE" strokeWidth="1.5"/>
            </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                {getNode(nodeid)?.data?.locked ? "Unlock the text" :"Lock the text"}
            </div>
            </button>
        </li>
        <li>
            <div className='h-[1px] w-full bg-[#181818] my-[8px]'></div>
        </li>
        <li>
            <button className='renameButton flex flex-row items-center justify-start px-[16px] gap-[8px] w-full h-[24px] bg-[#3E3E41]'
            onClick={manageEditLabel}>
            <div className='renameButton flex items-center justify-center'>
            <svg className='renameButton' xmlns="http://www.w3.org/2000/svg" width="9" height="10" viewBox="0 0 9 10" fill="none">
            <path d="M7 0.5L9.00006 2.50006L4.5 7L2.5 5L7 0.5Z" fill="#BEBEBE"/>
            <path d="M2 5.5L4 7.5L1 8.5L2 5.5Z" fill="#BEBEBE"/>
            </svg>
            </div>
            <div className='renameButton font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                rename
            </div>
            </button>
        </li>
        <li >
            <button className='flex flex-row items-center justify-start px-[16px]  gap-[8px] w-full h-[24px] bg-[#3E3E41] rounded-b-[4px]' onClick={deleteNode}>
                <div className='flex items-center justify-center'>
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M9 1L1 9" stroke="#BEBEBE" strokeWidth="2"/>
                <path d="M9 9L1 1" stroke="#BEBEBE" strokeWidth="2"/>
                </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
                Delete
            </div>
            </button>
        </li>
    </ul>
  )
}

export default TextNodeSettingMenu
import React, { useEffect, useState, Fragment } from 'react';
// import { useNodeContext } from '../../states/NodeContext'
import { useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { Transition } from '@headlessui/react';

type TextNodeSettingMenuProps = {
  showSettingMenu: number;
  clearMenu: () => void;
  nodeid: string;
};

function TextNodeSettingMenu({
  showSettingMenu,
  clearMenu,
  nodeid,
}: TextNodeSettingMenuProps) {
  // const {nodes, searchNode, deleteNode, lockNode, unlockNode,setHandleDisconnected, clear, markNodeAsInput, unmarkNodeAsInput, markNodeAsOutput, unmarkNodeAsOutput, allowEditLabel, disallowEditLabel, preventInactivateNode} = useNodeContext()
  const { setNodeEditable, preventInactivateNode } = useNodesPerFlowContext();
  const { setNodes, setEdges, getEdges, getNode } = useReactFlow();
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
    setEdges(prevEdges =>
      prevEdges.filter(edge => edge.source !== nodeid && edge.target !== nodeid)
    );
    setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeid));
  };

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
    setNodeEditable(nodeid);
    preventInactivateNode();
    clearMenu();
  };

  return (
    <Transition
      show={!!showSettingMenu}
      as={Fragment}
      enter='transition ease-out duration-100'
      enterFrom='transform opacity-0 translate-y-[-10px]'
      enterTo='transform opacity-100 translate-y-0'
      leave='transition ease-in duration-75'
      leaveFrom='transform opacity-100 translate-y-0'
      leaveTo='transform opacity-0 translate-y-[-10px]'
    >
      <ul className='flex flex-col absolute top-[8px] p-[8px] w-[160px] gap-[4px] bg-[#252525] border-[1px] border-[#404040] rounded-[8px] left-0 z-[20000]'>
        {/* <li>
                <button className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
                onClick={()=> manageNodeasInput(nodeid)}>
                <div className='flex items-center justify-center'>
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="16" y="7" width="2.5" height="12" rx="0.5" fill="currentColor"/>
                  <path d="M6 13H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M10 9L14 13L10 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                </div>
                <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
                    {getNode(nodeid)?.data?.isInput ? "Unset input" :"Set as input"}
                </div>
                </button>
            </li>
            <li>
                <button className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
                onClick={()=> manageNodeasOutput(nodeid)}>
                <div className='flex items-center justify-center'>
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="7.5" y="7" width="2.5" height="12" rx="0.5" fill="currentColor"/>
                  <path d="M12 13H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M16 9L20 13L16 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                </div>
                <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
                    {getNode(nodeid)?.data?.isOutput ? "Unset output" :"Set as output"}
                </div>
                </button>
            </li> */}
        

        <li>
          <button
            className='renameButton flex flex-row items-center justify-start  gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
            onClick={manageEditLabel}
          >
            <div className='renameButton flex items-center justify-center'>
              <svg
                width='26'
                height='26'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path
                  d='M16.8891 6L20.0003 9.11118L13.0002 16.111L9.88915 13L16.8891 6Z'
                  fill='currentColor'
                />
                <path
                  d='M9.1109 13.7776L12.222 16.8887L7.55536 18.4442L9.1109 13.7776Z'
                  fill='currentColor'
                />
              </svg>
            </div>
            <div className='renameButton font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
              Rename
            </div>
          </button>
        </li>
        <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>

        <li>
          <button
            className='flex flex-row items-center justify-start   gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#F44336] hover:text-[#FF6B64]'
            onClick={deleteNode}
          >
            <div className='flex items-center justify-center'>
              <svg
                width='26'
                height='26'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path d='M19 7L7 19' stroke='#F44336' stroke-width='2' />
                <path d='M19 19L7 7' stroke='#F44336' stroke-width='2' />
              </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
              Delete
            </div>
          </button>
        </li>
      </ul>
    </Transition>
  );
}

export default TextNodeSettingMenu;

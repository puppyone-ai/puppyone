import React, { useState, Fragment } from 'react'
import { useFlowsPerUserContext } from '../states/FlowsPerUserContext'
import { Transition } from '@headlessui/react'

type FlowThumbnailViewProps = {
    showFlowMenu: boolean;
}

function FlowThumbnailView({showFlowMenu}: FlowThumbnailViewProps) {
  const {workspaces, handleFlowSwitch, selectedFlowId} = useFlowsPerUserContext()
  const [hoveredFlowId, setHoveredFlowId] = useState<string | null>(null);

  return (
    <Transition
      show={showFlowMenu}
      as={Fragment}
      enter="transition ease-out duration-200"
      enterFrom="transform opacity-0 translate-y-[-10px]"
      enterTo="transform opacity-100 translate-y-0"
      leave="transition ease-in duration-150"
      leaveFrom="transform opacity-100 translate-y-0"
      leaveTo="transform opacity-0 translate-y-[-10px]"
    >
      <ul className="min-w-[128px] w-fit bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col absolute top-[110px] left-[60px] z-[2000000000]">
        {workspaces.map((workspace, index) => (
          <React.Fragment key={workspace.flowId}>
            <li 
                className={`w-full rounded-[4px] ${
                  workspace.flowId === selectedFlowId 
                    ? 'bg-[#3E3E41]' 
                    : hoveredFlowId === workspace.flowId 
                      ? 'bg-[#3E3E41]' 
                      : ''
                }`}
                onMouseEnter={() => setHoveredFlowId(workspace.flowId)}
                onMouseLeave={() => setHoveredFlowId(null)}
            >
                <button 
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (workspace.flowId !== selectedFlowId) {
                            handleFlowSwitch(workspace.flowId);
                        }
                    }}
                    className="px-[8px] rounded-[4px] bg-inherit w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-medium tracking-[0.5px] cursor-pointer whitespace-nowrap"
                >
                    {workspace.flowTitle}
                </button>
            </li>
            {index < workspaces.length - 1 && (
              <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>
            )}
          </React.Fragment>
        ))}
      </ul>
    </Transition>
  )
}

export default FlowThumbnailView
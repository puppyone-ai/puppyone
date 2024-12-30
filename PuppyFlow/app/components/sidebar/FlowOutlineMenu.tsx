import React, { useState } from 'react'
import { useFlowsPerUserContext } from '../states/FlowsPerUserContext'

type FlowOutlineMenuProps = {
    showFlowMenu: boolean;
}

function FlowOutlineMenu({showFlowMenu}: FlowOutlineMenuProps) {
  const {workspaces, handleFlowSwitch, selectedFlowId} = useFlowsPerUserContext()
  const [hoveredFlowId, setHoveredFlowId] = useState<string | null>(null);

  return (
    <ul className={`${showFlowMenu ? "flex z-[2000000000]" : "opacity-0 pointer-events-none z-[-1000000000]"} FlowOutlineMenuGroup absolute top-[110px] left-[60px] flex-col items-start justify-start w-[145px] flex-shrink-0 rounded-[8px] bg-[#3E3E41] gap-[4px] px-[8px] py-[16px]`}>
        {workspaces.map((workspace) => (
            <li key={workspace.flowId} 
                className={`w-full rounded-[4px] ${
                  workspace.flowId === selectedFlowId 
                    ? 'bg-[#5C5D5E]' 
                    : hoveredFlowId === workspace.flowId 
                      ? 'bg-[#5C5D5E]' 
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
                    className="flex items-center justify-start font-plus-jakarta-sans w-full h-[24px] px-[8px] rounded-[4px] transition-colors cursor-pointer"
                >
                    <p className='whitespace-nowrap overflow-hidden text-ellipsis w-[115px] h-full text-[12px] text-[#CDCDCD] font-normal tracking-[0.5px] leading-normal text-start flex items-center justify-start'>
                        {workspace.flowTitle}
                    </p>    
                </button>
            </li>
        ))}
    </ul>
  )
}

export default FlowOutlineMenu
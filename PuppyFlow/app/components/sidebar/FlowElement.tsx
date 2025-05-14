import React, { useState, useRef } from 'react'
import { useFlowsPerUserContext } from '../states/FlowsPerUserContext'
import FlowElementOperationMenu from './FlowElementOperationMenu'
type FlowElementProps = {
    FlowId: string;
    FlowName: string;
    handleOperationMenuShow: (flowId: string | null) => void;
    flowIdShowOperationMenu: string | null;
    // showFlowName: (flowId: string) => string;
    // editFlow: (flowId: string, flowName: string) => void;
    // removeFlow: (flowId: string) => void;
}

function FlowElement({FlowId, FlowName, handleOperationMenuShow, flowIdShowOperationMenu}: FlowElementProps) {
    // 需要定义一个css 条件是当hover到这个flow bar 时，bg背景颜色需要变化 bg-[#3d3e41]

    const [isHover, setIsHover] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    // const {removeFlow, editFlowName, setSelectedFlowId, selectedFlowId} = useFlowsPerUserContext()
    const {handleFlowSwitch, selectedFlowId, removeFlow, editFlowName} = useFlowsPerUserContext()


    


  return (
    <li className={`
      flex items-center justify-center pl-[16px] pr-[4px] h-[32px] w-full gap-[10px] rounded-[6px] cursor-pointer relative
      ${FlowId === selectedFlowId || flowIdShowOperationMenu === FlowId 
        ? 'bg-[#454545] hover:bg-[#454545] transition-colors duration-200' 
        : 'hover:bg-[#313131] transition-colors duration-200'
      }
    `} 
      onMouseEnter={() => setIsHover(true)} 
      onMouseLeave={() => setIsHover(false)} 
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (FlowId !== selectedFlowId) {
            handleFlowSwitch(FlowId)
        }
    }}>
      <div className={`flex items-center justify-start min-h-[32px] text-left text-[13px] rounded-[6px] w-full font-medium font-plus-jakarta-sans 
      ${FlowId === selectedFlowId ? 'text-white' : 'text-[#CDCDCD]'}
      FlowElementInput border-none outline-none bg-transparent`}>
        {FlowName}
      </div>
      <div className={`w-[24px] h-[24px] ${flowIdShowOperationMenu === FlowId || isHover ? 'flex' : 'hidden'}`}> {/* 添加固定宽度的容器 */}
        
          <button 
            ref={buttonRef}
            className='flex items-center justify-center w-[24px] h-[24px] text-[#CDCDCD] rounded-[4px] hover:bg-[#5C5D5E] transition-colors duration-200' 
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              handleOperationMenuShow(FlowId)
              // removeFlow(FlowId)
            }}
          >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"  fill="none" className="group transition-colors duration-200">
              <path d="M7 11H9V13H7V11Z" className="fill-[#5D6065] group-hover:fill-white transition-colors duration-200"/>
              <path d="M16 11H18V13H16V11Z" className="fill-[#5D6065] group-hover:fill-white transition-colors duration-200"/>
              <path d="M11.5 11H13.5V13H11.5V11Z" className="fill-[#5D6065] group-hover:fill-white transition-colors duration-200"/>
            </svg>
          </button>
          <FlowElementOperationMenu 
            flowId={FlowId} 
            show={flowIdShowOperationMenu === FlowId} 
            handleOperationMenuHide={() => handleOperationMenuShow(null)}
            buttonRef={buttonRef}
          />
      </div>

    </li>
  )
}

export default FlowElement
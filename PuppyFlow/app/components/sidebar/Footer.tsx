import React from 'react'
import {useFlowsPerUserContext} from '../states/FlowsPerUserContext'


function Footer() {

  const {addFlow} = useFlowsPerUserContext()

  return (
    <div className="flex h-[30px] items-center px-[16px]  mt-[8px] relative self-stretch w-full">
        <button className="flex items-center gap-[10px] font-plus-jakarta-sans text-[#6d7177]" onClick={addFlow}>
          <span className='text-[18px] leading-[18px] translate-y-[-2px]'>+</span>
          <span className='text-[12px] leading-normal'>New Workspace</span>
        </button>
      </div>
  )
}

export default Footer
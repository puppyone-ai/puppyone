import React from 'react'
import {useFlowsPerUserContext} from '../states/FlowsPerUserContext'


function AddNewWorkspaceButton() {

  const {addFlow} = useFlowsPerUserContext()

return (
  <div className="flex h-[32px] items-center   mt-[24px] relative self-stretch w-full cursor-pointer">
      <button className="w-full h-[32px] pl-[16px] pr-[4px] flex items-center gap-[10px] font-plus-jakarta-sans text-[#6d7177] hover:bg-[#313131] rounded-md transition-colors group" onClick={addFlow}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-hover:[&>*]:stroke-[#CDCDCD]">
          <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="3.25" stroke="#6D7177" strokeWidth="1.5"/>
          <path d="M8 4V12" stroke="#6D7177" strokeWidth="1.5"/>
          <path d="M4 8L12 8" stroke="#6D7177" strokeWidth="1.5"/>
        </svg>
        <span className='text-[14px] font-medium text-[#6D7177] group-hover:text-[#CDCDCD]'>New</span>
      </button>
    </div>
)
}

export default AddNewWorkspaceButton

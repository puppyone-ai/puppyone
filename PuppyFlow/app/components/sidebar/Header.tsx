import React, { useState } from 'react'
import { useFlowsPerUserContext } from '../states/FlowsPerUserContext'

type HeaderProps = {
    setFlowFullScreen: React.Dispatch<React.SetStateAction<boolean>>;
}

function Header({setFlowFullScreen}: HeaderProps) {

  const {userName} = useFlowsPerUserContext()

    return (
        <div className="flex w-full  items-center justify-between h-[32px] pl-[16px]   relative self-stretch  border-sidebar-grey gap-[16px]">
      <input className="HeaderTitle relative flex items-center justify-start h-[29px] w-[147px] font-plus-jakarta-sans font-bold text-[#cccccc] text-[13px] tracking-[0px] leading-[normal] whitespace-nowrap bg-transparent"
      value={`${userName ?? 'Your'}'s Project`}
      readOnly
      />
      <button className='w-[32px] h-[32px] flex items-center justify-center group' onClick={() => setFlowFullScreen(false)}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="group-hover:bg-[#313131] rounded-md">
            <rect width="32" height="32" rx="4" className="fill-transparent group-hover:fill-[#313131]"/>
            <rect x="8.75" y="10.75" width="14.5" height="10.5" rx="1.25" className="stroke-[#CDCDCD] group-hover:stroke-[#FFFFFF]" strokeWidth="1.5"/>
            <path d="M14 11V21" className="stroke-[#CDCDCD] group-hover:stroke-[#FFFFFF]" strokeWidth="1.5"/>
          </svg>
        </button>
    </div>
      );
}

export default Header
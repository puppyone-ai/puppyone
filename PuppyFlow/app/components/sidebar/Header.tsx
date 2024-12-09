import React from 'react'


function Header({title = "your workspace"}) {
    return (
        <div className="flex h-[32px] items-center justify-between pl-[25px] pr-[9px] py-[1px] relative self-stretch w-full border-sidebar-grey gap-[36.5px]">
      <div className="flex w-[193px] items-center gap-[7px] px-0 relative">
        <div className="relative flex items-center h-[30px] font-plus-jakarta-sans font-bold text-[#cccccc] text-[13px] tracking-[0px] leading-[normal] whitespace-nowrap">
          {title}
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="4" viewBox="0 0 10 7" fill="none">
        <path d="M1 1.5L5 5.5L9 1.5" stroke="#6D7177" strokeWidth="2"/>
        </svg>
      </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="9.5" height="8.444" viewBox="0 0 16 15" fill="none">
        <path d="M15 1.5L9.5 7.5L15 13.5" stroke="#6D7177" strokeWidth="2"/>
        <path d="M7 1.5L1.5 7.5L7 13.5" stroke="#6D7177" strokeWidth="2"/>
        </svg>
    </div>
      );
}

export default Header
import React from 'react'

function Footer() {
  return (
    <>
        <div className="h-10 items-center gap-2.5 px-[25px] py-2 self-stretch w-full flex relative">
        <div className="relative w-fit font-plus-jakarta-sans text-[13px]  font-weight-normal text-[#cccccc] tracking-[0.65px] leading-[normal] whitespace-nowrap">
          HackerNews Retriever
        </div>
      </div>
      <div className="flex h-[30px] items-center gap-[11px] pl-[25px] pr-[29px] py-0.5 relative self-stretch w-full">
        <button className="relative w-fit font-plus-jakarta-sans font-bold text-[#6d7177] text-[13px] tracking-[0.65px] leading-[normal]flex items-center">
          +
        </button>
        <div className="relative w-fit font-plus-jakarta-sans font-weight-normal text-[#6d7177] text-[13px] tracking-[0.65px] leading-[normal] whitespace-nowrap flex items-center">
          New Flow
        </div>
      </div>
    </>
  )
}

export default Footer
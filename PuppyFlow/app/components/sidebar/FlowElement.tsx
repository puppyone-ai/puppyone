import React from 'react'

function FlowElement({customFlowName="unknown flow"}) {
    // 需要定义一个css 条件是当hover到这个flow bar 时，bg背景颜色需要变化 bg-[#3d3e41]
  return (
    <div className='flex items-center justify-center px-[25px] py-[8px] h-[30px] flex-shrink-0 w-full'>
      <div className='flex items-center justify-start text-left w-full text-[13px] tracking-[0.65px] font-normal font-plus-jakarta-sans text-[#CDCDCD] active:bg-[#3E3E41]
       rounded-[8px]'>
      {customFlowName}
      </div> 
    </div>
  )
}

export default FlowElement
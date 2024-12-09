import React from 'react'
import Header from './Header'
import Footer from './Footer'
import FlowElement from './FlowElement'

function Sidebar() {
  return (
    <div className="flex-col font-normal  w-[223px] h-screen items-start gap-px bg-[#2c2d30] flex relative pt-[2px]" >
    <Header title="Guantum's workspace" />
    <div className="flex flex-col items-center px-0 pt-[10px] pb-[24px] relative self-stretch w-full">
      <FlowElement customFlowName='IndeaHunt Flow'/>
      <FlowElement customFlowName='puppyFlow'/>
      <FlowElement customFlowName='CV_Search'/>
      <FlowElement customFlowName='ChatBox Flow'/>
      
      <div className="flex flex-col h-[37px] items-center justify-center px-7 py-[18px] relative self-stretch w-full">
        <div className="self-stretch w-full h-px bg-sidebar-grey" />

      </div>
      <Footer />
    </div>
  </div>
  )
}

export default Sidebar
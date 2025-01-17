import React, { useState } from 'react'
import useWholeWorkflowJsonConstructUtils from '../../hooks/useWholeWorkflowJsonConstructUtils'




function TestRunBotton() {
  const [hovered, setHovered] = useState(false)
  const {sendWholeWorkflowJsonDataToBackend, isComplete, setIsComplete} = useWholeWorkflowJsonConstructUtils()


  const onDataSubmit = async () => {
    // console.log("isComplete or not?", isComplete)
    if (!isComplete) return
    setIsComplete(false)
    await sendWholeWorkflowJsonDataToBackend()

  };




  return (

    <button className=' h-[36px] px-[12px] rounded-r-[8px] bg-[rgba(217,217,217, 0)]  flex items-center justify-center gap-[4px] hover:cursor-pointer hover:bg-main-green transition-colors' onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={onDataSubmit}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="transition-[fill]">
        <path className="transition-[fill]" d="M12 7L3 13V1L12 7Z" fill={hovered === true ? "#000" : "#39BC66"}/>
      </svg>
      <div className={`text-[14px] font-normal leading-normal transition-colors ${hovered === true ? "text-[#000]" : "text-[#39BC66]"}`}>  Test Run</div>
    </button>
  )
}

export default TestRunBotton
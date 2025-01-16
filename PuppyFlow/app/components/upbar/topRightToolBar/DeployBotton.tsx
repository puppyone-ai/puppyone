import React, { useState } from 'react'
import useWholeWorkflowJsonConstructUtils from '../../hooks/useWholeWorkflowJsonConstructUtils'




function DeployBotton() {
  const [hovered, setHovered] = useState(false)
  const {sendWholeWorkflowJsonDataToBackend, isComplete, setIsComplete} = useWholeWorkflowJsonConstructUtils()


  const onWorkspaceDeploy = async () => {
    console.log("workspace deploy")
  };




  return (

    <button className={`flex flex-row items-center justify-center gap-[8px] px-[10px] h-[36px] rounded-[8px] bg-[#252525] border-[1px] hover:bg-[#FFA73D] transition-colors border-[#3E3E41] group`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={onWorkspaceDeploy}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="transition-[stroke]">
        <path className="transition-[stroke]" d="M1.36578 12.6751L12.3658 1.67508" stroke={hovered === true ? "#000" : "#FFA73D"} strokeWidth="2"/>
        <path className="transition-[stroke]" d="M2.86578 1.67512L12.3658 1.67513L12.3658 10.6751" stroke={hovered === true ? "#000" : "#FFA73D"} strokeWidth="2"/>
      </svg>
      <div className={`text-[14px] font-normal leading-normal transition-colors ${hovered === true ? "text-[#000]" : "text-[#FFA73D]"}`}>Deploy</div>
    </button>
  )
}

export default DeployBotton
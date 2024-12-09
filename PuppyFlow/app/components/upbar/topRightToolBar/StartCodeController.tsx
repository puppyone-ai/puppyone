import React, { useState } from 'react'
import useWholeWorkflowJsonConstructUtils from '../../hooks/useWholeWorkflowJsonConstructUtils'




function StartCodeController() {
  const [hovered, setHovered] = useState(false)
  const {sendWholeWorkflowJsonDataToBackend, isComplete, setIsComplete} = useWholeWorkflowJsonConstructUtils()


  const onDataSubmit = async () => {
    // console.log("isComplete or not?", isComplete)
    if (!isComplete) return
    setIsComplete(false)
    await sendWholeWorkflowJsonDataToBackend()

  };




  return (

    <button className='w-[28px] h-[28px] rounded-[8px] bg-[rgba(217,217,217, 0)] border-main-green border-[1.5px] border-solid flex items-center justify-center hover:cursor-pointer hover:bg-main-green transition-colors' onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={onDataSubmit}>
    <svg xmlns="http://www.w3.org/2000/svg" width="7" height="8" viewBox="0 0 5 6" fill="none">

    <path d="M0.5 5.1169V0.883095L4.02817 3L0.5 5.1169Z" fill={hovered === true ? "#000" : "#39BC66"} stroke={hovered === true ? "#000" : "#39BC66"}/>
    </svg>
    </button>
  )
}

export default StartCodeController
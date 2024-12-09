import React, {useState, useEffect} from 'react'
import { useNodeContext } from '../../states/NodeContext'
import { useReactFlow } from '@xyflow/react'
import { nodeSmallProps } from './NodeMenu'

type OtherNodesSubMenuProps = {
    selectedMenu: number,
    handleMouseDown: (nodeType: string) => void
}

  

function OtherNodesSubMenu({selectedMenu, handleMouseDown}: OtherNodesSubMenuProps) {
    const {getNodes, setNodes} = useReactFlow()
   const {addNode, nodes, totalCount, addCount} = useNodeContext()



  return (
        <ul id="nodeMenu" className={` ${selectedMenu === 1? 'opacity-100 translate-y-0' : 'opacity-0 hidden translate-y-4'}  bg-[#1c1d1f] rounded-[8px] border-solid border-[1px] border-[#3e3e41] absolute top-[345px] overflow-hidden left-[195px] z-[10000] text-white flex flex-col justify-evenly items-center gap-[6px] p-[6px] transition-all duration-300 ease-in-out transform origin-top`} >
        {/* <li>
            <button id="" className='w-[180px] h-[57px] bg-[#3E3E41] rounded-[5px] flex flex-row items-start gap-2 p-[6px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-main-blue transition-colors' onClick={(event)=> {
              event.preventDefault()
              event.stopPropagation()
              // setNode({nodeid: `${totalCount + 1}`, nodeType: "vector"})
              // setIsAdd(false)
              handleMouseDown("vector")
            }}>
            <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center text-[18px] font-[400] rounded-[5px]'>
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="25" viewBox="0 0 26 25" fill="none">
                <path d="M13 16V2" stroke="#CDCDCD" strokeWidth="1.5"/>
                <path d="M13 -8.9407e-08L10.1132 5L15.8868 5L13 -8.9407e-08Z" fill="#CDCDCD"/>
                <path d="M26 25L20.2459 24.5274L23.5322 19.7805L26 25ZM13.2846 15.5889L22.5847 22.0275L22.0155 22.8497L12.7154 16.4111L13.2846 15.5889Z" fill="#CDCDCD"/>
                <path d="M13 16L24.5 24" stroke="#CDCDCD" strokeWidth="1.5"/>
                <path d="M0 25L5.75413 24.5274L2.46779 19.7805L0 25ZM12.7154 15.5889L3.41526 22.0275L3.98447 22.8497L13.2846 16.4111L12.7154 15.5889Z" fill="#CDCDCD"/>
                <path d="M13 16L1.5 24" stroke="#CDCDCD" strokeWidth="1.5"/>
                </svg>

            </div>
            <div className='text-[12px] font-[700] pt-1 '>Vector</div>
            </button> 
        </li>  */}
        <li>
            <button id="" className='w-[180px] h-[57px] bg-[#3E3E41] rounded-[5px] flex flex-row items-start gap-2 p-[6px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-main-blue transition-colors' onClick={(event)=> {
              event.preventDefault()
              event.stopPropagation()
              // setNode({nodeid: `${totalCount + 1}`, nodeType: "weblink"})
              // setIsAdd(false)
              handleMouseDown("weblink")
            }}>
            <div className='w-[44px] h-[44px] bg-[#1C1D1F] flex items-center justify-center  text-[16px] font-[400] rounded-[5px]'>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="23" viewBox="0 0 24 23" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M14.5965 10.2725C14.4386 10.0347 14.2537 9.80936 14.0418 9.60053C12.3803 7.96313 9.6864 7.96313 8.02487 9.60053L3.69489 13.8676C2.03335 15.505 2.03336 18.1598 3.69489 19.7972C5.35642 21.4346 8.0503 21.4346 9.71184 19.7972L12.5341 17.0159L11.4658 15.963L8.64345 18.7443C7.57197 19.8002 5.83476 19.8002 4.76328 18.7443C3.6918 17.6884 3.6918 15.9764 4.76328 14.9205L9.09326 10.6534C10.1647 9.59749 11.902 9.59749 12.9734 10.6534C13.1896 10.8664 13.3621 11.1061 13.4911 11.3618L14.5965 10.2725Z" fill="#CDCDCD"/>
            <path fillRule="evenodd" clipRule="evenodd" d="M9.46603 12.4973C9.62388 12.735 9.80877 12.9604 10.0207 13.1692C11.6822 14.8066 14.3761 14.8066 16.0376 13.1692L20.3676 8.90215C22.0291 7.26475 22.0291 4.60999 20.3676 2.97259C18.7061 1.33519 16.0122 1.33519 14.3507 2.97259L11.5284 5.75391L12.5967 6.80678L15.4191 4.02547C16.4905 2.96955 18.2277 2.96955 19.2992 4.02546C20.3707 5.08138 20.3707 6.79336 19.2992 7.84927L14.9692 12.1164C13.8978 13.1723 12.1605 13.1723 11.0891 12.1164C10.8729 11.9034 10.7004 11.6636 10.5714 11.408L9.46603 12.4973Z" fill="#CDCDCD"/>
            </svg>
            </div>
            <div className='text-[12px] font-[700] pt-1'>Weblink</div>
            </button> 
        </li> 
        
    </ul>
  )
}

export default OtherNodesSubMenu
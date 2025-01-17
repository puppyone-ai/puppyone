'use client'

import { Menu, Transition } from '@headlessui/react'
import React, { useState, Fragment } from 'react'
import useWholeWorkflowJsonConstructUtils from '../../hooks/useWholeWorkflowJsonConstructUtils'

function DeployBotton() {
  const [hovered, setHovered] = useState(false)
  const {sendWholeWorkflowJsonDataToBackend} = useWholeWorkflowJsonConstructUtils()

  const handleDeploy = async () => {
    try {
      await sendWholeWorkflowJsonDataToBackend()
      // 可以添加成功提示
    } catch (error) {
      console.error('Deploy failed:', error)
    }
  }

  return (
    <Menu as="div" className="relative">
      <Menu.Button className={`flex flex-row items-center justify-center gap-[8px] px-[10px] h-[36px] rounded-[8px] bg-[#252525] border-[1px] hover:bg-[#FFA73D] transition-colors border-[#3E3E41] group`} 
        onMouseEnter={() => setHovered(true)} 
        onMouseLeave={() => setHovered(false)}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="transition-[stroke]">
          <path className="transition-[stroke]" d="M1.36578 12.6751L12.3658 1.67508" stroke={hovered === true ? "#000" : "#FFA73D"} strokeWidth="2"/>
          <path className="transition-[stroke]" d="M2.86578 1.67512L12.3658 1.67513L12.3658 10.6751" stroke={hovered === true ? "#000" : "#FFA73D"} strokeWidth="2"/>
        </svg>
        <div className={`text-[14px] font-normal leading-normal transition-colors ${hovered === true ? "text-[#000]" : "text-[#FFA73D]"}`}>Deploy</div>
      </Menu.Button>

      <Transition
        as="div"
        enter="transition ease-out duration-200"
        enterFrom="transform opacity-0 translate-y-[-10px]"
        enterTo="transform opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="transform opacity-100 translate-y-0"
        leaveTo="transform opacity-0 translate-y-[-10px]"
      >
        <Menu.Items className="absolute right-0 mt-[16px] w-[320px] origin-top-right rounded-2xl bg-[#1E1E1E] shadow-lg border border-[#404040] focus:outline-none">
          <div className="py-[24px] px-[16px]">
            <h2 className="text-[#CDCDCD] text-[16px] mb-2">
              Deploy the Project
            </h2>
            <p className="text-[#808080] text-[12px] mb-8">
              Host this project by PuppyAgent
            </p>

            {/* 两列布局 */}
            <div className="grid grid-cols-2 gap-8 mb-8">
              {/* 左列 */}
              <div>
                <h3 className="text-[#CDCDCD] text-[14px] mb-4">inputs</h3>
                <div className="space-y-3 text-[14px] font-medium">
                  <div className="bg-[#6D7177] text-[#1E1E1E] h-[32px] border-[1.5px] border-[#6D7177] px-4 rounded-lg flex items-center">Query</div>
                  <div className="bg-[#6D7177] text-[#1E1E1E] h-[32px] border-[1.5px] border-[#6D7177] px-4 rounded-lg flex items-center">Database</div>
                  <div className="bg-[#6D7177] text-[#1E1E1E] h-[32px] border-[1.5px] border-[#6D7177] px-4 rounded-lg flex items-center">FewShots</div>
                  <button className="w-8 h-8 flex items-center justify-center border border-[#404040] border-[2px] rounded-lg">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 1V13M1 7H13" stroke="#6D7177" strokeWidth="2"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* 右列 */}
              <div>
                <h3 className="text-[#CDCDCD] text-[14px] mb-4">outputs</h3>
                <div className="space-y-3 text-[14px] font-medium">
                  <div className="bg-[#6D7177] text-[#1E1E1E] h-[32px] border-[1.5px] border-[#6D7177] px-4 rounded-lg flex items-center">Result</div>

                  <button className="w-8 h-8 flex items-center justify-center border border-[#404040] border-[2px] rounded-lg">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 1V13M1 7H13" stroke="#6D7177" strokeWidth="2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Export API 按钮 */}
            <div className="flex justify-center">
              <button className="h-[36px] w-[100px] text-[14px] bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] text-[#CDCDCD] hover:bg-[#363636] transition duration-200 flex items-center justify-center">
                Export API
              </button>
            </div>
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  )
}

export default DeployBotton
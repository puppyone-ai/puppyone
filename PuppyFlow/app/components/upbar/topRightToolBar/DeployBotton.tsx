'use client'

import { Menu, Transition } from '@headlessui/react'
import React, { useState, Fragment, useEffect } from 'react'
import useWholeWorkflowJsonConstructUtils from '../../hooks/useWholeWorkflowJsonConstructUtils'
import { Button } from 'antd'
import { useReactFlow } from '@xyflow/react'
import { set } from 'lodash'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'

const CustomDropdown = ({ options, onSelect, selectedValue, isOpen, setIsOpen }:any) => {

  const handleSelect = (nodeId: string, label: string) => {
      onSelect({id:nodeId, label:label});
      setIsOpen(false); // Close dropdown after selection
  };

  // Inline styles
  const dropdownContainerStyle: React.CSSProperties  = {
      position: 'relative',
      cursor: 'pointer',
  };

  const dropdownHeaderStyle = {
      padding: '8px',
      backgroundColor: '#333', // Background color
      color: 'white', // Text color
      border: '1px solid #6D7177', // Border color
      borderRadius: '4px', // Rounded corners
  };

  const dropdownListStyle: React.CSSProperties = {
      position: 'absolute',
      top: '150%',
      left: 0,
      right: 0,
      backgroundColor: 'black', // Background color for dropdown items
      border: '1px solid #6D7177', // Border color
      borderRadius: '4px', // Rounded corners
      zIndex: 1000, // Ensure dropdown is above other elements
      height: 'auto', // Max height for dropdown
      width:'100px',
      overflowY: 'auto', // Scroll if too many items
      overflowX:'hidden',
      color:'white'
  };

  const dropdownItemStyle = {
      padding: '8px',
      color: 'white', // Text color for items
      cursor: 'pointer',
  };

  return (
      <div style={dropdownContainerStyle}>
          {isOpen ? (
              <ul style={dropdownListStyle}>
                  {console.log("options",options)}
                  {options.map((node:any) => (
                      <li
                          key={node.id}
                          style={dropdownItemStyle}
                          onClick={() => handleSelect(node.id, node.label)}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(51, 51, 51)'} // Set hover color
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'} // Reset hover color
                      >
                          {node.label || node.id}
                      </li>
                  ))}
              </ul>
          ):<></>}
      </div>
  );
};


function DeployBotton() {

  const API_SERVER_URL ="https://dev.api.puppyagent.com"
  const {constructWholeJsonWorkflow} = useJsonConstructUtils()

  const [selectedInputs, setSelectedInputs] = useState<any[]>([])
  const [selectedOutputs, setSelectedOutputs] = useState<any[]>([])
  const [isOpen, setIsOpen] = useState(false); // State to manage dropdown visibility
  const [isOutputOpen, setIsOutputOpen] = useState(false); // State to manage dropdown visibility

  const [hovered, setHovered] = useState(false)
  const {sendWholeWorkflowJsonDataToBackend} = useWholeWorkflowJsonConstructUtils()

  const handleDeploy = async () => {

    try {
      const res = await fetch(      
        API_SERVER_URL +" /config_api",
        {
          method: "POST",
          body:JSON.stringify({
            workflow_json: constructWholeJsonWorkflow(),
            inputs: selectedInputs.map(item=>item.id),
            outputs: selectedOutputs.map(item=>item.id),
          })
        }
      )

      const content = await res.json();

      const [api_id, api_key] = content

      if (!res.ok) {
        throw new Error(`Response status: ${res.status}`);
      }
      // ...
    } catch (error) {
      console.error(error);
    }



  }

  const { getNodes } = useReactFlow(); // Destructure getNodes from useReactFlow

  useEffect(()=>{


  },[])

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
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 translate-y-[-10px]"
        enterTo="transform opacity-100 translate-y-0"
        leave="transition ease-in duration-75"
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
                    {
                      selectedInputs
                      .map(item => (
                        <div key={item.id} className="bg-[#6D7177] text-[#1E1E1E] h-[32px] border-[1.5px] border-[#6D7177] px-4 rounded-lg flex items-center justify-between">{item.data?.label as string || item.id} 
                        <div className='flex bg-transparent border-none ml-auto cursor-pointer h-[20px] w-[20px] justify-center items-center'
                          onClick={
                            ()=>{
                              setSelectedInputs(prev=>{
                                return prev.filter(el=>el.id!==item.id)
                              })
                            }
                          }
                        >
                          <svg width="12" height="2" viewBox="0 0 12 2" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="0.5" y="0.5" width="11" height="1" fill="#252525" stroke="black"/>
                          </svg>
                        </div>
                      </div>
                      ))
                    }
                  <button className="w-8 h-8 flex items-center justify-center border border-[#404040] border-[2px] rounded-lg"
                    onClick={
                      ()=>{
                        console.log("add node")
                        setIsOpen((prev)=>!prev)
                      }
                    }
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 1V13M1 7H13" stroke="#6D7177" strokeWidth="2"/>
                    </svg>
                  </button>
                  <CustomDropdown
                          isOpen={isOpen}
                          setIsOpen={setIsOpen}
                          options={getNodes().filter( (item) => (item.type === 'text' || item.type === 'structured') ).filter(item=>!(selectedInputs.map(el=>el.id)).includes(item.id))}
                          onSelect={(selectedItem:any)=>setSelectedInputs(
                            (prev)=>{
                              return prev.length === 0 ? [selectedItem]:[...prev,selectedItem]
                            }
                          )}
                      />
                </div>
              </div>

              {/* 右列 */}
              <div>
                <h3 className="text-[#CDCDCD] text-[14px] mb-4">outputs</h3>
                <div className="space-y-3 text-[14px] font-medium">
                {
                      selectedOutputs
                      .map(item => (
                        <div key={item.id} className="bg-[#6D7177] text-[#1E1E1E] h-[32px] border-[1.5px] border-[#6D7177] px-4 rounded-lg flex items-center justify-between">{item.data?.label as string || item.id} 
                        <div className='flex bg-transparent border-none ml-auto cursor-pointer h-[20px] w-[20px] justify-center items-center'
                          onClick={
                            ()=>{
                              setSelectedOutputs(prev=>{
                                return prev.filter(el=>el.id!==item.id)
                              })
                            }
                          }
                        >
                          <svg width="12" height="2" viewBox="0 0 12 2" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="0.5" y="0.5" width="11" height="1" fill="#252525" stroke="black"/>
                          </svg>
                        </div>
                      </div>
                      ))
                    }
                  <button className="w-8 h-8 flex items-center justify-center border border-[#404040] border-[2px] rounded-lg"
                      onClick={
                        ()=>{
                          console.log("add node")
                          setIsOutputOpen((prev)=>!prev)
                        }
                      }
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 1V13M1 7H13" stroke="#6D7177" strokeWidth="2"/>
                    </svg>
                  </button>
                  <CustomDropdown
                          isOpen={isOutputOpen}
                          setIsOpen={setIsOutputOpen}
                          options={getNodes().filter( (item) => (item.type === 'text' || item.type === 'structured') ).filter(item=>!(selectedOutputs.map(el=>el.id)).includes(item.id))}
                          onSelect={(selectedItem:any)=>setSelectedOutputs(
                            (prev)=>{
                              return prev.length === 0 ? [selectedItem]:[...prev,selectedItem]
                            }
                          )}
                  />
                </div>
              </div>
            </div>

            {/* Export API 按钮 */}
            <div className="flex justify-center">
              <button className="h-[36px] w-[100px] text-[14px] bg-[#2A2A2A] border-[1px] border-[#404040] rounded-[8px] text-[#CDCDCD] hover:bg-[#363636] transition duration-200 flex items-center justify-center"
                onClick={handleDeploy}
              >
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
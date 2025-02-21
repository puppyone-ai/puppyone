'use client'

import { Menu, Transition } from '@headlessui/react'
import React, { useState, Fragment, useEffect, useRef } from 'react'
import useWholeWorkflowJsonConstructUtils from '../../hooks/useWholeWorkflowJsonConstructUtils'
import { Button } from 'antd'
import { useReactFlow } from '@xyflow/react'
import { set } from 'lodash'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'
import { useFlowsPerUserContext } from '../../states/FlowsPerUserContext'

import dynamic from 'next/dynamic';
import type { EditorProps, OnMount, OnChange, } from "@monaco-editor/react";
const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false
});

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
      <div className="relative">
          {isOpen ? (
              <ul className='absolute top-full right-0 w-[128px] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col items-start justify-start z-50'>
                  {options.map((node:any, index:number) => (
                      <>
                          <li
                              key={node.id}
                              className='w-full'
                          >
                              <button 
                                  className='px-[8px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap'
                                  onClick={() => handleSelect(node.id, node.data.label)}
                              >
                                  <span className="px-[4px]  bg-[#6D7177] rounded-[4px] font-semibold text-[12px] text-black">
                                      {node.data.label || node.id}
                                  </span>
                              </button>
                          </li>
                      </>
                  ))}
              </ul>
          ):<></>}
      </div>
  );
};

const LanguageDropdown = ({ options, onSelect, isOpen, setIsOpen }:any) => {

  const handleSelect = (item: string) => {
      onSelect(item)
      setIsOpen(false); // Close dropdown after selection
  };

  return (
      <div className="relative">
          {isOpen ? (
              <ul className='absolute top-[5px] right-[140px] w-[128px] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col items-start justify-start z-50'>
                  {options.map((item:string) => (
                      <>
                          <li
                              key={item}
                              className='w-full'
                          >
                              <button 
                                  className='px-[8px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap'
                                  onClick={() => handleSelect(item)}
                              >
                                  <span className="px-[4px]  bg-[#6D7177] rounded-[4px] font-semibold text-[12px] text-black">
                                      {item}
                                  </span>
                              </button>
                          </li>
                      </>
                  ))}
              </ul>
          ):<></>}
      </div>
  );
};

function DeployBotton() {

  const {setWorkspaces, selectedFlowId, workspaces} = useFlowsPerUserContext()

  const API_SERVER_URL ="https://dev.api.puppyagent.com" //"http://localhost:8000"
  const {constructWholeWorkflowJsonData} = useWholeWorkflowJsonConstructUtils()


  const [selectedInputs, setSelectedInputs] = useState<any[]>([])
  const [selectedOutputs, setSelectedOutputs] = useState<any[]>([])
  const [isOpen, setIsOpen] = useState(false); // State to manage dropdown visibility
  const [isOutputOpen, setIsOutputOpen] = useState(false); // State to manage dropdown visibility

  const [hovered, setHovered] = useState(false)

  interface ApiConfig {
    id: string;
    key: string;
  }

  // const [apiConfig, setApiConfig] = useState<ApiConfig>({id:"hello",key:"world"})   //uncomment this to test 
  const [apiConfig, setApiConfig] = useState<ApiConfig|undefined>(undefined)
  
    useEffect(()=>{
      setWorkspaces(prev => prev.map(w => 
        w.flowId === selectedFlowId ? { ...w, deploy:{selectedInputs,selectedOutputs,apiConfig} } : w
      ))
      console.log(workspaces)
    }
      ,[selectedInputs,selectedOutputs,apiConfig]
    )

    const lastSelectedFlowIdRef = useRef<string | null>(null); // Ref to track last selected flowId

    useEffect(() => {
      if (lastSelectedFlowIdRef.current !== selectedFlowId) {
        console.log("Workflow has changed");
        lastSelectedFlowIdRef.current = selectedFlowId; // Update the ref with the current flowId
        setSelectedInputs(workspaces.filter((w)=>w.flowId === selectedFlowId)[0].deploy?.selectedInputs)
        setSelectedOutputs(workspaces.filter((w)=>w.flowId === selectedFlowId)[0].deploy?.selectedOutputs)
        setApiConfig(workspaces.filter((w)=>w.flowId === selectedFlowId)[0].deploy?.apiConfig)
      }
    }, [selectedFlowId]);

  const handleDeploy = async () => {

    try {
      const res = await fetch(      
        API_SERVER_URL +"/config_api",
        {
          method: "POST",
          body:JSON.stringify({
            workflow_json: constructWholeWorkflowJsonData(),
            inputs: selectedInputs.map(item=>item.id),
            outputs: selectedOutputs.map(item=>item.id),
          })
        }
      )

      const content = await res.json();

      const {api_id:api_id, api_key:api_key} = content

      setApiConfig({id:api_id,key:api_key})

      console.log(api_id,api_key)

      if (!res.ok) {
        throw new Error(`Response status: ${res.status}`);
      }
      // ...
    } catch (error) {
      console.error(error);
    }



  }

  const { getNodes,getNode } = useReactFlow(); // Destructure getNodes from useReactFlow

  useEffect(()=>{


  },[])

  const PYTHON = "python"
  const SHELL = "shell"
  const JAVASCRIPT = "javascript"

  const input_text_gen = (inputs:string[],lang:string)=>{
    if(lang == JAVASCRIPT){
      const inputData = inputs.map((input, index) => (
        `        "${input}": "${getNode(input)?.data.content}", //${getNode(input)?.data.label}`
      ));
      return inputData.join('\n')
    }else{
      const inputData = inputs.map(
        (input, index) => (
        `     #${getNode(input)?.data.label} \n` + `     "${input}":` + ((getNode(input)?.data.content as string)?.trim() || "\"\"") + `,`
        )
      );
      return inputData.join('\n')
    }
  }

  const populatetext = (api_id:string, api_key:string,language:string) =>{
    
    const py = 
`import requests

api_url = "<${API_SERVER_URL}/execute_workflow/${api_id}>"

api_key = "${api_key}"

headers = {
    "Authorization": f"Bearer ${api_key}",
    "Content-Type": "application/json"
}

data = {
    "inputs": {
${input_text_gen(selectedInputs.map(item=>item.id),PYTHON)}
    },
    "outputs": {
${input_text_gen(selectedOutputs.map(item=>item.id),PYTHON)}
    }
}

response = requests.post(api_url, headers=headers, json=data)

if response.status_code == 200:
    print("Results:", response.json())
else:
    print("Error:", response.status_code, response.json())
`
    if(language===PYTHON){
      return py
    }    

    const sh = 
`curl -X POST "<${API_SERVER_URL}/execute_workflow/${api_id}>" \\
-H "Authorization: Bearer ${api_key}" \\
-H "Content-Type: application/json" \\
-d '{
    "inputs": {
${input_text_gen(selectedInputs.map(item=>item.id),SHELL)}
    },
    "outputs"{
${input_text_gen(selectedOutputs.map(item=>item.id),SHELL)}   
    }
}'
`

    if(language===SHELL){
      return sh
    }

    const js = `const axios = require('axios');

const apiUrl = "<${API_SERVER_URL}/execute_workflow/${api_id}>";

const data = {
    "inputs": {
${input_text_gen(selectedInputs.map(item=>item.id),JAVASCRIPT)}
    },
    "outputs"{
${input_text_gen(selectedOutputs.map(item=>item.id),JAVASCRIPT)}   
    }
};

axios.post(apiUrl, data, {
    headers: {
        "Authorization": "Bearer ${api_key}",
        "Content-Type": "application/json"
    }
})
.then(response => {
    console.log("Results:", response.data);
})
.catch(error => {
    if (error.response) {
        console.error("Error:", error.response.status, error.response.data);
    } else {
        console.error("Error:", error.message);
    }
});
`
      if(language===JAVASCRIPT){
        return js
      }

  
}

const [selectedLang,setSelectedLang] = useState(SHELL)

const [isLangSelectorOpen, setIsLangSelectorOpen] = useState(false)


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
                      workspaces.filter((w)=>w.flowId === selectedFlowId)[0].deploy.selectedInputs
                      .map((item: { id: string; label?: string }) => (
                        <div key={item.id} className="bg-[#6D7177] text-black text-[12px] text-semibold h-[26px] border-[1.5px] border-[#6D7177] pl-[16px] pr-[3px] rounded-lg flex items-center">
                          <span className="flex-shrink-0">{item.label as string || item.id}</span>
                          <div className='flex bg-transparent border-none ml-auto cursor-pointer h-[20px] w-[20px] justify-center items-center hover:bg-white/20 rounded-[6px]'
                            onClick={()=>{
                              setSelectedInputs(prev=>{
                                return prev.filter(el=>el.id!==item.id)
                              })
                            }}
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M1 1L9 9M9 1L1 9" stroke="#252525" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                          </div>
                        </div>
                      ))
                    }
                  <button className="w-[26px] h-[26px] flex items-center justify-center border border-[#6D7177] border-[2px] rounded-lg"
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
                      workspaces.filter((w)=>w.flowId === selectedFlowId)[0].deploy.selectedOutputs
                      .map((item: { id: string; label?: string })=> (
                        <div key={item.id} className="bg-[#6D7177] text-[12px] text-black h-[26px] border-[1.5px] border-[#6D7177] px-[16px] pr-[3px] rounded-lg flex items-center justify-between">{item.label as string || item.id} 
                        <div className='flex bg-[#6D7177] border-none ml-auto cursor-pointer h-[20px] w-[20px] justify-center items-center hover:bg-white/20 rounded-[6px]'
                          onClick={
                            ()=>{
                              setSelectedOutputs(prev=>{
                                return prev.filter(el=>el.id!==item.id)
                              })
                            }
                          }
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M1 1L9 9M9 1L1 9" stroke="#252525" strokeWidth="1.5" strokeLinecap="round"/>
                          </svg>
                        </div>
                      </div>
                      ))
                    }
                  <button className="w-[26px] h-[26px] flex items-center justify-center border border-[#6D7177] border-[2px] rounded-lg"
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

            {
              workspaces.filter((w)=>w.flowId === selectedFlowId)[0].deploy?.apiConfig?.id?
              <>
                {/* new codeblock */}
                <div
                  className='bg-[#252525] border-[1px] border-[#404040] rounded-lg p-[10px] mb-[10px]'
                >
                  <div
                    className='border-[1px] border-[#6D7177] text-[#6D7177] rounded-[4px] w-fit fit-content text-[12px] pr-[3px] pl-[3px] cursor-pointer'
                    onClick={()=>{
                      setIsLangSelectorOpen(
                        prev=>!prev
                      )
                    }}
                  >{selectedLang}</div>
                  <LanguageDropdown
                    isOpen={isLangSelectorOpen}
                    setIsOpen={setIsLangSelectorOpen}
                    options={[SHELL,PYTHON,JAVASCRIPT]}
                    onSelect={setSelectedLang}
                  />

                  {/* <div className="bg-[#1E1E1E] mt-[5px] rounded-lg p-4 text-[#CDCDCD] text-sm">
                      {populatetext(apiConfig.id,apiConfig.key,"py")}
                  </div> */}
                  <div className={`relative flex flex-col border-none rounded-[8px] cursor-pointer pl-[2px] pt-[8px] mt-[8px] bg-[#1C1D1F]`}>
                    <Editor
                          className='json-form hideLineNumbers rounded-[200px]'
                          defaultLanguage="json"
                          language={selectedLang}
                          // theme={themeManager.getCurrentTheme()}
                          value={populatetext(workspaces.filter((w)=>w.flowId === selectedFlowId)[0].deploy.apiConfig.id,workspaces.filter((w)=>w.flowId === selectedFlowId)[0].deploy.apiConfig.key,selectedLang)}
                          width={260}
                          height={200}
                          options={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontLigatures: true,
                            minimap: { enabled: false },
                            scrollbar: {
                              useShadows: false,
                              horizontal: 'hidden', // 隐藏水平滚动条
                              horizontalScrollbarSize: 0 // 设置水平滚动条大小为0
                            },
                            fontSize: 10,
                            fontWeight: 'normal',
                            lineHeight: 15,
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            fixedOverflowWidgets: true,
                            acceptSuggestionOnEnter: "on",
                            overviewRulerLanes: 0,  // 隐藏右侧的预览框
                            lineNumbersMinChars: 3,
                            glyphMargin: false,
                            lineDecorationsWidth: 0, // 控制行号和正文的间距
                            readOnly: true
                          }}
                        />
                  </div>

                </div>
              </>:<></>
            }

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
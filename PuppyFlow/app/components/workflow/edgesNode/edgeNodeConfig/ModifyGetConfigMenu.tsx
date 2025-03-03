import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType, Node} from '@xyflow/react'
import useJsonConstructUtils, {NodeJsonType, FileData} from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { ModifyConfigNodeData } from '../edgeNodes/ModifyConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'

import {PuppyDropdown} from "../../../misc/PuppyDropDown"


type ModifyGetConfigProps = {
    show: boolean,
    parentId: string,
    type:string,
    MODIFY_GET_TYPE:string,
    MODIFY_DEL_TYPE:string,
    MODIFY_REPL_TYPE:string
}


export type ModifyGetEdgeJsonType = {
    // id: string,
    type: "modify",
    data: {
      content: string, // or dict
      modify_type: "edit_structured",
      extra_configs: {
        "operations": [{
            type:string,
            params: {
                max_depth?:number,
                path?: (string|number)[],  // Get the first user's name
                default?: string      // Default value if key doesn't exist
            }
        }
    ]
      },
      inputs: { [key: string]: string },
      looped: boolean,
      outputs: { [key: string]: string }
    },
   
  }

type ConstructedModifyGetJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: ModifyGetEdgeJsonType }
}

type modeNames = "list" | "dict"

const CustomDropdown = ({ options, onSelect, configIndex, getConfigData }:any) => {
    const [isOpen, setIsOpen] = useState(false); // State to manage dropdown visibility

    const handleSelect = (keytype: string) => {
        onSelect(keytype);
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
        fontSize: '10px',
        padding: '8px',
        color: 'white', // Text color for items
        cursor: 'pointer',
    };

    return (
        <div style={dropdownContainerStyle}>
            <div  className={`overflow-hidden text-[12px] text-nowrap font-semibold ${getConfigData[configIndex]?.key ?"text-[#000] ":"text-white"} h-[16px] px-[4px] flex items-center justify-center rounded-[4px] border-[#6D7177] } ${getConfigData[configIndex]?.key ?"bg-[#6D7177]":""}`} onClick={() => {
                
                setIsOpen(prev => {
                    console.log("open",prev)
                    return !prev})
                }}>
                {getConfigData[configIndex]?.key  || "Select key type"} {/* Display selected label or placeholder */}
            </div>
            {isOpen ? (
                <ul style={dropdownListStyle}>
                    {console.log("options",options)}
                    {options.map((keytype:string) => (
                        <li
                            key={keytype}
                            style={dropdownItemStyle}
                            onClick={() => handleSelect(keytype)}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(51, 51, 51)'} // Set hover color
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'} // Reset hover color
                        >
                            {keytype}
                        </li>
                    ))}
                </ul>
            ):<></>}
        </div>
    );
};

function ModifyGetConfigMenu({show, parentId}: ModifyGetConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup} = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const {clearAll} = useNodesPerFlowContext()
    const modeRef = useRef<HTMLSelectElement>(null)
    const [mode, setMode] = useState<modeNames>(
        (getNode(parentId)?.data as ModifyConfigNodeData).content_type === "dict" ? "dict" : "list"
    )
    const numKeyRef = useRef<HTMLInputElement>(null)
    const [numKeyValue, setNumKeyValue] = useState<string | number>(
        (getNode(parentId) as Node)?.data.content_type === "list"
          ? ((getNode(parentId)?.data as ModifyConfigNodeData).extra_configs.index as number) :
          (getNode(parentId)?.data.content_type === "dict")
          ? ((getNode(parentId)?.data as ModifyConfigNodeData).extra_configs.key as string) : ""
      )
    const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as ModifyConfigNodeData)?.resultNode ?? null)
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [isLoop, setIsLoop] = useState((getNode(parentId)?.data as ModifyConfigNodeData)?.looped ?? false)


    const MODIFY_GET_TYPE="get"
    const MODIFY_DEL_TYPE="delete"
    const MODIFY_REPL_TYPE="replace"
    const MODIFY_GET_ALL_KEYS="get_keys"
    const MODIFY_GET_ALL_VAL="get_values"
  
    const [execMode,setExecMode] = useState(getNode(parentId)?.data.type as string||MODIFY_GET_TYPE) 

    useEffect(
        ()=>{
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return { ...node, data: { ...node.data, type:execMode } }; // Update the cases in the node's data
                }
                return node;
            }))
        },[execMode]
    )

    const onFocus: () => void = () => {
        const curRef = menuRef.current
        if (curRef && !curRef.classList.contains("nodrag")) {
            curRef.classList.add("nodrag")
        }
    }

    const onBlur: () => void = () => {
        const curRef = menuRef.current
        if (curRef) {
            curRef.classList.remove("nodrag")
        }
    }

    // trigger when states change, reactflow ConfigNodes data properties should be updated
    useEffect(() => {
        onModeChange()
    }, [mode])

    useEffect(() => {
        onNumKeyChange()
    }, [numKeyValue])

    useEffect(() => {
        onLoopChange(isLoop)
    }, [isLoop])

    // useEffect(() => {
    //     onResultNodeChange()
    // }, [resultNode])

    useEffect(() => {
        if (!resultNode) return
        if (isComplete) return
        
        const addNewNodeEdgeIntoFlow = async () => {
            const parentEdgeNode = getNode(parentId)
            if (!parentEdgeNode) return
            const location = {
                // 120 - 24 = 96 is half of the height of the targetNode - chunk node
                x: parentEdgeNode.position.x + 160,
                y: parentEdgeNode.position.y - 96,
            }

            const newNode = {
                id: resultNode,
                position: location,
                data: { 
                    content: "", 
                    label: resultNode,
                    isLoading: true,
                    locked: false,
                    isInput: false,
                    isOutput: false,
                    editable: false,
                },
                type: 'structured',
            }

            const newEdge = {
                id: `connection-${Date.now()}`,
                source: parentId,
                target: resultNode,
                type: "floating",
                data: {
                    connectionType: "CTT",
                },
                markerEnd: markerEnd,
            }

            await Promise.all([
                new Promise(resolve => {
                    setNodes(prevNodes => {
                        resolve(null);
                        return [...prevNodes, newNode];
                    })
                }),
                new Promise(resolve => {
                    setEdges(prevEdges => {
                        resolve(null);
                        return [...prevEdges, newEdge];
                    })
                }),
            ]);

            onResultNodeChange(resultNode)
            setIsAddFlow(true)
            // 不可以和 setEdge, setNodes 发生冲突一定要一先一后
            // clearActivation()
        }

        const sendData = async  () => {
            try {
                const jsonData = constructJsonData()
                console.log(jsonData)
                const response = await fetch(`${backend_IP_address_for_sendingData}`, {
                    method:'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(jsonData)
                })

                if (!response.ok) {
                    reportError(resultNode, `HTTP Error: ${response.status}`)
                }
                
                console.log(response)
                const result = await response.json();  // 解析响应的 JSON 数据
                console.log('Success:', result);
                console.log(resultNode, "your result node")
                await streamResult(result.task_id, resultNode);
                
                } catch (error) {
                    console.warn(error)
                    window.alert(error)
                } finally {
                    resetLoadingUI(resultNode)
                    setIsComplete(true)
                }
        }
    
        if (!isAddFlow && !isComplete) {
            addNewNodeEdgeIntoFlow()
        }
        else if (isAddFlow && !isComplete) {
            sendData()
        }
      }, [resultNode, isAddFlow, isComplete])
   
    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (
            <span key={`${node.id}-${parentId}`} className='w-fit text-[10px] font-semibold text-[#000] leading-normal bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[4px] border-[#6D7177] '>{`{{${node.label}}}`}</span>
        ))
    }

    const constructJsonData = (): ConstructedModifyGetJsonData | Error => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        let resultNodeLabel
        if (resultNode && getNode(resultNode)?.data?.label !== undefined) {
            resultNodeLabel = getNode(resultNode)?.data?.label as string
        }
        else {
            resultNodeLabel = resultNode as string
        }
        let blocks: { [key: string]: NodeJsonType } = {
            [resultNode as string]: {
                label: resultNodeLabel as string,
                type: "structured",
                data:{content: ""}
            }
        }
        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup)

        let edges: { [key: string]: ModifyGetEdgeJsonType } = {}

        const inputs = Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label])))

        const input_label = sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (node.label?node.label:node.id))[0]


            // 7. Get Keys operation (Retrieve all keys from a nested structure)
            // {
            //     "type": "get_keys",
            //     "params": {
            //         "max_depth": 2  // Get all keys up to depth level 2
            //     }
            // },
            // // 8. Get Values operation (Retrieve all values from a nested structure)
            // {
            //     "type": "get_values",
            //     "params": {
            //         "max_depth": 2  // Get all values up to depth level 2
            //     }
            // },

        const edgejson: ModifyGetEdgeJsonType = {
            // id: parentId,
            type: "modify",
            data: {  
                content: `{{${input_label}}}`,
                modify_type: "edit_structured",
                extra_configs: {
                    operations:[
                        {
                            type:execMode===MODIFY_REPL_TYPE?"set_value":execMode,
                            params: (execMode===MODIFY_GET_ALL_KEYS||execMode===MODIFY_GET_ALL_VAL)?{
                                "max_depth": 100
                            }:
                            {
                                path: [...getConfigDataa().map(({_,value})=>{
                                    const num = Number(value);
                                    return isNaN(num) ? value : num;
                                })],  // Get the first user's name
                                ...(execMode===MODIFY_GET_TYPE && { default: "Get Failed, value not exist" }),    // Default value if key doesn't exist
                                ...(execMode===MODIFY_REPL_TYPE && { value: paramv })    // Default value if key doesn't exist
                            }
                        }
                    ]
                },
                inputs: inputs,
                looped: isLoop,
                outputs: { [resultNode as string]: resultNodeLabel as string }
            },
        }

        edges[parentId] = edgejson
        console.log(blocks, edges, "blocks and edges constructed result")

        return {
            blocks,
            edges
        }
    }


    const onDataSubmit = async () => {

        // click 第一步： clearActivation
        await new Promise(resolve => {
            clearAll()
            resolve(null)
        });
        // click 第二步： 如果 resultNode 不存在，则创建一个新的 resultNode
        if (!resultNode || !getNode(resultNode)){

            const newResultNodeId = nanoid(6)
            // onResultNodeChange(newResultNodeId)
            setResultNode(newResultNodeId)
            
            // setIsAddContext(false)
            setIsAddFlow(false)
        }
        // click 第三步： 如果 resultNode 存在，则更新 resultNode 的 type 和 data
        else {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === resultNode){
                    return {...node, data: {...node.data, content: "", isLoading: true}}
                }
                return node
            }))
           
        }
        setIsComplete(false)
        };

    
    const onModeChange = () => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                // return {...node, data: {...node.data, content_type: modeRef.current.value as modeNames}}
                return {...node, data: {...node.data, content_type: mode}}
            }
            return node
        }))
    }

    const onNumKeyChange = () => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                // return {...node, data: {...node.data, extra_configs: { index: mode === "list" ? Number(numKeyRef.current.value) : undefined, key: mode === "dict" ? numKeyRef.current.value : undefined}}
                return {...node, data: {...node.data, extra_configs: { index: (typeof numKeyValue === "number" ? numKeyValue : undefined), key: (typeof numKeyValue === "string" ? numKeyValue : undefined)}}}
            }
            return node
        }))
    }


    const onLoopChange = (newLoop: boolean) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, looped: newLoop}}
            }
            return node
        }))
    }

    const onResultNodeChange = (newResultNode: string) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, resultNode: newResultNode}}
            }
            return node
        }))
    }

//   const[getConfigData, setGetConfigData ]=useState<{ key: string, value: string }[]>(getNode(parentId)?.data.getConfigData as [] || [
//     {
//         key:"key",
//         value:""
//     },
//   ])

  const setGetConfigDataa = (resolveData: (data:{ key: string; value: string; }[]) => { key: string; value: string; }[])=>{
    setNodes(prevNodes => prevNodes.map(node => {
        if (node.id === parentId) {
            return { ...node, data: { ...node.data, getConfigData:resolveData(getConfigDataa()) } }; // Update the cases in the node's data
        }
        return node;
    }))
  }

  const getConfigDataa = ()=> getNode(parentId)?.data.getConfigData as [] || [
    {
        key:"key",
        value:""
    },
  ]

  const [paramv,setParamv] = useState("")

  useEffect(
    ()=>{
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId){
                return {...node, data: {
                    ...node.data, 
                    params:{
                        ...node.data.params as object,
                        value:paramv
                    }
                }}
            }
            return node
        }))
    },
    [paramv]
)
  

  return (

    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[320px] rounded-[16px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme p-[7px] font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
        <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
            
            <div className='flex flex-row gap-[12px]'>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 10H10" stroke="#CDCDCD" strokeWidth="1.5"/>
                                <path d="M8.5 2L9.5 3L5 7.5L3 8L3.5 6L8 1.5L9 2.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                            </svg>

                </div>
                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                Modify
                </div>
            </div>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                </svg>
                </div>
                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                Edit
                </div>
            </div>
            </div>
            <div className='flex flex-row gap-[8px] items-center justify-center'>
                <button className='w-[57px] h-[26px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                onClick={onDataSubmit}>
                <span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                    <path d="M8 5L0 10V0L8 5Z" fill="black"/>
                    </svg>
                </span>
                <span>
                    Run
                </span>
                </button>
            </div>
        </li>
        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[8px] w-full'>
            <div className='text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             input
            </div>
            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                {displaySourceNodeLabels()}
            </div>
            
        </li>
        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[8px] w-full bg-black'>
            <div className='bg-black text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start rounded-l-[8px]'>
             Mode
            </div>
            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px] rounded-r-[8px] bg-black'>
                <PuppyDropdown
                
                    options= {
                        [
                            MODIFY_GET_TYPE,
                            MODIFY_DEL_TYPE,
                            MODIFY_REPL_TYPE,
                            MODIFY_GET_ALL_KEYS,
                            MODIFY_GET_ALL_VAL,
                        ]
                    }
                    onSelect= {(option:string)=>{
                        setExecMode(option)
                    }}
                    selectedValue={execMode}
                    listWidth={"200px"}
                    mapValueTodisplay={
                        (v:string)=>{
                            if(v===MODIFY_GET_ALL_KEYS){
                                return "get all keys"
                            }else if(v===MODIFY_GET_ALL_VAL){
                                return "get all values"
                            }
                            return v
                        }
                    }
                >
                </PuppyDropdown>
            </div>
            
        </li>

            <li className='flex flex-col gap-0 items-start justify-center font-plus-jakarta-sans'>

                <div className='border-[#6D7177] border-[1px] w-full rounded-[8px]'>
                {
                    execMode===MODIFY_GET_ALL_KEYS || execMode===MODIFY_GET_ALL_VAL ? <></>:
                    <div className='flex flex-col border-[#6D7177] border-b-[1px] w-full py-[16px] px-[8px] gap-[16px]'>
                        {
                            getConfigDataa().map(
                                ({key,value},index)=>(
                                    <>
                                    <label className='h-[16px] mb-[6px] text-[12px] font-semibold flex items-center'>  step {index+1} </label>
                                        <div className='inline-flex space-x-[12px] items-center justify-start'>
                                        <svg onClick={
                                            ()=>{
                                                setGetConfigDataa(
                                                    (prev)=>{
                                                        return prev.filter(
                                                            (_,curindex)=>index!==curindex
                                                        )

                                                    }
                                                )
                                            }
                                        } className={`cursor-pointer ${getConfigDataa().length <= 1 ? 'invisible' : ''}`}  width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="7.25" fill="#090909" stroke="#6D7177" strokeWidth="1.5"/>
                                            <path d="M6 10L14 10" stroke="#6D7177" strokeWidth="2"/>
                                        </svg>
                                        <ul key={index} className='flex-col border-[#6D7177] rounded-[4px] w-fit bg-black'>
                                            <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] w-[200px]'>
                                                <div className='flex flex-row flex-wrap gap-[0px] items-center justify-start py-[8px] px-[10px] w-fit'>

                                                <CustomDropdown
                                                    options={["key","num"]}
                                                    onSelect={(keytype:string) => {
                                                            console.log("selected keytype:", keytype);
                                                            setGetConfigDataa(
                                                                (prev)=>{
                                                                    return prev.map(
                                                                        ({key:curkey,value:curvalue},curindex)=>{
                                                                            if(curindex==index){
                                                                                return {
                                                                                    key:keytype,
                                                                                    value:curvalue
                                                                                }
                                                                            }else{
                                                                                return {
                                                                                    key:curkey,
                                                                                    value:curvalue
                                                                                }
                                                                            }
                                                                        }
                                                                    )

                                                                }
                                                            )
                                                        }}
                                                    configIndex={index}
                                                    getConfigData={getConfigDataa()}
                                                    />
                                                </div>
                                                    {/* ["contains", "doesn't contain", "is greater than [N] characters", "is less than [N] characters"]

                                                    return ["is empty", "is not empty", "contains", "doesn't contain", "is greater than [N] characters", "is less than [N] characters", "is list","is dict"]

                                                    return ["is True","is False"] */}
                                                <input 
                                                        value={value}
                                                        onChange={(e)=>{
                                                            setGetConfigDataa(
                                                                (prev)=>{
                                                                    return prev.map(
                                                                        ({key:curkey,value:curvalue},curindex)=>{
                                                                            if(curindex==index){
                                                                                return {
                                                                                    key:curkey,
                                                                                    value:e.target.value
                                                                                }
                                                                            }else{
                                                                                return {
                                                                                    key:curkey,
                                                                                    value:curvalue
                                                                                }
                                                                            }
                                                                        }
                                                                    )

                                                                }
                                                            )
                                                        }} 
                                                        className="w-[125px] text-white bg-black caret-white border-l-[1px] pl-[5px]"
                                                        type="text"></input>

                                                
                                            </li>
                                        </ul>
                                        {getConfigDataa().length - 1 === index ? (
                                            <div
                                            onClick={
                                                ()=>{
                                                    setGetConfigDataa(
                                                        (prev)=>{
                                                            return [
                                                                ...prev,
                                                                {
                                                                    key:"key",
                                                                    value:""
                                                                }
                                                            ]
                                                        }
                                                    )
                                                }
                                            } className='cursor-pointer'>
                                            <span> </span>
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="7.25" fill="#090909" stroke="#6D7177" stroke-width="1.5"/>
                                                <path d="M10 6V14" stroke="#6D7177" stroke-width="1.5"/>
                                                <path d="M6 10H14" stroke="#6D7177" stroke-width="1.5"/>
                                            </svg>
                                            </div>
                                        ) : (
                                            <div>
                                            <span> </span>
                                            <svg onClick={
                                                ()=>{
                                                    
                                                }
                                            } className='invisible' width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <rect x="0.75" y="0.75" width="18.5" height="18.5" rx="7.25" fill="#090909" stroke="#6D7177" stroke-width="1.5"/>
                                                <path d="M10 6V14" stroke="#6D7177" stroke-width="1.5"/>
                                                <path d="M6 10H14" stroke="#6D7177" stroke-width="1.5"/>
                                            </svg>
                                            </div>
                                        )}
                                        </div>
                                    </>
                                )
                            )
                        }

                    </div>
                }
                    

                </div>
            {/* <div className='flex flex-col gap-0 items-start justify-center '>
                <button onClick={()=>{

                }} className='flex rounded-[8px] bg-black text-[#6D7177] w-[52px] mt-1 font-plus-jakarta-sans text-[10px] font-[700] border-[1px] border-[#6D7177] items-center'>
                            <svg className="flex-inline" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 6V14" stroke="#6D7177" stroke-width="1.5"/>
                                <path d="M6 10H14" stroke="#6D7177" stroke-width="1.5"/>
                            </svg> Case
                </button>
            </div> */}
            </li>

            {
                execMode===MODIFY_REPL_TYPE && (
                    <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[3px] w-full h-[36px]'>
                        <div className='text-[#6D7177] w-[128px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
                        With
                        </div>
                        <input value={paramv} onChange={(e) => {
                            setParamv(e.target.value)
                        }} id="wrap_into" type="string" className='px-[10px] py-[5px] rounded-[8px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off'></input>
                    </li>
                )
            }
    </ul>
    
  )
}

export default ModifyGetConfigMenu

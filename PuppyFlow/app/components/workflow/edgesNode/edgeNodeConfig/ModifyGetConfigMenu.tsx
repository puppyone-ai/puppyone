import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType, Node} from '@xyflow/react'
import useJsonConstructUtils, {NodeJsonType, FileData} from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import { ModifyConfigNodeData } from '../edgeNodes/ModifyConfig'
import { backend_IP_address_for_sendingData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
type ModifyGetConfigProps = {
    show: boolean,
    parentId: string,
}


export type ModifyGetEdgeJsonType = {
    // id: string,
    type: "modify",
    data: {
    //   content_type: modeNames, // or dict
      modify_type: "get",
      extra_configs: {
        params: {
            path: (string|number)[],  // Get the first user's name
            default: string      // Default value if key doesn't exist
        }
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
        padding: '8px',
        color: 'white', // Text color for items
        cursor: 'pointer',
    };

    return (
        <div style={dropdownContainerStyle}>
            <div  className={`overflow-hidden text-[12px] text-nowrap font-[700] ${getConfigData[configIndex]?.key ?"text-[#000] ":"text-white"} leading-normal tracking-[0.84px] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] ${getConfigData[configIndex]?.key ?"border-[3px]":"border-[0px]"} ${getConfigData[configIndex]?.key ?"bg-[#6D7177]":""}`} onClick={() => {
                
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
            <span key={`${node.id}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{node.label}</span>
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

        const edgejson: ModifyGetEdgeJsonType = {
            // id: parentId,
            type: "modify",
            data: {  
                // content_type: mode,
                modify_type: "get",
                extra_configs: {
                    params: {
                        path: [...getConfigDataa().map(({_,value})=>{
                            const num = Number(value);
                            return isNaN(num) ? value : num;
                        })],  // Get the first user's name
                        default: "Get Failed, value not exist"      // Default value if key doesn't exist
                    }
                },
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
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
  
    

//   useEffect(() => {
//     setNodes(prevNodes => prevNodes.map(node => {
//         if (node.id === parentId) {
//             return { ...node, data: { ...node.data, getConfigData:getConfigData } }; // Update the cases in the node's data
//         }
//         return node;
//     }));
    
//     setTimeout(() => {
//         console.log("getconfigdata state track",getConfigData,getNode(parentId))
//     }, 2000) // Log after 2 seconds
// }, [getConfigData]); // Dependency array includes cases

  return (

    <ul ref={menuRef} className={`absolute top-[58px] left-[0px] text-white rounded-[9px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme pt-[7px] pb-[6px] px-[6px] font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
        <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
            
            <div className='flex flex-row gap-[12px]'>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="12" viewBox="0 0 10 12" fill="none">
                    <rect x="0.75" y="0.75" width="8.5" height="10.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    <path d="M6.5 4.5L3.5 7.5" stroke="#CDCDCD" strokeWidth="1.5"/>
                    </svg>

                </div>
                <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                Modify
                </div>
            </div>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M10.5 7.00016C4.08333 7.00016 3.5 2.3335 3.5 2.3335" stroke="#CDCDCD" strokeWidth="1.5"/>
                <rect x="-0.75" y="0.75" width="3.5" height="3.5" transform="matrix(-1 0 0 1 3.5 0)" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                <path d="M13.25 5.25H9.75V8.75H13.25V5.25Z" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                <rect x="-0.75" y="0.75" width="3.5" height="3.5" transform="matrix(-1 0 0 1 3.5 9)" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="1.5"/>
                </svg>
                </div>
                <div className='flex items-center justify-center text-[12px] font-[700] text-main-grey font-plus-jakarta-sans leading-normal'>
                Get
                </div>
            </div>
            </div>
            <div className='flex flex-row gap-[8px] items-center justify-center'>
                <div className='flex flex-col items-center justify-center'>
                <button className='w-[23px] h-[13px] rounded-[8px] border-[1px] border-[#6D7177] relative' onClick={() => {
                    setIsLoop(!isLoop)
                }}>
                    <div className={`w-[8px] h-[8px] rounded-[50%] absolute top-[1.5px] transition-all ease-in-out
                        ${isLoop ? "right-[2px] bg-[#39BC66]" : "left-[2px] bg-[#6D7177]"}`}>
                    </div>
                </button>
                <div className={`text-[6px] font-plus-jakarta-sans font-[700] leading-normal transition-all duration-300 ease-in-out
                    ${isLoop ? "text-[#39BC66]" : "text-[#6D7177]"}`}>
                    Loop
                </div>
                </div>
                <button className='w-[57px] h-[24px] rounded-[6px] bg-[#39BC66] text-[#000] text-[12px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
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
        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] w-[293px]'>
            <div className='text-[#6D7177] w-[57px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             input
            </div>
            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                {displaySourceNodeLabels()}
            </div>
            
        </li>

            <li className='flex flex-col gap-0 items-start justify-center font-plus-jakarta-sans'>

                <div className='border-[#6D7177] border-[1px] rounded-[8px]'>
                    
                    <div className='flex flex-col border-[#6D7177] border-b-[1px] w-[290px] p-3'>
                        {
                            getConfigDataa().map(
                                ({key,value},index)=>(
                                    <>
                                    <label className='h-[16px] mb-[15px]'>  Step {index+1} </label>
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
                                                    {/* ["contains", "doesn’t contain", "is greater than [N] characters", "is less than [N] characters"]

                                                    return ["is empty", "is not empty", "contains", "doesn’t contain", "is greater than [N] characters", "is less than [N] characters", "is list","is dict"]

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

        
    </ul>
    
  )
}

export default ModifyGetConfigMenu

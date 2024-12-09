'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import useJsonConstructUtils, {ProcessingData, NodeJsonType} from '../../hooks/useJsonConstructUtils'
import { nodeSmallProps } from '../nodeMenu/NodeMenu'
import { useNodeContext } from '../../states/NodeContext'
// import PythonConfigEditor from '../tableComponent/PythonConfigEditor'
import { CodeConfigNodeData } from '../../workflow/edges/configNodes/CodeConfig'
import isEqual from 'lodash/isEqual'
import dynamic from 'next/dynamic';
import { backend_IP_address_for_sendingData } from '../../hooks/useJsonConstructUtils'
import { ChooseConfigNodeData } from '../../workflow/edges/configNodes/ChooseConfig'
import { markerEnd } from '../../workflow/edges/ConfigToTargetEdge'
import { Select } from 'antd'
import useManageReactFlowUtils from '../../hooks/useManageReactFlowUtils'

type ChooseConfigProps = {
    show: boolean,
    parentId: string,
}


export type ChooseEdgeJsonType = {
    id: string,
    type: "choose",
    data: {
    switch: {id: string, label: string},
    content: { id: string, label: string },
    inputs: {id: string, label: string}[],
    outputs: {id: string, label: string}[],
    looped: boolean,
    ON: {id: string, label: string}[],
    OFF: {id: string, label: string}[]
  }
}

function ChooseConfigMenu({show, parentId}: ChooseConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges, getEdges} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, reportError, streamResultForMultipleNodes} = useJsonConstructUtils()
    const {addNode, addCount, allowActivateNode, clear, totalCount, searchNode} = useNodeContext()
    const {getResultNodes} = useManageReactFlowUtils()
    // const {getZoom, getViewport, getNode, flowToScreenPosition} = useReactFlow()
    const [switchValue, setSwitchValue] = useState<string | null>((getNode(parentId)?.data as ChooseConfigNodeData)?.switch ?? null)
    const [contentValue, setContentValue] = useState<string | null>((getNode(parentId)?.data as ChooseConfigNodeData)?.content ?? null)
    // const [resultNode, setResultNode] = useState<string | null>((getNode(parentId)?.data as CodeConfigNodeData)?.resultNode ?? null)
    const [outputs, setOutputs] = useState<string[]>(() => {
        const outputIds = (getNode(parentId)?.data as ChooseConfigNodeData)?.resultNodes 
        return outputIds ? outputIds : []
    })
    const [ON, setON] = useState<string[]>(() => {
        const ONIds = (getNode(parentId)?.data as ChooseConfigNodeData)?.ON
        return ONIds ?? []
    })
    const [OFF, setOFF] = useState<string[]>(() => {
        const OFFIds = (getNode(parentId)?.data as ChooseConfigNodeData)?.OFF
        return OFFIds ?? []
    })
    const switchRef = useRef<HTMLSelectElement>(null)
    const contentRef = useRef<HTMLSelectElement>(null)
    const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    const [autogenarated, setAutogenarated] = useState(false)
    const [shouldUpdateONOFF, setShouldUpdateONOFF] = useState(false)
    
    useEffect(() => {
        onSwitchValueChange()
    }, [switchValue])

    useEffect(() => {
        onContentValueChange()
    }, [contentValue])

    useEffect(() => {
        if (shouldUpdateONOFF) {
            setON(prevOn => prevOn.filter(node => outputs.includes(node)))
            setOFF(prevOff => prevOff.filter(node => outputs.includes(node)))
            setShouldUpdateONOFF(false)
        }
    }, [shouldUpdateONOFF])


    useEffect(() => {
        if (autogenarated) return
        const newOutputs = getResultNodes(parentId)
        if (isEqual(outputs, newOutputs)) return
        setOutputs(newOutputs)
        onResultNodesChange(newOutputs)
        // console.log(ON.filter(node => newOutputs.includes(node)))
        setShouldUpdateONOFF(true)
       
    }, [isEqual(outputs, getResultNodes(parentId))])

    useEffect(() => {
        onONValueChange()
    }, [ON])

    useEffect(() => {
        onOFFValueChange()
    }, [OFF])

    // useEffect(() => {
    //     console.log(ON, "ON")
    //     console.log(OFF, "OFF")
    // }, [outputs])


    // useEffect(() => {
    //     setON(prevOn => prevOn.filter(node => outputs.includes(node)))
    //     setOFF(prevOff => prevOff.filter(node => outputs.includes(node)))
    // }, [outputs])
  
    useEffect( () => {
        if (!outputs.length) return
        if (isComplete) return
    
        const addNodeAndSetFlag = async () => {
          for (let output of outputs) {
             await addNode(output)
          }
          setIsAddContext(true);
        };

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
                    for (let output of outputs) {
                        reportError(output, `HTTP Error: ${response.status}`)
                    }
                }
                
                console.log(response)
                const result = await response.json();  // 解析响应的 JSON 数据
                console.log('Success:', result);
                console.log(outputs, "your result node")
                await streamResultForMultipleNodes(result.task_id, outputs);
                
                } catch (error) {
                    console.warn(error)
                    window.alert(error)
                } finally {
                    setIsComplete(true)
                    // const realResultNode = getNode(resultNode.nodeid)
                    // if (!realResultNode) return
                    // if (resultNode.nodeType !== realResultNode.type) {
                    //     onResultNodeChange({
                    //         nodeid: resultNode.nodeid,
                    //         nodeType: realResultNode.type ?? "text"
                    //     })
                    //     setResultNode({
                    //         nodeid: resultNode.nodeid,
                    //         nodeType: realResultNode.type ?? "text"
                    //     })
                    // }
                }
        }
    
        if (!isAddContext) {
          addNodeAndSetFlag()
          addCount(outputs.length)
        }
        else if (isAddContext && !isAddFlow) {
            const parentEdgeNode = getNode(parentId)
            if (!parentEdgeNode) return
            // const location1 = {
            //     // 120 - 40 = 80 is half of the width of the target node - code node
            //     x: parentEdgeNode.position.x - 160,
            //     y: parentEdgeNode.position.y + 200
            // }

            // const location2 = {
            //     x: parentEdgeNode.position.x,
            //     y: parentEdgeNode.position.y + 200
            // }
            // ... existing code ...
            const centerX = parentEdgeNode.position.x - 80; // 中心点
            const spacing = 288; // 节点间距
            const totalWidth = spacing * (outputs.length - 1); // 所有间距的总宽度
            const startX = centerX - totalWidth / 2; // 最左侧节点的x坐标
           
            for (let output of outputs) {
                const location = {
                    x: startX + spacing * outputs.indexOf(output),
                    y: parentEdgeNode.position.y + 200
                }

                setNodes(prevNodes => [
                    ...prevNodes,
                    {
                        id: output,
                        position: location,
                        data: { content: "" },
                        type: 'text', // default type
                    }
                ]);

                setEdges((edges) => edges.concat({
                    id: `connection-${Date.now() + outputs.indexOf(output)}`,
                    source: parentId,
                    target: output,
                    type: "CTT",
                    markerEnd: markerEnd,
                }))

               
            }

           setIsAddFlow(true)  
           allowActivateNode()
           clear()
    
        }
        else if (isAddContext && isAddFlow) {
            setAutogenarated(false)
            sendData()
            
        }
      }, [outputs, isAddContext, isAddFlow, isComplete])

      
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

    const displaySourceNodeLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (
            <span key={`${node.id}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{node.label}</span>
        ))
    }

    const displaySwitchLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        const switchNodes = sourceNodeIdWithLabelGroup.filter(node => getNode(node.id)?.type === "switch")
        if (switchNodes.length > 0 && !switchValue) {
            setSwitchValue(switchNodes[0].id)
        }
        else if (switchNodes.length > 0 && switchValue) {
            if (!switchNodes.map(node => node.id).includes(switchValue)) {
                setSwitchValue(switchNodes[0].id)
            }
        }
        else if (switchNodes.length === 0 && switchValue) {
            setSwitchValue(null)
        }
        return switchNodes.map((node: {id: string, label: string}) => (
            <option key={`switch.${node.id}-${Date.now()}`} value={node.id}>
                {node.label}
            </option>
        ))
    }

    const displayContentLabels = () => {
        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        const contentNodes = sourceNodeIdWithLabelGroup.filter(node => getNode(node.id)?.type === "text")
        if (contentNodes.length > 0 && !contentValue) {
            setContentValue(contentNodes[0].id)
        }
        else if (contentNodes.length > 0 && contentValue) {
            if (!contentNodes.map(node => node.id).includes(contentValue)) {
                setContentValue(contentNodes[0].id)
            }
        }
        else if (contentNodes.length === 0 && contentValue) {
            setContentValue(null)
        }
        return contentNodes.map((node: {id: string, label: string}) => (
            <option key={`content.${node.id}-${Date.now()}`} value={node.id}>
                {node.label}
            </option>
        ))
    }

    const displayOutputNodeLabels = () => {
        if (outputs.length === 0) return [].map((node: string) => (
            <span key={`${node}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{getNode(node)?.data?.label as string ?? node}</span>
        ))

        return outputs.map((node: string) => (
            <span key={`${node}-${parentId}`} className='w-fit text-[12px] font-[700] text-[#000] leading-normal tracking-[0.84px] bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] border-[3px]'>{getNode(node)?.data?.label as string ?? node}</span>
        ))
    }

    // const displayONLabels = () => {
    //     return outputs.map((node: string) => (
    //         <option key={`ON.${node}-${Date.now()}`} value={node}>
    //             {getNode(node)?.data?.label as string ?? node}
    //         </option>
    //     ))
    // }

    // const displayOFFLabels = () => {
    //     return outputs.map((node: string) => (
    //         <option key={`OFF.${node}-${Date.now()}`} value={node}>
    //             {getNode(node)?.data?.label as string ?? node}
    //         </option>
    //     ))
    // }


    

    const constructJsonData = () => {
        if (!switchValue || !contentValue) return new Error("switch or content is not selected")

        const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(parentId)
        
        let blocks: NodeJsonType[] = []
        for (let output of outputs) {
            let resultNodeLabel
            if (getNode(output) && getNode(output)?.data?.label !== undefined) {
                resultNodeLabel = getNode(output)?.data?.label as string
            }
            else {
                resultNodeLabel = output
            }

            const nodejson: NodeJsonType = {
                id: output,
                label: resultNodeLabel,
                type: "text",
                data:{content: ""}
            }
            blocks = [...blocks, nodejson]
        }

        for (let sourceNodeIdWithLabel of sourceNodeIdWithLabelGroup) {
            const nodeInfo = getNode(sourceNodeIdWithLabel.id)
            if (!nodeInfo) continue
            const nodeContent = (nodeInfo.type === "structured" || nodeInfo.type === "none" && nodeInfo.data?.subType === "structured") ? cleanJsonString(nodeInfo.data.content as string | any) : nodeInfo.data.content as string
            if (nodeContent === "error") return "error"
            const nodejson: NodeJsonType = {
                id: nodeInfo.id,
                label: (nodeInfo.data.label as string | undefined) ?? nodeInfo.id,
                type: nodeInfo.type!,
                data: {
                    content: nodeContent,
                    ...(nodeInfo.type === "none" ? {subType: nodeInfo.data?.subType as string ?? "text"}: {})
                }
            }
            blocks = [...blocks, nodejson]
        }

        let edges:ChooseEdgeJsonType[] = []

        const edgejson: ChooseEdgeJsonType = {
            id: parentId,
            type: "choose",
            data: {  
                switch: {id: switchValue, label: getNode(switchValue)?.data?.label as string ?? switchValue},
                content: {id: contentValue, label: getNode(contentValue)?.data?.label as string ?? contentValue},
                inputs: sourceNodeIdWithLabelGroup,
                outputs: outputs.map((node: string) => ({id: node, label: getNode(node)?.data?.label as string ?? node})),
                looped: false,
                ON: ON.map((node: string) => ({id: node, label: getNode(node)?.data?.label as string ?? node})),
                OFF: OFF.map((node: string) => ({id: node, label: getNode(node)?.data?.label as string ?? node}))
            },
        }

        edges = [...edges, edgejson]
        console.log(blocks, edges)

        return {
            blocks,
            edges
        }
    }


    const onDataSubmit = async () => {

        if (!outputs.length){
            setAutogenarated(true)
            onResultNodesChange([`${totalCount+1}`, `${totalCount+2}`])
            setOutputs([`${totalCount+1}`, `${totalCount+2}`])
            setIsAddContext(false)
            setIsAddFlow(false)
        }
        // else if (outputs.length > 0 && outputs.map(output => getNode(output)).includes(undefined)) {
        //     const definedNodes = outputs.filter(output => getNode(output))
        //     if (definedNodes.length >= 2) {
        //         onResultNodesChange(definedNodes)
        //         setOutputs(definedNodes)
        //         allowActivateNode()
        //         clear()
        //         setIsAddContext(true)
        //         setIsAddFlow(true)
        //     }
        // }
        else {
            // setNodes(prevNodes => prevNodes.map(node => {
            //     if (node.id === resultNode){
            //         return {...node, data: {...node.data, content: ""}}
            //     }
            //     return node
            // }))
            // onResultNodesChange(currentResultNodes)

            setIsAddContext(true)
            setIsAddFlow(true)
            allowActivateNode()
            clear()
        }
        setIsComplete(false)
        };

        // const onLoopChange = (newLoop: boolean) => {
        //     setNodes(prevNodes => prevNodes.map(node => {
        //         if (node.id === parentId) {
        //             return {...node, data: {...node.data, looped: newLoop}}
        //         }
        //         return node
        //     }))
        // }

    
        const onResultNodesChange = (newResultNodes: string[]) => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, resultNodes: newResultNodes}}
                }
                return node
            }))
        }

        const onSwitchValueChange = () => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, switch: switchValue}}
                }
                return node
            }))
        }

        const onContentValueChange = () => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, content: contentValue}}
                }
                return node
            }))
        }

        const onOutputValueChange = () => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, resultNodes: outputs}}
                }
                return node
            }))
        }

        const onONValueChange = () => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, ON: ON}}
                }
                return node
            }))
        }

        const onOFFValueChange = () => {
            setNodes(prevNodes => prevNodes.map(node => {
                if (node.id === parentId) {
                    return {...node, data: {...node.data, OFF: OFF}}
                }
                return node
            }))
        }

  
    
  return (

    <ul ref={menuRef} className={`absolute top-[58px] left-[0px] text-white rounded-[9px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme pt-[7px] pb-[6px] px-[6px] font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
        <li className='flex gap-1 items-center justify-between font-plus-jakarta-sans'>
            <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[4px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M6 12V7" stroke="#D9D9D9" strokeWidth="2"/>
                    <path d="M10 2V7L2 7V2" stroke="#D9D9D9" strokeWidth="1.5"/>
                    <path d="M0.934259 2.5L2 0.901388L3.06574 2.5H0.934259Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                    <path d="M8.93426 2.5L10 0.901388L11.0657 2.5H8.93426Z" fill="#D9D9D9" stroke="#D9D9D9"/>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[12px] font-[600] text-main-grey font-plus-jakarta-sans leading-normal'>
                Choose
                </div>
            </div>
            <div className='w-[57px] h-[26px]'>
                <button className='w-full h-full rounded-[6px] bg-[#39BC66] text-[#000] text-[12px] font-[700] font-plus-jakarta-sans flex flex-row items-center  justify-center gap-[7px]' onClick={onDataSubmit}>
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
        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] w-[280px]'>
            <div className='text-[#6D7177] w-[62px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             input
            </div>
            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                {displaySourceNodeLabels()}
            </div>
            
        </li>
        <ul className='flex flex-col border-[#6D7177] rounded-[4px] w-[280px]'>
            <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-t-[4px] w-[280px] h-[36px]'>
            <div className='text-[#6D7177] w-[112px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             switch
            </div>
            <select ref={switchRef} id='switch' defaultValue={undefined} value={switchValue ?? undefined} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                e.preventDefault()
                e.stopPropagation()
                setSwitchValue(e.target.value)
            }} className='flex flex-row items-center justify-start py-[5px] px-[10px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                {displaySwitchLabels()}
            </select>
            
            </li>
            <li className='flex items-center justify-start font-plus-jakarta-sans border-x-[1px] border-b-[1px] bg-black border-[#6D7177] rounded-b-[4px] w-[280px] h-[36px]'>
            <div className='text-[#6D7177] w-[112px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             content
            </div>
            <select ref={contentRef} id='content' defaultValue={undefined} value={contentValue ?? undefined} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                e.preventDefault()
                e.stopPropagation()
                setContentValue(e.target.value)
            }} className='flex flex-row items-center justify-start py-[5px] px-[10px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
               {displayContentLabels()}
            </select>
            </li>
        </ul>

        <li className='flex gap-1 items-center justify-start font-plus-jakarta-sans border-[1px] border-[#6D7177] rounded-[4px] w-[280px]'>
            <div className='text-[#6D7177] w-[62px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             output
            </div>
            <div className='flex flex-row flex-wrap gap-[10px] items-center justify-start flex-1 py-[8px] px-[10px]'>
                {displayOutputNodeLabels()}
            </div>
            
        </li>
        
        <li className='flex flex-col gap-1 items-start justify-center font-plus-jakarta-sans'>
            <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal ml-[4px]'>
            chose output when switch
            </div>
            <div className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[4px] w-[280px] h-[36px]'>
            <div className='text-[#6D7177] w-[112px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             ON
            </div>
            {/* <select ref={ONRef} id='ON' multiple={true} value={ON} contentEditable={outputs.length > 0} onChange={() => {
                if (ONRef.current){
                    const selectedLabel = getNode(ONRef.current.value)?.data?.label as string | undefined ?? ONRef.current.value
                    // console.log(selectedLabel, "ON")
                    setON([...])
                }
            }} className='flex flex-row items-center justify-start py-[5px] px-[10px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                {displayONLabels()}
            </select> */}
            <Select
            className='dark-Select'
            mode="multiple"
            allowClear
            disabled={outputs.length === 0}
            style={{ width: '100%' }}
            placeholder="Please select"
            defaultValue={[]}
            value={ON}
            onMouseEnter={onFocus}
            onMouseLeave={onBlur}
            onChange={(value) => {
                if (isEqual(ON, value)) return
                setON(value)
            }}
            options={outputs.map((node: string) => ({label: getNode(node)?.data?.label as string ?? node, value: node}))} />
            </div>
        </li>

        <li className='flex flex-col gap-1 items-start justify-center font-plus-jakarta-sans'>
            <div className='text-[#6D7177] font-plus-jakarta-sans text-[12px] font-[700] leading-normal ml-[4px]'>
            chose output when switch
            </div>
            <div className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[4px] w-[280px] h-[36px]'>
            <div className='text-[#6D7177] w-[112px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             OFF
            </div>
            {/* <select ref={OFFRef} id='OFF' multiple={true} value={OFF} contentEditable={outputs.length > 0} onChange={() => {
                
            }} className='flex flex-row items-center justify-start py-[5px] px-[10px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                {displayOFFLabels()}
            </select> */}
             <Select
            className='dark-Select'
            mode="multiple"
            allowClear
            disabled={outputs.length === 0}
            style={{ width: '100%' }}
            placeholder="Please select"
            defaultValue={[]}
            value={OFF}
            onFocus={onFocus}
            onBlur={onBlur}
            onChange={(value) => {
                if (isEqual(OFF, value)) return
                setOFF(value)
            }}
            options={outputs.map((node: string) => ({label: getNode(node)?.data?.label as string ?? node, value: node}))} />
            </div>
        </li>
        
    </ul>
  )
}

export default ChooseConfigMenu

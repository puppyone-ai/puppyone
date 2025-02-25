'use client'
import React, { useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore, ReactFlowState, MarkerType} from '@xyflow/react'
import useJsonConstructUtils, {NodeJsonType, FileData} from '../../../hooks/useJsonConstructUtils'
// import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../../states/NodesPerFlowContext'
import {isEqual} from 'lodash'
import { SearchConfigNodeData } from '@/app/components/workflow/edgesNode/edgeNodes/SearchConfig'
import { backend_IP_address_for_sendingData, BasicNodeData } from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import { nanoid } from 'nanoid'
import {JsonNodeData} from '../../blockNode/JsonNode'


type SearchByVectorConfigProps = {
    show: boolean,
    parentId: string,
}

export type SearchByVectorEdgeJsonType = {
    // id: string,
    type: "search",
    data: {
        // search_type: "vector",
        // sub_search_type: "embedding",
        search_type: "vector",
        // sub_search_type: "vector",
        top_k: number,
        inputs: { [key: string]: string },
        threshold: number,
        extra_configs: {
            // For vector
            provider: "openai",
            model: "text-embedding-ada-002",
            db_type: "pinecone",
            collection_name: "test_collection",
        },
        docs_id: { [key: string]: string }, // 用于储藏vectordb的id
        query_id: { [key: string]: string }, // 用于储藏query的id
        looped: boolean,
        outputs: { [key: string]: string }
    },
    id:string
}

type ConstructedSearchByVectorJsonData = {
    blocks: { [key: string]: NodeJsonType },
    edges: { [key: string]: SearchByVectorEdgeJsonType }
}

function SearchByVectorConfigMenu({show, parentId}: SearchByVectorConfigProps) {
    const menuRef = useRef<HTMLUListElement>(null)
    const {getNode, setNodes, setEdges, getNodes} = useReactFlow()
    const {getSourceNodeIdWithLabel, cleanJsonString, streamResult, reportError, resetLoadingUI, transformBlocksFromSourceNodeIdWithLabelGroup} = useJsonConstructUtils()
    // const {addNode, addCount, allowActivateNode, clear, totalCount} = useNodeContext()
    const {clearAll} = useNodesPerFlowContext()
    const [resultNode, setResultNode] = useState<string | null>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.resultNode ?? null
    )
    // const [isAddContext, setIsAddContext] = useState(true)
    const [isAddFlow, setIsAddFlow] = useState(true)
    const [isComplete, setIsComplete] = useState(true)
    
    const [query, setQuery] = useState<{id: string, label: string}>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.query_id ?? {id: "", label: ""}
    )
    const [vectorDB, setVectorDB] = useState<{id: string, label: string}>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.vector_db ?? {id: "", label: ""}
    )
    const [top_k, setTop_k] = useState<number | undefined>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.top_k ?? 5
    )
    const queryRef = useRef<HTMLSelectElement>(null)
    const vectorDBRef = useRef<HTMLSelectElement>(null)
    const thresholdRef = useRef<HTMLInputElement>(null)
    const topkRef = useRef<HTMLInputElement>(null)
    // const [queryList, setQueryList] = useState<{id: string, label: string}[]>([])
    // const [vectorDBList, setVectorDBList] = useState<{id: string, label: string}[]>([])
    // const [parents, setParents] = useState<{id: string, label: string}[]>([]);
    const [threshold, setThreshold] = useState<number | undefined>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.extra_configs?.threshold ?? 0.7
    )


    useEffect(() => {
        onQueryChange(query)
    }, [query])

    useEffect(() => {
        onVectorDBChange(vectorDB)
    }, [vectorDB])

    useEffect(() => {
        onTopKChange(top_k)
    }, [top_k])

    useEffect(() => {
        onThresholdChange(threshold)
    }, [threshold])
    
    
    // update query and vectorDBList based on parents
    // useEffect(() => {
    //         setQueryList(parents.filter(node => {
    //             const nodeInfo = getNode(node.id)
    //             if (nodeInfo){
    //                 console.log(nodeInfo, "nodeInfo")
    //                 if (nodeInfo.type === "text" || (nodeInfo.type === "none" && nodeInfo.data.subtype !== "structured")){
    //                     return true
    //                 }
    //             }
    //             return false
    //         }))

    //         setVectorDBList(parents.filter(
    //             node => {
    //                 const nodeInfo = getNode(node.id)
    //                 if (nodeInfo) {
    //                     if (nodeInfo.type === "structured") {
    //                         return true
    //                     }
    //                 }
    //                 return false
    //             }
    //         ))
    //     }, [parents])

        
        // update to set query => default query value
        // useEffect(() => {
        //     if (queryList.length > 0 && queryRef.current) {
        //       const defaultQuery = queryList[0];
        //       const selectedLabel = getNode(defaultQuery.id)?.data?.label as string | undefined ?? defaultQuery.id;
        //       if (!query.id) {
        //         setQuery({id: defaultQuery.id, label: selectedLabel});
        //       }
              
        //     }
        //   }, [queryList]);

          
        //   // update to set vectorDB => default vectorDB value
        //   useEffect(() => {
        //     if (vectorDBList.length > 0 && vectorDBRef.current) {
        //       const defaultVectorDB = vectorDBList[0];
        //       const selectedLabel = getNode(defaultVectorDB.id)?.data?.label as string | undefined ?? defaultVectorDB.id;
        //       if (!vectorDB.id) {
        //         setVectorDB({id: defaultVectorDB.id, label: selectedLabel});
        //       }
              
        //     }
        //   }, [vectorDBList]);

    
        useEffect( () => {
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
        // if (!isEqual(sourceNodeIdWithLabelGroup, parents)) {
        //     setParents(sourceNodeIdWithLabelGroup);
        // }
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (
            <span key={`${node.id}-${parentId}`} className='w-fit text-[10px] font-semibold text-[#000] leading-normal bg-[#6D7177] px-[4px] flex items-center justify-center h-[16px] rounded-[4px] border-[#6D7177]'>{`{{${node.label}}}`}</span>
        ))
    }

    const constructJsonData = (): ConstructedSearchByVectorJsonData | Error => {
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
                data: {content: ""}
            }
        }
        transformBlocksFromSourceNodeIdWithLabelGroup(blocks, sourceNodeIdWithLabelGroup)

        let edges: { [key: string]: SearchByVectorEdgeJsonType } = {}


        const query_label = getNode(query.id)?.data?.label as string | undefined ?? query.label
        const vectorDB_label = getNode(vectorDB.id)?.data?.label as string | undefined ?? vectorDB.label
       
        const edgejson: SearchByVectorEdgeJsonType = {
            // "search-1728709343180": {
            // "type": "search",
            // "data": {
            //     "search_type": "vector",
            //     "inputs": {
            //         "3": "",
            //         "4": ""
            //     },
            //     "outputs": { "5": "" },
            //     "top_k": 10,
            //     "threshold": 0.5,
            //     "extra_configs": {
            //     "model": "text-embedding-ada-002",
            //     "db_type": "pgvector",
            //     "collection_name": "test_collection",
            //     },
            //     "docs_id": {"3": ""},
            //     "query_id": {"4": ""}
            // }
            // }
            // id: parentId,
            type: "search",
            data: {  
                search_type: "vector", // 改成vector？
                inputs: Object.fromEntries(sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => ([node.id, node.label]))),
                outputs: {[resultNode as string]: resultNodeLabel as string},
                top_k: top_k ?? 5,
                threshold: threshold ?? 0.7,
                extra_configs: {
                    provider: "openai",
                    model: "text-embedding-ada-002",
                    db_type: "pinecone",
                    collection_name: "test_collection"
                },
                docs_id: {[vectorDB.id]: vectorDB_label},
                query_id: {[query.id]: query_label},
                looped: false,
            },
            id: parentId
        }

        if (query_label !== query.label) setQuery({id: query.id, label: query_label})
        if (vectorDB_label !== vectorDB.label) setVectorDB({id: vectorDB.id, label: vectorDB_label})
        edges[parentId] = edgejson
        console.log(blocks, edges)

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


    const displayQueryLabels = () => {
        const queryList = getSourceNodeIdWithLabel(parentId).filter(node => {
            const nodeInfo = getNode(node.id)
            if (nodeInfo?.type === "text") {
                return true
            }
            return false
        })
        if (queryList.length > 0 && !query.id) {
            setQuery({id: queryList[0].id, label: queryList[0].label})
        }
        else if (queryList.length > 0 && query.id) {
            if (!queryList.map(node => node.id).includes(query.id)) {
                setQuery({id: queryList[0].id, label: queryList[0].label})
            }
        }
        else if (queryList.length === 0 && query.id) {
            setQuery({id: "", label: ""})
        }
        return queryList.map((q: {id: string, label: string}) => (
            <option key={`${q.id}-${parentId}`} value={q.id}>
                {q.label}
            </option>
        ))
    }

    const displayVectorDBLabels = () => {
        const vectorDBList = getSourceNodeIdWithLabel(parentId).filter(node => {
            const nodeInfo = getNode(node.id)
            if (nodeInfo?.type === "structured" && nodeInfo.data.index_name) {
                return true
            }
            return false
        })
        if (vectorDBList.length > 0 && !vectorDB.id) {
            setVectorDB({id: vectorDBList[0].id, label: vectorDBList[0].label})
        }
        else if (vectorDBList.length > 0 && vectorDB.id) {
            if (!vectorDBList.map(node => node.id).includes(vectorDB.id)) {
                setVectorDB({id: vectorDBList[0].id, label: vectorDBList[0].label})
            }
        }
        else if (vectorDBList.length === 0 && vectorDB.id) {
            setVectorDB({id: "", label: ""})
        }
        return vectorDBList.map((db: {id: string, label: string}) => (
            <option key={`${db.id}-${parentId}`} value={db.id}>
                {db.label}
            </option>
        ))
    }

    const onResultNodeChange = (newResultNode: string) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, resultNode: newResultNode}}
            }
            return node
        }))
    }

    const onQueryChange = (newQuery: {id: string, label: string}) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, query_id: newQuery}}
            }
            return node
        }))
    }

    const onVectorDBChange = (newVectorDB: {id: string, label: string}) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, vector_db: newVectorDB}}
            }
            return node
        }))
    }

    const onTopKChange = (newTopK: number | undefined) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, top_k: newTopK}}
            }
            return node
        }))
    }

    const onThresholdChange = (newThreshold: number | undefined) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, extra_configs: {...(node.data as SearchConfigNodeData).extra_configs, threshold: newThreshold}}}
            }
            return node
        }))
    }
    
    


 
  return (

    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[320px] rounded-[16px] border-[1px] border-[rgb(109,113,119)] bg-main-black-theme p-[7px]  font-plus-jakarta-sans flex flex-col gap-[13px] ${show ? "" : "hidden"} `} >
         <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
            
            <div className='flex flex-row gap-[12px]'>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="none" viewBox="0 0 13 13">
                    <path stroke="#CDCDCD" strokeWidth="2" d="M5.143 5.143 12 12"/>
                    <circle cx="4.714" cy="4.714" r="3.714" fill="#1C1D1F" stroke="#CDCDCD" strokeWidth="2"/>
                    </svg>
                </div>
                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                Search
                </div>
                </div>
                <div className='flex flex-row gap-[8px] justify-center items-center'>
                    <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 14 14">
                        <path fill="#CDCDCD" d="m0 14 4.597-.446-2.684-3.758L0 14Zm6.768-5.325-4.071 2.907.465.651 4.07-2.908-.465-.65Z"/>
                        <path stroke="#CDCDCD" strokeWidth="1.5" d="M7 9V2"/>
                        <path fill="#CDCDCD" d="M7 0 4.69 4h4.62L7 0Z"/>
                        <path stroke="#CDCDCD" strokeWidth="1.5" d="m7 9-5 3.5"/>
                        <path fill="#CDCDCD" d="m14 14-4.597-.446 2.684-3.758L14 14ZM7.232 8.675l4.071 2.907-.465.651-4.07-2.908.465-.65Z"/>
                        <path stroke="#CDCDCD" strokeWidth="1.5" d="m7 9 5 3.5"/>
                        </svg>
                    </div>
                    <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                    By Vector
                    </div>
                </div>
            </div>
            <div className='w-[57px] h-[26px]'>
                <button className='w-full h-full rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center  justify-center gap-[7px]' onClick={onDataSubmit}>
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

        <ul className='flex flex-col border-[#6D7177] rounded-[8px] w-full'>
            <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-t-[8px] w-full h-[36px]'>
            <div className='text-[#6D7177] w-[112px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             query
            </div>
            <select ref={queryRef} id='query' value={query.id} onChange={() => {
                if (queryRef.current){
                    if (queryRef.current.value !== query.id) {
                        const selectedLabel = getNode(queryRef.current.value)?.data?.label as string | undefined ?? queryRef.current.value
                        console.log(selectedLabel, "queryValue")
                        setQuery({id: queryRef.current.value, label: selectedLabel})
                    }
                }
            }} className='flex flex-row items-center justify-start py-[5px] px-[10px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                {displayQueryLabels()}
            </select>
            
            </li>
            <li className='flex items-center justify-start font-plus-jakarta-sans border-x-[1px] border-b-[1px] bg-black border-[#6D7177] rounded-b-[8px] w-full h-[36px]'>
            <div className='text-[#6D7177] w-[112px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start'>
             vector DB
            </div>
            <select ref={vectorDBRef} id='vectorDB' value={vectorDB.id} onChange={() => {
                if (vectorDBRef.current){
                    if (vectorDBRef.current.value !== vectorDB.id) {
                        const selectedLabel = getNode(vectorDBRef.current.value)?.data?.label as string | undefined ?? vectorDBRef.current.value
                        console.log(selectedLabel, "vectordb")
                        setVectorDB({id: vectorDBRef.current.value, label: selectedLabel})
                    }
                }
            }} className='flex flex-row items-center justify-start py-[5px] px-[10px] text-[12px] font-[700] leading-normal text-main-grey border-none w-full h-full font-plus-jakarta-sans'>
                {displayVectorDBLabels()}
            </select>
            </li>
        </ul>


        <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[8px] w-full h-[36px]'>
            <div className='text-[#6D7177] w-[120px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start whitespace-nowrap'>
             result number
            </div>
            <input ref={topkRef} value={top_k} onChange={() => {
                if (topkRef.current) {
                    setTop_k(topkRef.current.value === "" ? undefined : Number(topkRef.current.value))
                }
            }} id="result_number" type='number' className='px-[10px] py-[5px] rounded-r-[4px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off' required onMouseDownCapture={onFocus} onBlur={onBlur}></input>
            
        </li>
        <li className='flex items-center justify-start font-plus-jakarta-sans border-[1px] bg-black border-[#6D7177] rounded-[8px] w-full h-[36px]'>
            <div className='text-[#6D7177] w-[160px] font-plus-jakarta-sans text-[12px] font-[700] leading-normal px-[12px] py-[8px] border-r-[1px] border-[#6D7177] flex items-center justify-start whitespace-nowrap'>
             threshold
            </div>
            <input ref={thresholdRef} value={threshold} onChange={() => {
                if (thresholdRef.current) {
                    setThreshold(thresholdRef.current.value === "" ? undefined : Number(thresholdRef.current.value))
                }
            }} id="threshold" type='number' max={1} min={0} step={0.001} className='px-[10px] py-[5px] rounded-r-[4px] bg-black text-[12px] font-[700] text-[#CDCDCD] tracking-[1.12px] leading-normal flex items-center justify-center font-plus-jakarta-sans w-full h-full' autoComplete='off' required onMouseDownCapture={onFocus} onBlur={onBlur}></input>
            
        </li>

        
    </ul>
  )
}

export default SearchByVectorConfigMenu
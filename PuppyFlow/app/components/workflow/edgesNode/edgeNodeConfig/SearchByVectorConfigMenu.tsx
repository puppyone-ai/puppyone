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
            db_type: "pgvector" | "pinecone",
            collection_name: string,
        }|{},
        doc_ids: string[], // 用于储藏vectordb的id
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
    const {getNode, setNodes, setEdges, getEdges} = useReactFlow()
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

    // 添加复制功能状态
    const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

    // 添加展开/收起状态
    const [showSettings, setShowSettings] = useState(false);

    // Add these state variables near your other useState declarations
    const [nodeLabels, setNodeLabels] = useState<{label: string, id: string}[]>(
        (getNode(parentId)?.data as SearchConfigNodeData)?.nodeLabels ?? []
    );
    // Change this state variable to a ref
    const sourceNodeLabelsRef = useRef<{label: string, id: string}[]>(getSourceNodeIdWithLabel(parentId).map((node) => ({label:node.label, id:node.id})));

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(`{{${text}}}`).then(() => {
            setCopiedLabel(text);
            setTimeout(() => setCopiedLabel(null), 1000);
        }).catch(err => {
            console.warn('Failed to copy:', err);
        });
    };

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
        return sourceNodeIdWithLabelGroup.map((node: {id: string, label: string}) => (
            <button 
                key={`${node.id}-${parentId}`} 
                onClick={() => copyToClipboard(node.label)}
                className={`flex items-center justify-center px-[8px] h-[20px] rounded-[4px] 
                         border-[1px] text-[10px] font-medium transition-all duration-200
                         ${copiedLabel === node.label 
                           ? 'bg-[#3B9BFF]/20 border-[#3B9BFF] text-[#39BC66]' 
                           : 'bg-[#252525] border-[#3B9BFF]/30 text-[#3B9BFF]/90 hover:bg-[#3B9BFF]/5'}`}
            >
                {copiedLabel === node.label ? 'Copied!' : `{{${node.label}}}`}
            </button>
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

        console.log("search node config",getNode(parentId))

        console.log("received collection name",getEdges().filter(
            (eg)=>eg.target === parentId
        ).map(
            (eg)=>getNode(eg.source)?.data.index_name
        )[0] as string)

        const construct_input_nodes_data_from_ids = (blocks: { [key: string]: NodeJsonType }) => {
            const data = Object.entries(blocks).map(([id, node]) => {
                console.log("construct_input_nodes_data_from_ids node",node)
                console.log("construct_input_nodes_data_from_ids id",id)

                const originalNode = getNode(id);
                console.log("construct_input_nodes_data_from_ids originalNode",originalNode)

                if (originalNode?.type === "structured") {
                    return [id, {
                        ...node,
                        data:{
                            ...node.data,
                            embedding_view:originalNode?.data?.chunks,
                        },
                        collection_configs: originalNode?.data?.collection_configs,
                    }];
                } else {
                    return [id, {
                        ...node,
                    }];
                }
            })

            console.log("construct_input_nodes_data_from_ids data",data)
            return Object.fromEntries(data);

        }

        const final_blocks =  construct_input_nodes_data_from_ids(blocks)
        
       
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
                },
                doc_ids: nodeLabels.map(node => node.id),
                query_id: {[query.id]: query_label},
                looped: false,
            },
            id: parentId
        }

        if (query_label !== query.label) setQuery({id: query.id, label: query_label})
        if (vectorDB_label !== vectorDB.label) setVectorDB({id: vectorDB.id, label: vectorDB_label})
        edges[parentId] = edgejson
        console.log("search by vector payload",final_blocks, edges)

        return {
            blocks: final_blocks,
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
        console.log("query list",queryList)
        return queryList.map((q: {id: string, label: string}) => (
            <option 
                key={`${q.id}-${parentId}`} 
                value={q.id}
                className='text-[#3B9BFF]'
            >
                {`{{${q.label}}}`}
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
            <option 
                key={`${db.id}-${parentId}`} 
                value={db.id}
                className='text-[#3B9BFF]'
            >
                {`{{${db.label}}}`}
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
    
 

    // Add these functions near your other handler functions
    const updateNodeLabelsInParent = (labels: {label: string, id: string}[]) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === parentId) {
                return {...node, data: {...node.data, nodeLabels: labels}};
            }
            return node;
        }));
    };

    const addNodeLabel = (label: {label: string, id: string}) => {
        if (label && !nodeLabels.some(nodeLabel => nodeLabel.id === label.id)) {
            const newNodeLabels = [...nodeLabels, label];
            setNodeLabels(newNodeLabels);
            updateNodeLabelsInParent(newNodeLabels);
        }
    };

    const removeNodeLabel = (index: number) => {
        const newNodeLabels = [...nodeLabels];
        newNodeLabels.splice(index, 1);
        setNodeLabels(newNodeLabels);
        updateNodeLabelsInParent(newNodeLabels);
    };

    // Update the useEffect to set the ref value instead
    useEffect(() => {
        sourceNodeLabelsRef.current = getSourceNodeIdWithLabel(parentId).filter(node => getNode(node.id)?.type === "structured" && getNode(node.id)?.data.index_name).map((node) => ({label:node.label, id:node.id}))
    }, [getSourceNodeIdWithLabel(parentId)])

  return (

    <ul ref={menuRef} className={`absolute top-[58px] left-0 text-white w-[320px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] ${show ? "" : "hidden"} shadow-lg`}>
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
        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Input Variables</label>
                <div className='w-2 h-2 rounded-full bg-[#3B9BFF]'></div>
            </div>
            <div className='flex gap-2 p-[5px] bg-transparent rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                {displaySourceNodeLabels()}
            </div>
        </li>

        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Query</label>
                <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
            </div>
            <select 
                ref={queryRef} 
                value={query.id} 
                onChange={() => {
                    if (queryRef.current && queryRef.current.value !== query.id) {
                        const selectedLabel = getNode(queryRef.current.value)?.data?.label as string | undefined ?? queryRef.current.value
                        setQuery({id: queryRef.current.value, label: selectedLabel})
                    }
                }}
                className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                         text-[#3B9BFF] text-[12px] font-medium appearance-none cursor-pointer 
                         hover:border-[#6D7177]/50 transition-colors'
            >
                {displayQueryLabels()}
            </select>
        </li>

        <li className='flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
                <label className='text-[13px] font-semibold text-[#6D7177]'>Database with Vector Indexing</label>
                <div className='w-2 h-2 rounded-full bg-[#39BC66]'></div>
            </div>
           
            {/* start of node labels */}
            <div className='bg-[#1E1E1E] rounded-[8px] p-2 border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                    <div className='flex flex-wrap gap-2 items-center min-h-[12px]'>
                        {nodeLabels.map((label, index) => (
                            <div key={index}
                                className='flex items-center bg-[#252525] rounded-md 
                                        border border-[#FF9B4D]/30 hover:border-[#FF9B4D]/50 
                                        transition-colors group'
                            >
                                <span className='text-[12px] text-[#FF9B4D] px-2 py-1'>
                                    {label.label}
                                </span>
                                <button
                                    onClick={() => removeNodeLabel(index)}
                                    className='text-[#6D7177] hover:text-[#ff6b6b] transition-colors 
                                            px-1 py-1 opacity-0 group-hover:opacity-100'
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                        ))}

                    </div>
                </div>

                <div className='mt-1'>
                    <div className='text-[11px] text-[#6D7177] mb-2'>Available Database Blocks:</div>
                    <div className='flex flex-wrap gap-2'>
                        {sourceNodeLabelsRef.current.map((labelOption: {label: string, id: string}) => (
                            <button
                                key={labelOption.id}
                                onClick={() => addNodeLabel({label:labelOption.label, id:labelOption.id})}
                                className={`px-2 py-1 rounded-md text-[11px] transition-colors
                                        ${nodeLabels.some(nodeLabel => nodeLabel.id === labelOption.id)
                                        ? 'bg-[#252525] text-[#CDCDCD] border border-[#6D7177]/50'
                                        : 'bg-[#1E1E1E] text-[#6D7177] border border-[#6D7177]/30 hover:bg-[#252525] hover:text-[#CDCDCD]'}`}
                            >
                                {labelOption.label||labelOption.id}
                            </button>
                        ))}
                    </div>
                </div>
            {/* end of node labels */}
        </li>

        <li className='flex flex-col gap-2'>
            <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                    <label className='text-[13px] font-semibold text-[#6D7177]'>Settings</label>
                    <div className='w-2 h-2 rounded-full bg-[#6D7177]'></div>
                </div>
                <button 
                    onClick={() => setShowSettings(!showSettings)}
                    className='text-[12px] text-[#6D7177] hover:text-[#39BC66] transition-colors flex items-center gap-1'
                >
                    {showSettings ? 'Hide' : 'Show'}
                    <svg 
                        className={`w-4 h-4 transition-transform ${showSettings ? 'rotate-180' : ''}`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
            </div>

            {showSettings && (
                <div className='flex flex-col gap-2 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                    <div className='flex flex-col gap-1'>
                        <label className='text-[12px] text-[#6D7177]'>Result Number</label>
                        <input 
                            ref={topkRef} 
                            value={top_k} 
                            onChange={() => {
                                if (topkRef.current) {
                                    setTop_k(topkRef.current.value === "" ? undefined : Number(topkRef.current.value))
                                }
                            }}
                            type='number'
                            className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 text-[12px] text-[#CDCDCD] hover:border-[#6D7177]/50 transition-colors'
                            onMouseDownCapture={onFocus}
                            onBlur={onBlur}
                        />
                    </div>
                    <div className='flex flex-col gap-1'>
                        <label className='text-[12px] text-[#6D7177]'>Threshold</label>
                        <input 
                            ref={thresholdRef} 
                            value={threshold} 
                            onChange={() => {
                                if (thresholdRef.current) {
                                    setThreshold(thresholdRef.current.value === "" ? undefined : Number(thresholdRef.current.value))
                                }
                            }}
                            type='number'
                            max={1}
                            min={0}
                            step={0.001}
                            className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 text-[12px] text-[#CDCDCD] hover:border-[#6D7177]/50 transition-colors'
                            onMouseDownCapture={onFocus}
                            onBlur={onBlur}
                        />
                    </div>
                </div>
            )}
        </li>
    </ul>
  )
}

export default SearchByVectorConfigMenu
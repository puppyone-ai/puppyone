import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef } from 'react'
import useJsonConstructUtils from '../../../hooks/useJsonConstructUtils'
import { markerEnd } from '../../connectionLineStyles/ConfigToTargetEdge'
import InputOutputDisplay from './components/InputOutputDisplay'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'
import { PuppyDropdown } from '@/app/components/misc/PuppyDropDown'

// 首先定义一个索引项接口 - 移到组件外部
interface IndexingItem {
    type: string;
    status: string;
    index_name: string;
    collection_configs?: {
        collection_name: string;
        // 其他配置...
    };
    // 其他属性...
}

// 添加一个简化版的索引项接口
interface SimplifiedIndexItem {
    index_name: string;
    collection_configs?: {
        collection_name: string;
        // 其他配置...
    };
}

export type RetrievingConfigNodeData = {
    dataSource?: { id: string, label: string, index_item?: SimplifiedIndexItem }[],
    subMenuType: string | null,
    top_k: number | undefined,
    content: string | null,
    query_id: { id: string, label: string } | undefined,
    structuredWithVectorIndexing: string[],
    extra_configs: {
        model: "llama-3.1-sonar-small-128k-online" | "llama-3.1-sonar-large-128k-online" | "llama-3.1-sonar-huge-128k-online" | undefined,
        threshold: number | undefined
    },
}

type RetrievingConfigNodeProps = NodeProps<Node<RetrievingConfigNodeData>>

function Retrieving({ isConnectable, id }: RetrievingConfigNodeProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode, setNodes } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)

    // 状态管理 - 保留在主组件中
    const [query, setQuery] = useState<{ id: string, label: string }>(
        (getNode(id)?.data as RetrievingConfigNodeData)?.query_id ?? { id: "", label: "" }
    )
    const [top_k, setTop_k] = useState<number | undefined>(
        (getNode(id)?.data as RetrievingConfigNodeData)?.top_k ?? 5
    )
    const [threshold, setThreshold] = useState<number | undefined>(
        (getNode(id)?.data as RetrievingConfigNodeData)?.extra_configs?.threshold ?? 0.7
    )
    const [showSettings, setShowSettings] = useState(false)
    const [dataSource, setDataSource] = useState<{ label: string, id: string, index_item?: SimplifiedIndexItem }[]>(
        (getNode(id)?.data as RetrievingConfigNodeData)?.dataSource ?? []
    )
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)

    // Refs
    const queryRef = useRef<HTMLSelectElement>(null)
    const thresholdRef = useRef<HTMLInputElement>(null)
    const topkRef = useRef<HTMLInputElement>(null)

    // 接着定义一个新的 ref 用于存储扁平化的索引项列表
    const flattenedIndexItems = useRef<{
        nodeId: string,
        nodeLabel: string,
        indexItem: IndexingItem
    }[]>([]);

    // 更新扁平化的索引项列表
    useEffect(() => {
        const items: { nodeId: string, nodeLabel: string, indexItem: IndexingItem }[] = [];

        getSourceNodeIdWithLabel(id).forEach(node => {
            const nodeInfo = getNode(node.id);
            if (nodeInfo?.type === "structured") {
                const indexingList = nodeInfo?.data?.indexingList as IndexingItem[] | undefined;

                if (Array.isArray(indexingList)) {
                    indexingList.forEach(item => {
                        if (item.type === "vector" && item.status === "done") {
                            items.push({
                                nodeId: node.id,
                                nodeLabel: node.label,
                                indexItem: item
                            });
                        }
                    });
                }
            }
        });

        flattenedIndexItems.current = items;
    }, [getSourceNodeIdWithLabel(id)]);

    // 使用 useBaseEdgeNodeLogic hook 替换原有的运行逻辑
    const { isLoading, handleDataSubmit } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: "structured",

    });

    // 状态同步逻辑 - 保留在主组件中
    useEffect(() => {
        onQueryChange(query)
    }, [query])

    useEffect(() => {
        onTopKChange(top_k)
    }, [top_k])

    useEffect(() => {
        onThresholdChange(threshold)
    }, [threshold])

    // 组件初始化
    useEffect(() => {
        if (!isOnGeneratingNewNode) {
            clearAll()
            activateEdge(id)
        }

        return () => {
            if (activatedEdge === id) {
                clearEdgeActivation()
            }
        }
    }, [])

    // UI 交互函数
    const onClickButton = () => {
        setIsMenuOpen(!isMenuOpen)

        if (isOnGeneratingNewNode) return
        if (activatedEdge === id) {
            clearEdgeActivation()
        }
        else {
            clearAll()
            activateEdge(id)
        }
    }

    const onFocus = () => {
        const curRef = menuRef.current
        if (curRef && !curRef.classList.contains("nodrag")) {
            curRef.classList.add("nodrag")
        }
    }

    const onBlur = () => {
        const curRef = menuRef.current
        if (curRef) {
            curRef.classList.remove("nodrag")
        }
    }

    // 数据同步函数
    const onQueryChange = (newQuery: { id: string, label: string }) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, query_id: newQuery } }
            }
            return node
        }))
    }

    const onTopKChange = (newTopK: number | undefined) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, top_k: newTopK } }
            }
            return node
        }))
    }

    const onThresholdChange = (newThreshold: number | undefined) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, extra_configs: { ...(node.data as RetrievingConfigNodeData).extra_configs, threshold: newThreshold } } }
            }
            return node
        }))
    }

    // Node标签管理
    const updateDataSourceInParent = (dataSource: { label: string, id: string, index_item?: SimplifiedIndexItem }[]) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, dataSource: dataSource } };
            }
            return node;
        }));
    };

    // 修改 addNodeLabel 函数
    const addNodeLabel = (option: { nodeId: string, nodeLabel: string, indexItem: IndexingItem }) => {
        // 使用连入的 JSON Block 的 nodeId 作为 id
        const nodeId = option.nodeId;

        // 检查是否已经添加了相同 nodeId 的数据源
        if (!dataSource.some(item => item.id === nodeId)) {
            const simplifiedIndexItem: SimplifiedIndexItem = {
                index_name: option.indexItem.index_name,
                collection_configs: option.indexItem.collection_configs
            };

            const newItem = {
                id: nodeId,  // 使用原始的 nodeId
                label: option.nodeLabel,
                index_item: simplifiedIndexItem  // 改为index_item
            };

            const newDataSource = [...dataSource, newItem];
            setDataSource(newDataSource);
            updateDataSourceInParent(newDataSource);
        }
    };

    const removeNodeLabel = (index: number) => {
        const newDataSource = [...dataSource];
        newDataSource.splice(index, 1);
        setDataSource(newDataSource);
        updateDataSourceInParent(newDataSource);
    };

    // UI助手函数
    const displayQueryLabels = () => {
        const queryList = getSourceNodeIdWithLabel(id).filter(node => {
            const nodeInfo = getNode(node.id)
            if (nodeInfo?.type === "text") {
                return true
            }
            return false
        })
        if (queryList.length > 0 && !query.id) {
            setQuery({ id: queryList[0].id, label: queryList[0].label })
        }
        else if (queryList.length > 0 && query.id) {
            if (!queryList.map(node => node.id).includes(query.id)) {
                setQuery({ id: queryList[0].id, label: queryList[0].label })
            }
        }
        else if (queryList.length === 0 && query.id) {
            setQuery({ id: "", label: "" })
        }

        return queryList.map((q: { id: string, label: string }) => (
            <option
                key={`${q.id}-${id}`}
                value={q.id}
                className='text-[#3B9BFF]'
            >
                {`{{${q.label}}}`}
            </option>
        ))
    }

    // 修改 onDataSubmit 函数
    const onDataSubmit = () => {
        handleDataSubmit();
    }

    // 在组件顶部定义共享样式
    const handleStyle = {
        position: "absolute" as const,
        width: "calc(100%)",
        height: "calc(100%)",
        top: "0",
        left: "0",
        borderRadius: "0",
        transform: "translate(0px, 0px)",
        background: "transparent",
        border: "3px solid transparent",
        zIndex: !isOnConnect ? "-1" : "1",
    };

    return (
        <div className='p-[3px] w-[80px] h-[48px]'>
            <button
                onClick={onClickButton}
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"} group ${isOnGeneratingNewNode ? "pointer-events-none" : ""}`}
            >
                Retrieve
                <Handle id={`${id}-a`} className='edgeSrcHandle handle-with-icon handle-top' type='source' position={Position.Top} />
                <Handle id={`${id}-b`} className='edgeSrcHandle handle-with-icon handle-right' type='source' position={Position.Right} />
                <Handle id={`${id}-c`} className='edgeSrcHandle handle-with-icon handle-bottom' type='source' position={Position.Bottom} />
                <Handle id={`${id}-d`} className='edgeSrcHandle handle-with-icon handle-left' type='source' position={Position.Left} />
                {/* Target handles */}
                <Handle
                    id={`${id}-a`}
                    type="target"
                    position={Position.Top}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
                <Handle
                    id={`${id}-b`}
                    type="target"
                    position={Position.Right}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
                <Handle
                    id={`${id}-c`}
                    type="target"
                    position={Position.Bottom}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
                <Handle
                    id={`${id}-d`}
                    type="target"
                    position={Position.Left}
                    style={handleStyle}
                    isConnectable={isConnectable}
                    onMouseEnter={() => setIsTargetHandleTouched(true)}
                    onMouseLeave={() => setIsTargetHandleTouched(false)}
                />
            </button>

            {/* Configuration Menu (integrated directly) */}
            {isMenuOpen && (
                <ul ref={menuRef} className="absolute top-[64px] text-white w-[320px] rounded-[16px] border-[1px] border-[#6D7177] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg">
                    <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                        <div className='flex flex-row gap-[12px]'>
                            <div className='flex flex-row gap-[8px] justify-center items-center'>
                                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 14 14">
                                        <path fill="#CDCDCD" d="m0 14 4.597-.446-2.684-3.758L0 14Zm6.768-5.325-4.071 2.907.465.651 4.07-2.908-.465-.65Z" />
                                        <path stroke="#CDCDCD" strokeWidth="1.5" d="M7 9V2" />
                                        <path fill="#CDCDCD" d="M7 0 4.69 4h4.62L7 0Z" />
                                        <path stroke="#CDCDCD" strokeWidth="1.5" d="m7 9-5 3.5" />
                                        <path fill="#CDCDCD" d="m14 14-4.597-.446 2.684-3.758L14 14ZM7.232 8.675l4.071 2.907-.465.651-4.07-2.908.465-.65Z" />
                                        <path stroke="#CDCDCD" strokeWidth="1.5" d="m7 9 5 3.5" />
                                    </svg>
                                </div>
                                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                                    Retrieve by Vector
                                </div>
                            </div>
                        </div>
                        <div className='w-[57px] h-[26px]'>
                            <button
                                className='w-full h-full rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
                                onClick={onDataSubmit}
                                disabled={isLoading}
                            >
                                <span>
                                    {isLoading ? (
                                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="8" height="10" viewBox="0 0 8 10" fill="none">
                                            <path d="M8 5L0 10V0L8 5Z" fill="black" />
                                        </svg>
                                    )}
                                </span>
                                <span>
                                    {isLoading ? '' : 'Run'}
                                </span>
                            </button>
                        </div>
                    </li>

                    {/* Input/Output display */}
                    <li>
                        <InputOutputDisplay
                            parentId={id}
                            getNode={getNode}
                            getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
                            getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
                            supportedInputTypes={['text', 'structured']}
                            supportedOutputTypes={['structured']}
                        />
                    </li>

                    <li className='flex flex-col gap-2'>
                        <div className='flex items-center gap-2'>
                            <label className='text-[13px] font-semibold text-[#6D7177]'>Query</label>
                            <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                        </div>
                        <div className='flex items-center gap-2 h-[32px] p-0 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                            <PuppyDropdown
                                options={getSourceNodeIdWithLabel(id)
                                    .filter(node => getNode(node.id)?.type === "text")
                                    .map(q => ({
                                        id: q.id,
                                        label: q.label
                                    }))
                                }
                                selectedValue={query.id
                                    ? { id: query.id, label: query.label }
                                    : null
                                }
                                onSelect={(value: { id: string, label: string }) => {
                                    setQuery({ id: value.id, label: value.label });
                                }}
                                buttonHeight="32px"
                                buttonBgColor="transparent"
                                menuBgColor="#1A1A1A"
                                listWidth="100%"
                                containerClassnames="w-full"
                                mapValueTodisplay={(value: any) =>
                                    value && value.label
                                        ? <span className="text-[#3B9BFF] text-[12px] font-medium">{`{{${value.label}}}`}</span>
                                        : <span className="text-[#6D7177] text-[12px]">Select a query</span>
                                }
                                renderOption={(option: { id: string, label: string }) => (
                                    <div className="text-[#3B9BFF] text-[12px] font-medium">{`{{${option.label}}}`}</div>
                                )}
                            />
                        </div>
                    </li>

                    <li className='flex flex-col gap-2'>
                        <div className='flex items-center gap-2'>
                            <label className='text-[13px] font-semibold text-[#6D7177]'>Indexed Structured Data</label>
                            <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                        </div>

                        {/* start of node labels */}
                        <div className='bg-[#1E1E1E] rounded-[8px] p-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                            <div className='flex flex-wrap gap-2 items-center min-h-[12px]'>
                                {dataSource.map((item, index) => (
                                    <div key={index}
                                        className='flex items-center bg-[#252525] rounded-[4px] h-[26px] p-[6px]
                                                    border border-[#9B7EDB]/30 hover:border-[#9B7EDB]/50 
                                                    transition-colors group'
                                    >
                                        <span className='text-[10px] px-1'>
                                            <span className='text-[#9B7EDB]'>{`{{${item.label}}}`}</span>
                                            <span className='text-[#CDCDCD]'>-{item.index_item?.index_name}</span>
                                        </span>
                                        <button
                                            onClick={() => removeNodeLabel(index)}
                                            className='text-[#6D7177] hover:text-[#ff6b6b] transition-colors 
                                                        px-1 opacity-0 group-hover:opacity-100'
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                        </button>
                                    </div>
                                ))}
                                <div className="relative w-[26px] h-[26px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30">
                                    <PuppyDropdown
                                        options={flattenedIndexItems.current.map(item => ({
                                            nodeId: item.nodeId,
                                            nodeLabel: item.nodeLabel,
                                            indexItem: item.indexItem,
                                            displayText: item.nodeLabel
                                        }))}
                                        onSelect={(option: { nodeId: string, nodeLabel: string, indexItem: IndexingItem }) =>
                                            addNodeLabel(option)
                                        }
                                        selectedValue={null}
                                        optionBadge={false}
                                        listWidth="250px"
                                        buttonHeight="26px"
                                        buttonBgColor="transparent"
                                        menuBgColor="#1A1A1A"
                                        containerClassnames="w-[26px]"
                                        showDropdownIcon={false}
                                        mapValueTodisplay={(value: null | undefined | string | { nodeId: string, nodeLabel: string, indexItem: IndexingItem } | any) => {
                                            if (value === null || value === undefined) return (
                                                <span className="flex items-center justify-center w-full h-full">
                                                    <svg width="10" height="10" viewBox="0 0 14 14">
                                                        <path d="M7 0v14M0 7h14" stroke="#6D7177" strokeWidth="2" />
                                                    </svg>
                                                </span>
                                            );

                                            return (
                                                <span className="flex items-center justify-center w-full h-full">
                                                    <svg width="10" height="10" viewBox="0 0 14 14">
                                                        <path d="M7 0v14M0 7h14" stroke="#6D7177" strokeWidth="2" />
                                                    </svg>
                                                </span>
                                            );
                                        }}
                                        renderOption={(option: { nodeId: string, nodeLabel: string, indexItem: IndexingItem, displayText: string }) => (
                                            <div className="px-2 py-1 rounded cursor-pointer">
                                                <div className="text-[11px] text-[#9B7EDB]">{`{{${option.nodeLabel}}}`}</div>
                                                <div className="text-[9px] text-[#6D7177] truncate">
                                                    {option.indexItem.index_name}
                                                </div>
                                            </div>
                                        )}
                                    />
                                </div>
                            </div>
                        </div>
                    </li>

                    <li className='flex flex-col gap-2'>
                        <div className='flex items-center justify-between'>
                            <div className='flex items-center gap-2'>
                                <label className='text-[13px] font-semibold text-[#6D7177]'>Settings</label>
                                <div className='w-[5px] h-[5px] rounded-full bg-[#6D7177]'></div>
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
                            <div className='flex flex-col p-[8px] gap-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
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
            )}
        </div>
    )
}

export default Retrieving
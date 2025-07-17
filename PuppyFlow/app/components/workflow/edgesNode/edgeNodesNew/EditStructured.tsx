import { Handle, Position, NodeProps, Node, useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, { useState, useEffect, useRef } from 'react'
import InputOutputDisplay from './components/InputOutputDisplay'
import { PuppyDropdown } from "../../../misc/PuppyDropDown"
import { nanoid } from 'nanoid'
import { useBaseEdgeNodeLogic } from './hook/useRunSingleEdgeNodeLogicNew'
import { UI_COLORS } from '@/app/utils/colors'
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget'

export type ModifyConfigNodeData = {
    subMenuType: string | null,
    content: string | null,
    looped: boolean | undefined,
    content_type: "list" | "dict" | null,
    extra_configs: {
        index: number | undefined,
        key: string | undefined,
        params: {
            path: (string | number)[]
        }
    },
}

type ModifyConfigNodeProps = NodeProps<Node<ModifyConfigNodeData>>

// PathNode type for tree structure
type PathNode = {
    id: string,
    key: string, // "key" or "num"
    value: string,
    children: PathNode[]
}

function EditStructured({ data, isConnectable, id }: ModifyConfigNodeProps) {
    const { isOnConnect, activatedEdge, isOnGeneratingNewNode, clearEdgeActivation, activateEdge, clearAll } = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const { getNode, setNodes } = useReactFlow()
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useGetSourceTarget()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isHovered, setIsHovered] = useState(false)
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false)
    const menuRef = useRef<HTMLUListElement>(null)

    // 常量定义
    const MODIFY_GET_TYPE = "get"
    const MODIFY_DEL_TYPE = "delete"
    const MODIFY_REPL_TYPE = "replace"
    const MODIFY_GET_ALL_KEYS = "get_keys"
    const MODIFY_GET_ALL_VAL = "get_values"

    // 首先定义 getConfigDataa 函数，避免在使用前访问错误
    const getConfigDataa = (): Array<{ key: string, value: string }> =>
        (getNode(id)?.data.getConfigData as Array<{ key: string, value: string }>) || [
            {
                key: "key",
                value: ""
            },
        ];

    // 辅助函数 - 设置配置数据
    const setGetConfigDataa = (resolveData: (data: { key: string; value: string; }[]) => { key: string; value: string; }[]) => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, getConfigData: resolveData(getConfigDataa()) } };
            }
            return node;
        }))
    }

    // 状态管理
    const [execMode, setExecMode] = useState(
        getNode(id)?.data.type as string || MODIFY_GET_TYPE
    )

    const [paramv, setParamv] = useState("")

    // 使用通用 Hook 替换专用 Hook
    const { isLoading, handleDataSubmit } = useBaseEdgeNodeLogic({
        parentId: id,
        targetNodeType: 'structured'
    });

    // Add this new state for tree path structure - 现在可以安全使用 getConfigDataa
    const [pathTree, setPathTree] = useState<PathNode[]>(() => {
        // Try to convert existing flat path to tree structure if available
        const existingData = getConfigDataa();
        if (existingData && existingData.length > 0) {
            // Create a simple tree with the existing path items
            const rootNode: PathNode = {
                id: nanoid(6),
                key: existingData[0]?.key || "key",
                value: existingData[0]?.value || "",
                children: []
            };

            let currentNode = rootNode;
            for (let i = 1; i < existingData.length; i++) {
                const item = existingData[i];
                if (item) {
                    const newNode: PathNode = {
                        id: nanoid(6),
                        key: item.key || "key",
                        value: item.value || "",
                        children: []
                    };
                    currentNode.children.push(newNode);
                    currentNode = newNode;
                }
            }

            return [rootNode];
        }

        // Default empty tree with one root node
        return [{
            id: nanoid(6),
            key: "key",
            value: "",
            children: []
        }];
    });

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

    // 辅助函数
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

    // 状态同步到 ReactFlow
    useEffect(() => {
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return { ...node, data: { ...node.data, type: execMode } };
            }
            return node;
        }))
    }, [execMode])

    useEffect(() => {
        const flatPath = flattenPathTree(pathTree);
        setGetConfigDataa(() => flatPath);
    }, [pathTree]);

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

    // 修改提交函数，增加数据保存逻辑
    const onDataSubmit = () => {
        const flatPath = flattenPathTree(pathTree);

        // 先保存当前状态到节点数据
        setNodes(prevNodes => prevNodes.map(node => {
            if (node.id === id) {
                return {
                    ...node,
                    data: {
                        ...node.data,
                        type: execMode,
                        getConfigData: flatPath,
                        paramv: paramv
                    }
                };
            }
            return node;
        }));

        // 然后调用通用处理函数
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

    // Function to flatten the tree structure into a path array
    const flattenPathTree = (nodes: PathNode[]): { key: string, value: string }[] => {
        const result: { key: string, value: string }[] = [];

        const traverse = (node: PathNode) => {
            result.push({ key: node.key, value: node.value });
            if (node.children.length > 0) {
                traverse(node.children[0]); // We only follow the first child in each level
            }
        };

        if (nodes.length > 0) {
            traverse(nodes[0]);
        }

        return result;
    };

    return (
        <div className='p-[3px] w-[80px] h-[48px] relative'>
            {/* Invisible hover area between node and run button */}
            <div
                className="absolute -top-[40px] left-0 w-full h-[40px]"
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            />

            {/* Run button positioned above the node - show when node or run button is hovered */}
            <button
                className={`absolute -top-[40px] left-1/2 transform -translate-x-1/2 w-[57px] h-[24px] rounded-[6px] border-[1px] text-[10px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[4px] transition-all duration-200 ${
                    (isHovered || isRunButtonHovered) ? 'opacity-100' : 'opacity-0'
                }`}
                style={{
                    backgroundColor: isRunButtonHovered ? '#39BC66' : '#181818',
                    borderColor: isRunButtonHovered ? '#39BC66' : UI_COLORS.EDGENODE_BORDER_GREY,
                    color: isRunButtonHovered ? '#000' : UI_COLORS.EDGENODE_BORDER_GREY
                }}
                onClick={onDataSubmit}
                disabled={isLoading}
                onMouseEnter={() => setIsRunButtonHovered(true)}
                onMouseLeave={() => setIsRunButtonHovered(false)}
            >
                <span>
                    {isLoading ? (
                        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="6" height="8" viewBox="0 0 8 10" fill="none">
                            <path d="M8 5L0 10V0L8 5Z" fill="currentColor" />
                        </svg>
                    )}
                </span>
                <span>
                    {isLoading ? '' : 'Run'}
                </span>
            </button>

            <button
                onClick={onClickButton}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] edge-node transition-colors gap-[4px]`}
                style={{
                    borderColor: isHovered ? UI_COLORS.LINE_ACTIVE : UI_COLORS.EDGENODE_BORDER_GREY,
                    color: isHovered ? UI_COLORS.LINE_ACTIVE : UI_COLORS.EDGENODE_BORDER_GREY
                }}
            >
                {/* Edit Structured SVG icon */}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 14 14" fill="none">
                    <path d="M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <div className="flex flex-col items-center justify-center leading-tight text-[9px]">
                    <span>Edit</span>
                    <span>Struct</span>
                </div>

                <Handle id={`${id}-a`} className='edgeSrcHandle handle-with-icon handle-top' type='source' position={Position.Top} />
                <Handle id={`${id}-b`} className='edgeSrcHandle handle-with-icon handle-right' type='source' position={Position.Right} />
                <Handle id={`${id}-c`} className='edgeSrcHandle handle-with-icon handle-bottom' type='source' position={Position.Bottom} />
                <Handle id={`${id}-d`} className='edgeSrcHandle handle-with-icon handle-left' type='source' position={Position.Left} />

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

            {/* Configuration Menu */}
            {isMenuOpen && (
                <ul 
                    ref={menuRef} 
                    className="absolute top-[64px] text-white w-[416px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] shadow-lg"
                    style={{
                        borderColor: UI_COLORS.EDGENODE_BORDER_GREY
                    }}
                >
                    <li className='flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans'>
                        <div className='flex flex-row gap-[12px]'>
                            <div className='flex flex-row gap-[8px] justify-center items-center'>
                                <div className='w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center'>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none">
                                        <path d="M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z" stroke="#CDCDCD" strokeWidth="1.5" />
                                        <path d="M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5" stroke="#CDCDCD" strokeWidth="1.5" />
                                    </svg>
                                </div>
                                <div className='flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal'>
                                    Edit Structured
                                </div>
                            </div>
                        </div>
                        <div className='flex flex-row gap-[8px] items-center justify-center'>
                            <button
                                className='w-[57px] h-[26px] rounded-[8px] bg-[#39BC66] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]'
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

                    <li>
                        <InputOutputDisplay
                            parentId={id}
                            getNode={getNode}
                            getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
                            getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
                            supportedInputTypes={['structured']}
                            supportedOutputTypes={['structured']}
                            inputNodeCategory="blocknode"
                            outputNodeCategory="blocknode"
                        />
                    </li>

                    <li className='flex flex-col gap-2'>
                        <div className='flex items-center gap-2'>
                            <label className='text-[13px] font-semibold text-[#6D7177]'>Mode</label>
                            <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                        </div>
                        <div className='flex gap-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors'>
                            <PuppyDropdown
                                options={[MODIFY_GET_TYPE, MODIFY_DEL_TYPE, MODIFY_REPL_TYPE, MODIFY_GET_ALL_KEYS, MODIFY_GET_ALL_VAL]}
                                onSelect={(option: string) => setExecMode(option)}
                                selectedValue={execMode}
                                listWidth={"200px"}
                                mapValueTodisplay={(v: string) => {
                                    if (v === MODIFY_GET_ALL_KEYS) return "get all keys"
                                    if (v === MODIFY_GET_ALL_VAL) return "get all values"
                                    return v
                                }}
                            />
                        </div>
                    </li>

                    {!(execMode === MODIFY_GET_ALL_KEYS || execMode === MODIFY_GET_ALL_VAL) && (
                        <li className='flex flex-col gap-2'>
                            <div className='flex items-center gap-2'>
                                <label className='text-[13px] font-semibold text-[#6D7177]'>Path</label>
                                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                            </div>
                            <div className='flex flex-col gap-4 p-2 bg-[#1E1E1E] rounded-[8px] border-[1px] border-[#6D7177]/30'>
                                <TreePathEditor paths={pathTree} setPaths={setPathTree} />
                            </div>
                        </li>
                    )}

                    {execMode === MODIFY_REPL_TYPE && (
                        <li className='flex flex-col gap-2'>
                            <div className='flex items-center gap-2'>
                                <label className='text-[12px] font-medium text-[#6D7177]'>Replace With</label>
                                <div className='w-[5px] h-[5px] rounded-full bg-[#FF4D4D]'></div>
                            </div>
                            <input
                                value={paramv}
                                onChange={(e) => setParamv(e.target.value)}
                                type='string'
                                className='w-full h-[32px] px-3 bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 
                                        text-[#CDCDCD] text-[12px] font-medium appearance-none cursor-pointer 
                                        hover:border-[#6D7177]/50 transition-colors'
                                autoComplete='off'
                                onFocus={onFocus}
                                onBlur={onBlur}
                            />
                        </li>
                    )}
                </ul>
            )}
        </div>
    )
}

// TreePathEditor Component
const TreePathEditor = ({ paths, setPaths }: {
    paths: PathNode[],
    setPaths: React.Dispatch<React.SetStateAction<PathNode[]>>
}) => {

    const addNode = (parentId: string) => {
        setPaths((prevPaths) => {
            const newPaths = JSON.parse(JSON.stringify(prevPaths));
            const findAndAddNode = (nodes: PathNode[]) => {
                for (let node of nodes) {
                    if (node.id === parentId) {
                        node.children.push({
                            id: nanoid(6),
                            key: "key",
                            value: "",
                            children: [],
                        });
                        return true;
                    }
                    if (node.children.length && findAndAddNode(node.children)) {
                        return true;
                    }
                }
                return false;
            };
            findAndAddNode(newPaths);
            return newPaths;
        });
    };

    const deleteNode = (nodeId: string) => {
        setPaths((prevPaths) => {
            const newPaths = JSON.parse(JSON.stringify(prevPaths));
            const findAndDeleteNode = (nodes: PathNode[]) => {
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i].id === nodeId) {
                        nodes.splice(i, 1);
                        return true;
                    }
                    if (nodes[i].children.length && findAndDeleteNode(nodes[i].children)) {
                        return true;
                    }
                }
                return false;
            };
            findAndDeleteNode(newPaths);
            return newPaths;
        });
    };

    const updateNodeValue = (nodeId: string, value: string) => {
        setPaths((prevPaths) => {
            const newPaths = JSON.parse(JSON.stringify(prevPaths));
            const findAndUpdateNode = (nodes: PathNode[]) => {
                for (let node of nodes) {
                    if (node.id === nodeId) {
                        node.value = value;
                        return true;
                    }
                    if (node.children.length && findAndUpdateNode(node.children)) {
                        return true;
                    }
                }
                return false;
            };
            findAndUpdateNode(newPaths);
            return newPaths;
        });
    };

    const updateNodeKey = (nodeId: string, key: string) => {
        setPaths((prevPaths) => {
            const newPaths = JSON.parse(JSON.stringify(prevPaths));
            const findAndUpdateNode = (nodes: PathNode[]) => {
                for (let node of nodes) {
                    if (node.id === nodeId) {
                        node.key = key;
                        return true;
                    }
                    if (node.children.length && findAndUpdateNode(node.children)) {
                        return true;
                    }
                }
                return false;
            };
            findAndUpdateNode(newPaths);
            return newPaths;
        });
    };

    const renderNode = (node: PathNode, level = 0) => {
        const isLeafNode = node.children.length === 0;

        return (
            <div key={node.id} className="relative group">
                <div
                    className="relative"
                    style={{ marginLeft: `${level * 32}px` }}
                >
                    {/* SVG connector lines for non-root nodes */}
                    {level > 0 && (
                        <svg
                            className="absolute -left-[16px] top-[-6px]"
                            width="17"
                            height="21"
                            viewBox="0 0 17 21"
                            fill="none"
                        >
                            <path
                                d="M1 0L1 20H17"
                                stroke="#6D7177"
                                strokeWidth="1"
                                strokeOpacity="0.5"
                                fill="none"
                            />
                        </svg>
                    )}

                    <div className="flex items-center gap-2 mb-1.5">
                        <div className="flex-1 relative h-[32px] bg-[#252525] rounded-[6px] border-[1px] border-[#6D7177]/30 hover:border-[#6D7177]/50 transition-colors overflow-hidden">
                            <input
                                value={node.value}
                                onChange={(e) => updateNodeValue(node.id, e.target.value)}
                                className='w-full h-full bg-transparent border-none outline-none pl-[72px] pr-2
                         text-[#CDCDCD] text-[12px] font-medium appearance-none'
                                placeholder={node.key === 'num' ? 'Enter number...' : 'Enter key...'}
                            />

                            {/* Floating type selector */}
                            <div
                                className={`absolute left-[6px] top-1/2 -translate-y-1/2 h-[20px] flex items-center 
                           px-2 rounded-[4px] cursor-pointer transition-colors
                           ${node.key === 'key'
                                        ? 'bg-[#2D2544] border border-[#9B6DFF]/30 hover:border-[#9B6DFF]/50 hover:bg-[#2D2544]/80'
                                        : 'bg-[#443425] border border-[#FF9B4D]/30 hover:border-[#FF9B4D]/50 hover:bg-[#443425]/80'}`}
                                onClick={() => {
                                    updateNodeKey(node.id, node.key === 'key' ? 'num' : 'key');
                                }}
                            >
                                <div className={`text-[10px] font-semibold min-w-[24px] text-center
                               ${node.key === 'key'
                                        ? 'text-[#9B6DFF]'
                                        : 'text-[#FF9B4D]'}`}>
                                    {node.key}
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={() => deleteNode(node.id)}
                            className='p-0.5 w-6 h-6 flex items-center justify-center text-[#6D7177] hover:text-[#ff4d4d] transition-colors'
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="relative">
                    {node.children.map((child) => renderNode(child, level + 1))}

                    {isLeafNode && level < 5 && (
                        <div className="flex items-center" style={{ marginLeft: `${level * 32 + 32}px` }}>
                            <button
                                onClick={() => addNode(node.id)}
                                className='w-6 h-6 flex items-center justify-center rounded-md
                          bg-[#252525] border-[1px] border-[#6D7177]/30
                          text-[#6D7177]
                          hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] 
                          transition-colors'
                            >
                                <svg width="10" height="10" viewBox="0 0 14 14">
                                    <path d="M7 0v14M0 7h14" stroke="currentColor" strokeWidth="2" />
                                </svg>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className='flex flex-col gap-3'>
            {paths.length === 0 ? (
                <button
                    onClick={() => setPaths([{ id: nanoid(6), key: "key", value: "", children: [] }])}
                    className='w-full h-[32px] flex items-center justify-center gap-2 rounded-[6px] 
                   border border-[#6D7177]/30 bg-[#252525] text-[#CDCDCD] text-[12px] font-medium 
                   hover:border-[#6D7177]/50 hover:bg-[#1E1E1E] transition-colors'
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6D7177">
                        <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Create Root Node
                </button>
            ) : (
                paths.map((path) => renderNode(path))
            )}
        </div>
    );
};

export default EditStructured

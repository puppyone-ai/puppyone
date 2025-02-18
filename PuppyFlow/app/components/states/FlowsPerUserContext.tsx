// This context is used to store all workflows per user

import React, { createContext, useContext, useState, ReactElement, useEffect} from "react";
import { Node, Edge } from "@xyflow/react";
import useManageUserWorkspacesUtils from '../hooks/useManageUserWorkSpacesUtils'
import useJsonConstructUtils from '../hooks/useJsonConstructUtils'
import { useReactFlow } from '@xyflow/react';
import { useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';

interface InitialUserData {
    user_id: string;
    user_name: string;
    workspaces: {
        workspace_id: string;
        workspace_name: string;
    }[];
    workspace_history: any;
}

// type Flow = {
//     // nodes: Node[],
//     // edges: Edge[],
//     // basic information
//     flowId: string,
//     flowTitle: string,
// }

// export type flowsPerUserContext = {
//     userId: string,
//     userName: string,
//     flows: Flow[],
//     selectedFlowId: string | null,
//     setUserId: React.Dispatch<React.SetStateAction<string>>,
//     setSelectedFlowId: React.Dispatch<React.SetStateAction<string | null>>,
//     setFlows: React.Dispatch<React.SetStateAction<Flow[]>>,
//     addFlow: () => void,
//     removeFlow: (flowId: string) => void,
//     editFlowName: (flowId: string, newName: string) => void,
//     storeLastestFlow: () => void, // focus on store the flow data from reactflow (contruct it and turn it into string) into database (combine utils and reactflow built-in functions)
//     loadLastestFlow: () => void, // focus on load the flow data from database into reactflow  (combine utils and reactflow built-in functions)
// }

// const initialFlowsPerUserContext: flowsPerUserContext = {
//     userId: "",
//     userName: "",
//     flows: [],
//     selectedFlowId: null,
//     setUserId: () => {},
//     setSelectedFlowId: () => {},
//     setFlows: () => {},
//     addFlow: () => {},
//     removeFlow: (flowId: string) => {},
//     editFlowName: (flowId: string, newName: string) => {},
//     storeLastestFlow: () => {},
//     loadLastestFlow: () => {},
// }


// export const FlowsPerUserContext = createContext<flowsPerUserContext>(initialFlowsPerUserContext);

// const FlowsPerUserProps = () => {
//     const [userId, setUserId] = useState<string>("");
//     const [userName, setUserName] = useState<string>("");
//     const [flows, setFlows] = useState<Flow[]>([]);
//     const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
//     // 用于存储最后一次保存的json for certain workspace
//     const lastSavedJsonRef = useRef<string>('')
//     const intervalIdRef = useRef<NodeJS.Timeout | null>(null)
//     const {createWorkspaceInDatabase, deleteWorkspaceInDatabase, updateWorkspaceNameInDatabase, addWorkspaceHistory, fetchLatestWorkspaceHistory, fetchUserId, fetchUserWorkspacesInfo, fetchUserName} = useManageUserWorkspacesUtils()
//     const {constructWholeJsonWorkflow} = useJsonConstructUtils()
//     const {setNodes, setEdges} = useReactFlow()


//     useEffect(() => {
//         const InitiateUserWorkspaces = async () => {
//             if (!selectedFlowId) {
//                 setNodes([])
//                 setEdges([])
//             }
//             const userId = await fetchUserId()
//             const userName = await fetchUserName(userId)
//             if (userId) {
//                 setUserId(userId)
//                 setUserName(userName as string)
//                 const flows = await fetchUserWorkspacesInfo(userId)
//                 if (flows) {
//                     setFlows(flows.map(flow => ({flowId: flow.workspace_id, flowTitle: flow.workspace_name})))
//                 }
//             } 
//         }
//         InitiateUserWorkspaces()

//         // const AutoStoreLastestFlowInterval = setInterval(storeLastestFlow, 10000)
        
//         // return () => {
//         //     clearInterval(AutoStoreLastestFlowInterval)
//         // }

//     }, [])

//     useEffect(() => {

//         // loadLastestFlow()

//         //   // 清理之前的定时器
//         //     if (intervalIdRef.current) {
//         //         clearInterval(intervalIdRef.current)
//         //     }

//         //     // 只有当selectedFlowId存在时才设置新的定时器
//         //     if (selectedFlowId) {
//         //         intervalIdRef.current = setInterval(storeLastestFlow, 10000)
//         //     }
            
//         //     return () => {
//         //         if (intervalIdRef.current) {
//         //             clearInterval(intervalIdRef.current)
//         //             intervalIdRef.current = null
//         //         }
//         //     }

//         const initializeFlow = async () => {
//             try {
//                 // 1. 清理之前的定时器
//                 if (intervalIdRef.current) {
//                     clearInterval(intervalIdRef.current)
//                     intervalIdRef.current = null
//                 }

//                 // 2. 加载最新的flow
//                 await loadLastestFlow()

                 
//                 // 3. 只有当selectedFlowId存在时才设置新的定时器
//                 if (selectedFlowId) {
//                     intervalIdRef.current = setInterval(storeLastestFlow, 1000)
//                 }
//             }
//             catch (error) {
//                 console.error("Error initializing flow:", error);
//             }
//         }

//         initializeFlow()

//         return () => {
//             if (intervalIdRef.current) {
//                 clearInterval(intervalIdRef.current)
//                 intervalIdRef.current = null
//             }
//         }
    
//     }, [selectedFlowId])


//     const addFlow = async () => {
//         try {
//             const newFlow: { workspace_id: string; workspace_name: string; } | undefined = await createWorkspaceInDatabase(userId)
//             if (newFlow) {
//                 setFlows([...flows, {flowId: newFlow.workspace_id, flowTitle: newFlow.workspace_name}])
//             }
//         } catch (error) {
//             console.error("Error adding flow:", error);
//         }  
//     }

//     const removeFlow = async (flowId: string) => {
//         try {
//             await deleteWorkspaceInDatabase(flowId)
//             setFlows(flows.filter(flow => flow.flowId !== flowId));
//         } catch (error) {
//             console.error("Error removing flow:", error);
//         }
//     }

//     const editFlowName = async (flowId: string, newName: string) => {
//         try {
//             const data = await updateWorkspaceNameInDatabase(flowId, newName)
//             if (data && data.workspace_name === newName) {
//                 setFlows(flows.map(flow => flow.flowId === flowId ? { ...flow, flowTitle: newName } : flow));
//             }
//         } catch (error) {
//             console.error("Error editing flow name:", error);
//         }
//     }

    
//     // 存储最新的flow
//     const storeLastestFlow = async () => {
//         try {
//             if (selectedFlowId) {
                
//                 const currentflowJson = constructWholeJsonWorkflow() // for current workspace flow

//                 const currentflowJsonString = JSON.stringify(currentflowJson)

//                 if (currentflowJsonString !== lastSavedJsonRef.current) {
//                     console.log('start storing lastest flow!, because currentflowJsonString is not equal to lastSavedJsonRef.current')
//                     const generatedDatatimestamp = new Date().toISOString();
//                     await addWorkspaceHistory(selectedFlowId, currentflowJson, generatedDatatimestamp)
//                     lastSavedJsonRef.current = currentflowJsonString
//                 }

//             }
//         } catch (error) {
//             console.error("Error storing flow:", error);
//         }
//     }

//     // 加载最新的flow
//     const loadLastestFlow = async () => {
//         try {
//             if (selectedFlowId) {
//                 const LatestflowJsonHistory: {history: {blocks: Node[], edges: Edge[]}, timestep: string} | null = await fetchLatestWorkspaceHistory(selectedFlowId)
//                 if (LatestflowJsonHistory) {
//                     console.log('start loading lastest flow!, because LatestflowJsonHistory is not null', LatestflowJsonHistory)
//                     lastSavedJsonRef.current = JSON.stringify(LatestflowJsonHistory.history)
//                     setNodes(LatestflowJsonHistory.history.blocks)
//                     setEdges(LatestflowJsonHistory.history.edges)
//                 }
//                 else {
//                     lastSavedJsonRef.current = ''
//                     setNodes([])
//                     setEdges([])
//                 }
//             }
//         } catch (error) {
//             console.error("Error loading flow:", error);
//         }
//     }

//     return {
//         userId,
//         userName,
//         flows,
//         selectedFlowId,
//         setUserId,
//         setSelectedFlowId,
//         setFlows,
//         addFlow,
//         removeFlow,
//         editFlowName,
//         storeLastestFlow,
//         loadLastestFlow,
//     }

// }
type deployItem={
     id: string; label?: string 
}

type WorkspaceData = {
    flowId: string;
    flowTitle: string;
    latestJson: {
        blocks: Node[];
        edges: Edge[];
    } | null;
    deploy:{
        selectedInputs:Array<deployItem>;
        selectedOutputs:Array<deployItem>;
        apiConfig?:any
    }
    zoomState?:any;
    isDirty: boolean; // 标记是否有未保存的更改
    viewport?:{
        x:number,
        y:number,
        zoom:number
    }
}

export type FlowsPerUserContextType = {
    userId: string;
    userName: string;
    workspaces: WorkspaceData[];
    selectedFlowId: string | null;
    handleFlowSwitch: (newFlowId: string | null) => Promise<void>;
    addFlow: () => Promise<void>    ;
    removeFlow: (flowId: string) => Promise<void>;
    editFlowName: (flowId: string, newName: string) => Promise<void>;
    forceSaveHistory: (flowId: string) => Promise<void>;
    setWorkspaces: React.Dispatch<React.SetStateAction<WorkspaceData[]>>; // Added type for setWorkspaces
}

type QueueOperation = {
    type: 'saveHistory' | 'createWorkspace' | 'deleteWorkspace' | 'updateWorkspaceName';
    payload: any;
    priority: number; // 1: 最高优先级 (create/delete), 2: 普通优先级 (rename), 3: 最低优先级 (save)
    onComplete: () => void;
    onError?: () => void;
}

const initialFlowsPerUserContext: FlowsPerUserContextType = {
    userId: "",
    userName: "",
    workspaces: [],
    selectedFlowId: null,
    handleFlowSwitch: () => Promise.resolve(),
    addFlow: () => Promise.resolve(),
    removeFlow: () => Promise.resolve(),
    editFlowName: () => Promise.resolve(),
    forceSaveHistory: () => Promise.resolve(),
    setWorkspaces:()=>{},
}

const FlowsPerUserContext = createContext<FlowsPerUserContextType>(initialFlowsPerUserContext);


const FlowsPerUserProps = () => {
    const [userId, setUserId] = useState<string>("");
    const [userName, setUserName] = useState<string>("");
    const [workspaces, setWorkspaces] = useState<WorkspaceData[]>([]);
    const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
    const operationQueueRef = useRef<QueueOperation[]>([]);
    const isProcessingRef = useRef(false);
    const {createWorkspaceInDatabase, deleteWorkspaceInDatabase, updateWorkspaceNameInDatabase, addWorkspaceHistory, fetchLatestWorkspaceHistory, fetchUserId, fetchUserWorkspacesInfo, fetchUserName, initializeUserDataV2} = useManageUserWorkspacesUtils()
    const {constructWholeJsonWorkflow} = useJsonConstructUtils()
    const reactFlowInstance = useReactFlow()
    const workspacesRef = useRef<WorkspaceData[]>([]); // 用于存储最新的workspace数据 for useEffect quote
    const isForceSaveRef = useRef(false);

    // 添加一个 ref 来存储未保存的状态
    const unsavedStatesRef = useRef<Record<string, {
        nodes: Node[];
        edges: Edge[];
        viewport:{
            x:number,
            y:number,
            zoom:number
        };
        timestamp: number;
    }>>({});

    // 添加规范化工具函数
    const normalizeWorkspaceJson = (json: any) => {
        if (!json?.blocks || !json?.edges) return json;
        
        const normalizeNode = (node: any) => ({
            id: node.id,
            type: node.type,
            data: {
                ...node.data,  // 保留所有 data 字段
                label: node.data?.label || "",
                content: node.data?.content || ""
            }
        });

        const normalizeEdge = (edge: any) => ({
            id: edge.id,
            type: edge.type,
            data: {
                ...edge.data,  // 保留所有 data 字段
                inputs: edge.data?.inputs?.sort((a: any, b: any) => a.id.localeCompare(b.id)) || [],
                outputs: edge.data?.outputs?.sort((a: any, b: any) => a.id.localeCompare(b.id)) || [],
                // 确保其他重要字段也被包含在比较中
                code: edge.data?.code,
                content_type: edge.data?.content_type,
                modify_type: edge.data?.modify_type,
                extra_configs: edge.data?.extra_configs,
                messages: edge.data?.messages,
                looped: edge.data?.looped
            }
        });

        return {
            blocks: json.blocks
                .map(normalizeNode)
                .sort((a: any, b: any) => a.id.localeCompare(b.id)),
            edges: json.edges
                .map(normalizeEdge)
                .sort((a: any, b: any) => a.id.localeCompare(b.id))
        };
    };

    // 添加调试日志
    const isJsonEqual = (json1: any, json2: any): boolean => {
        // 1. 基础类型快速判定
        if (!json1 || !json2) return json1 === json2;
        if (json1 === json2) return true;
        
        // 2. 结构有效性判定（更灵活的方式）
        const isValidWorkspaceJson = (json: any) => {
            // 检查必要的数组字段是否存在且为数组
            const hasValidBlocks = Array.isArray(json?.blocks);
            const hasValidEdges = Array.isArray(json?.edges);
            
            // 允许空数组，但类型必须正确
            return hasValidBlocks && hasValidEdges;
        };
        
        if (!isValidWorkspaceJson(json1) || !isValidWorkspaceJson(json2)) {
            console.log('Quick fail: invalid workspace structure', {
                json1: {
                    hasBlocks: Array.isArray(json1?.blocks),
                    hasEdges: Array.isArray(json1?.edges)
                },
                json2: {
                    hasBlocks: Array.isArray(json2?.blocks),
                    hasEdges: Array.isArray(json2?.edges)
                }
            });
            return false;
        }
        
        // 3. 长度快速判定
        if (json1.blocks.length !== json2.blocks.length || 
            json1.edges.length !== json2.edges.length) {
            console.log('Quick fail: length mismatch', {
                blocks: { json1: json1.blocks.length, json2: json2.blocks.length },
                edges: { json1: json1.edges.length, json2: json2.edges.length }
            });
            return false;
        }
        
        // 4. ID集合快速判定
        const getIds = (items: any[]) => new Set(items.map(item => item.id));
        const blocks1Ids = getIds(json1.blocks);
        const blocks2Ids = getIds(json2.blocks);
        const edges1Ids = getIds(json1.edges);
        const edges2Ids = getIds(json2.edges);
        
        if (blocks1Ids.size !== blocks2Ids.size || edges1Ids.size !== edges2Ids.size) {
            console.log('Quick fail: ID set size mismatch');
            return false;
        }
        
        // 5. ID一致性快速判定
        const areIdsSame = Array.from(blocks1Ids).every(id => blocks2Ids.has(id)) &&
                          Array.from(edges1Ids).every(id => edges2Ids.has(id));
        if (!areIdsSame) {
            console.log('Quick fail: ID set mismatch');
            return false;
        }
        
        // 6. 如果快速判定都通过，再进行完整的标准化比较
        const normalized1 = normalizeWorkspaceJson(json1);
        const normalized2 = normalizeWorkspaceJson(json2);
        
        const result = JSON.stringify(normalized1) === JSON.stringify(normalized2);
        
        if (!result) {
            console.log('Deep comparison failed:', {
                normalized1,
                normalized2
            });
        }
        
        return result;
    };

    // 处理操作队列
    const processOperationQueue = async () => {
        if (isProcessingRef.current || operationQueueRef.current.length === 0) return;

        try {
            isProcessingRef.current = true;
            operationQueueRef.current.sort((a, b) => a.priority - b.priority);
            const operation = operationQueueRef.current[0];

            // 如果是删除操作，确保清理掉相关任务
            if (operation.type === 'deleteWorkspace') {
                operationQueueRef.current = operationQueueRef.current.filter(op => 
                    op === operation || op.payload.flowId !== operation.payload.flowId || op.payload.newWorkspaceId !== operation.payload.flowId
                );
            }

            switch (operation.type) {
                case 'saveHistory':
                    const { flowId, json, timestamp } = operation.payload;
                    await addWorkspaceHistory(flowId, json, timestamp);
                    setWorkspaces(prev => prev.map(w => 
                        w.flowId === flowId 
                            ? { ...w, latestJson: json, isDirty: false }
                            : w
                    ));
                    break;
                case 'createWorkspace':
                    const { newWorkspaceId, newWorkspaceName } = operation.payload;
                    // console.log("createWorkspace!!!", newWorkspaceId, newWorkspaceName)
                    await createWorkspaceInDatabase(newWorkspaceId, newWorkspaceName, userId);
                    // if (newFlow) {
                    //     setWorkspaces(prev => prev.map(w => 
                    //         w.flowId === tempId ? {
                    //             flowId: newFlow.workspace_id,
                    //             flowTitle: newFlow.workspace_name,
                    //             latestJson: w.latestJson,
                    //             isDirty: w.isDirty
                    //         } : w
                    //     ));
                    // }
                    break;
                case 'deleteWorkspace':
                    await deleteWorkspaceInDatabase(operation.payload.flowId);
                    break;
                case 'updateWorkspaceName':
                    const { flowId: nameFlowId, newName } = operation.payload;
                    await updateWorkspaceNameInDatabase(nameFlowId, newName);
                    break;
            }
            
            operation.onComplete();
            operationQueueRef.current.shift();
        } catch (error) {
            console.error("Error processing operation:", error);
            operationQueueRef.current[0].onError?.();
        } finally {
            isProcessingRef.current = false;
            if (operationQueueRef.current.length > 0) {
                await processOperationQueue();
            }
        }
    };


     // 添加到操作队列
     const queueOperation = async (operation: Omit<QueueOperation, 'onComplete' | 'onError'>) => {
        
        
        return new Promise<void>((resolve, reject) => {
            // if (operation.type === 'createWorkspace' || operation.type === 'deleteWorkspace') {
            //     operationQueueRef.current.unshift({
            //         ...operation,
            //         onComplete: resolve,
            //         onError: reject
            //     });
            // }
            // else {
            //     operationQueueRef.current.push({
            //         ...operation,
            //         onComplete: resolve,
            //         onError: reject
            //     });
            // }
            operationQueueRef.current.push({
                ...operation,
                onComplete: resolve,
                onError: reject
            });
            processOperationQueue();
        });
    };


    // 修改现有的queueSave以使用新的队列系统, 默认优先级为3, 但是可以手动设置优先级 (forceSave priority = 1)
    const addSaveHistoryToQueue = async (flowId: string, json: any, priority: number = 3) => {
        return queueOperation({
            type: 'saveHistory',
            priority: priority,
            payload: {
                flowId,
                json,
                timestamp: moment().tz('Asia/Shanghai').format()
            }
        });
    };

    // 创建新的workspace 任务进入队列
    const addCreateWorkspaceToQueue = async (newWorkspaceId: string, newWorkspaceName: string) => {
        return queueOperation({
            type: 'createWorkspace',
            priority: 1,
            payload: { newWorkspaceId, newWorkspaceName }
        });
    };

    // 删除现有的workspace 任务进入队列
    const addDeleteWorkspaceToQueue = async (flowId: string) => {
        return queueOperation({
            type: 'deleteWorkspace',
            priority: 1,
            payload: { flowId }
        });
    };

    // 更新workspace的名称 任务进入队列
    const addUpdateWorkspaceNameToQueue = async (flowId: string, newName: string) => {
        return queueOperation({
            type: 'updateWorkspaceName',
            priority: 2,
            payload: { flowId, newName }
        });
    };

    // 初始化加载所有workspace数据
    useEffect(() => {
        const initializeWorkspaces = async () => {
            try {
                console.log("Starting workspace initialization...");
                
                const data = await initializeUserDataV2() as InitialUserData;
                console.log("Received initial data:", data);
                
                if (!data || !data.workspaces.length) {
                    console.log("No workspaces found");
                    return;
                }

                // 设置用户信息
                setUserId(data.user_id);
                setUserName(data.user_name);

                // 先设置基础工作区数据
                const initialWorkspaces = data.workspaces.map((workspace) => ({
                    flowId: workspace.workspace_id,
                    flowTitle: workspace.workspace_name,
                    latestJson: null,
                    deploy:{
                        selectedInputs:[],
                        selectedOutputs:[],
                        apiConfig:undefined
                    },
                    isDirty: false
                }));
                
                setWorkspaces(initialWorkspaces);

                // 设置第一个工作区为选中状态
                setSelectedFlowId(data.workspaces[0].workspace_id);

                // 并行获取所有工作区的历史记录
                const historyPromises = data.workspaces.map(async (workspace, index) => {
                    const latestHistory = await fetchLatestWorkspaceHistory(workspace.workspace_id);
                    
                    if (latestHistory) {
                        setWorkspaces(prevWorkspaces => {
                            const newWorkspaces = [...prevWorkspaces];
                            newWorkspaces[index] = {
                                ...newWorkspaces[index],
                                latestJson: latestHistory
                            };
                            // 如果是当前选中的工作区，立即更新显示
                            if (workspace.workspace_id === data.workspaces[0].workspace_id) {
                                updateFlowDisplay(latestHistory);
                            }
                            return newWorkspaces;
                        });
                    }
                });

                await Promise.all(historyPromises);
                console.log("All workspace histories fetched");

            } catch (error) {
                console.error("Error initializing workspaces:", error);
            }
        };

        initializeWorkspaces();
    }, []);

    // 添加一个更新显示的辅助函数
    const updateFlowDisplay = (history: any) => {
        if (history && history.blocks && history.edges) {
            reactFlowInstance.setNodes(history.blocks);
            reactFlowInstance.setEdges(history.edges);
        }
    };

    // 切换workspace
    const handleFlowSwitch = async (newFlowId: string | null) => {
        try {
            const targetWorkspace = workspaces.find(w => w.flowId === newFlowId);
            console.log("切换前的工作区状态:", {
                flowTitle: targetWorkspace?.flowTitle,
                isDirty: targetWorkspace?.isDirty,
                viewport: targetWorkspace?.viewport,
                hasLatestJson: !!targetWorkspace?.latestJson
            });
            
            // 1. 自动缓存当前工作区状态
            const prevFlowId = selectedFlowId;
            if (prevFlowId) {
                const currentWorkspace = workspaces.find(w => w.flowId === prevFlowId);
                console.log("缓存当前工作区状态:", currentWorkspace?.flowTitle);
                
                unsavedStatesRef.current[prevFlowId] = {
                    nodes: reactFlowInstance.getNodes(),
                    edges: reactFlowInstance.getEdges(),
                    viewport: reactFlowInstance.getViewport(),
                    timestamp: Date.now()
                };
            }

            // 2. 加载新工作区的数据
            if (newFlowId) {
                console.log("准备加载新工作区数据");
                const unsavedState = unsavedStatesRef.current[newFlowId];
                if (unsavedState) {
                    console.log("使用未保存的状态");
                    reactFlowInstance.setNodes(unsavedState.nodes);
                    reactFlowInstance.setEdges(unsavedState.edges);
                    if(unsavedState?.viewport !== undefined){
                        reactFlowInstance.setViewport(
                            unsavedState?.viewport
                        )
                    }
                } else {
                    const targetWorkspace = workspaces.find(w => w.flowId === newFlowId);
                    if (targetWorkspace?.latestJson) {
                        console.log("使用预加载的状态");
                        reactFlowInstance.setNodes(targetWorkspace.latestJson.blocks);
                        reactFlowInstance.setEdges(targetWorkspace.latestJson.edges);
                        if(targetWorkspace?.viewport !== undefined){
                            reactFlowInstance.setViewport(
                                targetWorkspace?.viewport
                            )
                        }
                    } else {
                        console.log("从服务器获取最新状态");
                        const latestHistory = await fetchLatestWorkspaceHistory(newFlowId);
                        if (latestHistory) {
                            reactFlowInstance.setNodes(latestHistory.blocks);
                            reactFlowInstance.setEdges(latestHistory.edges);
                            if(latestHistory?.viewport !== undefined){
                                reactFlowInstance.setViewport(
                                    latestHistory?.viewport
                                )
                            }
                            setWorkspaces(prev => prev.map(w => 
                                w.flowId === newFlowId 
                                    ? { ...w, latestJson: latestHistory }
                                    : w
                            ));
                        } else {
                            console.log("没有历史记录，清空画布");
                            reactFlowInstance.setNodes([]);
                            reactFlowInstance.setEdges([]);
                        }
                    }
                }
            } else {
                console.log("切换到空工作区");
                reactFlowInstance.setNodes([]);
                reactFlowInstance.setEdges([]);
            }

            // 3. 最后更新选中的工作区
            console.log("更新选中的工作区");
            setSelectedFlowId(newFlowId);
            
            // 加载完成后再次检查状态
            console.log("切换后的工作区状态:", {
                flowTitle: targetWorkspace?.flowTitle,
                isDirty: targetWorkspace?.isDirty,
                viewport: targetWorkspace?.viewport,
                hasLatestJson: !!targetWorkspace?.latestJson
            });
        } catch (error) {
            console.error("Error switching workspace:", error);
        }
    };

   

    // 若当前有选中的flow，则每秒检查一次是否有内容变化，有则标记为未保存状态
    useEffect(() => {
        if (!selectedFlowId) return;
        const saveWorkspaceInterval = setInterval(() => {
            const currentJson = constructWholeJsonWorkflow();
            const targetWorkspace = workspacesRef.current.find(w => w.flowId === selectedFlowId);
            if (targetWorkspace && !isJsonEqual(targetWorkspace.latestJson, currentJson)) {
                setWorkspaces(prev => prev.map(w => 
                    w.flowId === selectedFlowId 
                        ? { ...w, latestJson: currentJson, isDirty: true }
                        : w
                ));
            }
        }, 1000);

        // 定期保存机制，本身是5s，但是先comment掉，现在没有定期自动保存机制，只能手动保存或者在切换workspace时候自动保存了
        // const saveHistoryToDatabaseInterval = setInterval(() => {
        //     const workspace = workspacesRef.current.find(w => w.flowId === selectedFlowId);
            
        //     if (workspace?.isDirty) {
        //         console.log("auto save history to database!!")
        //         AutoUpdateWorkspaceData(selectedFlowId);
        //     }
        // }, 5000);


        return () => {
            clearInterval(saveWorkspaceInterval);
            // clearInterval(saveHistoryToDatabaseInterval);
        }
    }, [selectedFlowId]);

    useEffect(() => {
        // 将当前的workspaces数据存储到ref中，用于useEffect的quote
        workspacesRef.current = workspaces;
        // console.log("current workspaces:", workspacesRef.current, "current operationQueue:", operationQueueRef.current)
    }, [workspaces]);

     

    // 更新workspace数据 to database (for 定期保存)
    const AutoUpdateWorkspaceData = async (flowId: string) => {
        // const currentJson = constructWholeJsonWorkflow();

        if (isForceSaveRef.current) return;
        // console.log("AutoUpdateWorkspaceData", workspacesRef.current)
        const targetWorkspace = workspacesRef.current.find(w => w.flowId === flowId);
        // console.log("targetWorkspace history desired to be saved:", targetWorkspace)
        if (!targetWorkspace || targetWorkspace.isDirty === false) return;

        // if (!targetWorkspace || isJsonEqual(targetWorkspace.latestJson, currentJson)) return;

        // setWorkspaces(prev => prev.map(w => 
        //     w.flowId === flowId 
        //         ? { ...w, latestJson: currentJson, isDirty: true }
        //         : w
        // ));
        // await addSaveHistoryToQueue(flowId, currentJson);
        await addSaveHistoryToQueue(flowId, targetWorkspace.latestJson);
    };

    // 立即保存修改
    const forceSaveHistory = async (flowId: string) => {
        try {
            isForceSaveRef.current = true;
            const currentJson = constructWholeJsonWorkflow();
            // const targetWorkspace = workspaces.find(w => w.flowId === flowId);

            //使用当前时间作为时间戳，确保在队列中的任务时间戳更早
            const now = moment().tz('Asia/Shanghai'); 

            //清理掉所有未执行的、时间戳晚于当前时间的保存任务
            operationQueueRef.current = operationQueueRef.current.filter(op => 
                op.type !== 'saveHistory' || 
                moment.tz(op.payload.timestamp, 'Asia/Shanghai').isBefore(now)
            );

            // operationQueueRef.current = operationQueueRef.current.filter(op => 
            //     op.type !== 'saveHistory' || 
            //     op.payload.timestamp < currentTime
            // );

            // await addWorkspaceHistory(flowId, currentJson, currentTime);
            // setWorkspaces(prev => prev.map(w => 
            //     w.flowId === flowId 
            //         ? { ...w, latestJson: currentJson, isDirty: false }
            //         : w
            // ));
            await addSaveHistoryToQueue(flowId, currentJson, 1);    
        } catch (error) {
            console.error("Error force saving history:", error);
        } finally {
            isForceSaveRef.current = false;
        }
    };

    const addFlow = async () => {
        const newWorkspaceId = uuidv4();
        const newWorkspaceName = "Untitled Workspace";
        // 立即更新UI
        setWorkspaces(prev => [...prev, {
            flowId: newWorkspaceId,
            flowTitle: newWorkspaceName,
            latestJson: null,
            deploy:{
                selectedInputs:[],
                selectedOutputs:[]
            },
            isDirty: false
        }]);

        // 加入操作队列
        addCreateWorkspaceToQueue(newWorkspaceId, newWorkspaceName).catch(() => {
            // 失败时回滚
            setWorkspaces(prev => prev.filter(w => w.flowId !== newWorkspaceId));
        });
    }

    const removeFlow = async (flowId: string) => {
        const removedWorkspace = workspaces.find(w => w.flowId === flowId);
        setWorkspaces(prev => prev.filter(w => w.flowId !== flowId));
        if (selectedFlowId === flowId) {
            // 如果当前选中的flow被删除，则清空节点和边
            setSelectedFlowId(null);
            reactFlowInstance.setNodes([]);
            reactFlowInstance.setEdges([]);
        }

        if (removedWorkspace) {
            addDeleteWorkspaceToQueue(flowId).catch(() => {
                // 失败时回滚
                setWorkspaces(prev => [...prev, removedWorkspace]);
            });
        }
        
    }

    const editFlowName = async (flowId: string, newName: string) => {
        const oldName = workspaces.find(w => w.flowId === flowId)?.flowTitle;

        setWorkspaces(prev => prev.map(w => 
            w.flowId === flowId ? { ...w, flowTitle: newName } : w
        ))

        if (oldName) {
            addUpdateWorkspaceNameToQueue(flowId, newName).catch(() => {
                // 失败时回滚
                setWorkspaces(prev => prev.map(w => w.flowId === flowId ? { ...w, flowTitle: oldName } : w));
            });
        }
    }

    return {
        userId,
        userName,
        workspaces,
        selectedFlowId,
        handleFlowSwitch,
        addFlow,
        removeFlow,
        editFlowName,
        forceSaveHistory,
        setWorkspaces
        // ... 其他方法
    };
};

type providerType = {
    children?: ReactElement | null
}

export const FlowsPerUserContextProvider = ({children}: providerType): ReactElement => {
    return (
        <FlowsPerUserContext.Provider value={FlowsPerUserProps()}>
            {children}
        </FlowsPerUserContext.Provider>
        )
}


export const useFlowsPerUserContext = () => useContext(FlowsPerUserContext);
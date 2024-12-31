// This context is used to store all workflows per user

import React, { createContext, useContext, useState, ReactElement, useEffect} from "react";
import { Node, Edge } from "@xyflow/react";
import useManageUserWorkspacesUtils from '../hooks/useManageUserWorkSpacesUtils'
import useJsonConstructUtils from '../hooks/useJsonConstructUtils'
import { useReactFlow } from '@xyflow/react';
import { useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';

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

type WorkspaceData = {
    flowId: string;
    flowTitle: string;
    latestJson: {
        blocks: Node[];
        edges: Edge[];
    } | null;
    isDirty: boolean; // 标记是否有未保存的更改
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
}

const FlowsPerUserContext = createContext<FlowsPerUserContextType>(initialFlowsPerUserContext);


const FlowsPerUserProps = () => {
    const [userId, setUserId] = useState<string>("");
    const [userName, setUserName] = useState<string>("");
    const [workspaces, setWorkspaces] = useState<WorkspaceData[]>([]);
    const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
    const operationQueueRef = useRef<QueueOperation[]>([]);
    const isProcessingRef = useRef(false);
    const {createWorkspaceInDatabase, deleteWorkspaceInDatabase, updateWorkspaceNameInDatabase, addWorkspaceHistory, fetchLatestWorkspaceHistory, fetchUserId, fetchUserWorkspacesInfo, fetchUserName} = useManageUserWorkspacesUtils()
    const {constructWholeJsonWorkflow} = useJsonConstructUtils()
    const {setNodes, setEdges} = useReactFlow()
    const workspacesRef = useRef<WorkspaceData[]>([]); // 用于存储最新的workspace数据 for useEffect quote
    const isForceSaveRef = useRef(false);


    // 添加一个工具函数来比较JSON
    const isJsonEqual = (json1: any, json2: any): boolean => {
        if (!json1 || !json2) return json1 === json2;
        return JSON.stringify(json1) === JSON.stringify(json2);
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
                            ? { ...w, isDirty: json !== w.latestJson }
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

                // setNodes([])
                // setEdges([])

                // 1. 初始化用户信息
                const userId = await fetchUserId();
                const userName = await fetchUserName(userId);
                if (!userId) return;
                setUserId(userId);
                setUserName(userName as string);

                const workspacesInfo = await fetchUserWorkspacesInfo(userId);
                if (!workspacesInfo) return;

                // 并行加载所有workspace的最新数据
                const workspacesWithData = await Promise.all(
                    workspacesInfo.map(async (workspace) => {
                        const latestHistory = await fetchLatestWorkspaceHistory(workspace.workspace_id);
                        
                        return {
                            flowId: workspace.workspace_id,
                            flowTitle: workspace.workspace_name,
                            latestJson: latestHistory || null,
                            isDirty: false
                        };
                    })
                );

                setWorkspaces(workspacesWithData);
            } catch (error) {
                console.error("Error initializing workspaces:", error);
            }
        };

        initializeWorkspaces();
    }, []);

    // 切换workspace
    const handleFlowSwitch = async (newFlowId: string | null) => {
        try {
            // 1. 如果当前有选中的flow，等待保存完成
            // if (selectedFlowId) {
            //     // await updateWorkspaceData(selectedFlowId);
            //     await forceSaveHistory(selectedFlowId);
            // } 
    
            // 2. 切换到新的flow
            if (!newFlowId) {
                setSelectedFlowId(null);
                setNodes([]);
                setEdges([]);
                return;
            }
    
            // 3. 加载新workspace数据
            const workspace = workspaces.find(w => w.flowId === newFlowId);
            if (workspace?.latestJson) {
                setNodes(workspace.latestJson.blocks);
                setEdges(workspace.latestJson.edges);
            } else {
                setNodes([]);
                setEdges([]);
            }
            setSelectedFlowId(newFlowId);
        } catch (error) {
            console.error("Error switching workspace:", error);
        }
    };

   

    // 若是当前有选中的flow，则定期保存修改（若是有修改)，就是每秒check一下
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

     

    // 定期保存修改
    // useEffect(() => {
    //     if (!selectedFlowId) return;

    //     const saveInterval = setInterval(() => {
    //         const workspace = workspaces.find(w => w.flowId === selectedFlowId);
    //         if (workspace?.isDirty) {
    //             updateWorkspaceData(selectedFlowId);
    //         }
    //     }, 5000);

    //     return () => clearInterval(saveInterval);
    // }, [selectedFlowId, workspaces]);



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
            const targetWorkspace = workspaces.find(w => w.flowId === flowId);
            if (!targetWorkspace || isJsonEqual(targetWorkspace.latestJson, currentJson) && targetWorkspace.isDirty === false) return;

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
            setNodes([])
            setEdges([])
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
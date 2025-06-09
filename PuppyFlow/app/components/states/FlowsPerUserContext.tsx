// This context is used to store all workflows per user

import React, { createContext, useContext, useState, ReactElement, useEffect, useCallback } from "react";
import { Node, Edge } from "@xyflow/react";
import useManageUserWorkspacesUtils from '../hooks/useManageUserWorkSpacesUtils'
import useJsonConstructUtils from '../hooks/useJsonConstructUtils'
import { useReactFlow } from '@xyflow/react';
import { useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';
import { useAppSettings } from './AppSettingsContext';

interface InitialUserData {
    user_id: string;
    user_name: string;
    workspaces: {
        workspace_id: string;
        workspace_name: string;
    }[];
    workspace_history: any;
}


// 1. 首先定义视口类型
type Viewport = {
    x: number;
    y: number;
    zoom: number;
}

// 2. 定义工作区内容的基础类型
type WorkspaceContent = {
    blocks: Node[];
    edges: Edge[];
    viewport: Viewport;
    version: string;
}

// 3. 基于 WorkspaceContent 定义 WorkspaceData
type WorkspaceData = {
    flowId: string;
    flowTitle: string;
    latestJson: WorkspaceContent | null;
    isDirty: boolean;
}

export type FlowsPerUserContextType = {
    userId: string;
    userName: string;
    workspaces: WorkspaceData[];
    selectedFlowId: string | null;
    handleFlowSwitch: (newFlowId: string | null) => Promise<void>;
    addFlow: () => Promise<void>;
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
    setWorkspaces: () => { },
}

const FlowsPerUserContext = createContext<FlowsPerUserContextType>(initialFlowsPerUserContext);


const FlowsPerUserProps = () => {
    const [userId, setUserId] = useState<string>("");
    const [userName, setUserName] = useState<string>("");
    const [workspaces, setWorkspaces] = useState<WorkspaceData[]>([]);
    const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
    const operationQueueRef = useRef<QueueOperation[]>([]);
    const isProcessingRef = useRef(false);
    const { createWorkspaceInDatabase, deleteWorkspaceInDatabase, updateWorkspaceNameInDatabase, addWorkspaceHistory, fetchLatestWorkspaceHistory, fetchUserId, fetchUserWorkspacesInfo, fetchUserName, initializeUserDataV2 } = useManageUserWorkspacesUtils()
    const { constructWholeJsonWorkflow } = useJsonConstructUtils()
    const reactFlowInstance = useReactFlow()
    const workspacesRef = useRef<WorkspaceData[]>([]); // 用于存储最新的workspace数据 for useEffect quote
    const isForceSaveRef = useRef(false);
    const dirtyWorkspacesRef = useRef<Set<string>>(new Set());

    // 添加一个 ref 来存储未保存的状态
    const unsavedStatesRef = useRef<Record<string, {
        nodes: Node[];
        edges: Edge[];
        viewport: {
            x: number,
            y: number,
            zoom: number
        };
        timestamp: number;
    }>>({});

    // 3. 使用这个类型来定义 state
    const [currentWorkspaceContent, setCurrentWorkspaceContent] = useState<WorkspaceContent | null>(null);

    // 获取部署类型
    const { isLocalDeployment } = useAppSettings();

    // 添加本地保存相关函数
    const saveToLocalFile = async (flowId: string, json: any, timestamp: string) => {
        try {
            const response = await fetch('/api/workspace', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ flowId, json, timestamp }),
            });

            if (!response.ok) {
                throw new Error('Failed to save workspace');
            }

            return true;
        } catch (error) {
            console.error("Error saving to local file:", error);
            throw error;
        }
    };

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
                    const { flowId, json, timestamp, isLocal } = operation.payload;
                    if (isLocal) {
                        // 本地保存逻辑
                        await saveToLocalFile(flowId, json, timestamp);
                    } else {
                        // 现有的云端保存逻辑
                        await addWorkspaceHistory(flowId, json, timestamp);
                    }
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
                timestamp: moment().tz('Asia/Shanghai').format(),
                isLocal: isLocalDeployment
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

    // 🔥 优化：添加工作区更新的回调函数，减少重复代码
    const updateWorkspaceHistory = useCallback((index: number, workspaceId: string, history: any) => {
        setWorkspaces(prevWorkspaces => {
            // 检查是否真的需要更新，避免不必要的重渲染
            if (prevWorkspaces[index]?.latestJson === history) {
                return prevWorkspaces; // 返回相同引用，避免重渲染
            }
            
            const newWorkspaces = [...prevWorkspaces];
            if (newWorkspaces[index]) {
                newWorkspaces[index] = {
                    ...newWorkspaces[index],
                    latestJson: history
                };
            }
            return newWorkspaces;
        });
    }, []);

    // 🔥 可选：并发限制版本 - 适用于工作区数量很多的情况
    const fetchWorkspaceHistoriesWithLimit = useCallback(async (
        workspaces: Array<{workspace_id: string, workspace_name: string}>, 
        concurrencyLimit: number = 5
    ) => {
        const results: Array<{
            success: boolean;
            workspaceId: string;
            workspaceName: string;
            hasHistory?: boolean;
            error?: string;
            duration: number;
        }> = [];
        
        let completedCount = 0;
        let successCount = 0;
        const totalCount = workspaces.length;
        let firstWorkspaceLoaded = false;
        
        // 分批处理
        for (let i = 0; i < workspaces.length; i += concurrencyLimit) {
            const batch = workspaces.slice(i, i + concurrencyLimit);
            console.log(`🔄 处理批次 ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(workspaces.length / concurrencyLimit)}，包含 ${batch.length} 个工作区`);
            
            const batchPromises = batch.map(async (workspace, batchIndex) => {
                const actualIndex = i + batchIndex;
                const singleStartTime = performance.now();
                
                try {
                    const latestHistory = await fetchLatestWorkspaceHistory(
                        workspace.workspace_id, 
                        isLocalDeployment
                    );
                    
                    const singleEndTime = performance.now();
                    completedCount++;
                    
                    if (latestHistory) {
                        successCount++;
                        console.log(
                            `✅ [${completedCount}/${totalCount}] 工作区 "${workspace.workspace_name}" 获取成功，耗时: ${(singleEndTime - singleStartTime).toFixed(2)}ms`
                        );

                        // 立即更新状态
                        updateWorkspaceHistory(actualIndex, workspace.workspace_id, latestHistory);

                        // 如果是第一个工作区且还没有加载过，立即更新显示
                        if (actualIndex === 0 && !firstWorkspaceLoaded) {
                            firstWorkspaceLoaded = true;
                            console.log("🎯 更新第一个工作区显示");
                            updateFlowDisplay(latestHistory);
                        }
                    } else {
                        console.log(
                            `⚠️ [${completedCount}/${totalCount}] 工作区 "${workspace.workspace_name}" 无历史记录，耗时: ${(singleEndTime - singleStartTime).toFixed(2)}ms`
                        );
                    }

                    return {
                        success: true,
                        workspaceId: workspace.workspace_id,
                        workspaceName: workspace.workspace_name,
                        hasHistory: !!latestHistory,
                        duration: singleEndTime - singleStartTime
                    };
                } catch (error) {
                    const singleEndTime = performance.now();
                    completedCount++;
                    
                    console.error(
                        `❌ [${completedCount}/${totalCount}] 工作区 "${workspace.workspace_name}" 获取失败，耗时: ${(singleEndTime - singleStartTime).toFixed(2)}ms`, 
                        error
                    );
                    
                    return {
                        success: false,
                        workspaceId: workspace.workspace_id,
                        workspaceName: workspace.workspace_name,
                        error: error instanceof Error ? error.message : String(error),
                        duration: singleEndTime - singleStartTime
                    };
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // 可选：添加批次间的小延迟，避免服务器压力过大
            if (i + concurrencyLimit < workspaces.length) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        return results;
    }, [updateWorkspaceHistory, isLocalDeployment]);

    // 修改初始化加载工作区数据的部分 - 优化版本
    useEffect(() => {
        const initializeWorkspaces = async () => {
            try {
                console.log("🚀 开始工作区初始化...");
                const totalStartTime = performance.now();

                // 1. 获取基础数据
                const dataStartTime = performance.now();
                const data = await initializeUserDataV2() as InitialUserData;
                const dataEndTime = performance.now();
                console.log(`📊 基础数据获取耗时: ${(dataEndTime - dataStartTime).toFixed(2)}ms`);

                if (!data || !data.workspaces.length) {
                    console.log("❌ 没有找到工作区");
                    return;
                }

                // 2. 设置用户信息和基础工作区数据
                const setupStartTime = performance.now();
                setUserId(data.user_id);
                setUserName(data.user_name);

                const initialWorkspaces = data.workspaces.map((workspace) => ({
                    flowId: workspace.workspace_id,
                    flowTitle: workspace.workspace_name,
                    latestJson: null,
                    isDirty: false
                }));

                setWorkspaces(initialWorkspaces);
                setSelectedFlowId(data.workspaces[0].workspace_id);
                const setupEndTime = performance.now();
                console.log(`🔧 基础设置耗时: ${(setupEndTime - setupStartTime).toFixed(2)}ms`);

                // 3. 🔥 优化：真正的并发流式更新 - 每个请求返回后立即更新
                console.log(`🔄 开始并发获取 ${data.workspaces.length} 个工作区的历史记录...`);
                const historyStartTime = performance.now();
                
                // 🔧 配置选项：根据工作区数量选择策略
                const CONCURRENCY_THRESHOLD = 10; // 超过10个工作区时使用限制并发
                const CONCURRENCY_LIMIT = 5; // 并发限制数量
                const useLimitedConcurrency = data.workspaces.length > CONCURRENCY_THRESHOLD;
                
                let results: Array<{
                    success: boolean;
                    workspaceId: string;
                    workspaceName: string;
                    hasHistory?: boolean;
                    error?: string;
                    duration: number;
                }>;

                if (useLimitedConcurrency) {
                    console.log(`📊 工作区数量 (${data.workspaces.length}) 超过阈值 (${CONCURRENCY_THRESHOLD})，使用限制并发模式 (${CONCURRENCY_LIMIT})`);
                    results = await fetchWorkspaceHistoriesWithLimit(data.workspaces, CONCURRENCY_LIMIT);
                } else {
                    console.log(`📊 工作区数量 (${data.workspaces.length}) 较少，使用完全并发模式`);
                    
                    let completedCount = 0;
                    let successCount = 0;
                    const totalCount = data.workspaces.length;
                    let firstWorkspaceLoaded = false;

                    // 创建所有并发请求，每个完成后立即更新状态
                    const historyPromises = data.workspaces.map(async (workspace, index) => {
                        const singleStartTime = performance.now();
                        
                        try {
                            const latestHistory = await fetchLatestWorkspaceHistory(
                                workspace.workspace_id, 
                                isLocalDeployment
                            );
                            
                            const singleEndTime = performance.now();
                            completedCount++;
                            
                            if (latestHistory) {
                                successCount++;
                                console.log(
                                    `✅ [${completedCount}/${totalCount}] 工作区 "${workspace.workspace_name}" 获取成功，耗时: ${(singleEndTime - singleStartTime).toFixed(2)}ms`
                                );

                                // 🔥 立即更新状态，不等待其他请求
                                updateWorkspaceHistory(index, workspace.workspace_id, latestHistory);

                                // 如果是第一个工作区且还没有加载过，立即更新显示
                                if (workspace.workspace_id === data.workspaces[0].workspace_id && !firstWorkspaceLoaded) {
                                    firstWorkspaceLoaded = true;
                                    console.log("🎯 更新第一个工作区显示");
                                    updateFlowDisplay(latestHistory);
                                }
                            } else {
                                console.log(
                                    `⚠️ [${completedCount}/${totalCount}] 工作区 "${workspace.workspace_name}" 无历史记录，耗时: ${(singleEndTime - singleStartTime).toFixed(2)}ms`
                                );
                            }

                            return { 
                                success: true, 
                                workspaceId: workspace.workspace_id, 
                                workspaceName: workspace.workspace_name,
                                hasHistory: !!latestHistory,
                                duration: singleEndTime - singleStartTime
                            };
                            
                        } catch (error) {
                            const singleEndTime = performance.now();
                            completedCount++;
                            
                            console.error(
                                `❌ [${completedCount}/${totalCount}] 工作区 "${workspace.workspace_name}" 获取失败，耗时: ${(singleEndTime - singleStartTime).toFixed(2)}ms`, 
                                error
                            );
                            
                            return { 
                                success: false, 
                                workspaceId: workspace.workspace_id, 
                                workspaceName: workspace.workspace_name,
                                error: error instanceof Error ? error.message : String(error),
                                duration: singleEndTime - singleStartTime
                            };
                        }
                    });

                    // 等待所有请求完成
                    results = await Promise.all(historyPromises);
                }
                
                const historyEndTime = performance.now();
                const totalHistoryTime = historyEndTime - historyStartTime;
                const avgTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
                const maxTime = Math.max(...results.map(r => r.duration));
                const minTime = Math.min(...results.map(r => r.duration));

                // 统计信息
                const successCount = results.filter(r => r.success).length;
                const failedWorkspaces = results.filter(r => !r.success);
                const workspacesWithHistory = results.filter(r => r.success && r.hasHistory).length;
                
                console.log(`🎉 工作区历史记录获取完成！`);
                console.log(`📈 统计信息:`);
                console.log(`   - 成功: ${successCount}/${results.length}`);
                console.log(`   - 有历史记录: ${workspacesWithHistory}/${results.length}`);
                console.log(`   - 总耗时: ${totalHistoryTime.toFixed(2)}ms`);
                console.log(`   - 平均耗时: ${avgTime.toFixed(2)}ms`);
                console.log(`   - 最快: ${minTime.toFixed(2)}ms`);
                console.log(`   - 最慢: ${maxTime.toFixed(2)}ms`);
                
                if (failedWorkspaces.length > 0) {
                    console.warn(`⚠️ 失败的工作区:`, failedWorkspaces.map(w => w.workspaceName));
                }

                const totalEndTime = performance.now();
                console.log(`🏁 工作区初始化完成，总耗时: ${(totalEndTime - totalStartTime).toFixed(2)}ms`);

            } catch (error) {
                console.error("💥 工作区初始化失败:", error);
                // 即使初始化失败，也要确保基本的UI状态
                setWorkspaces([]);
                setSelectedFlowId(null);
            }
        };

        initializeWorkspaces();
    }, [updateWorkspaceHistory, isLocalDeployment]); // 添加依赖项

    // 添加一个更新显示的辅助函数
    const updateFlowDisplay = (history: any) => {
        if (history && history.blocks && history.edges) {
            reactFlowInstance.setNodes(history.blocks);
            reactFlowInstance.setEdges(history.edges);
        }
        if (history.viewport) {
            console.log("set viewport", history.viewport)
            setTimeout(() => {
                reactFlowInstance.setViewport(history.viewport)
            }, 0)
        }
    };

    // 切换workspace
    const handleFlowSwitch = async (newFlowId: string | null) => {
        let currentNodes = reactFlowInstance.getNodes();
        let currentEdges = reactFlowInstance.getEdges();

        try {
            const targetWorkspace = workspaces.find(w => w.flowId === newFlowId);
            console.log("new flow id:", newFlowId)
            console.log("切换前的flow:", {
                nodes: reactFlowInstance.getNodes(),
                edges: reactFlowInstance.getEdges(),
                viewport: reactFlowInstance.getViewport()
            });
            console.log("切换前的全部工作区:", workspaces);
            console.log("切换前的工作区状态:", {
                flowTitle: targetWorkspace?.flowTitle,
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

                console.log("缓存后缓存状态:", unsavedStatesRef.current);
            }

            // 2. 加载新工作区的数据
            if (newFlowId) {
                console.log("准备加载新工作区数据", unsavedStatesRef.current);
                const unsavedState = unsavedStatesRef.current[newFlowId];
                if (unsavedState) {
                    console.log("准备加载新工作区数据from unsaved", unsavedStatesRef.current);
                    console.log("使用未保存的状态", unsavedStatesRef.current[newFlowId]);
                    console.log("使用未保存的状态的nodes", unsavedState.nodes);
                    console.log("使用未保存的状态的edges", unsavedState.edges);
                    reactFlowInstance.setNodes(unsavedState.nodes);
                    reactFlowInstance.setEdges(unsavedState.edges);
                    if (unsavedState?.viewport !== undefined) {
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
                        if (targetWorkspace?.latestJson?.viewport !== undefined) {
                            reactFlowInstance.setViewport(
                                targetWorkspace?.latestJson?.viewport
                            )
                        }
                    } else {
                        console.log("从服务器获取最新状态");
                        const latestHistory = await fetchLatestWorkspaceHistory(newFlowId, isLocalDeployment);
                        if (latestHistory) {
                            reactFlowInstance.setNodes(latestHistory.blocks);
                            reactFlowInstance.setEdges(latestHistory.edges);
                            if (latestHistory?.viewport !== undefined) {
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
                            // Or try this more direct approach
                            reactFlowInstance.deleteElements({ nodes: reactFlowInstance.getNodes(), edges: reactFlowInstance.getEdges() });
                            reactFlowInstance.setNodes([]);
                            reactFlowInstance.setEdges([]);
                            // reactFlowInstance.setViewport({ x: 0, y: 0, zoom: 1 });


                            // Check again after a small delay
                            setTimeout(() => {
                                console.log("Nodes after timeout:", reactFlowInstance.getNodes());
                                console.log("edges after timeout:", reactFlowInstance.getEdges());
                            }, 100);
                        }
                    }
                }
            } else {
                console.log("切换到空工作区");
                reactFlowInstance.deleteElements({ nodes: reactFlowInstance.getNodes(), edges: reactFlowInstance.getEdges() });
                reactFlowInstance.setNodes([]);
                reactFlowInstance.setEdges([]);
                // reactFlowInstance.setViewport({ x: 0, y: 0, zoom: 1 });
            }

            // 3. 最后更新选中的工作区
            console.log("currentNodes", currentNodes)
            console.log("currentEdges", currentEdges)
            if (currentNodes.length !== 0 || currentEdges.length !== 0) {
                while (currentNodes === reactFlowInstance.getNodes() || currentEdges === reactFlowInstance.getEdges()) {

                    console.log("等待加载完成")

                }
            }
            console.log("更新选中的工作区");
            setSelectedFlowId(newFlowId);

            // 加载完成后再次检查状态
            console.log("切换后的全部工作区:", workspaces);
            console.log("切换后的工作区状态:", {
                flowTitle: targetWorkspace?.flowTitle,
                hasLatestJson: !!targetWorkspace?.latestJson
            });
            console.log("切换后的flow:", {
                nodes: reactFlowInstance.getNodes(),
                edges: reactFlowInstance.getEdges(),
                viewport: reactFlowInstance.getViewport()
            });
        } catch (error) {
            console.error("Error switching workspace:", error);
        }
    };

    useEffect(() => {
        if (!selectedFlowId) return;
        
        // 获取当前工作区的内容 - 初始加载时执行一次
        const currentJson = constructWholeJsonWorkflow();
        setCurrentWorkspaceContent(currentJson);
        
    }, [selectedFlowId]); // 只在selectedFlowId变化时执行

    useEffect(() => {
        if (!selectedFlowId || !currentWorkspaceContent) return;
        
        const targetWorkspace = workspacesRef.current.find(w => w.flowId === selectedFlowId);
        if (targetWorkspace && !isJsonEqual(targetWorkspace.latestJson, currentWorkspaceContent)) {
            setWorkspaces(prev => prev.map(w => {
                if (w.flowId === selectedFlowId) {
                    return { ...w, latestJson: currentWorkspaceContent, isDirty: true };
                }
                return w;
            }));
        }
    }, [currentWorkspaceContent, selectedFlowId]);

    useEffect(() => {
        // 将当前的workspaces数据存储到ref中，用于useEffect的quote
        workspacesRef.current = workspaces;
        // console.log("current workspaces:", workspacesRef.current, "current operationQueue:", operationQueueRef.current)
    }, [workspaces]);



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

        // 使用提供的JSON作为初始模板，并确保类型正确
        const templateJson = {
            "blocks": [
                {
                    "id": "llmnew-1747135937293",
                    "type": "llmnew",
                    "position": {
                        "x": 0,
                        "y": 0
                    },
                    "data": {
                        "subMenuType": null,
                        "content": [
                            {
                                "role": "system",
                                "content": "You are PuppyAgent, an AI that helps answer people's questions."
                            },
                            {
                                "role": "user",
                                "content": "Answer the question: {{Text1}}"
                            }
                        ],
                        "model": "anthropic/claude-3.5-haiku",
                        "base_url": "",
                        "structured_output": false,
                        "max_tokens": 4096
                    },
                    "measured": {
                        "width": 80,
                        "height": 48
                    },
                    "selected": false,
                    "dragging": false
                },
                {
                    "id": "8vCBOi",
                    "position": {
                        "x": 160,
                        "y": -64
                    },
                    "data": {
                        "content": "Hi! I'm PuppyAgent, an AI assistant ready to help you.",
                        "label": "Text2",
                        "isLoading": false,
                        "locked": false,
                        "isInput": false,
                        "isOutput": true,
                        "editable": false
                    },
                    "type": "text",
                    "measured": {
                        "width": 240,
                        "height": 176
                    },
                    "selected": false,
                    "dragging": false,
                    "width": 240,
                    "height": 176,
                    "resizing": false
                },
                {
                    "id": "Lm-PbX",
                    "position": {
                        "x": -320,
                        "y": -64
                    },
                    "data": {
                        "content": "Introduce yourself within 10 words",
                        "label": "Text1",
                        "isLoading": false,
                        "locked": false,
                        "isInput": true,
                        "isOutput": false,
                        "editable": false
                    },
                    "type": "text",
                    "measured": {
                        "width": 240,
                        "height": 176
                    },
                    "selected": false,
                    "dragging": false,
                    "width": 240,
                    "height": 176,
                    "resizing": false
                }
            ],
            "edges": [
                {
                    "id": "connection-1747135937303",
                    "source": "Lm-PbX",
                    "target": "llmnew-1747135937293",
                    "type": "floating"
                },
                {
                    "source": "llmnew-1747135937293",
                    "sourceHandle": "llmnew-1747135937293-b",
                    "target": "8vCBOi",
                    "targetHandle": "8vCBOi-d",
                    "id": "connection-1747135941560",
                    "type": "floating",
                    "data": {
                        "connectionType": "CTT"
                    }
                }
            ],
            "viewport": {
                "x": 516.625,
                "y": 369,
                "zoom": 1
            },
            "version": "1.0.0"
        }

        // 立即更新UI，使用模板JSON并进行类型转换
        setWorkspaces(prev => [...prev, {
            flowId: newWorkspaceId,
            flowTitle: newWorkspaceName,
            latestJson: templateJson as any, // 使用类型断言绕过类型检查
            isDirty: true  // 添加这个字段
        }]);

        // 加入操作队列
        addCreateWorkspaceToQueue(newWorkspaceId, newWorkspaceName).catch(() => {
            // 失败时回滚
            setWorkspaces(prev => prev.filter(w => w.flowId !== newWorkspaceId));
        });

        // 如果当前没有选中的flow，自动选中新创建的flow
        if (!selectedFlowId) {
            await handleFlowSwitch(newWorkspaceId);
        }
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

export const FlowsPerUserContextProvider = ({ children }: providerType): ReactElement => {
    return (
        <FlowsPerUserContext.Provider value={FlowsPerUserProps()}>
            {children}
        </FlowsPerUserContext.Provider>
    )
}


export const useFlowsPerUserContext = () => useContext(FlowsPerUserContext);
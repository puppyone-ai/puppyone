/**
 * WorkspacesContext - User Workspace Management Context
 * 
 * This context manages workspace state only, without any API calls or hooks.
 * It provides a centralized state management for:
 * 
 * 1. Workspace list with metadata (pull/push status, showing status)
 * 2. Selected workspace tracking
 * 3. Current workspace JSON content
 * 4. User information
 */

import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useWorkspaceInitialization } from '../hooks/useWorkspaceInitialization';
import { Node, Edge } from "@xyflow/react";

// 基础类型定义
export type WorkspaceJSON = {
    blocks: Node[];
    edges: Edge[];
    viewport?: {
        x: number;
        y: number;
        zoom: number;
    };
    version?: string;
}

// 重新导出 WorkspaceInfo 类型以保持兼容性

export type WorkspaceInfo = {
    workspace_id: string;
    workspace_name: string;
    content: WorkspaceJSON | null;
    pullFromDatabase: boolean;
    pushToDatabase: boolean;
}

export type ServerInfo = {
    // 服务器相关信息，根据需要扩展
    [key: string]: any;
}

// 显示状态管理 - 可以是工作区或服务器
export type ShowingItem = {
    type: 'workspace' | 'server';
    id: string;
    name: string;
}

// Context 类型定义
type WorkspacesContextType = {
    // 基础状态
    userId: string;
    userName: string;
    workspaces: WorkspaceInfo[];
    servers: ServerInfo[];
    currentWorkspaceJson: WorkspaceJSON | null;
    
    // 显示状态管理
    showingItem: ShowingItem | null;
    
    // 初始化状态
    isInitialized: boolean;
    isLoading: boolean;
    initializationError: string | null;
    
    // 基础操作 - 纯状态更新，不涉及 API 调用
    setWorkspaces: (workspaces: WorkspaceInfo[]) => void;
    setCurrentWorkspaceJson: (json: WorkspaceJSON | null) => void;
    setUserId: (id: string) => void;
    setUserName: (name: string) => void;
    setServers: (servers: ServerInfo[]) => void;
    
    // 显示状态操作
    setShowingItem: (item: ShowingItem | null) => void;
    setShowingWorkspace: (workspaceId: string) => void;
    setShowingServer: (serverId: string) => void;
    clearShowing: () => void;
    
    // 工作区操作
    addWorkspace: (workspace: WorkspaceInfo) => void;
    removeWorkspace: (workspaceId: string) => void;
    updateWorkspace: (workspaceId: string, updates: Partial<WorkspaceInfo>) => void;
    
    // 工作区内容操作
    updateWorkspaceContent: (workspaceId: string, content: WorkspaceJSON) => void;
    markWorkspaceAsPulled: (workspaceId: string) => void;
    markWorkspaceForPush: (workspaceId: string, needsPush: boolean) => void;
    
    // 工具方法
    getWorkspaceById: (id: string) => WorkspaceInfo | undefined;
    getCurrentWorkspace: () => WorkspaceInfo | undefined;
    createEmptyWorkspace: (id: string, name: string) => WorkspaceInfo;
    getServerById: (id: string) => ServerInfo | undefined;
    isWorkspaceShowing: (workspaceId: string) => boolean;
    isServerShowing: (serverId: string) => boolean;
    
    // 初始化方法
    reinitialize: () => Promise<void>;
    
    // Hook 访问 - 通过初始化 hook 暴露统一的工作区管理
    workspaceManagement: ReturnType<typeof useWorkspaceInitialization>['workspaceManagement'];
};

const WorkspacesContext = createContext<WorkspacesContextType | undefined>(undefined);

// Provider 组件
export const WorkspacesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // 基础状态
    const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
    const [currentWorkspaceJson, setCurrentWorkspaceJson] = useState<WorkspaceJSON | null>(null);
    const [userId, setUserId] = useState<string>("");
    const [userName, setUserName] = useState<string>("");
    const [servers, setServers] = useState<ServerInfo[]>([]);
    
    // 显示状态管理
    const [showingItem, setShowingItem] = useState<ShowingItem | null>(null);

    // 使用初始化 hook
    const initialization = useWorkspaceInitialization();

    // 初始化逻辑 - 现在完全通过 hook 处理
    useEffect(() => {
        const performInitialization = async () => {
            if (initialization.isInitialized) return;
            
            const result = await initialization.initializeAllData();
            
            if (result) {
                // 更新 Context 状态
                setUserId(result.userId);
                setUserName(result.userName);
                setWorkspaces(result.workspaces);
                
                if (result.defaultWorkspace) {
                    setShowingItem({
                        type: 'workspace',
                        id: result.defaultWorkspace.workspace_id,
                        name: result.defaultWorkspace.workspace_name
                    });
                    setCurrentWorkspaceJson(result.defaultWorkspaceContent);
                }
            }
        };

        performInitialization();
    }, []);

    // 重新初始化方法
    const reinitialize = async () => {
        initialization.resetInitialization();
        const result = await initialization.initializeAllData();
        
        if (result) {
            setUserId(result.userId);
            setUserName(result.userName);
            setWorkspaces(result.workspaces);
            
            if (result.defaultWorkspace) {
                setShowingItem({
                    type: 'workspace',
                    id: result.defaultWorkspace.workspace_id,
                    name: result.defaultWorkspace.workspace_name
                });
                // 现在类型是安全的
                setCurrentWorkspaceJson(result.defaultWorkspaceContent);
            }
        }
    };

    // 根据 ID 获取工作区
    const getWorkspaceById = (id: string): WorkspaceInfo | undefined => {
        return workspaces.find(w => w.workspace_id === id);
    };

    // 根据 ID 获取服务器
    const getServerById = (id: string): ServerInfo | undefined => {
        return servers.find(s => s.id === id);
    };

    // 获取当前选中的工作区
    const getCurrentWorkspace = (): WorkspaceInfo | undefined => {
        if (!showingItem || showingItem.type !== 'workspace') return undefined;
        return getWorkspaceById(showingItem.id);
    };

    // 创建空的工作区对象
    const createEmptyWorkspace = (id: string, name: string): WorkspaceInfo => {
        return {
            workspace_id: id,
            workspace_name: name,
            content: null,
            pullFromDatabase: false,
            pushToDatabase: false,
        };
    };

    // 简化的显示工作区方法 - 只负责状态更新
    const setShowingWorkspace = (workspaceId: string) => {
        const workspace = getWorkspaceById(workspaceId);
        if (workspace) {
            setShowingItem({
                type: 'workspace',
                id: workspaceId,
                name: workspace.workspace_name
            });
            // 同步更新当前工作区内容
            setCurrentWorkspaceJson(workspace.content);
        }
    };

    const setShowingServer = (serverId: string) => {
        const server = getServerById(serverId);
        if (server) {
            setShowingItem({
                type: 'server',
                id: serverId,
                name: server.name || serverId
            });
        }
    };

    const clearShowing = () => {
        setShowingItem(null);
        setCurrentWorkspaceJson(null);
    };

    // 判断工作区是否正在显示
    const isWorkspaceShowing = (workspaceId: string): boolean => {
        return showingItem?.type === 'workspace' && showingItem.id === workspaceId;
    };

    // 判断服务器是否正在显示
    const isServerShowing = (serverId: string): boolean => {
        return showingItem?.type === 'server' && showingItem.id === serverId;
    };

    // 添加工作区
    const addWorkspace = (workspace: WorkspaceInfo) => {
        setWorkspaces(prev => [...prev, workspace]);
    };

    // 移除工作区
    const removeWorkspace = (workspaceId: string) => {
        setWorkspaces(prev => prev.filter(w => w.workspace_id !== workspaceId));
        
        // 如果删除的是当前显示的工作区，清空显示状态和当前JSON
        if (isWorkspaceShowing(workspaceId)) {
            clearShowing();
        }
    };

    // 更新工作区信息
    const updateWorkspace = (workspaceId: string, updates: Partial<WorkspaceInfo>) => {
        setWorkspaces(prev => prev.map(w => 
            w.workspace_id === workspaceId 
                ? { ...w, ...updates }
                : w
        ));
        
        // 如果更新的是当前显示的工作区，同步更新当前 JSON
        if (isWorkspaceShowing(workspaceId) && updates.content !== undefined) {
            setCurrentWorkspaceJson(updates.content);
        }
        
        // 如果更新的是当前显示的工作区名称，同步更新显示项
        if (isWorkspaceShowing(workspaceId) && updates.workspace_name) {
            setShowingItem(prev => prev ? {
                ...prev,
                name: updates.workspace_name!
            } : null);
        }
    };

    // 更新工作区内容
    const updateWorkspaceContent = (workspaceId: string, content: WorkspaceJSON) => {
        updateWorkspace(workspaceId, { 
            content, 
            pushToDatabase: true
        });
    };

    // 标记工作区已从数据库拉取
    const markWorkspaceAsPulled = (workspaceId: string) => {
        updateWorkspace(workspaceId, { pullFromDatabase: true });
    };

    // 标记工作区是否需要推送到数据库
    const markWorkspaceForPush = (workspaceId: string, needsPush: boolean) => {
        updateWorkspace(workspaceId, { pushToDatabase: needsPush });
    };

    const contextValue: WorkspacesContextType = {
        // 状态
        workspaces,
        currentWorkspaceJson,
        userId,
        userName,
        servers,
        showingItem,
        
        // 初始化状态
        isInitialized: initialization.isInitialized,
        isLoading: initialization.isLoading,
        initializationError: initialization.error,
        
        // 基础操作
        setWorkspaces,
        setCurrentWorkspaceJson,
        setUserId,
        setUserName,
        setServers,
        
        // 显示状态操作
        setShowingItem,
        setShowingWorkspace,
        setShowingServer,
        clearShowing,
        
        // 工作区操作
        addWorkspace,
        removeWorkspace,
        updateWorkspace,
        
        // 工作区内容操作
        updateWorkspaceContent,
        markWorkspaceAsPulled,
        markWorkspaceForPush,
        
        // 工具方法
        getWorkspaceById,
        getCurrentWorkspace,
        createEmptyWorkspace,
        getServerById,
        isWorkspaceShowing,
        isServerShowing,
        
        // 初始化方法
        reinitialize,
        
        // Hook 访问 - 现在只暴露统一的工作区管理
        workspaceManagement: initialization.workspaceManagement,
    };

    return (
        <WorkspacesContext.Provider value={contextValue}>
            {children}
        </WorkspacesContext.Provider>
    );
};

// 自定义 hook
export const useWorkspaces = () => {
    const context = useContext(WorkspacesContext);
    if (!context) {
        throw new Error('useWorkspaces must be used within WorkspacesProvider');
    }
    return context;
};
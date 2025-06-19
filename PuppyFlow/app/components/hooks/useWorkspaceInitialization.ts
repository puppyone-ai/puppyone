import { useState, useCallback } from 'react';
import { useWorkspaceManagement, WorkspaceJSON } from './useWorkspaceManagement';

// 工作区信息类型
export type WorkspaceInfo = {
    workspace_id: string;
    workspace_name: string;
    content: WorkspaceJSON | null;
    pullFromDatabase: boolean;
    pushToDatabase: boolean;
}

// 初始化结果类型
export type InitializationResult = {
    userId: string;
    userName: string;
    workspaces: WorkspaceInfo[];
    defaultWorkspace: WorkspaceInfo | null;
    defaultWorkspaceContent: WorkspaceJSON | null;
}

export const useWorkspaceInitialization = () => {
    const [isInitialized, setIsInitialized] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const workspaceManagement = useWorkspaceManagement();

    // 初始化所有工作区数据
    const initializeAllData = useCallback(async (): Promise<InitializationResult | null> => {
        if (isLoading) return null;
        
        try {
            setIsLoading(true);
            setError(null);
            
            // 1. 获取用户基础数据
            const userData = await workspaceManagement.initializeUserData();
            
            if (!userData) {
                throw new Error('Failed to initialize user data');
            }

            // 2. 只获取第一个工作区的内容
            let defaultWorkspace: WorkspaceInfo | null = null;
            let defaultWorkspaceContent: WorkspaceJSON | null = null;

            if (userData.workspaces.length > 0) {
                const firstWorkspace = userData.workspaces[0];
                try {
                    const content = await workspaceManagement.fetchWorkspaceContent(firstWorkspace.workspace_id);
                    defaultWorkspace = {
                        workspace_id: firstWorkspace.workspace_id,
                        workspace_name: firstWorkspace.workspace_name,
                        content: content,
                        pullFromDatabase: true,
                        pushToDatabase: false,
                    };
                    defaultWorkspaceContent = content;
                } catch (error) {
                    console.error(`Failed to fetch content for default workspace:`, error);
                    defaultWorkspace = {
                        workspace_id: firstWorkspace.workspace_id,
                        workspace_name: firstWorkspace.workspace_name,
                        content: null,
                        pullFromDatabase: false,
                        pushToDatabase: false,
                    };
                }
            }

            // 其他工作区只保存基础信息，不获取内容
            const allWorkspaces = userData.workspaces.map(ws => {
                if (ws.workspace_id === defaultWorkspace?.workspace_id) {
                    return defaultWorkspace;
                }
                return {
                    workspace_id: ws.workspace_id,
                    workspace_name: ws.workspace_name,
                    content: null,
                    pullFromDatabase: false,
                    pushToDatabase: false,
                };
            });

            const result: InitializationResult = {
                userId: userData.user_id,
                userName: userData.user_name,
                workspaces: allWorkspaces,
                defaultWorkspace,
                defaultWorkspaceContent,
            };

            setIsInitialized(true);
            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
            console.error('Error in workspace initialization:', error);
            setError(errorMessage);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [isLoading, workspaceManagement]);

    // 重置初始化状态
    const resetInitialization = useCallback(() => {
        setIsInitialized(false);
        setError(null);
    }, []);

    return {
        // 状态
        isInitialized,
        isLoading,
        error,
        
        // 方法
        initializeAllData,
        resetInitialization,
        
        // 暴露工作区管理 hook 以供其他操作使用
        workspaceManagement,
    };
}; 
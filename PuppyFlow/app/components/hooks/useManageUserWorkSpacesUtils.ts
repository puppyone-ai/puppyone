import React from 'react'
import Cookies from 'js-cookie'
import { SYSTEM_URLS } from '@/config/urls'
import { useAppSettings } from '../states/AppSettingsContext'

// console.log('Environment Variables:', {
//     USER_SYSTEM_BACKEND_URL: process.env.NEXT_PUBLIC_USER_SYSTEM_BACKEND_URL,
//     NODE_ENV: process.env.NODE_ENV
// });
const UserSystem_Backend_Base_Url = SYSTEM_URLS.USER_SYSTEM.BACKEND

interface ManageUserWorkspacesUtils {
    getToken: (isLocal?: boolean) => string | undefined;
    fetchUserId: (isLocal?: boolean) => Promise<string | undefined>;
    fetchUserName: (userId?: string, isLocal?: boolean) => Promise<string | undefined>;
    fetchUserWorkspacesInfo: (userId?: string, isLocal?: boolean) => Promise<{ workspace_id: string, workspace_name: string }[] | undefined>;
    createWorkspaceInDatabase: (newWorkspaceId: string, newWorkspaceName: string, userId?: string) => Promise<{
        workspace_id: string;
        workspace_name: string;
    } | undefined>;
    deleteWorkspaceInDatabase: (workspaceId: string) => Promise<void>;
    updateWorkspaceNameInDatabase: (workspaceId: string, newWorkspaceName: string) => Promise<{ workspace_id: string; workspace_name: string; } | undefined>;
    addWorkspaceHistory: (workspaceId: string, historyData: any, timestep: string) => Promise<void>;
    fetchLatestWorkspaceHistory: (workspaceId: string, isLocal?: boolean) => Promise<any | undefined>;
    initializeUserDataV2: (isLocal?: boolean) => Promise<{
        user_id: string;
        user_name: string;
        workspaces: {
            workspace_id: string;
            workspace_name: string;
        }[];
        workspace_history: any;
    }>;
}

export default function useManageUserWorkspacesUtils(): ManageUserWorkspacesUtils {
    // 在 hook 的顶层获取 isLocalDeployment
    const { isLocalDeployment } = useAppSettings();
    
    // client side get token
    const getToken = (isLocal?: boolean) => {
        if (isLocal) {
            // 本地部署模式下不需要真实token，返回固定值
            return 'local-token';
        } else {
            // 云端部署模式下获取真实token
            const token = Cookies.get('access_token');
            console.log('token', token);
            return token;
        }
    };

    // 调用后端api
    const fetchUserId = async (isLocalOverride?: boolean) => {
        // 优先使用传入的参数，否则使用全局设置
        const isLocal = isLocalOverride !== undefined ? isLocalOverride : isLocalDeployment;
        
        try {
            if (isLocal) {
                // 本地部署模式下返回固定的本地用户ID
                return 'local-user';
            } else {
                // 云端部署模式下获取真实用户ID
                const userAccessToken = getToken();
                if (!userAccessToken) {
                    throw new Error('No user access token found');
                }

                const response = await fetch(`${UserSystem_Backend_Base_Url}/get_user_id`, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${userAccessToken}`
                    }
                });

                if (response.status !== 200) {
                    const error_data: { error: string } = await response.json();
                    throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
                }

                const data: { user_id: string } = await response.json();
                console.log('User Info:', data);
                return data.user_id as string;
            }
        } catch (error) {
            console.error('Error fetching userId:', error);
            return undefined;
        }
    };

    const fetchUserName = async (userId?: string, isLocalOverride?: boolean) => {
        const isLocal = isLocalOverride !== undefined ? isLocalOverride : isLocalDeployment;
        try {
            if (isLocal) {
                // 本地部署模式下返回固定的本地用户名
                return 'Puppy';
            } else {
                // 云端部署模式下获取真实用户名
                let finalUserId = userId;
                if (!finalUserId) {
                    finalUserId = await fetchUserId();
                    if (!finalUserId) {
                        throw new Error('You do not have a valid user id');
                    }
                }

                const response = await fetch(`${UserSystem_Backend_Base_Url}/get_user_name/${finalUserId}`, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });

                if (response.status === 204) {
                    // user not found
                    return "Unnamed User";
                } else if (response.status === 404) {
                    const error_data: { error: string } = await response.json();
                    throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
                } else if (response.status === 200) {
                    const data: { user_name: string } = await response.json();
                    console.log('User Info:', data);
                    return data.user_name;
                } else {
                    throw new Error(`HTTP error! status: ${response.status}, error message: Other errors`);
                }
            }
        } catch (error) {
            console.error('Error fetching userName:', error);
            return "Unnamed User";
        }
    };

    const fetchUserWorkspacesInfo = async (userId?: string, isLocalOverride?: boolean) => {
        const isLocal = isLocalOverride !== undefined ? isLocalOverride : isLocalDeployment;
        // return workspaces info: workspaceid, workspacename
        try {
            if (isLocal) {
                // 本地部署模式：从文件系统获取工作区列表
                const response = await fetch('/api/workspace/list');
                if (!response.ok) {
                    throw new Error('Failed to fetch workspace list');
                }
                const data = await response.json();
                return data.workspaces || [];
            } else {
                // 云端部署模式：使用现有逻辑
                let finalUserId = userId;
                if (!finalUserId) {
                    finalUserId = await fetchUserId();
                    if (!finalUserId) {
                        throw new Error('You do not have a valid user id');
                    }
                }

                const response = await fetch(`${UserSystem_Backend_Base_Url}/get_user_workspaces/${finalUserId}`, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });

                if (response.status === 404) {
                    const error_data: { error: string } = await response.json();
                    throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
                } else if (response.status === 204) {
                    // return empty workspaces
                    return [];
                } else if (response.status === 200) {
                    // return workspaces
                    const data: { workspaces: { workspace_id: string, workspace_name: string }[] } = await response.json();
                    console.log('User Info:', data);
                    return data.workspaces;
                } else {
                    throw new Error(`HTTP error! status: ${response.status}, error message: ${response.statusText}`);
                }
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
            return []; // 出错时返回空数组
        }
    };

    const createWorkspaceInDatabase = async (newWorkspaceId: string, newWorkspaceName: string, userId?: string) => {
        try {
            let finalUserId = userId
            if (!finalUserId) {
                finalUserId = await fetchUserId()
                if (!finalUserId) {
                    throw new Error('You are not a valid user')
                }
            }

            console.log("createWorkspace!!!", JSON.stringify({
                workspace_id: newWorkspaceId,
                workspace_name: newWorkspaceName
            }))

            const response = await fetch(`${UserSystem_Backend_Base_Url}/create_workspace/${finalUserId}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    workspace_id: newWorkspaceId,
                    workspace_name: newWorkspaceName
                })
            });

            if (response.status === 404) {
                // user not found
                const error_data: { error: string } = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 400) {
                // workspace not created successfully
                const error_data: { error: string } = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 201 || response.status === 200) {
                // successfully created workspace
                const data: { msg: string, workspace_id: string, workspace_name: string } = await response.json();
                console.log('new created workspace info:', data);
                return { workspace_id: data.workspace_id, workspace_name: data.workspace_name }
            }
            else {
                throw new Error(`HTTP error! status: ${response.status}, error message: ${response.statusText}`)
            }


        } catch (error) {
            console.error('Error fetching user workspaces:', error);
        }
    }

    const deleteWorkspaceInDatabase = async (workspaceId: string) => {
        try {

            const response = await fetch(`${UserSystem_Backend_Base_Url}/delete_workspace/${workspaceId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (response.status === 404) {
                // workspace not found
                const error_data: { error: string } = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 500) {
                // other errors
                const error_data: { error: string } = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 200) {
                const success_data: { msg: string } = await response.json()
                console.log(success_data.msg)
            }
            else {
                throw new Error(`HTTP error! status: ${response.status}, error message: ${response.statusText}`)
            }


        } catch (error) {
            console.error('Error when deleting workspace:', error);
        }
    }

    const updateWorkspaceNameInDatabase = async (workspaceId: string, newWorkspaceName: string) => {
        try {
            const response = await fetch(`${UserSystem_Backend_Base_Url}/update_workspace_name/${workspaceId}`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ new_name: newWorkspaceName })
            });

            if (response.status === 404) {
                // workspace does not exist
                const error_data: { error: string } = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 400) {
                // workspace name cannot be empty
                const error_data: { error: string } = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 500) {
                // other errors
                const error_data: { error: string } = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 200) {
                const data: { msg: string, workspace_id: string, workspace_name: string } = await response.json();
                console.log('updated workspace name:', data);
                return { workspace_id: data.workspace_id, workspace_name: data.workspace_name }
            }
            else {
                throw new Error(`HTTP error! status: ${response.status}, error message: ${response.statusText}`)
            }

        } catch (error) {
            console.error('Error when updating workspace name:', error);
        }
    }

    const addWorkspaceHistory = async (workspaceId: string, historyData: any, timestep: string) => {
        try {
            const response = await fetch(`${UserSystem_Backend_Base_Url}/add_workspace_history/${workspaceId}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    history: historyData,
                    timestep: timestep
                })
            });

            if (response.status === 404) {
                // workspace does not exist
                const error_data: { error: string } = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 500) {
                // other errors
                const error_data: { error: string } = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 201) {
                const success_data: { msg: string, version_id: string, version_timestamp: string } = await response.json()
                console.log(success_data.msg, success_data.version_id, success_data.version_timestamp)
            }
            else {
                throw new Error(`HTTP error! status: ${response.status}, error message: ${response.statusText}`)
            }

        } catch (error) {
            console.error('Error adding workspace history:', error);
            throw error // 重新抛出error 允许外部function 识别error并报错
        }
    }

    const fetchLatestWorkspaceHistory = async (workspaceId: string, isLocalOverride?: boolean) => {
        const isLocal = isLocalOverride !== undefined ? isLocalOverride : isLocalDeployment;
        try {
            if (isLocal) {
                // 本地存储逻辑
                const response = await fetch(`/api/workspace?flowId=${workspaceId}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch workspace');
                }
                const { data } = await response.json();
                return data;
            } else {
                // 现有的云端逻辑
                const response = await fetch(`${UserSystem_Backend_Base_Url}/get_latest_workspace_history/${workspaceId}`, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                    }
                });

                if (response.status === 204) {
                    return null;
                } else if (response.status === 404) {
                    const error_data: { error: string } = await response.json();
                    throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
                } else if (response.status === 500) {
                    const error_data: { error: string } = await response.json();
                    throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
                } else if (response.status === 200) {
                    const data: { history: any } = await response.json();
                    console.log('latest workspace history for workspace:', workspaceId, data);
                    return data.history;
                } else {
                    throw new Error(`HTTP error! status: ${response.status}, error message: ${response.statusText}`);
                }
            }
        } catch (error) {
            console.error('Error fetching latest workspace history for workspace:', workspaceId, error);
            return null;
        }
    };

    const initializeUserDataV2 = async (isLocalOverride?: boolean) => {
        const isLocal = isLocalOverride !== undefined ? isLocalOverride : isLocalDeployment;
        try {
            if (isLocal) {
                // 本地部署模式
                // 获取本地用户ID和用户名
                const userId = await fetchUserId(true);
                console.log('userId', userId);
                const userName = await fetchUserName(undefined, true);
                console.log('userName', userName);
                // 获取本地工作区列表
                const workspaces = await fetchUserWorkspacesInfo(undefined, true);
                
                // 返回适配云端格式的数据结构
                return {
                    user_id: userId || 'local-user',
                    user_name: userName || 'Puppy',
                    workspaces: workspaces || [],
                    workspace_history: {}
                };
            } else {
                // 云端部署模式 - 现有的逻辑
                const userAccessToken = getToken();
                if (!userAccessToken) {
                    throw new Error('No user access token found');
                }

                const response = await fetch(`${UserSystem_Backend_Base_Url}/initialize_user_data_v2`, {
                    method: 'GET',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${userAccessToken}`
                    }
                });

                if (response.status !== 200) {
                    const error_data: {error: string} = await response.json();
                    throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
                }

                const data = await response.json();
                console.log('Initialize User Data V2:', data);
                return data;
            }
        } catch (error) {
            console.error('Error in initializeUserDataV2:', error);
            
            // 如果出错，至少返回一个基本结构
            return {
                user_id: isLocal ? 'local-user' : '',
                user_name: isLocal ? 'Puppy' : '',
                workspaces: [],
                workspace_history: {}
            };
        }
    };

    return (
        {
            getToken: (isLocalOverride?: boolean) => getToken(isLocalOverride !== undefined ? isLocalOverride : isLocalDeployment),
            fetchUserId: (isLocalOverride?: boolean) => fetchUserId(isLocalOverride),
            fetchUserName: (userId?: string, isLocalOverride?: boolean) => fetchUserName(userId, isLocalOverride),
            fetchUserWorkspacesInfo: (userId?: string, isLocalOverride?: boolean) => fetchUserWorkspacesInfo(userId, isLocalOverride),
            createWorkspaceInDatabase: (newWorkspaceId: string, newWorkspaceName: string, userId?: string) => createWorkspaceInDatabase(newWorkspaceId, newWorkspaceName, userId),
            deleteWorkspaceInDatabase: (workspaceId: string) => deleteWorkspaceInDatabase(workspaceId),
            updateWorkspaceNameInDatabase: (workspaceId: string, newWorkspaceName: string) => updateWorkspaceNameInDatabase(workspaceId, newWorkspaceName),
            addWorkspaceHistory: (workspaceId: string, historyData: any, timestep: string) => addWorkspaceHistory(workspaceId, historyData, timestep),
            fetchLatestWorkspaceHistory: (workspaceId: string, isLocalOverride?: boolean) => fetchLatestWorkspaceHistory(workspaceId, isLocalOverride),
            initializeUserDataV2: (isLocalOverride?: boolean) => initializeUserDataV2(isLocalOverride)
        }
    )
}


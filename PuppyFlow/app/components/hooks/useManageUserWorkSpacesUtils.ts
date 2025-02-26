import React from 'react'
import Cookies from 'js-cookie'
import { SYSTEM_URLS } from '@/config/urls'

// console.log('Environment Variables:', {
//     USER_SYSTEM_BACKEND_URL: process.env.NEXT_PUBLIC_USER_SYSTEM_BACKEND_URL,
//     NODE_ENV: process.env.NODE_ENV
// });
const UserSystem_Backend_Base_Url = SYSTEM_URLS.USER_SYSTEM.BACKEND

interface ManageUserWorkspacesUtils {
    getToken: () => string | undefined;
    fetchUserId: () => Promise<string | undefined>;
    fetchUserName: (userId?: string) => Promise<string | undefined>;
    fetchUserWorkspacesInfo: (userId?: string) => Promise<{workspace_id: string, workspace_name: string}[] | undefined>;
    createWorkspaceInDatabase: (newWorkspaceId: string, newWorkspaceName: string, userId?: string) => Promise<{
        workspace_id: string;
        workspace_name: string;
    } | undefined>;
    deleteWorkspaceInDatabase: (workspaceId: string) => Promise<void>;
    updateWorkspaceNameInDatabase: (workspaceId: string, newWorkspaceName: string) => Promise<{ workspace_id: string; workspace_name: string; } | undefined>;
    addWorkspaceHistory: (workspaceId: string, historyData: any, timestep: string) => Promise<void>;
    fetchLatestWorkspaceHistory: (workspaceId: string) => Promise<any | undefined>;
    initializeUserDataV2: () => Promise<{
        user_name: string;
        workspaces: {
            workspace_id: string;
            workspace_name: string;
        }[];
        workspace_history: any;
    }>;
  }

export default function useManageUserWorkspacesUtils(): ManageUserWorkspacesUtils {

    // client side get token
    const getToken = () => {
        const token = Cookies.get('access_token')
        console.log('token', token)
        return token
    }

    // 调用后端api
    const fetchUserId = async () => {
        try {
            const userAccessToken = getToken()

            if (!userAccessToken) {
                throw new Error('No user access token found')
            }

            const response = await fetch(`${UserSystem_Backend_Base_Url}/get_user_id`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userAccessToken}` // 替换为access token
            }
            });
        
            if (response.status !== 200) {
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
            }
        
            const data: {user_id: string} = await response.json();
            console.log('User Info:', data);
            return data.user_id as string
        } catch (error) {
            console.error('Error fetching userId:', error);
        }
        
    }

    const fetchUserName = async (userId?: string) => {
        try {
            let finalUserId = userId
            if (!finalUserId) {
                finalUserId = await fetchUserId()
                if (!finalUserId) {
                    throw new Error('You do not have a valid user id')
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
                return "Unnamed User"
            }
        
            else if (response.status === 404) {
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
            }
            else if (response.status === 200) {
                const data: {user_name: string} = await response.json();
                console.log('User Info:', data);
                return data.user_name
            }
            else {
                throw new Error(`HTTP error! status: ${response.status}, error message: Other errors`)
            }

        } catch (error) {
            console.error('Error fetching userName:', error);
        }
    }

    const fetchUserWorkspacesInfo = async (userId?: string) => {
        // return workspaces info: workspaceid, workspacename

        try {
            let finalUserId = userId
            if (!finalUserId) {
                finalUserId = await fetchUserId()
                if (!finalUserId) {
                    throw new Error('You do not have a valid user id')
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
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 204) {
                // return empty workspaces
                return []
            }
            else if (response.status === 200) {
                // return workspaces
                const data: {workspaces: {workspace_id: string, workspace_name: string}[]} = await response.json();
                console.log('User Info:', data);
                return data.workspaces
            }
            else {
                throw new Error(`HTTP error! status: ${response.status}, error message: ${response.statusText}`)
            }
        
        } catch (error) {
            console.error('Error fetching user info:', error);
        }
        
    }

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
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 400) {
                // workspace not created successfully
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 201 || response.status === 200) {
                // successfully created workspace
                const data: {msg: string, workspace_id: string, workspace_name: string} = await response.json();
                console.log('new created workspace info:', data);
                return {workspace_id: data.workspace_id, workspace_name: data.workspace_name}
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
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 500) {
                // other errors
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 200) {
                const success_data: {msg: string} = await response.json()
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
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 400) {
                // workspace name cannot be empty
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 500) {
                // other errors
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 200) {
                const data: {msg: string, workspace_id: string, workspace_name: string} = await response.json();
                console.log('updated workspace name:', data);
                return {workspace_id: data.workspace_id, workspace_name: data.workspace_name}
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
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 500) {
                // other errors
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 201) {
                const success_data: {msg: string, version_id: string, version_timestamp: string} = await response.json()
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

    const fetchLatestWorkspaceHistory = async (workspaceId: string) => {
        try {
            const response = await fetch(`${UserSystem_Backend_Base_Url}/get_latest_workspace_history/${workspaceId}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            }
            });
        
            if (response.status === 204) {
                // return empty history
                return null
            }
            else if (response.status === 404) {
                // workspace does not exist
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 500) {
                // other errors
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`)
            }
            else if (response.status === 200) {
                // return history
                const data: {history: any} = await response.json();
                console.log('latest workspace history for workspace:', workspaceId, data);
                return data.history
            }
            else {
                throw new Error(`HTTP error! status: ${response.status}, error message: ${response.statusText}`)
            }

        } catch (error) {
            console.error('Error fetching latest workspace history for workspace:', workspaceId, error);
        }
    }

    const initializeUserDataV2 = async () => {
        try {
            const userAccessToken = getToken()

            if (!userAccessToken) {
                throw new Error('No user access token found')
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
                const error_data: {error: string} = await response.json()
                throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
            }

            const data = await response.json();
            console.log('Initialize User Data V2:', data);
            return data;

        } catch (error) {
            console.error('Error in initializeUserDataV2:', error);
            throw error;
        }
    }

  return (
    {
        getToken,
        fetchUserId,
        fetchUserName,
        fetchUserWorkspacesInfo,
        createWorkspaceInDatabase,
        deleteWorkspaceInDatabase,
        updateWorkspaceNameInDatabase,
        addWorkspaceHistory,
        fetchLatestWorkspaceHistory,
        initializeUserDataV2
    }
  )
}


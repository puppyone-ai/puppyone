/**
 * Display Switch Hook
 *
 * Simple hook to switch between workspace and server display modes.
 * Also handles switching the selected ID and corresponding JSON content.
 */

import { useWorkspaces } from '../states/UserWorkspacesContext';
import { useServers } from '../states/UserServersContext';

export const useDisplaySwitch = () => {
  const {
    displayOrNot: workspaceDisplay,
    setDisplayOrNot: setWorkspaceDisplay,
    setShowingWorkspace,
    getWorkspaceById,
  } = useWorkspaces();

  const {
    displayOrNot: serverDisplay,
    setDisplayOrNot: setServerDisplay,
    setShowingId: setShowingServerId,
    getApiServiceById,
    getChatbotServiceById,
  } = useServers();

  // 切换到工作区显示
  const switchToWorkspace = (workspaceId?: string) => {
    setWorkspaceDisplay(true);
    setServerDisplay(false);

    // 如果提供了工作区ID，同时切换到该工作区
    if (workspaceId) {
      setShowingWorkspace(workspaceId);
    }
  };

  // 切换到服务器显示
  const switchToServer = (serviceId?: string) => {
    setWorkspaceDisplay(false);
    setServerDisplay(true);

    // 如果提供了服务ID，同时切换到该服务
    if (serviceId) {
      setShowingServerId(serviceId);
    }
  };

  // 切换到指定的工作区（同时切换显示模式）
  const switchToWorkspaceById = (workspaceId: string) => {
    const workspace = getWorkspaceById(workspaceId);
    if (workspace) {
      switchToWorkspace(workspaceId);
    }
  };

  // 切换到指定的服务（同时切换显示模式）
  const switchToServiceById = (serviceId: string) => {
    // 先检查是否是API服务
    const apiService = getApiServiceById(serviceId);
    if (apiService) {
      switchToServer(serviceId);
      return;
    }

    // 再检查是否是Chatbot服务
    const chatbotService = getChatbotServiceById(serviceId);
    if (chatbotService) {
      switchToServer(serviceId);
      return;
    }

    console.warn(`Service with ID ${serviceId} not found`);
  };

  // 通用的切换方法 - 根据ID自动判断类型
  const switchToItemById = (id: string) => {
    // 先尝试作为工作区ID
    const workspace = getWorkspaceById(id);
    if (workspace) {
      switchToWorkspaceById(id);
      return;
    }

    // 再尝试作为服务ID
    switchToServiceById(id);
  };

  // 获取当前显示模式
  const getCurrentDisplayMode = (): 'workspace' | 'server' | 'none' => {
    if (workspaceDisplay) return 'workspace';
    if (serverDisplay) return 'server';
    return 'none';
  };

  return {
    // 状态
    workspaceDisplay,
    serverDisplay,
    currentMode: getCurrentDisplayMode(),

    // 基础切换方法
    switchToWorkspace,
    switchToServer,

    // 带ID的切换方法
    switchToWorkspaceById,
    switchToServiceById,
    switchToItemById,
  };
};

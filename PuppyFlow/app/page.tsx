'use client';
import Sidebar from './components/sidebar/Sidebar';
import Workflow from './components/workflow/Workflow';
import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { NodesPerFlowContextProvider } from './components/states/NodesPerFlowContext';
import {
  WorkspacesProvider,
  useWorkspaces,
} from './components/states/UserWorkspacesContext';
import BlankWorkspace from './components/blankworkspace/BlankWorkspace';
import { AppSettingsProvider } from './components/states/AppSettingsContext';
import { ServersProvider } from './components/states/UserServersContext';
import { useDisplaySwitch } from './components/hooks/useDisplayWorkspcaeSwitching';
import ServerDisplay from './components/serverDisplay/ServerDisplay';
import { SYSTEM_URLS } from '@/config/urls';
import axios from 'axios';

function ActiveFlowContent() {
  const { showingItem } = useWorkspaces();
  const { currentMode } = useDisplaySwitch();

  // 根据显示模式决定渲染什么内容
  if (currentMode === 'workspace') {
    // 如果是工作区模式，使用 ReactFlow 渲染
    return showingItem?.type === 'workspace' ? (
      <Workflow />
    ) : (
      <BlankWorkspace />
    );
  } else if (currentMode === 'server') {
    // 如果是服务器模式，使用服务器组件渲染
    return <ServerDisplay />;
  } else {
    // 默认显示空白工作区
    return <BlankWorkspace />;
  }
}

function MainApplication() {
  // Install global 401 handlers for fetch and axios
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const originalFetch = window.fetch;
    const redirectFlagKey = '__auth_redirecting_due_to_401__';

    const redirectToLogin = () => {
      // Prevent multiple simultaneous redirects
      if ((window as any)[redirectFlagKey]) return;
      (window as any)[redirectFlagKey] = true;

      try {
        const loginUrl = new URL(SYSTEM_URLS.USER_SYSTEM.FRONTEND);
        loginUrl.searchParams.set('return_to', window.location.href);
        // Notify UI before navigating away
        window.dispatchEvent(
          new CustomEvent('auth:expired', { detail: { status: 401 } })
        );
        window.location.replace(loginUrl.toString());
      } catch (error) {
        // Fallback: hard reload if URL config malformed
        window.location.reload();
      }
    };

    // Wrap fetch to catch 401 responses
    window.fetch = async (...args) => {
      const response = await originalFetch(...(args as Parameters<typeof originalFetch>));
      if (response && response.status === 401) {
        redirectToLogin();
      }
      return response;
    };

    // Axios response interceptor to handle 401 globally
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const status: number | undefined = error?.response?.status;
        if (status === 401) {
          redirectToLogin();
        }
        return Promise.reject(error);
      }
    );

    return () => {
      // Cleanup on unmount
      window.fetch = originalFetch;
      axios.interceptors.response.eject(interceptorId);
    };
  }, []);

  return (
    <div
      id='home'
      className='w-screen h-screen flex flex-row bg-[#131313] overflow-hidden'
    >
      <AppSettingsProvider>
        <ReactFlowProvider>
          <WorkspacesProvider>
            <ServersProvider>
              <>
                <Sidebar />

                <NodesPerFlowContextProvider>
                  <ActiveFlowContent />
                </NodesPerFlowContextProvider>
              </>
            </ServersProvider>
          </WorkspacesProvider>
        </ReactFlowProvider>
      </AppSettingsProvider>
    </div>
  );
}

export default function Home() {
  return <MainApplication />;
}

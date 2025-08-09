import { useState, useCallback } from 'react';
import { useServerOperations } from './useServerManagement';
import { useWorkspaces } from '../states/UserWorkspacesContext';

// Service types (moved from context)
export interface ApiService {
  api_id: string;
  api_key: string;
  endpoint?: string;
  created_at?: string;
  workspace_id?: string;
  inputs?: string[];
  outputs?: string[];
  workflow_json?: any;
}

export interface ChatbotService {
  chatbot_id: string;
  chatbot_key: string;
  endpoint?: string;
  created_at?: string;
  workspace_id?: string;
  input?: string;
  output?: string;
  history?: string | null;
  multi_turn_enabled?: boolean;
  welcome_message?: string;
  config?: {
    multiTurn: boolean;
    welcomeMessage: string;
    deployTo: string;
  };
  workflow_json?: any;
}

// Enhanced service types with workspace info
export interface EnhancedApiService extends ApiService {
  workspaceName: string;
  type: 'api';
}

export interface EnhancedChatbotService extends ChatbotService {
  workspaceName: string;
  type: 'chatbot';
}

export type EnhancedService = EnhancedApiService | EnhancedChatbotService;
export type ServiceType = 'api' | 'chatbot';

// Initialization result type
export type ServerInitializationResult = {
  apis: EnhancedApiService[];
  chatbots: EnhancedChatbotService[];
  totalCount: number;
};

export const useServerInitialization = () => {
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const serverOperations = useServerOperations();
  const { workspaces } = useWorkspaces();

  const initializeAllServices =
    useCallback(async (): Promise<ServerInitializationResult | null> => {
      if (isLoading) {
        console.log('⏳ Initialization already in progress, skipping...');
        return null;
      }

      console.log('🚀 Starting server initialization...');
      setIsLoading(true);
      setError(null);

      try {
        if (!workspaces.length) {
          console.log('⚠️ No workspaces available, returning empty result');
          const result: ServerInitializationResult = {
            apis: [],
            chatbots: [],
            totalCount: 0,
          };
          setIsInitialized(true);
          return result;
        }

        // 使用统一的增强服务获取方法
        const { apis, chatbots, totalCount } =
          await serverOperations.fetchAllEnhancedServices(workspaces);

        const result: ServerInitializationResult = {
          apis,
          chatbots,
          totalCount,
        };

        console.log(
          `✅ Initialized ${apis.length} APIs and ${chatbots.length} chatbots`
        );
        setIsInitialized(true);
        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Unknown server initialization error';
        console.error('Error in server initialization:', error);
        setError(errorMessage);
        return null;
      } finally {
        setIsLoading(false);
      }
    }, [isLoading, serverOperations, workspaces]);

  // Reset initialization state
  const resetInitialization = useCallback(() => {
    setIsInitialized(false);
    setError(null);
  }, []);

  return {
    // State
    isInitialized,
    isLoading,
    error,

    // Methods
    initializeAllServices,
    resetInitialization,

    // Expose server operations for other operations
    serverOperations,
  };
};

import { useState, useCallback } from 'react';
import { useServerOperations } from './useServerMnagement';
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
}

export const useServerInitialization = () => {
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const serverOperations = useServerOperations();
  const { workspaces } = useWorkspaces();

  // Initialize all server data
  const initializeAllServices = useCallback(async (): Promise<ServerInitializationResult | null> => {
    if (isLoading) return null;
    
    try {
      setIsLoading(true);
      setError(null);

      if (!workspaces.length) {
        const result: ServerInitializationResult = {
          apis: [],
          chatbots: [],
          totalCount: 0
        };
        setIsInitialized(true);
        return result;
      }

      // Use the unified API to fetch all deployments
      const deploymentsResponse = await serverOperations.fetchUserDeployments({
        includeDetails: true,
        includeKeys: true
      });

      console.log('🔄 Fetched deployments from unified API:', deploymentsResponse);

      // Create workspace mapping
      const workspaceMap = new Map(workspaces.map(w => [w.workspace_id, w.workspace_name]));

      // Build service data
      const allApis: EnhancedApiService[] = [];
      const allChatbots: EnhancedChatbotService[] = [];

      deploymentsResponse.deployments.forEach(deployment => {
        const workspaceName = workspaceMap.get(deployment.workspace_id) || 'Unknown Workspace';

        if (deployment.deployment_type === 'api' && deployment.api_id) {
          const apiService: EnhancedApiService = {
            api_id: deployment.api_id,
            api_key: deployment.api_key || '',
            inputs: deployment.inputs || [],
            outputs: deployment.outputs || [],
            workspace_id: deployment.workspace_id,
            created_at: deployment.created_at ? new Date(deployment.created_at * 1000).toISOString() : undefined,
            workflow_json: deployment.workflow_json || undefined,
            workspaceName,
            type: 'api' as const
          };
          allApis.push(apiService);
        } 
        else if (deployment.deployment_type === 'chatbot' && deployment.chatbot_id) {
          const chatbotService: EnhancedChatbotService = {
            chatbot_id: deployment.chatbot_id,
            chatbot_key: deployment.chatbot_key || '',
            input: deployment.input || '',
            output: deployment.output || '',
            history: deployment.history || null,
            multi_turn_enabled: deployment.multi_turn_enabled || false,
            welcome_message: deployment.welcome_message || '',
            workspace_id: deployment.workspace_id,
            created_at: deployment.created_at ? new Date(deployment.created_at * 1000).toISOString() : undefined,
            workflow_json: deployment.workflow_json || undefined,
            workspaceName,
            type: 'chatbot' as const
          };
          allChatbots.push(chatbotService);
        }
      });

      const result: ServerInitializationResult = {
        apis: allApis,
        chatbots: allChatbots,
        totalCount: deploymentsResponse.total_count
      };

      console.log(`✅ Initialized ${allApis.length} APIs and ${allChatbots.length} chatbots`);
      setIsInitialized(true);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown server initialization error';
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
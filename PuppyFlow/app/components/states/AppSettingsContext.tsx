/**
 * AppSettingsContext - Global Application Settings Context
 * 
 * This context manages the following application-wide settings and states:
 * 
 * 1. Model Management:
 *    - Cloud models (OpenAI, DeepSeek, Anthropic, etc.)
 *    - Local models (via Ollama integration)
 *    - Model availability toggling
 *    - Model type classification (LLM vs Embedding)
 *    - Dynamic model loading and refresh capabilities
 * 
 * 2. Deployment Configuration:
 *    - Local vs Cloud deployment detection
 *    - Environment-based model filtering
 *    - Ollama connection status monitoring
 * 
 * 3. Warning System:
 *    - Global warning message management
 *    - Warning toast notifications
 *    - Warning message expansion/collapse states
 *    - Automatic warning cleanup
 * 
 * 4. State Synchronization:
 *    - Real-time model availability updates
 *    - Cross-component state sharing
 *    - Persistent warning notifications
 * 
 * Usage: Wrap your app with AppSettingsProvider and use useAppSettings hook
 * to access the context values throughout your application.
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import WarningToast from '../misc/WarningToast';
import { useOllamaModels } from '../hooks/useOllamaModels';
import { SYSTEM_URLS } from '@/config/urls';
import Cookies from 'js-cookie';

// 定义用户订阅状态类型
export type UserSubscriptionStatus = {
  is_premium: boolean;
  subscription_plan: 'free' | 'premium';
  subscription_status: 'active' | 'canceled' | 'expired';
  subscription_period_start: string;
  subscription_period_end: string;
  effective_end_date: string;
  days_left: number;
  expired_date: string; // legacy字段，用于兼容性
  polar_subscription_id?: string;
};

// 定义模型类型
export type Model = {
  id: string;
  name: string;
  provider?: string;
  isLocal?: boolean;
  active?: boolean;
  type?: 'llm' | 'embedding'; // 新增字段：区分 LLM 和 embedding 模型
};

// 定义警告消息类型
export type WarnMessage = {
  time: number;
  text: string;
  expanded?: boolean;
};

// 定义上下文类型
type AppSettingsContextType = {
  // 模型相关
  cloudModels: Model[];
  localModels: Model[];
  availableModels: Model[];
  isLocalDeployment: boolean;
  isLoadingLocalModels: boolean;
  ollamaConnected: boolean;
  toggleModelAvailability: (id: string) => void;
  addLocalModel: (model: Omit<Model, 'isLocal'>) => void;
  removeLocalModel: (id: string) => void;
  refreshLocalModels: () => Promise<void>;
  
  // 用户订阅状态相关
  userSubscriptionStatus: UserSubscriptionStatus | null;
  isLoadingSubscriptionStatus: boolean;
  fetchUserSubscriptionStatus: () => Promise<void>;
  
  // 认证相关
  getAuthHeaders: () => HeadersInit;
  getUserToken: (forceLocal?: boolean) => string | undefined;
  getCustomAuthHeaders: (headerName?: string) => Record<string, string>;
  
  // 警告消息相关
  warns: WarnMessage[];
  addWarn: (text: string) => void;
  removeWarn: (index: number) => void;
  clearWarns: () => void;
  toggleWarnExpand: (index: number) => void;
};

// 创建上下文
const AppSettingsContext = createContext<AppSettingsContextType | undefined>(undefined);

// 预定义的云端模型
const CLOUD_MODELS: Model[] = [
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', isLocal: false, active: true, type: 'llm' },
  { id: 'openai/gpt-4o-2024-11-20', name: 'GPT-4o (2024-11-20)', provider: 'OpenAI', isLocal: false, active: true, type: 'llm' },
  { id: 'openai/gpt-4.5-preview', name: 'GPT-4.5 Preview', provider: 'OpenAI', isLocal: false, active: true, type: 'llm' },
  { id: 'openai/o1', name: 'o1', provider: 'OpenAI', isLocal: false, active: true, type: 'llm' },
  { id: 'openai/o3-mini', name: 'o3 Mini', provider: 'OpenAI', isLocal: false, active: true, type: 'llm' },
  { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek Chat v3', provider: 'DeepSeek', isLocal: false, active: true, type: 'llm' },
  { id: 'deepseek/deepseek-r1-zero:free', name: 'DeepSeek R1 Zero', provider: 'DeepSeek', isLocal: false, active: true, type: 'llm' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', provider: 'DeepSeek', isLocal: false, active: true, type: 'llm' },
  { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'Anthropic', isLocal: false, active: true, type: 'llm' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', isLocal: false, active: true, type: 'llm' },
  { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', provider: 'Anthropic', isLocal: false, active: true, type: 'llm' },
  // 添加一些云端 embedding 模型示例
  { id: 'text-embedding-ada-002', name: 'Text Embedding Ada 002', provider: 'OpenAI', isLocal: false, active: true, type: 'embedding' },
];

// 后备本地模型（当 Ollama 不可用时使用）
const FALLBACK_LOCAL_MODELS: Model[] = [
];

// Provider 组件
export const AppSettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // 检查部署类型
  const isLocalDeployment = (process.env.NEXT_PUBLIC_DEPLOYMENT_TYPE || '').toLowerCase() === 'local';
  
  // 使用 Ollama hook
  const {
    models: ollamaModels,
    loading: isLoadingLocalModels,
    error: ollamaError,
    isConnected: ollamaConnected,
    refetch: refreshOllamaModels,
  } = useOllamaModels({
    autoFetch: isLocalDeployment,
    retryAttempts: 2,
    retryDelay: 1000,
  });

  // 用户订阅状态管理
  const [userSubscriptionStatus, setUserSubscriptionStatus] = useState<UserSubscriptionStatus | null>(null);
  const [isLoadingSubscriptionStatus, setIsLoadingSubscriptionStatus] = useState<boolean>(false);
  
  // 模型状态管理
  const [cloudModels, setCloudModels] = useState<Model[]>(CLOUD_MODELS);
  const [localModels, setLocalModels] = useState<Model[]>([]);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  
  // 警告消息状态管理
  const [warns, setWarns] = useState<WarnMessage[]>([]);
  
  // 当 Ollama 模型更新时，更新本地模型列表
  useEffect(() => {
    if (isLocalDeployment) {
      if (ollamaModels.length > 0) {
        setLocalModels(ollamaModels);
      } else if (ollamaError && !isLoadingLocalModels) {
        // 如果 Ollama 连接失败，使用后备模型
        setLocalModels(FALLBACK_LOCAL_MODELS);
        addWarn(`无法连接到 Ollama 服务: ${ollamaError}`);
      }
    }
  }, [ollamaModels, ollamaError, isLoadingLocalModels, isLocalDeployment]);
  
  // 刷新本地模型的函数
  const refreshLocalModels = async () => {
    if (!isLocalDeployment) return;
    await refreshOllamaModels();
  };
  
  // 添加警告消息
  const addWarn = (text: string) => {
    setWarns(prev => [...prev, { time: Math.floor(Date.now() / 1000), text, expanded: false }]);
  };
  
  // 移除警告消息
  const removeWarn = (index: number) => {
    setWarns(prev => prev.filter((_, i) => i !== index));
  };
  
  // 清除所有警告消息
  const clearWarns = () => {
    setWarns([]);
  };

  // 切换警告消息展开/折叠状态
  const toggleWarnExpand = (index: number) => {
    setWarns(prev => 
      prev.map((warn, i) => 
        i === index ? { ...warn, expanded: !warn.expanded } : warn
      )
    );
  };
  
  // 根据部署类型更新可用模型
  useEffect(() => {
    if (isLocalDeployment) {
      // 在本地部署时，同时包含本地模型和云端模型
      setAvailableModels([...localModels, ...cloudModels]);
    } else {
      // 在云端部署时，只包含云端模型
      setAvailableModels([...cloudModels]);
    }
  }, [isLocalDeployment, cloudModels, localModels]);
  
  // 切换模型可用性
  const toggleModelAvailability = (id: string) => {
    // 检查模型是在本地模型列表还是云端模型列表中
    const isLocalModel = localModels.some(model => model.id === id);
    const isCloudModel = cloudModels.some(model => model.id === id);
    
    if (isLocalModel) {
      setLocalModels(models => 
        models.map(model => 
          model.id === id ? { ...model, active: !model.active } : model
        )
      );
    } else if (isCloudModel) {
      setCloudModels(models => 
        models.map(model => 
          model.id === id ? { ...model, active: !model.active } : model
        )
      );
    }
  };
  
  // 添加本地模型
  const addLocalModel = (model: Omit<Model, 'isLocal'>) => {
    const newModel = { ...model, isLocal: true, active: true };
    setLocalModels(prev => [...prev, newModel]);
  };
  
  // 移除本地模型
  const removeLocalModel = (id: string) => {
    setLocalModels(localModels.filter(model => model.id !== id));
  };

  // 认证相关方法 - 获取认证headers
  const getAuthHeaders = (): HeadersInit => {
    // 在本地部署时，可能不需要认证或有不同的认证逻辑
    if (isLocalDeployment) {
      // 本地开发环境的逻辑（根据需要调整）
      const token = Cookies.get('access_token');
      return token ? { 'Authorization': `Bearer ${token}` } : {};
    }
    
    // 生产环境始终要求认证
    const token = Cookies.get('access_token');
    if (!token) {
      console.warn('No access token found in production environment');
      addWarn('认证令牌缺失，请重新登录');
      return {};
    }
    
    return { 'Authorization': `Bearer ${token}` };
  };

  // 获取用户token的通用方法
  const getUserToken = (forceLocal?: boolean): string | undefined => {
    const useLocal = forceLocal !== undefined ? forceLocal : isLocalDeployment;
    
    if (useLocal) {
      return 'local-token';
    }
    
    const token = Cookies.get('access_token');
    if (!token && !useLocal) {
      console.warn('No access token found in production environment');
      addWarn('认证令牌缺失，请重新登录');
    }
    
    return token;
  };

  // 获取带有自定义header名称的认证headers
  const getCustomAuthHeaders = (headerName: string = 'Authorization'): Record<string, string> => {
    const token = getUserToken();
    return token ? { [headerName]: `Bearer ${token}` } : {};
  };

  // 获取用户订阅状态
  const fetchUserSubscriptionStatus = async (): Promise<void> => {
    if (isLocalDeployment) {
      // 本地部署模式，设置默认的订阅状态，用量为99999
      setUserSubscriptionStatus({
        is_premium: true, // 本地部署默认为premium
        subscription_plan: 'premium',
        subscription_status: 'active',
        subscription_period_start: new Date().toISOString(),
        subscription_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 一年后
        effective_end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        days_left: 99999, // 本地部署设置为99999天
        expired_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      return;
    }

    // 云端部署模式
    setIsLoadingSubscriptionStatus(true);
    
    try {
      const userAccessToken = getUserToken();
      if (!userAccessToken) {
        throw new Error('No user access token found');
      }

      const UserSystem_Backend_Base_Url = SYSTEM_URLS.USER_SYSTEM.BACKEND;
      const response = await fetch(`${UserSystem_Backend_Base_Url}/user_subscription_status`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        }
      });

      if (response.status !== 200) {
        const error_data: { error: string } = await response.json();
        throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
      }

      const subscriptionData: any = await response.json();
      console.log('用户订阅状态:', subscriptionData);
      
      // 字段名映射：将 API 返回的字段名转换为前端期望的字段名
      setUserSubscriptionStatus({
        is_premium: subscriptionData.is_premium ?? false,
        subscription_plan: subscriptionData.plan ?? 'free',
        subscription_status: subscriptionData.status ?? 'expired',
        subscription_period_start: subscriptionData.period_start ?? '',
        subscription_period_end: subscriptionData.period_end ?? '',
        effective_end_date: subscriptionData.effective_end_date ?? '',
        days_left: subscriptionData.days_left ?? 0,
        expired_date: subscriptionData.expired_date ?? '',
        polar_subscription_id: subscriptionData.polar_subscription_id,
      });
    } catch (error) {
      console.error('Error fetching user subscription status:', error);
      
      // 云端部署失败时，设置默认的免费状态
      setUserSubscriptionStatus({
        is_premium: false,
        subscription_plan: 'free',
        subscription_status: 'expired',
        subscription_period_start: '',
        subscription_period_end: '',
        effective_end_date: '',
        days_left: 0,
        expired_date: '',
      });
    } finally {
      setIsLoadingSubscriptionStatus(false);
    }
  };

  // 自动获取订阅状态
  useEffect(() => {
    fetchUserSubscriptionStatus();
  }, [isLocalDeployment]);

  return (
    <AppSettingsContext.Provider
      value={{
        cloudModels,
        localModels,
        availableModels,
        isLocalDeployment,
        isLoadingLocalModels,
        ollamaConnected,
        toggleModelAvailability,
        addLocalModel,
        removeLocalModel,
        refreshLocalModels,
        userSubscriptionStatus,
        isLoadingSubscriptionStatus,
        fetchUserSubscriptionStatus,
        getAuthHeaders,
        getUserToken,
        getCustomAuthHeaders,
        warns,
        addWarn,
        removeWarn,
        clearWarns,
        toggleWarnExpand,
      }}
    >
      {children}
      {/* 使用抽离出来的警告组件 */}
      <WarningToast 
        warns={warns}
        clearWarns={clearWarns}
        removeWarn={removeWarn}
        toggleWarnExpand={toggleWarnExpand}
      />
    </AppSettingsContext.Provider>
  );
};

// 自定义 hook
export const useAppSettings = () => {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error('useAppSettings must be used within AppSettingsProvider');
  }
  return context;
}; 
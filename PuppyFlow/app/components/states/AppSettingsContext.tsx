import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import WarningToast from '../misc/WarningToast';
import { useOllamaModels } from '../hooks/useOllamaModels';

// 定义模型类型
export type Model = {
  id: string;
  name: string;
  provider?: string;
  isLocal?: boolean;
  active?: boolean;
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
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', isLocal: false, active: true },
  { id: 'openai/gpt-4o-2024-11-20', name: 'GPT-4o (2024-11-20)', provider: 'OpenAI', isLocal: false, active: true },
  { id: 'openai/gpt-4.5-preview', name: 'GPT-4.5 Preview', provider: 'OpenAI', isLocal: false, active: true },
  { id: 'openai/o1', name: 'o1', provider: 'OpenAI', isLocal: false, active: true },
  { id: 'openai/o3-mini', name: 'o3 Mini', provider: 'OpenAI', isLocal: false, active: true },
  { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek Chat v3', provider: 'DeepSeek', isLocal: false, active: true },
  { id: 'deepseek/deepseek-r1-zero:free', name: 'DeepSeek R1 Zero', provider: 'DeepSeek', isLocal: false, active: true },
  { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'Anthropic', isLocal: false, active: true },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', isLocal: false, active: true },
  { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', provider: 'Anthropic', isLocal: false, active: true },
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
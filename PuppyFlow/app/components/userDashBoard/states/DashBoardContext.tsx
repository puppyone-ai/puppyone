import React, { createContext, useContext, useState, ReactElement } from "react";
import { useFlowsPerUserContext } from '../../states/FlowsPerUserContext';

// Model types
export type CloudModel = {
  id: string;
  name: string;
  provider: string;
  active: boolean;
};

export type LocalModel = {
  id: string;
  name: string;
  path: string;
  active: boolean;
};

// Context type definition
export type DashboardContextType = {
  // User Settings
  userName: string | undefined;
  emailNotifications: boolean;
  setEmailNotifications: React.Dispatch<React.SetStateAction<boolean>>;
  
  // AI Models
  cloudModels: CloudModel[];
  localModels: LocalModel[];
  newModelName: string;
  newModelPath: string;
  showAddForm: boolean;
  setCloudModels: React.Dispatch<React.SetStateAction<CloudModel[]>>;
  setLocalModels: React.Dispatch<React.SetStateAction<LocalModel[]>>;
  setNewModelName: React.Dispatch<React.SetStateAction<string>>;
  setNewModelPath: React.Dispatch<React.SetStateAction<string>>;
  setShowAddForm: React.Dispatch<React.SetStateAction<boolean>>;
  toggleCloudModel: (id: string) => void;
  toggleLocalModel: (id: string) => void;
  addLocalModel: () => void;
  removeLocalModel: (id: string) => void;
  
  // Tab navigation
  activeTab: 'settings' | 'models' | 'billing' | 'servers';
  onTabChange: (tab: 'settings' | 'models' | 'billing' | 'servers') => void;
  onClose: () => void;
};

// Create the context
export const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

// Provider props
type DashboardProviderProps = {
  children: ReactElement | null;
  activeTab: 'settings' | 'models' | 'billing' | 'servers';
  onTabChange: (tab: 'settings' | 'models' | 'billing' | 'servers') => void;
  onClose: () => void;
};

// Provider component
export const DashboardProvider = ({ 
  children,
  activeTab,
  onTabChange,
  onClose
}: DashboardProviderProps): ReactElement => {
  const { userName } = useFlowsPerUserContext();
  const [emailNotifications, setEmailNotifications] = useState(true);
  
  const [cloudModels, setCloudModels] = useState<CloudModel[]>([
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', active: true },
    { id: 'openai/gpt-4o-2024-11-20', name: 'GPT-4o (2024-11-20)', provider: 'OpenAI', active: true },
    { id: 'openai/gpt-4.5-preview', name: 'GPT-4.5 Preview', provider: 'OpenAI', active: false },
    { id: 'openai/o1', name: 'o1', provider: 'OpenAI', active: true },
    { id: 'openai/o3-mini', name: 'o3 Mini', provider: 'OpenAI', active: false },
    { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek Chat v3', provider: 'DeepSeek', active: true },
    { id: 'deepseek/deepseek-r1-zero', name: 'DeepSeek R1 Zero', provider: 'DeepSeek', active: false },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'Anthropic', active: true },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', active: false },
    { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', provider: 'Anthropic', active: true },
  ]);
  
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  
  const [newModelName, setNewModelName] = useState('');
  const [newModelPath, setNewModelPath] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const toggleCloudModel = (id: string) => {
    setCloudModels(cloudModels.map(model => 
      model.id === id ? { ...model, active: !model.active } : model
    ));
  };

  const toggleLocalModel = (id: string) => {
    setLocalModels(localModels.map(model => 
      model.id === id ? { ...model, active: !model.active } : model
    ));
  };

  const addLocalModel = () => {
    if (newModelName && newModelPath) {
      const newModel = {
        id: `local-${Date.now()}`,
        name: newModelName,
        path: newModelPath,
        active: true
      };
      setLocalModels([...localModels, newModel]);
      setNewModelName('');
      setNewModelPath('');
      setShowAddForm(false);
    }
  };

  const removeLocalModel = (id: string) => {
    setLocalModels(localModels.filter(model => model.id !== id));
  };

  return (
    <DashboardContext.Provider 
      value={{
        // User settings
        userName,
        emailNotifications,
        setEmailNotifications,
        
        // AI Models
        cloudModels,
        localModels,
        newModelName,
        newModelPath,
        showAddForm,
        setCloudModels,
        setLocalModels,
        setNewModelName,
        setNewModelPath,
        setShowAddForm,
        toggleCloudModel,
        toggleLocalModel,
        addLocalModel,
        removeLocalModel,
        
        // Tab navigation
        activeTab,
        onTabChange,
        onClose,
      }}
    >
      {children}
    </DashboardContext.Provider>
  );
};

// Custom hook to use the dashboard context
export const useDashboardContext = () => {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboardContext must be used within DashboardProvider');
  }
  return context;
};

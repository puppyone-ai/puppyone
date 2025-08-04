import React, {
  createContext,
  useContext,
  useState,
  ReactElement,
  useEffect,
} from 'react';
import { useWorkspaces } from '../../states/UserWorkspacesContext';
import { useAppSettings } from '../../states/AppSettingsContext';

// Model types
export type CloudModel = {
  id: string;
  name: string;
  provider: string;
  active: boolean;
  type?: 'llm' | 'embedding';
};

export type LocalModel = {
  id: string;
  name: string;
  path: string;
  active: boolean;
  type?: 'llm' | 'embedding';
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
  activeTab: 'settings' | 'models' | 'billing' | 'usage' | 'servers';
  onTabChange: (
    tab: 'settings' | 'models' | 'billing' | 'usage' | 'servers'
  ) => void;
  onClose: () => void;
};

// Create the context
export const DashboardContext = createContext<DashboardContextType | undefined>(
  undefined
);

// Provider props
type DashboardProviderProps = {
  children: ReactElement | null;
  activeTab: 'settings' | 'models' | 'billing' | 'usage' | 'servers';
  onTabChange: (
    tab: 'settings' | 'models' | 'billing' | 'usage' | 'servers'
  ) => void;
  onClose: () => void;
};

// Provider component
export const DashboardProvider = ({
  children,
  activeTab,
  onTabChange,
  onClose,
}: DashboardProviderProps): ReactElement => {
  const { userName } = useWorkspaces();
  const [emailNotifications, setEmailNotifications] = useState(true);

  // 使用AppSettingsContext
  const {
    cloudModels: globalCloudModels,
    localModels: globalLocalModels,
    toggleModelAvailability,
    addLocalModel: addGlobalLocalModel,
    removeLocalModel: removeGlobalLocalModel,
  } = useAppSettings();

  // 将全局模型映射到Dashboard需要的格式
  const [cloudModels, setCloudModels] = useState<CloudModel[]>([]);
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);

  // 当全局模型变化时，更新Dashboard的模型
  useEffect(() => {
    // 转换云端模型
    const mappedCloudModels = globalCloudModels.map(model => ({
      id: model.id,
      name: model.name,
      provider: model.provider || 'Unknown',
      active: model.active || false,
      type: model.type,
    }));
    setCloudModels(mappedCloudModels);

    // 转换本地模型 - 在这里我们为path提供一个默认空字符串
    const mappedLocalModels = globalLocalModels.map(model => ({
      id: model.id,
      name: model.name,
      path: '', // 使用空字符串作为path的默认值
      active: model.active || false,
      type: model.type,
    }));
    setLocalModels(mappedLocalModels);
  }, [globalCloudModels, globalLocalModels]);

  const [newModelName, setNewModelName] = useState('');
  const [newModelPath, setNewModelPath] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // 连接Dashboard操作到全局模型管理
  const toggleCloudModel = (id: string) => {
    toggleModelAvailability(id);
  };

  const toggleLocalModel = (id: string) => {
    toggleModelAvailability(id);
  };

  const addLocalModel = () => {
    if (newModelName) {
      addGlobalLocalModel({
        id: `local-${Date.now()}`,
        name: newModelName,
        active: true,
      });
      setNewModelName('');
      setNewModelPath('');
      setShowAddForm(false);
    }
  };

  const removeLocalModel = (id: string) => {
    removeGlobalLocalModel(id);
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
    throw new Error(
      'useDashboardContext must be used within DashboardProvider'
    );
  }
  return context;
};

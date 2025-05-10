import React from 'react';
import { DashboardProvider, useDashboardContext } from './states/DashBoardContext';
import Settings from './Settings';
import Models from './Models';
import Billing from './Billing';
import DeployedServers from './DeployedServer';

type DashboardProps = {
  activeTab: 'settings' | 'models' | 'billing' | 'servers';
  onTabChange: (tab: 'settings' | 'models' | 'billing' | 'servers') => void;
  onClose: () => void;
};

function Dashboard({ activeTab, onTabChange, onClose }: DashboardProps) {
  return (
    <DashboardProvider activeTab={activeTab} onTabChange={onTabChange} onClose={onClose}>
      <div className="flex flex-col h-[600px]">
        {/* Main Content with Sidebar */}
        <div className="flex flex-1 gap-8 text-[14px] font-medium">
          {/* Sidebar Navigation */}
          <div className="w-48 border-r border-[#404040]">
            <nav className="space-y-1 pr-4">
              <button
                onClick={() => onTabChange('settings')}
                className={`w-full text-left px-4 py-2 rounded-md transition-colors ${
                  activeTab === 'settings'
                    ? 'bg-[#36404A] text-[#60A5FA]'
                    : 'text-[#888888] hover:bg-[#333333] hover:text-white'
                }`}
              >
                User Settings
              </button>
              <button
                onClick={() => onTabChange('models')}
                className={`w-full text-left px-4 py-2 rounded-md transition-colors ${
                  activeTab === 'models'
                    ? 'bg-[#36404A] text-[#60A5FA]'
                    : 'text-[#888888] hover:bg-[#333333] hover:text-white'
                }`}
              >
                AI Models
              </button>
              <button
                onClick={() => onTabChange('servers')}
                className={`w-full text-left px-4 py-2 rounded-md transition-colors ${
                  activeTab === 'servers'
                    ? 'bg-[#36404A] text-[#60A5FA]'
                    : 'text-[#888888] hover:bg-[#333333] hover:text-white'
                }`}
              >
                Deployed Servers
              </button>
              <button
                onClick={() => onTabChange('billing')}
                className={`w-full text-left px-4 py-2 rounded-md transition-colors ${
                  activeTab === 'billing'
                    ? 'bg-[#36404A] text-[#60A5FA]'
                    : 'text-[#888888] hover:bg-[#333333] hover:text-white'
                }`}
              >
                Billing
              </button>
            </nav>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto pr-4">
            {activeTab === 'settings' ? (
              <Settings />
            ) : activeTab === 'models' ? (
              <Models />
            ) : activeTab === 'servers' ? (
              <DeployedServers />
            ) : (
              <Billing />
            )}
          </div>
        </div>

        {/* Footer */}
        <Footer />
      </div>
    </DashboardProvider>
  );
}

// Separate Footer component
const Footer: React.FC = () => {
  const { onClose } = useDashboardContext();

  return (
    <div className="flex justify-end gap-3 pt-6 border-t border-[#404040]">
      <button
        onClick={onClose}
        className="px-4 py-2 text-[#CDCDCD] hover:text-white rounded-md transition duration-200"
      >
        Cancel
      </button>
      <button className="px-4 py-2 bg-[#2B5C9B] hover:bg-[#1E4B8A] text-white rounded-md transition duration-200">
        Save Changes
      </button>
    </div>
  );
};

export default Dashboard;

import React from 'react';
import {
  DashboardProvider,
  useDashboardContext,
} from './states/DashBoardContext';
import Settings from './Settings';
import Models from './Models';
import Billing from './Billing';
import Usage from './Usage';
import DeployedServers from './DeployedServer';

type DashboardProps = {
  activeTab: 'settings' | 'models' | 'billing' | 'usage' | 'servers';
  onTabChange: (
    tab: 'settings' | 'models' | 'billing' | 'usage' | 'servers'
  ) => void;
  onClose: () => void;
};

function Dashboard({ activeTab, onTabChange, onClose }: DashboardProps) {
  return (
    <DashboardProvider
      activeTab={activeTab}
      onTabChange={onTabChange}
      onClose={onClose}
    >
      <div className='flex h-[600px] text-[14px] font-medium'>
        {/* Sidebar Navigation (贯穿全高) */}
        <div className='w-48 h-full border-r border-[#2f2f2f] bg-transparent py-2'>
          <nav className='space-y-1 px-2'>
              <button
                onClick={() => onTabChange('settings')}
              className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'settings'
                  ? 'bg-[#343434] text-white font-semibold'
                  : 'text-[#a1a1a1] hover:bg-[#2f2f2f] hover:text-[#e5e5e5]'
              }`}
              >
                User Settings
              </button>
              <button
                onClick={() => onTabChange('models')}
              className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'models'
                  ? 'bg-[#343434] text-white font-semibold'
                  : 'text-[#a1a1a1] hover:bg-[#2f2f2f] hover:text-[#e5e5e5]'
              }`}
              >
                AI Models
              </button>
              <button
                onClick={() => onTabChange('servers')}
              className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'servers'
                  ? 'bg-[#343434] text-white font-semibold'
                  : 'text-[#a1a1a1] hover:bg-[#2f2f2f] hover:text-[#e5e5e5]'
              }`}
              >
                Deployed Servers
              </button>
              <button
                onClick={() => onTabChange('usage')}
              className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'usage'
                  ? 'bg-[#343434] text-white font-semibold'
                  : 'text-[#a1a1a1] hover:bg-[#2f2f2f] hover:text-[#e5e5e5]'
              }`}
              >
                Usage
              </button>
              <button
                onClick={() => onTabChange('billing')}
              className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'billing'
                  ? 'bg-[#343434] text-white font-semibold'
                  : 'text-[#a1a1a1] hover:bg-[#2f2f2f] hover:text-[#e5e5e5]'
              }`}
              >
                Billing
              </button>
          </nav>
        </div>

        {/* Right Column: Content + Footer */}
        <div className='flex flex-col flex-1 pl-6 pr-4'>
          <div className='flex-1 overflow-y-auto'>
            {activeTab === 'settings' ? (
              <Settings />
            ) : activeTab === 'models' ? (
              <Models />
            ) : activeTab === 'servers' ? (
              <DeployedServers />
            ) : activeTab === 'usage' ? (
              <Usage />
            ) : (
              <Billing />
            )}
          </div>

          {/* Footer */}
          <Footer />
        </div>
      </div>
    </DashboardProvider>
  );
}

// Separate Footer component
const Footer: React.FC = () => {
  const { onClose } = useDashboardContext();

  return (
        <div className='flex justify-end gap-3 pt-6 border-t border-[#343434]'>
      <button
        onClick={onClose}
            className='btn btn-ghost'
      >
        Cancel
      </button>
          <button className='btn btn-primary'>
        Save Changes
      </button>
    </div>
  );
};

export default Dashboard;

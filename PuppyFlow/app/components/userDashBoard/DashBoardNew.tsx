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
      <div className='flex h-[600px] text-[13px] text-[#D4D4D4]'>
        {/* Sidebar Navigation (贯穿全高) */}
        <div className='w-56 h-full border-r border-[#2f2f2f] bg-transparent py-3'>
          <nav className='space-y-0.5 px-2'>
            <div className='px-2 pb-1 text-[12px] font-semibold text-[#9CA3AF]'>Account</div>
              <button
                onClick={() => onTabChange('settings')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'settings'
                  ? 'relative bg-[#1F1F1F] text-[#E5E5E5] before:content-[""] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-full before:bg-[#4091FF]'
                  : 'text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]'
              }`}
              >
                <svg className='w-4 h-4' viewBox='0 0 20 20' fill='currentColor'>
                  <path d='M10 2a4 4 0 014 4v1h1a2 2 0 110 4h-1v1a4 4 0 11-8 0V11H5a2 2 0 110-4h1V6a4 4 0 014-4z' />
                </svg>
                <span className='text-[13px]'>Preferences</span>
              </button>
              <button
                onClick={() => onTabChange('models')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'models'
                  ? 'relative bg-[#1F1F1F] text-[#E5E5E5] before:content-[""] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-full before:bg-[#4091FF]'
                  : 'text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]'
              }`}
              >
                <svg className='w-4 h-4' viewBox='0 0 20 20' fill='currentColor'>
                  <path d='M4 3h12a1 1 0 011 1v4H3V4a1 1 0 011-1zm-1 8h14v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4z' />
                </svg>
                <span className='text-[13px]'>AI Models</span>
              </button>
              <div className='px-2 pt-2 pb-1 text-[12px] font-semibold text-[#9CA3AF]'>Workspace</div>
              <button
                onClick={() => onTabChange('servers')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'servers'
                  ? 'relative bg-[#1F1F1F] text-[#E5E5E5] before:content-[""] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-full before:bg-[#4091FF]'
                  : 'text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]'
              }`}
              >
                <svg className='w-4 h-4' viewBox='0 0 20 20' fill='currentColor'>
                  <path d='M3 4a2 2 0 012-2h10a2 2 0 012 2v3H3V4zm0 5h14v3a2 2 0 01-2 2H5a2 2 0 01-2-2V9z' />
                </svg>
                <span className='text-[13px]'>Deployed Servers</span>
              </button>
              <button
                onClick={() => onTabChange('usage')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'usage'
                  ? 'relative bg-[#1F1F1F] text-[#E5E5E5] before:content-[""] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-full before:bg-[#4091FF]'
                  : 'text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]'
              }`}
              >
                <svg className='w-4 h-4' viewBox='0 0 20 20' fill='currentColor'>
                  <path d='M11 2a1 1 0 011 1v6h5a1 1 0 110 2h-6a1 1 0 01-1-1V3a1 1 0 011-1zM4 9a1 1 0 10-2 0v6a1 1 0 102 0V9zm5 3a1 1 0 10-2 0v3a1 1 0 102 0v-3zm5-2a1 1 0 10-2 0v5a1 1 0 102 0V10z' />
                </svg>
                <span className='text-[13px]'>Usage</span>
              </button>
              <button
                onClick={() => onTabChange('billing')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'billing'
                  ? 'relative bg-[#1F1F1F] text-[#E5E5E5] before:content-[""] before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-[3px] before:h-4 before:rounded-full before:bg-[#4091FF]'
                  : 'text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]'
              }`}
              >
                <svg className='w-4 h-4' viewBox='0 0 20 20' fill='currentColor'>
                  <path d='M2 5a2 2 0 012-2h12a2 2 0 012 2v2H2V5zm0 4h16v6a2 2 0 01-2 2H4a2 2 0 01-2-2V9zm3 3a1 1 0 100 2h4a1 1 0 100-2H5z' />
                </svg>
                <span className='text-[13px]'>Billing</span>
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
        <div className='flex justify-end gap-2 pt-6 border-t border-[#2A2A2A]'>
      <button
        onClick={onClose}
            className='inline-flex items-center justify-center rounded-md text-[13px] font-medium px-2.5 py-1.5 text-[#E5E5E5] hover:bg-[#1A1A1A] transition-colors active:scale-95'
      >
        Cancel
      </button>
          <button className='inline-flex items-center justify-center rounded-md text-[13px] font-medium px-3 py-1.5 border border-[#2A2A2A] bg-[#141414] text-[#E5E5E5] hover:bg-[#1A1A1A] transition-colors active:scale-95'>
        Save Changes
      </button>
    </div>
  );
};

export default Dashboard;

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
            <div className='px-2 pb-1 text-[12px] font-semibold text-[#9CA3AF]'>
              Account
            </div>
            <button
              onClick={() => onTabChange('settings')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'settings'
                  ? 'bg-[#1F1F1F] text-[#E5E5E5]'
                  : 'text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]'
              }`}
            >
              <svg
                className='w-4 h-4'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                aria-hidden='true'
              >
                <circle cx='12' cy='12' r='10' />
                <circle cx='12' cy='10' r='3' />
                <path d='M6 18c2-2 4-3 6-3s4 1 6 3' />
              </svg>
              <span className='text-[13px]'>Preferences</span>
            </button>
            <button
              onClick={() => onTabChange('models')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'models'
                  ? 'bg-[#1F1F1F] text-[#E5E5E5]'
                  : 'text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]'
              }`}
            >
              <svg
                className='w-4 h-4'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                aria-hidden='true'
              >
                <ellipse cx='12' cy='12' rx='8' ry='4' />
                <ellipse
                  cx='12'
                  cy='12'
                  rx='8'
                  ry='4'
                  transform='rotate(60 12 12)'
                />
                <ellipse
                  cx='12'
                  cy='12'
                  rx='8'
                  ry='4'
                  transform='rotate(-60 12 12)'
                />
                <circle
                  cx='12'
                  cy='12'
                  r='1.5'
                  fill='currentColor'
                  stroke='none'
                />
              </svg>
              <span className='text-[13px]'>AI Models</span>
            </button>
            <div className='px-2 pt-2 pb-1 text-[12px] font-semibold text-[#9CA3AF]'>
              Workspace
            </div>
            <button
              onClick={() => onTabChange('servers')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'servers'
                  ? 'bg-[#1F1F1F] text-[#E5E5E5]'
                  : 'text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]'
              }`}
            >
              <svg
                className='w-4 h-4'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                aria-hidden='true'
              >
                <path d='M12 2c-3 2-4 6-4 9v3l-2 2 3 .5.5 3L12 18l2.5 1.5.5-3 3-.5-2-2v-3c0-3-1-7-4-9z' />
                <circle cx='12' cy='9.5' r='1.5' />
                <path d='M9 14l-2 2m8-2l2 2' />
                <path
                  d='M12 18s-1.5 1.5-1.5 3c0 .6.4 1 1.5 1s1.5-.4 1.5-1c0-1.5-1.5-3-1.5-3z'
                  fill='currentColor'
                  stroke='none'
                />
              </svg>
              <span className='text-[13px]'>Deployed Servers</span>
            </button>
            <button
              onClick={() => onTabChange('usage')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'usage'
                  ? 'bg-[#1F1F1F] text-[#E5E5E5]'
                  : 'text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-[#E5E5E5]'
              }`}
            >
              <svg
                className='w-4 h-4'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                aria-hidden='true'
              >
                <polyline points='3 12 8 12 10 7 14 17 16 12 21 12' />
              </svg>
              <span className='text-[13px]'>Usage</span>
            </button>
            <button
              onClick={() => onTabChange('billing')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                activeTab === 'billing'
                  ? 'bg-[#1F1F1F] text-[#E5E5E5]'
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
        className='h-[28px] px-[14px] rounded-[6px] text-[12px] font-medium transition-all duration-200 flex items-center justify-center bg-[#2A2A2A] hover:bg-[#333333] text-[#CDCDCD] border border-[#404040] hover:border-[#505050]'
      >
        Cancel
      </button>
      <button className='h-[28px] px-[14px] rounded-[6px] text-[12px] font-medium transition-all duration-200 flex items-center justify-center bg-[#4599DF] hover:bg-[#3A85CC] text-white shadow-sm hover:shadow-md'>
        Save Changes
      </button>
    </div>
  );
};

export default Dashboard;

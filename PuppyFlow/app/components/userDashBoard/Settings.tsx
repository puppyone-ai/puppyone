import React from 'react';
import { useDashboardContext } from './states/DashBoardContext';

const Settings: React.FC = () => {
  const { userName, emailNotifications, setEmailNotifications } =
    useDashboardContext();

  return (
    <div className='space-y-4 max-h-[500px] pr-2 text-[13px] text-[#D4D4D4]'>
      <h3 className='text-[16px] font-semibold text-[#E5E5E5] sticky top-0 z-10 bg-[#2A2A2A] border-b border-[#343434] py-2'>
        User Settings
      </h3>

      <div className='py-[8px] overflow-y-auto'>
        {/* Profile Section */}
        <div className='rounded-lg border border-[#2A2A2A] bg-[#141414] p-4 mb-4 flex items-center gap-4'>
          <div className='w-12 h-12 rounded-md bg-[#3A3A3A] flex items-center justify-center'>
            <span className='text-xl text-[#A1A1A1]'>🐶</span>
          </div>
          <div className='flex flex-col gap-0.5'>
            <span className='text-[#E5E5E5] text-[14px] font-medium'>
              {userName ?? 'User'}
            </span>
            <span className='text-[#8B8B8B] text-[12px] font-normal'>
              @{userName?.toLowerCase() ?? 'user'}
            </span>
          </div>
        </div>

        {/* Preferences Section */}
        <div className='px-1'>
          <div className='text-[11px] uppercase tracking-wide text-[#9CA3AF] mb-2'>Preferences</div>
        </div>
        <div className='rounded-lg border border-[#2A2A2A] bg-[#141414] overflow-hidden'>
          <div className='divide-y divide-[#2A2A2A]'>
            <div className='flex items-center justify-between px-4 py-3 hover:bg-[#101010]'>
              <div>
                <div className='text-[13px] text-[#E5E5E5]'>Email notifications</div>
                <div className='text-[12px] text-[#8B8B8B]'>Get product updates and alerts</div>
              </div>
              <div
                onClick={() => setEmailNotifications(!emailNotifications)}
                className={`w-10 h-5 ${
                  emailNotifications ? 'bg-[#4091FF]' : 'bg-[#2F2F2F]'
                } rounded-full p-0.5 cursor-pointer transition-colors duration-200`}
                role='switch'
                aria-checked={emailNotifications}
              >
                <div
                  className={`w-4 h-4 bg-white rounded-full transform transition-transform duration-200 ${
                    emailNotifications ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;

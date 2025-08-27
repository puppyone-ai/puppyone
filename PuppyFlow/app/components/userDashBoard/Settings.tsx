import React from 'react';
import { useDashboardContext } from './states/DashBoardContext';

const Settings: React.FC = () => {
  const { userName, emailNotifications, setEmailNotifications } =
    useDashboardContext();

  return (
    <div className='space-y-4 max-h-[500px] pr-2'>
      <h3 className='text-[16px] font-semibold text-[#E5E5E5] sticky top-0 z-10 bg-[#2A2A2A] border-b border-[#343434] py-2'>
        User Settings
      </h3>

      <div className='py-[8px] overflow-y-auto'>
        {/* Profile Section */}
        <div className='ui-card mb-4 flex items-center gap-6'>
          <div className='w-16 h-16 rounded-full bg-[#3A3A3A] flex items-center justify-center'>
            <span className='text-2xl text-[#A1A1A1]'>🐶</span>
          </div>
          <div className='flex flex-col gap-0.5'>
            <span className='text-[#E5E5E5] text-[15px] font-medium'>
              {userName ?? 'User'}
            </span>
            <span className='text-[#8B8B8B] text-[12px] font-regular'>
              @{userName?.toLowerCase() ?? 'user'}
            </span>
          </div>
        </div>

        {/* Preferences Section */}
        <h4 className='ui-heading mb-2'>Preferences</h4>
        <div className='ui-card'>
          <div className='flex items-center justify-between'>
            <span className='text-[13px] text-[#E5E5E5]'>Email Notifications</span>
            <div
              onClick={() => setEmailNotifications(!emailNotifications)}
              className={`w-10 h-5 ${
                emailNotifications ? 'bg-[#16A34A]' : 'bg-[#404040]'
              } rounded-full p-0.5 cursor-pointer transition-colors duration-200`}
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
  );
};

export default Settings;

import React from 'react';
import { useDashboardContext } from './states/DashBoardContext';

const Settings: React.FC = () => {
  const { userName, emailNotifications, setEmailNotifications } =
    useDashboardContext();

  return (
    <div className='space-y-6 max-h-[500px] pr-2'>
      <h3 className='text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]'>
        User Settings
      </h3>

      <div className='py-[8px] overflow-y-auto'>
        {/* Profile Section */}
        <div className='flex items-center gap-6 p-4 bg-[#333333] rounded-lg mb-6'>
          <div className='w-20 h-20 rounded-full bg-[#4A4A4A] flex items-center justify-center'>
            <span className='text-3xl text-[#888888]'>🐶</span>
          </div>
          <div className='flex flex-col gap-1'>
            <span className='text-white text-[16px] font-medium'>
              {userName ?? 'User'}
            </span>
            <span className='text-[#888888] text-[14px] font-regular'>
              @{userName?.toLowerCase() ?? 'user'}
            </span>
          </div>
        </div>

        {/* Preferences Section */}
        <h4 className='text-[16px] font-medium text-[#AAAAAA] mb-4'>
          Preferences
        </h4>
        <div className='bg-[#333333] rounded-lg p-4'>
          <div className='flex items-center justify-between'>
            <span className='text-[14px] text-white'>Email Notifications</span>
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

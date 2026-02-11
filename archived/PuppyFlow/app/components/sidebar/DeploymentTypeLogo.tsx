'use client';

import React, { useState } from 'react';

function DeploymentTypeLogo() {
  const [showVersionPopup, setShowVersionPopup] = useState(false);

  const handleDeploymentTypeClick = () => {
    setShowVersionPopup(!showVersionPopup);
  };

  return (
    <div className='relative'>
      <div
        className='flex items-center justify-center w-[40px] h-[40px] rounded-md cursor-pointer select-none hover:bg-[#313131] transition-colors duration-200'
        onClick={handleDeploymentTypeClick}
      >
        {/* Conditional icon for deployment type */}
        {(process.env.NEXT_PUBLIC_DEPLOYMENT_MODE || '').toLowerCase() !==
        'cloud' ? (
          <svg
            className='w-4 h-4 text-[#5D6065]'
            fill='currentColor'
            viewBox='0 0 14 10'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M0 8C0 7.73478 0.105357 7.48043 0.292893 7.29289C0.48043 7.10536 0.734784 7 1 7H13C13.2652 7 13.5196 7.10536 13.7071 7.29289C13.8946 7.48043 14 7.73478 14 8V9C14 9.26522 13.8946 9.51957 13.7071 9.70711C13.5196 9.89464 13.2652 10 13 10H1C0.734784 10 0.48043 9.89464 0.292893 9.70711C0.105357 9.51957 0 9.26522 0 9V8Z'
              fill='#6D7177'
            />
            <path
              d='M12 0C12.2652 0 12.5195 0.105432 12.707 0.292969C12.8946 0.480505 13 0.734784 13 1V7H11V2H3V7H1V1C1 0.734784 1.10543 0.480505 1.29297 0.292969C1.48051 0.105432 1.73478 0 2 0H12Z'
              fill='#6D7177'
            />
          </svg>
        ) : (
          <svg
            className='w-4 h-4 text-[#5D6065] mx-auto'
            fill='currentColor'
            viewBox='0 0 16 16'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path d='M4.5 10.5a2.5 2.5 0 01-.48-4.95 3.5 3.5 0 016.96 0 2.5 2.5 0 01-.48 4.95h-6z' />
          </svg>
        )}
      </div>

      {showVersionPopup && (
        <div className="absolute left-full top-1/4 transform -translate-y-1/2 ml-3 bg-[#2A2A2A] border border-[#404040] rounded-md p-2 shadow-lg z-10 min-w-[96px] text-[11px] select-none before:content-[''] before:absolute before:left-[-6px] before:top-1/2 before:transform before:-translate-y-1/2 before:w-3 before:h-3 before:bg-[#2A2A2A] before:border-b before:border-l before:border-[#404040] before:rotate-45">
          <div className='flex flex-col space-y-1 text-[#AAAAAA]'>
            <div>
              Type:{' '}
              <span className='text-white'>
                {(
                  process.env.NEXT_PUBLIC_DEPLOYMENT_MODE || ''
                ).toLowerCase() === 'cloud'
                  ? 'Cloud'
                  : 'Local'}
              </span>
            </div>
            <div>
              Version:{' '}
              <span className='text-white'>
                {process.env.NEXT_PUBLIC_FRONTEND_VERSION}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DeploymentTypeLogo;

import React from 'react';

const Billing: React.FC = () => {
  return (
    <div className='space-y-6 max-h-[500px] pr-2'>
      <h3 className='text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]'>
        Billing
      </h3>

      <div className='py-[8px] overflow-y-auto'>
        <div className='bg-[#333333] rounded-lg p-6 text-center'>
          <span className='text-[#888888] text-[14px]'>
            🚧 Billing features coming soon
          </span>
          <p className='text-[#666666] text-[13px] mt-2'>
            This section is currently under development
          </p>
        </div>
      </div>
    </div>
  );
};

export default Billing;

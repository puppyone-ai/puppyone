import React from 'react';

const Billing: React.FC = () => {
  return (
    <div className='space-y-4 max-h-[500px] pr-2'>
      <h3 className='text-[16px] font-semibold text-[#E5E5E5] sticky top-0 z-10 bg-[#2A2A2A] border-b border-[#343434] py-2'>
        Billing
      </h3>

      <div className='py-[8px] overflow-y-auto'>
        <div className='max-w-[560px] mx-auto'>
          <div className='rounded-md border border-[#343434] bg-[#2B2B2B] p-4'>
            <span className='block text-[#A1A1A1] text-[13px]'>
              🚧 Billing features coming soon
            </span>
            <p className='text-[#8B8B8B] text-[12px] mt-1.5'>
              This section is currently under development
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Billing;

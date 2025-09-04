'use client';
import React from 'react';

type AuthExpiredPromptProps = {
  visible: boolean;
  onLogin: () => void;
  onDismiss: () => void;
};

const AuthExpiredPrompt: React.FC<AuthExpiredPromptProps> = ({
  visible,
  onLogin,
  onDismiss,
}) => {
  if (!visible) return null;

  return (
    <div className='fixed bottom-[32px] right-[16px] z-50'>
      <div
        className='bg-red-500 rounded-lg shadow-lg overflow-hidden transition-all duration-300 ease-in-out text-white w-[360px]'
        style={{ opacity: 0.97 }}
      >
        <div className='px-4 pt-3 pb-2'>
          <div className='flex items-start gap-2'>
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
              className='mt-1 flex-shrink-0'
            >
              <path
                d='M12 3L21 18H3L12 3Z'
                fill='white'
                stroke='white'
                strokeWidth='0.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <path
                d='M12 12V8'
                stroke='#FF3A3A'
                strokeWidth='2.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <circle cx='12' cy='15.5' r='1.25' fill='#FF3A3A' />
            </svg>
            <div className='flex-1 min-w-0'>
              <div className='text-[13px] font-medium'>Session expired</div>
              <div className='text-[12px] opacity-90 mt-0.5'>
                Your session has expired. Please sign in again to continue. You
                can sign in now or cancel to stay on this page.
              </div>
            </div>
          </div>
        </div>
        <div className='px-4 pb-3 flex items-center justify-end gap-2'>
          <button
            onClick={onDismiss}
            className='text-white/95 hover:text-white border border-white/40 hover:border-white/60 rounded-md px-3 py-1.5 text-[12px] transition-colors'
          >
            Cancel
          </button>
          <button
            onClick={onLogin}
            className='bg-white text-red-600 hover:bg-red-50 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors'
          >
            Sign in now
          </button>
        </div>
      </div>
    </div>
  );
};

export default AuthExpiredPrompt;

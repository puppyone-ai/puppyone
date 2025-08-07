import React, { useState } from 'react';

function ModeController() {
  // two mode: 1. workflow 2. treeschema. svg 需要render 两个
  const [mode, setMode] = useState('workflow');

  const changeToWorkflow = () => {
    setMode('workflow');
  };

  const changeToTreeSchema = () => {
    setMode('treeschema');
  };

  return (
    <button
      className={`border-[2px] border-solid border-[#3E3E41] bg-[#3E3E41] rounded-[7px] w-[37px] h-[24px] hover:cursor-pointer flex ${mode === 'workflow' ? 'justify-start' : 'justify-end'} transition-all items-center`}
      onClick={() =>
        setMode(prevMode =>
          prevMode === 'workflow' ? 'treeschema' : 'workflow'
        )
      }
    >
      <div
        className={`bg-[#1C1D1F] rounded-[6px] w-[20px] h-[20px] flex items-center justify-center`}
      >
        {mode === 'workflow' ? (
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='10'
            height='10'
            viewBox='0 0 10 10'
            fill='none'
          >
            <line
              x1='5.11523'
              y1='2.30762'
              x2='5.11523'
              y2='5.38454'
              stroke='#D9D9D9'
            />
            <line
              x1='8.19189'
              y1='4.61572'
              x2='8.19189'
              y2='6.92342'
              stroke='#D9D9D9'
            />
            <rect
              x='0.5'
              y='7.42285'
              width='2.84615'
              height='2.07692'
              stroke='#D9D9D9'
            />
            <path
              d='M3.57715 0.5H6.4233V2.57692H3.57715V0.5Z'
              stroke='#D9D9D9'
            />
            <rect
              x='6.65332'
              y='7.42285'
              width='2.84615'
              height='2.07692'
              stroke='#D9D9D9'
            />
            <path d='M1.53857 4.92969H8.69141' stroke='#D9D9D9' />
            <line
              x1='2.03857'
              y1='4.61572'
              x2='2.03857'
              y2='6.92342'
              stroke='#D9D9D9'
            />
          </svg>
        ) : (
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='10'
            height='10'
            viewBox='0 0 10 10'
            fill='none'
          >
            <path
              d='M2.80811 7.42285H9.50045V9.49977H2.80811V7.42285Z'
              stroke='#D9D9D9'
            />
            <path
              d='M0.5 5.11572H7.19235V7.19265H0.5V6.15418V5.11572Z'
              stroke='#D9D9D9'
            />
            <path
              d='M2.80811 2.80762H9.50045V4.88454H2.80811V2.80762Z'
              stroke='#D9D9D9'
            />
            <path d='M0.5 0.5H7.19235V2.57692H0.5V0.5Z' stroke='#D9D9D9' />
          </svg>
        )}
      </div>
    </button>
  );
}

export default ModeController;

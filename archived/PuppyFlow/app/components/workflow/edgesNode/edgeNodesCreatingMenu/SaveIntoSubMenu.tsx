import React from 'react';
import { Position } from '@xyflow/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';

type SaveIntoSubMenuProps = {
  nodeType: string;
  sourceNodeId: string;
  showMenu: number;
};

function SaveIntoSubMenu({
  nodeType,
  sourceNodeId,
  showMenu,
}: SaveIntoSubMenuProps) {
  return (
    <ul
      id='edgeMenu'
      className={`bg-[#1c1d1f] rounded-[11px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] top-[180px] left-[135px] gap-[3px] p-[3px] items-center ${showMenu === 1 ? '' : 'hidden'}`}
    >
      <li>
        <button
          className='w-[116px] h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer'
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            // createNewConnection('LLM')
          }}
        >
          <div className='flex items-center gap-[11px] flex-1'>
            <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
              <svg
                xmlns='http://www.w3.org/2000/svg'
                width='12'
                height='11'
                viewBox='0 0 12 11'
                fill='none'
              >
                <path
                  d='M0.5 0.5H7.56158L11.2806 10.5H0.5V0.5Z'
                  stroke='#CDCDCD'
                />
                <rect
                  x='0.5'
                  y='2.94458'
                  width='11'
                  height='7.55556'
                  fill='#1C1D1F'
                  stroke='#CDCDCD'
                />
              </svg>
            </div>
            <div className='text-[12px] font-[700] flex items-center justify-center h-full'>
              File
            </div>
          </div>
          <div className='h-full w-[7px] flex items-center justify-center mr-[9px]'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='7'
              height='10'
              viewBox='0 0 7 10'
              fill='none'
            >
              <path d='M1 1L5 5L1 9' stroke={'#CDCDCD'} strokeWidth='2' />
            </svg>
          </div>
        </button>
      </li>
    </ul>
  );
}

export default SaveIntoSubMenu;

import React from 'react';

type OthersSubMenuProps = {
  nodeType: string;
  sourceNodeId: string;
  showMenu: number;
};

function OthersSubMenu({
  nodeType,
  sourceNodeId,
  showMenu,
}: OthersSubMenuProps) {
  const topPosition =
    nodeType === 'text'
      ? 'top-[250px]'
      : nodeType === 'structured'
        ? 'top-[285px]'
        : 'top-[250px]';

  return (
    <ul
      id='edgeMenu'
      className={`bg-[#1c1d1f] rounded-[11px] border-solid border-[3px] border-[#42454A] absolute float-start flex flex-col justify-evenly z-[20001] ${topPosition} left-[135px] gap-[3px] p-[3px] items-center ${showMenu === 1 ? '' : 'hidden'}`}
    >
      <li className='w-full'>
        <button
          className='w-full h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer'
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            // createNewConnection('LLM')
          }}
        >
          <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='14'
              height='11'
              fill='none'
              viewBox='0 0 14 11'
            >
              <path
                fill='#CDCDCD'
                d='M3.799 6.344c-.04.123-.06.316-.064.576H2.417c.02-.55.072-.93.156-1.138.085-.211.303-.454.655-.727l.356-.279a1.24 1.24 0 0 0 .283-.288.982.982 0 0 0 .196-.59 1.12 1.12 0 0 0-.22-.674c-.143-.205-.407-.308-.791-.308-.378 0-.646.125-.806.376-.156.25-.234.511-.234.781H.6c.039-.927.363-1.585.971-1.972.384-.248.856-.372 1.416-.372.736 0 1.346.176 1.831.528.489.351.733.872.733 1.562 0 .424-.106.78-.318 1.07-.123.175-.36.4-.713.673l-.346.269a1.05 1.05 0 0 0-.376.513ZM3.838 9H2.383V7.589h1.455V9Zm7.961-2.656c-.04.123-.06.316-.064.576h-1.318c.02-.55.072-.93.156-1.138.085-.211.303-.454.654-.727l.357-.279a1.24 1.24 0 0 0 .283-.288.982.982 0 0 0 .195-.59 1.12 1.12 0 0 0-.22-.674c-.143-.205-.406-.308-.79-.308-.378 0-.646.125-.806.376-.156.25-.234.511-.234.781H8.6c.039-.927.363-1.585.971-1.972.384-.248.856-.372 1.416-.372.736 0 1.346.176 1.831.528.489.351.733.872.733 1.562 0 .424-.106.78-.318 1.07-.123.175-.361.4-.713.673l-.346.269a1.05 1.05 0 0 0-.376.513ZM11.838 9h-1.455V7.589h1.455V9Z'
              />
            </svg>
          </div>
          <div className='text-[12px] font-[700] flex items-center justify-center h-full'>
            query rewriting
          </div>
        </button>
      </li>
      <li className='w-full'>
        <button
          className='w-full h-[30px] bg-[#3E3E41] hover:bg-main-orange rounded-[5px] flex flex-row items-start gap-[11px] font-plus-jakarta-sans text-[#CDCDCD] hover:text-[#1C1D1F] py-[3px] pl-[3px] cursor-pointer'
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            // createNewConnection('LLM')
          }}
        >
          <div className='w-[24px] h-[24px] bg-[#1C1D1F] flex items-center justify-center rounded-[3px]'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='12'
              height='12'
              fill='none'
              viewBox='0 0 12 12'
            >
              <path
                fill='#1C1D1F'
                stroke='#CDCDCD'
                strokeWidth='1.5'
                d='M.75.75h10.5v6.5H.75z'
              />
              <path fill='#CDCDCD' d='m7 8-1 4-1-4h2Z' />
            </svg>
          </div>
          <div className='text-[12px] font-[700] flex items-center justify-center h-full'>
            generating
          </div>
        </button>
      </li>
    </ul>
  );
}

export default OthersSubMenu;

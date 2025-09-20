import React from 'react';
import AddNodeButton from './upbarComponent/AddNodeButton';
import GroupListButton from './upbarComponent/GroupListButton';
import Upright from './upbarComponent/Upright';

function Upbar() {
  const [openMenu, setOpenMenu] = React.useState<
    null | 'text' | 'structured' | 'file' | 'group'
  >(null);
  const closeTimeoutRef = React.useRef<number | null>(null);

  const openWithCancel = React.useCallback(
    (menuKey: 'text' | 'structured' | 'file' | 'group') => {
      if (closeTimeoutRef.current != null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      setOpenMenu(menuKey);
    },
    []
  );

  const scheduleClose = React.useCallback(() => {
    if (closeTimeoutRef.current != null) {
      window.clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = window.setTimeout(() => {
      setOpenMenu(null);
      closeTimeoutRef.current = null;
    }, 120);
  }, []);

  React.useEffect(() => {
    return () => {
      if (closeTimeoutRef.current != null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);
  return (
    <div className='w-full h-[48px] absolute top-[40px] left-0 z-[10000] pointer-events-none'>
      <div className='pointer-events-auto will-change-auto bg-[#2A2A2A] rounded-[12px] border border-transparent ring-1 ring-black/30 shadow-xl shadow-black/30 backdrop-blur-md flex flex-row items-center gap-[8px] px-[8px] py-[6px] absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'>
        {/* Inline +Add types (compact with per-button hover menu) */}
        <div
          className='relative'
          onMouseEnter={() => openWithCancel('text')}
          onMouseLeave={scheduleClose}
        >
          <button
            className='inline-flex items-center justify-center gap-0 h-[36px] w-[36px] rounded-md px-0 py-0 border border-[#2A2A2A] bg-transparent text-[#CDCDCD] hover:bg-[#444444] transition-colors'
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('openAddNodeMenu', {
                  detail: { preselect: 'text', startDirect: true },
                } as any)
              );
            }}
            title='Add Text'
            aria-label='Add Text'
          >
            <svg
              width='24'
              height='24'
              viewBox='0 0 20 20'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path d='M5 9V5H15V9' stroke='#CDCDCD' />
              <path d='M10 5V15' stroke='#CDCDCD' />
              <path d='M6.99768 14.5L13 14.5' stroke='#CDCDCD' />
            </svg>
          </button>
          <div
            className={`pointer-events-auto absolute left-1/2 -translate-x-1/2 top-full mt-2 z-[10001] ${openMenu === 'text' ? 'block' : 'hidden'}`}
            onMouseEnter={() => openWithCancel('text')}
            onMouseLeave={scheduleClose}
          >
            <div className='relative bg-[#1E1E1E] border border-[#343434] rounded-[10px] px-[12px] py-[10px] shadow-2xl text-left w-[220px]'>
              <div className='absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1E1E1E] rotate-45 border-l border-t border-[#343434]' />

              <div className='text-[12px] font-semibold text-[#E6E6E6] mb-[4px] font-plus-jakarta-sans'>
                Text Block
              </div>
              <div className='text-[11px] leading-5 text-[#AFAFAF] mb-[6px] font-plus-jakarta-sans'>
                Add a freeform text block. Click and drag to draw its size and
                type your content.
              </div>
              <a
                href='https://www.youtube.com/watch?v=wa9KiyFApVU'
                target='_blank'
                rel='noreferrer'
                className='text-[11px] text-[#4599DF] hover:underline font-plus-jakarta-sans'
              >
                Learn how to use ↗
              </a>
            </div>
          </div>
        </div>
        <div
          className='relative'
          onMouseEnter={() => openWithCancel('structured')}
          onMouseLeave={scheduleClose}
        >
          <button
            className='inline-flex items-center justify-center gap-0 h-[36px] w-[36px] rounded-md px-0 py-0 border border-[#2A2A2A] bg-transparent text-[#CDCDCD] hover:bg-[#444444] transition-colors'
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('openAddNodeMenu', {
                  detail: { preselect: 'structured', startDirect: true },
                } as any)
              );
            }}
            title='Add Structured'
            aria-label='Add Structured'
          >
            <svg
              width='24'
              height='24'
              viewBox='0 0 20 20'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path d='M7 5H4V15H7' stroke='#CDCDCD' />
              <path d='M13 5H16V15H13' stroke='#CDCDCD' />
              <rect
                x='7.25'
                y='7.25'
                width='0.5'
                height='0.5'
                fill='#CDCDCD'
                stroke='#CDCDCD'
                strokeWidth='0.5'
              />
              <mask id='path-4-inside-1_8567_40' fill='white'>
                <path d='M9.5 7H13V8H9.5V7Z' />
              </mask>
              <path d='M9.5 7H13V8H9.5V7Z' fill='#CDCDCD' />
              <path
                d='M9.5 7V6H8.5V7H9.5ZM13 7H14V6H13V7ZM13 8V9H14V8H13ZM9.5 8H8.5V9H9.5V8ZM9.5 7V8H13V7V6H9.5V7ZM13 7H12V8H13H14V7H13ZM13 8V7H9.5V8V9H13V8ZM9.5 8H10.5V7H9.5H8.5V8H9.5Z'
                fill='#CDCDCD'
                mask='url(#path-4-inside-1_8567_40)'
              />
              <mask id='path-6-inside-2_8567_40' fill='white'>
                <path d='M7 9.5H8V10.5H7V9.5Z' />
              </mask>
              <path d='M7 9.5H8V10.5H7V9.5Z' fill='#CDCDCD' />
              <path
                d='M7 9.5V8.5H6V9.5H7ZM8 9.5H9V8.5H8V9.5ZM8 10.5V11.5H9V10.5H8ZM7 10.5H6V11.5H7V10.5ZM7 9.5V10.5H8V9.5V8.5H7V9.5ZM8 9.5H7V10.5H8H9V9.5H8ZM8 10.5V9.5H7V10.5V11.5H8V10.5ZM7 10.5H8V9.5H7H6V10.5H7Z'
                fill='#CDCDCD'
                mask='url(#path-6-inside-2_8567_40)'
              />
              <mask id='path-8-inside-3_8567_40' fill='white'>
                <path d='M9.5 9.5H13V10.5H9.5V9.5Z' />
              </mask>
              <path d='M9.5 9.5H13V10.5H9.5V9.5Z' fill='#CDCDCD' />
              <path
                d='M9.5 9.5V8.5H8.5V9.5H9.5ZM13 9.5H14V8.5H13V9.5ZM13 10.5V11.5H14V10.5H13ZM9.5 10.5H8.5V11.5H9.5V10.5ZM9.5 9.5V10.5H13V9.5V8.5H9.5V9.5ZM13 9.5H12V10.5H13H14V9.5H13ZM13 10.5V9.5H9.5V10.5V11.5H13V10.5ZM9.5 10.5H10.5V9.5H9.5H8.5V10.5H9.5Z'
                fill='#CDCDCD'
                mask='url(#path-8-inside-3_8567_40)'
              />
              <rect
                x='7.25'
                y='12.25'
                width='0.5'
                height='0.5'
                fill='#CDCDCD'
                stroke='#CDCDCD'
                strokeWidth='0.5'
              />
              <mask id='path-11-inside-4_8567_40' fill='white'>
                <path d='M9.5 12H13V13H9.5V12Z' />
              </mask>
              <path d='M9.5 12H13V13H9.5V12Z' fill='#CDCDCD' />
              <path
                d='M9.5 12V11H8.5V12H9.5ZM13 12H14V11H13V12ZM13 13V14H14V13H13ZM9.5 13H8.5V14H9.5V13ZM9.5 12V13H13V12V11H9.5V12ZM13 12H12V13H13H14V12H13ZM13 13V12H9.5V13V14H13V13ZM9.5 13H10.5V12H9.5H8.5V13H9.5Z'
                fill='#CDCDCD'
                mask='url(#path-11-inside-4_8567_40)'
              />
            </svg>
          </button>
          <div
            className={`pointer-events-auto absolute left-1/2 -translate-x-1/2 top-full mt-2 z-[10001] ${openMenu === 'structured' ? 'block' : 'hidden'}`}
            onMouseEnter={() => openWithCancel('structured')}
            onMouseLeave={scheduleClose}
          >
            <div className='relative bg-[#1E1E1E] border border-[#343434] rounded-[10px] px-[12px] py-[10px] shadow-2xl text-left w-[220px]'>
              <div className='absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1E1E1E] rotate-45 border-l border-t border-[#343434]' />

              <div className='text-[12px] font-semibold text-[#E6E6E6] mb-[4px] font-plus-jakarta-sans'>
                Structured Block
              </div>
              <div className='text-[11px] leading-5 text-[#AFAFAF] mb-[6px] font-plus-jakarta-sans'>
                Add a structured JSON-style block. Drag to size, then define
                key-value content.
              </div>
            </div>
          </div>
        </div>
        <div
          className='relative'
          onMouseEnter={() => openWithCancel('file')}
          onMouseLeave={scheduleClose}
        >
          <button
            className='inline-flex items-center justify-center gap-0 h-[36px] w-[36px] rounded-md px-0 py-0 border border-[#2A2A2A] bg-transparent text-[#CDCDCD] hover:bg-[#444444] transition-colors'
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('openAddNodeMenu', {
                  detail: { preselect: 'file', startDirect: true },
                } as any)
              );
            }}
            title='Add File'
            aria-label='Add File'
          >
            <svg
              width='24'
              height='24'
              viewBox='0 0 20 20'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                d='M8.79297 5.5L10.793 7.5H15.5V14.5H4.5V5.5H8.79297Z'
                stroke='#CDCDCD'
              />
            </svg>
          </button>
          <div
            className={`pointer-events-auto absolute left-1/2 -translate-x-1/2 top-full mt-2 z-[10001] ${openMenu === 'file' ? 'block' : 'hidden'}`}
            onMouseEnter={() => openWithCancel('file')}
            onMouseLeave={scheduleClose}
          >
            <div className='relative bg-[#1E1E1E] border border-[#343434] rounded-[10px] px-[12px] py-[10px] shadow-2xl text-left w-[220px]'>
              <div className='absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1E1E1E] rotate-45 border-l border-t border-[#343434]' />

              <div className='text-[12px] font-semibold text-[#E6E6E6] mb-[4px] font-plus-jakarta-sans'>
                File Block
              </div>
              <div className='text-[11px] leading-5 text-[#AFAFAF] mb-[6px] font-plus-jakarta-sans'>
                Add a file block for documents. Drag to size, then upload files
                to process.
              </div>
            </div>
          </div>
        </div>
        {/** Weblink temporarily disabled */}
        {/**
        <button ...>Weblink</button>
        **/}
        {/* Vertical divider moved to Upbar level */}

        <div
          className='w-px h-[36px] bg-[#3e3e41] opacity-90 mx-0'
          aria-hidden
        ></div>
        <div
          className='relative'
          onMouseEnter={() => openWithCancel('group')}
          onMouseLeave={scheduleClose}
        >
          <GroupListButton />
          <div
            className={`pointer-events-auto absolute left-1/2 -translate-x-1/2 top-full mt-2 z-[10001] ${openMenu === 'group' ? 'block' : 'hidden'}`}
            onMouseEnter={() => openWithCancel('group')}
            onMouseLeave={scheduleClose}
          >
            <div className='relative bg-[#1E1E1E] border border-[#343434] rounded-[10px] px-[12px] py-[10px] shadow-2xl text-left w-[220px]'>
              <div className='absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#1E1E1E] rotate-45 border-l border-t border-[#343434]' />

              <div className='text-[12px] font-semibold text-[#E6E6E6] mb-[4px] font-plus-jakarta-sans'>
                Group
              </div>
              <div className='text-[11px] leading-5 text-[#AFAFAF] mb-[6px] font-plus-jakarta-sans'>
                Click to draw an area and create a group of nodes you can run or
                deploy together.
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Keep AddNodeButton mounted outside layout to avoid flex gap spacing */}
      <AddNodeButton showTriggerButton={false} />
      {/* Move resize (Controls) and Save outside the upbar card */}
      <div className='pointer-events-auto absolute right-[24px] top-1/2 -translate-y-1/2'>
        <Upright />
      </div>
    </div>
  );
}

export default Upbar;

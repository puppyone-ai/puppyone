import React from 'react'

type FullScreenControllerProps = {
    nodeid: string,
}

function FullScreenController({nodeid}: FullScreenControllerProps) {
  return (
    <button className='flex items-center justify-center'>
        <div>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M10.0002 2L6.57172 5.42853" stroke="#6D7177" strokeWidth="1.2"/>
            <path d="M9.99978 5.99997V2.00003H5.99984" stroke="#6D7177" strokeWidth="1.2"/>
            <path d="M5.99973 10.0005H1.99978V6.00057" stroke="#6D7177" strokeWidth="1.2"/>
            <path d="M5.42847 6.57129L1.99994 9.99982" stroke="#6D7177" strokeWidth="1.2"/>
            </svg>
        </div>
    </button>
  )
}

export default FullScreenController
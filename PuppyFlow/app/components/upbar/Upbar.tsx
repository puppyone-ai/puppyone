import React from 'react'
import AddNodeButton from './topLeftToolBar/AddNodeButton'
import TopRightToolBar from './topRightToolBar/TopRightToolBar'
import TopRightSaveHistoryButton from './topRightToolBar/SaveButton'

function Upbar() {
  return (
    <div className='w-full h-[44px] gap-[12px] absolute top-[48px] z-[10000] pl-[48px] pr-[48px] flex flex-row justify-between items-center flex-wrap pointer-events-none'>
        <div className='flex flex-row items-center gap-6 pointer-events-auto'>
          <AddNodeButton />
        </div>
        <div className='flex flex-row items-center justify-center gap-[20px]'>
          <TopRightToolBar />
        </div>
    </div>
  )
}

export default Upbar
import React from 'react'
import AddNodeButton from '../workflow/buttonControllers/AddNodeButton'
import TopRightToolBar from './topRightToolBar/TopRightToolBar'
import TopRightSaveHistoryButton from './TopRightSaveHistoryButton'
function Upbar() {
  return (
    <div className='w-full h-[44px] gap-[8px] absolute top-[32px] z-[10000] pl-[32px] pr-[32px] flex flex-row justify-between items-center flex-wrap pointer-events-none'>
        <AddNodeButton />
        <div className='flex flex-row items-center justify-center gap-[20px]'>
          <TopRightSaveHistoryButton />
          <TopRightToolBar />
        </div>
    </div>
  )
}

export default Upbar
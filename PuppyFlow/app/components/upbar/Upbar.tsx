import React from 'react'
import AddNodeButton from '../workflow/buttonControllers/AddNodeButton'
import TopRightToolBar from './topRightToolBar/TopRightToolBar'

function Upbar() {
  return (
    <div className='w-full h-[40px] gap-[8px] absolute top-[21px] z-[10000] pl-[37px] pr-[26px] flex flex-row justify-between items-center flex-wrap'>
        <AddNodeButton />
        <TopRightToolBar />
    </div>
  )
}

export default Upbar
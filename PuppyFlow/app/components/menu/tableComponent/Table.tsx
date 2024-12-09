import React from 'react'
import Cell from './Cell'

function Table() {
  return (
    <div className='flex-grow max-w-custom'>
        <table id="message" className='px-[8px] py-[9px] bg-main-black-theme text-[16px] font-[400] text-[#CDCDCD] tracking-[1.12px] leading-normal w-full table-auto '>
            <thead>
                <tr className=' border-b-[0.5px] border-[#CDCDCD] text-start align-middle text-[#6D7177] text-[12px] font-[700] leading-normal font-plus-jakarta-sans '>
                <td className='pl-[24px] pb-1'>role</td>
                <td className='pl-[24px] pb-1'>content</td>
                </tr>
                
            </thead>
            <tbody className='border-[0.5px] border-[#CDCDCD]'>
            <tr className='border-b-[0.5px] border-[#CDCDCD] border-dashed text-left align-middle font-plus-jakarta-sans font-[400]'>
                <td className='border-r-[0.5px] border-dashed border-[#CDCDCD]'><Cell type='role' content='system' />
                </td>
                <td>
                    <Cell type='content' content='You are an engineer' />
                </td>
            </tr>
            <tr className='text-left align-middle font-[400]'>
                <td className='border-r-[0.5px] border-dashed border-[#CDCDCD]'>
                    <Cell type='role' content='user' />
                </td>
                <td>
                    <Cell type='content' content='help me solve a problem' />
                </td>
            </tr>
            </tbody>  
        </table>     
    </div>
  )
}

export default Table
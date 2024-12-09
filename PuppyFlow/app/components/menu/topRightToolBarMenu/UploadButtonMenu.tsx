'use client'
import React, { useState, useRef, useEffect, useCallback } from 'react'
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils'



type UploadButtonMenuProps = {
  clearTopRightToolBarMenu: () => void
}
function UploadButtonMenu({clearTopRightToolBarMenu}: UploadButtonMenuProps) {
    const {constructWholeJsonWorkflow} = useJsonConstructUtils()
    
  
    const saveJsonToLocal = async (jsonData: any) => {
        const stringJsonData = JSON.stringify(jsonData, null, 2);
        const blob = new Blob([stringJsonData], { type: "application/json;charset=utf-8" });

        console.log(window)

        try {
            // 尝试使用现代 API
            if ( 'showSaveFilePicker' in window) {
                const fileHandle = await (window as any).showSaveFilePicker({
                    suggestedName: 'data.json',
                    types: [{
                        description: 'JSON File',
                        accept: { 'application/json': ['.json'] },
                    }],
                });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
            } else {
                

                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                document.body.appendChild(iframe);
                
                // 在 iframe 中创建链接并触发下载
                const iframeWindow = iframe.contentWindow;
                const url = URL.createObjectURL(blob);
                
                if (iframeWindow) {
                const link = iframeWindow.document.createElement('a');
                link.href = url;
                link.download = 'data.json';
                link.click();
                }
                
                // 延迟清理
                setTimeout(() => {
                document.body.removeChild(iframe);
                URL.revokeObjectURL(url);
                }, 1000);

                
            }
        }catch (err) {
            console.error('保存文件时出错:', err);
        }

    }
    
  return (

    <ul className='w-[90px] bg-[#3E3E41] px-0 py-[8px] rounded-[10px] flex flex-col items-start justify-center absolute top-10 left-1/2 -translate-x-1/2'>
    <li>
    <button className='px-[10px] py-[4px] bg-inherit hover:bg-[#525257] w-[90px] h-[28px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap' onClick={() => {
        const jsonData = constructWholeJsonWorkflow()
        console.log(jsonData)
        saveJsonToLocal(jsonData)
        clearTopRightToolBarMenu()
    }}>
            Save JSON
        </button>
    </li>
    <li>
        <button className='px-[10px] py-[4px] bg-inherit hover:bg-[#525257] w-[90px] h-[28px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap'>
            API
        </button>
    </li>
    <li>
        <button className='px-[10px] py-[4px] bg-inherit hover:bg-[#525257] w-[90px] h-[28px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap'>
            Share Link
        </button>
        </li>
    </ul>

  )
}

export default UploadButtonMenu

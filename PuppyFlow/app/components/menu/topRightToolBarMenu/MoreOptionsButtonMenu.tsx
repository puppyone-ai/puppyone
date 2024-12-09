'use client'
import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { useDropzone } from 'react-dropzone'
import { useNodeContext } from '../../states/NodeContext'
import {useReactFlow, Panel} from '@xyflow/react'

type MoreOptionsButtonMenuProps = {
  clearTopRightToolBarMenu: () => void
}
function MoreOptionsButtonMenu({clearTopRightToolBarMenu}: MoreOptionsButtonMenuProps) {

  const {restore} = useNodeContext()
  const {setNodes, setEdges} = useReactFlow()
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moreOptionsButtonMenuRef = useRef<HTMLUListElement>(null);
  
  


  // const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  //   console.log(event.target.files, "files")
  //   const file = event.target.files?.[0];
  //   if (file) {
  //     const reader = new FileReader();
  //     reader.onload = (event) => {
  //       try {
  //         const jsonContent = JSON.parse(event.target?.result as string);
  //         if (jsonContent.blocks && jsonContent.edges) {
  //           restore(jsonContent.blocks, jsonContent.edges, jsonContent.totalCount);
  //           setNodes(jsonContent.blocks);
  //           setEdges(jsonContent.edges);
  //         }
  //       } catch (error) {
  //         console.error('解析 JSON 文件时出错:', error);
  //       }
  //     };
  //     reader.readAsText(file);
  //   }
  // };

  
  // const onDrop = useCallback((acceptedFiles: any) => {
  //   // 处理上传的文件
  //   if (acceptedFiles.length > 0) {
  //     const file = acceptedFiles[0]; // 只处理第一个文件
  //     const reader = new FileReader();
  //     reader.onload = (event) => {
  //       try {
  //         const jsonContent = JSON.parse(event.target?.result as string);
  //         // if (onFileSelect) {
  //         //   onFileSelect(jsonContent);
  //         // }
  //         // restore NodeContext
         
  //         if (jsonContent.blocks && jsonContent.edges) {
  //           console.log(jsonContent.blocks)
  //           console.log(jsonContent.edges)
  //           console.log(jsonContent.totalCount)
  //           restore(jsonContent.blocks, jsonContent.edges, jsonContent.totalCount)
  //           setNodes(jsonContent.blocks)
  //           setEdges(jsonContent.edges)
  //         }
  //       } catch (error) {
  //         console.error('解析 JSON 文件时出错:', error);
  //       }
  //     };
  //     reader.readAsText(file);
  //   }
  //   }, []);

  //   const { getRootProps, getInputProps, open } = useDropzone({ onDrop });


  // useEffect(() => {
  //   if (file) {
  //     console.log(file, "file")
  //     handleFileContent(file)
  //   }
  // }, [file])


  const openFile = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        // 优先使用现代 API
        // const [fileHandle] = await (window as any).showOpenFilePicker({
        //   types: [{
        //     description: 'JSON Files',
        //     accept: {
        //       'application/json': ['.json']
        //     }
        //   }],
        //   multiple: false
        // });
        
        // const file = await fileHandle.getFile();
        // handleFileContent(file);
           
       // 创建 input 元素
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.position = 'fixed';
    input.style.top = '0';
    input.style.left = '0';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';

    // 添加到文档中
    document.body.appendChild(input);

    // 设置文件选择监听器
    input.onchange = (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFileContent(file);
      }
      // 清理
      document.body.removeChild(input);
    };

    // 直接调用点击
    input.click();
      } else {
        // 回退到传统方法
        // fileInputRef.current?.click();
           // 方案1: 使用 window.open 触发文件选择
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);

    // 使用 click() 事件
    const clickEvent = new MouseEvent('click', {
      view: window,
      bubbles: true,
      cancelable: true
    });
    input.dispatchEvent(clickEvent);

    // 监听文件选择
    input.onchange = (event: Event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFileContent(file);
      }
      document.body.removeChild(input);
    };
      }
    } catch (error) {
      console.error('Error opening file:', error);
      // 如果现代 API 失败，回退到传统方法
      // fileInputRef.current?.click();
    }
  };
  
  const handleFileContent = async (file: File) => {
    try {
      const text = await file.text(); // 使用更现代的 API 替代 FileReader
      // console.log(text, "text hello")
      const jsonContent = JSON.parse(text);
      
      if (jsonContent.blocks && jsonContent.edges) {
        restore(jsonContent.blocks, jsonContent.edges, jsonContent.totalCount);
        setNodes(jsonContent.blocks);
        setEdges(jsonContent.edges);
      }
    } catch (error) {
      console.error('Error processing file:', error);
    } finally {
      // console.log("finally, clearTopRightToolBarMenu")
      clearTopRightToolBarMenu()
      
    }
  };

  // 传统方法的处理函数
const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (file) {
    handleFileContent(file);
  } else {
    clearTopRightToolBarMenu()
  }
};


  return (
    <>
    <ul ref={moreOptionsButtonMenuRef} className='bg-[#3E3E41] py-[8px] rounded-[10px] flex flex-col items-center justify-center absolute top-10 left-0'>
        <li>
            <button className='px-[10px] py-[4px] bg-inherit hover:bg-[#525257] h-[28px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap' onClick={(e) => {
                // open()
                // openFile()
                e.stopPropagation()
                e.preventDefault()
                // setShowUploadFileForm(true)
                // document.getElementById("file-input")?.click()
                if (moreOptionsButtonMenuRef.current) {
                  moreOptionsButtonMenuRef.current.style.display = 'none'
                }
                fileInputRef.current?.click()
                
            }}>
                Upload JSON
            </button>
            {/* <input
            type="file"
            ref={fileInputRef}
            onChange={handleInputChange}
            accept=".json"
            style={{ display: 'none' }}
          /> */}
            {/* {ReactDOM.createPortal(
      <div {...getRootProps()} style={{display: 'none', position: 'absolute', top: "50%", right: "50%", transform: "translate(50%, -50%)", zIndex: 9999, padding: 20, border: '2px dashed #ccc' }}>
        <input {...getInputProps()} />
        <p className='text-center text-main-grey'>Drag and drop files here, or click to select files</p>
    </div>, document.getElementById('flowChart') as Element
    )}   */}
        </li>
    </ul>
    {ReactDOM.createPortal(
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleInputChange}
        onClick={(e) => e.stopPropagation()}
        accept=".json"
        className="opacity-0 absolute top-0 left-0 w-full h-full cursor-pointer"
        style={{
          position: 'fixed',
          top: '-100%',
          left: '-100%',
          // 移除 pointer-events-none
          // 移除 transform 和 translate，因为它们可能会影响点击
          zIndex: 9999,
        }}
        
      />,
      document.body
    )}
     {/* {showUploadFileForm && ReactDOM.createPortal(
        <form className='absolute p-[20px] top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[10000000] bg-[#3E3E41] rounded-[10px] flex flex-col items-center justify-center'>
          <input
          id="file-input"
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            e.stopPropagation();
            const file = e.target.files?.[0];
           
            console.log(file, "file")
            if (file) {
              setFile(file)
            }
          }}
          onClick={(e) => e.stopPropagation()}
          accept=".json"
        />
        SelectedFileName: {file?.name}
        <div className='flex justify-between items-center gap-[6px]'>
        <button className='bg-main-green text-white px-[10px] py-[4px] rounded-[4px] text-[10px]' onClick={async () => {
          if (file) {
            await handleFileContent(file)
          }
          setShowUploadFileForm(false)
        }}>Confirm Upload</button>
        <button className='bg-main-red text-white px-[10px] py-[4px] rounded-[4px] text-[10px]' onClick={() => setShowUploadFileForm(false)}>Cancel Upload</button>
        </div>
        </form>,
        document.body
      )} */}
    </>
    
  )
}

export default MoreOptionsButtonMenu

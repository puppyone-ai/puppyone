'use client';
import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils';

type MoreOptionsButtonMenuProps = {
  clearTopRightToolBarMenu: () => void;
};
function MoreOptionsButtonMenu({
  clearTopRightToolBarMenu,
}: MoreOptionsButtonMenuProps) {
  const { setNodes, setEdges } = useReactFlow();
  const { constructWholeJsonWorkflow } = useJsonConstructUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        clearTopRightToolBarMenu();
        return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const jsonContent = JSON.parse(e.target?.result as string);
          if (jsonContent.blocks && jsonContent.edges) {
            setNodes(jsonContent.blocks);
            setEdges(jsonContent.edges);
          }
        } catch (error) {
          console.error('解析 JSON 文件时出错:', error);
        } finally {
          clearTopRightToolBarMenu();
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsText(file);
    },
    [clearTopRightToolBarMenu, setEdges, setNodes]
  );

  const saveJsonToLocal = useCallback((jsonData: any) => {
    try {
      const stringJsonData = JSON.stringify(jsonData, null, 2);
      const blob = new Blob([stringJsonData], {
        type: 'application/json;charset=utf-8',
      });

      if ('showSaveFilePicker' in window) {
        (async () => {
          try {
            const fileHandle = await (window as any).showSaveFilePicker({
              suggestedName: 'workflow.json',
              types: [
                {
                  description: 'JSON File',
                  accept: { 'application/json': ['.json'] },
                },
              ],
            });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
          } catch (e) {
            console.error(e);
          }
        })();
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'workflow.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('保存文件时出错:', err);
    }
  }, []);

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

  // No options left here; JSON import/export moved to sidebar menu

  return (
    <>
      <Transition
        as={Fragment}
        enter='transition ease-out duration-100'
        enterFrom='transform opacity-0 translate-y-[-10px]'
        enterTo='transform opacity-100 translate-y-0'
        leave='transition ease-in duration-75'
        leaveFrom='transform opacity-100 translate-y-0'
        leaveTo='transform opacity-0 translate-y-[-10px]'
      >
        <Menu.Items className='absolute top-full mt-4 left-0 z-50'>
          <ul className='w-32 bg-[#252525] p-2 border border-[#404040] rounded-lg gap-1 flex flex-col items-start justify-start'>
            <Menu.Item>
              {({ active }) => (
                <li className='w-full'>
                  <button
                    className='px-2 rounded bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-normal tracking-[0.5px] cursor-pointer whitespace-nowrap'
                    onClick={e => {
                      e.stopPropagation();
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }}
                  >
                    Import JSON
                  </button>
                </li>
              )}
            </Menu.Item>

            <li className='w-full h-[1px] bg-[#404040] my-0.5'></li>

            <Menu.Item>
              {({ active }) => (
                <li className='w-full'>
                  <button
                    className='px-2 rounded bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-normal tracking-[0.5px] cursor-pointer whitespace-nowrap'
                    onClick={() => {
                      const jsonData = constructWholeJsonWorkflow();
                      saveJsonToLocal(jsonData);
                      clearTopRightToolBarMenu();
                    }}
                  >
                    Export JSON
                  </button>
                </li>
              )}
            </Menu.Item>
          </ul>
        </Menu.Items>
      </Transition>
      {mounted && (
        <input
          ref={fileInputRef}
          type='file'
          accept='.json'
          onChange={handleInputChange}
          onClick={e => e.stopPropagation()}
          className='opacity-0 absolute top-0 left-0 w-[1px] h-[1px]'
          style={{ position: 'fixed', top: '-100%', left: '-100%', zIndex: 9999 }}
        />
      )}
    </>
  );
}

export default MoreOptionsButtonMenu;

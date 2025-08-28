'use client';
import React, { Fragment } from 'react';
import { Menu, Transition } from '@headlessui/react';

type MoreOptionsButtonMenuProps = {
  clearTopRightToolBarMenu: () => void;
};
function MoreOptionsButtonMenu({
  clearTopRightToolBarMenu,
}: MoreOptionsButtonMenuProps) {

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
          <ul className='w-32 bg-[#252525] p-2 border border-[#404040] rounded-lg gap-1 flex flex-col items-start justify-start'></ul>
        </Menu.Items>
      </Transition>
    </>
  );
}

export default MoreOptionsButtonMenu;

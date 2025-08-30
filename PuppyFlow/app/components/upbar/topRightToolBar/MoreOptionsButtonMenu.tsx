'use client';
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  Fragment,
} from 'react';
import ReactDOM from 'react-dom';
import { useDropzone } from 'react-dropzone';
// import { useNodeContext } from '../../states/NodeContext'
import { useReactFlow, Panel } from '@xyflow/react';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import { Menu, Transition } from '@headlessui/react';

type MoreOptionsButtonMenuProps = {
  clearTopRightToolBarMenu: () => void;
};
function MoreOptionsButtonMenu({
  clearTopRightToolBarMenu,
}: MoreOptionsButtonMenuProps) {
  const [mounted, setMounted] = useState(false);

  const { setNodes, setEdges } = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const moreOptionsButtonMenuRef = useRef<HTMLUListElement>(null);
  const { constructWholeJsonWorkflow } = useJsonConstructUtils();

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

  /* --  used for upload json file -- */
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
          cancelable: true,
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
        // restore(jsonContent.blocks, jsonContent.edges, jsonContent.totalCount);
        setNodes(jsonContent.blocks);
        setEdges(jsonContent.edges);
      }
    } catch (error) {
      console.error('Error processing file:', error);
    } finally {
      // console.log("finally, clearTopRightToolBarMenu")
      clearTopRightToolBarMenu();
    }
  };

  // 传统方法的处理函数
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileContent(file);
    } else {
      clearTopRightToolBarMenu();
    }
    // 重置文件输入框的值，这样下次选择相同文件时也会触发 onChange
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /* -- used for save json file -- */
  const saveJsonToLocal = async (jsonData: any) => {
    const stringJsonData = JSON.stringify(jsonData, null, 2);
    const blob = new Blob([stringJsonData], {
      type: 'application/json;charset=utf-8',
    });

    // console.log(window)

    try {
      // 尝试使用现代 API
      if ('showSaveFilePicker' in window) {
        const fileHandle = await (window as any).showSaveFilePicker({
          suggestedName: 'data.json',
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
    } catch (err) {
      console.error('保存文件时出错:', err);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

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
                      console.log(jsonData);
                      saveJsonToLocal(jsonData);
                      clearTopRightToolBarMenu();
                    }}
                  >
                    Export JSON
                  </button>
                </li>
              )}
            </Menu.Item>

            {/* <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>

            <Menu.Item>
              {({ active }) => (
                <li className='w-full'>
                  <button className='px-[8px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap'>
                    Share Link
                  </button>
                </li>
              )}
            </Menu.Item> */}
          </ul>
        </Menu.Items>
      </Transition>

      {mounted &&
        ReactDOM.createPortal(
          <input
            type='file'
            ref={fileInputRef}
            onChange={handleInputChange}
            onClick={e => e.stopPropagation()}
            accept='.json'
            className='opacity-0 absolute top-0 left-0 w-full h-full cursor-pointer'
            style={{
              position: 'fixed',
              top: '-100%',
              left: '-100%',
              zIndex: 9999,
            }}
          />,
          document.body
        )}
    </>
  );
}

export default MoreOptionsButtonMenu;

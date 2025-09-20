import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useWorkspaces } from '../states/UserWorkspacesContext';
import { Transition } from '@headlessui/react';
import { Fragment } from 'react';

type FlowElementOperationMenuProps = {
  flowId: string;
  show: boolean;
  handleOperationMenuHide: () => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
};

function FlowElementOperationMenu({
  flowId,
  show,
  handleOperationMenuHide,
  buttonRef,
}: FlowElementOperationMenuProps) {
  const { removeWorkspace, updateWorkspace, workspaceManagement } =
    useWorkspaces();
  const renameModalRef = useRef<HTMLDivElement>(null);
  const newNameInputRef = useRef<HTMLInputElement>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isRenameVisible, setIsRenameVisible] = useState(false);
  const [isRenameAnimating, setIsRenameAnimating] = useState(false);
  const canRenameInteract = isRenameVisible && !isRenameAnimating;

  useEffect(() => {
    if (show && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPosition({
        top: rect.top - 4,
        left: rect.right + 10,
      });
    }
  }, [show, buttonRef]);

  const handleRenameDialogOpen = () => {
    setIsRenameOpen(true);
    setIsRenameAnimating(true);
    setIsRenameVisible(false);
    requestAnimationFrame(() => {
      setIsRenameVisible(true);
      setTimeout(() => setIsRenameAnimating(false), 300);
    });
  };

  const handleRenameDialogClose = () => {
    setIsRenameAnimating(true);
    setIsRenameVisible(false);
    setTimeout(() => {
      if (newNameInputRef.current) newNameInputRef.current.value = '';
      setIsRenameOpen(false);
      setIsRenameAnimating(false);
    }, 300);
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleRenameDialogClose();
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (renameModalRef.current && !renameModalRef.current.contains(e.target as Node)) {
        handleRenameDialogClose();
      }
    };
    if (isRenameOpen) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('mousedown', handleMouseDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleMouseDown);
      document.body.style.overflow = 'unset';
    };
  }, [isRenameOpen]);

  const handleRename = async (e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      e.stopPropagation();
      e.preventDefault();
      if (newNameInputRef.current?.value) {
        console.log(newNameInputRef.current?.value, 'start to rename');
        const result = await workspaceManagement.renameWorkspace(
          flowId,
          newNameInputRef.current?.value
        );
        if (result) {
          updateWorkspace(flowId, { workspace_name: result.workspace_name });
        }
      } else {
        alert('Please enter a name');
      }
    } catch (error) {
      console.error(error);
    } finally {
      handleRenameDialogClose();
    }
  };

  const handleDelete = async () => {
    try {
      const success = await workspaceManagement.deleteWorkspace(flowId);
      if (success) {
        removeWorkspace(flowId);
      }
    } catch (error) {
      console.error('Error deleting workspace:', error);
    }
  };

  return (
    <>
      {ReactDOM.createPortal(
        <Transition
          show={show}
          as={Fragment}
          enter='transition ease-out duration-100'
          enterFrom='transform opacity-0 translate-y-[-10px]'
          enterTo='transform opacity-100 translate-y-0'
          leave='transition ease-in duration-75'
          leaveFrom='transform opacity-100 translate-y-0'
          leaveTo='transform opacity-0 translate-y-[-10px]'
        >
          <ul
            className='w-[128px] bg-[#252525] p-[8px] border-[1px] border-[#404040] rounded-[8px] gap-[4px] flex flex-col fixed z-[2000000]'
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
            }}
          >
            <li className='w-full'>
              <button
                className='px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#CDCDCD] hover:text-white font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]'
                onClick={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleOperationMenuHide();
                  handleRenameDialogOpen();
                }}
              >
                <div className='flex justify-center items-center'>
                  <svg
                    width='26'
                    height='26'
                    viewBox='0 0 26 26'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                  >
                    <path
                      d='M16.8891 6L20.0003 9.11118L13.0002 16.111L9.88915 13L16.8891 6Z'
                      fill='#BEBEBE'
                    />
                    <path
                      d='M9.1109 13.7776L12.222 16.8887L7.55536 18.4442L9.1109 13.7776Z'
                      fill='#BEBEBE'
                    />
                  </svg>
                </div>
                Rename
              </button>
            </li>

            <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>

            <li className='w-full'>
              <button
                className='px-[0px] rounded-[4px] bg-inherit hover:bg-[#3E3E41] w-full h-[26px] flex justify-start items-center text-[#F44336] hover:text-[#FF6B64] font-plus-jakarta-sans text-[12px] font-[400] tracking-[0.5px] cursor-pointer whitespace-nowrap gap-[8px]'
                onClick={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  handleOperationMenuHide();
                  handleDelete();
                }}
              >
                <div className='flex justify-center items-center'>
                  <svg
                    width='26'
                    height='26'
                    viewBox='0 0 26 26'
                    fill='none'
                    xmlns='http://www.w3.org/2000/svg'
                  >
                    <path d='M19 7L7 19' stroke='#F44336' stroke-width='2' />
                    <path d='M19 19L7 7' stroke='#F44336' stroke-width='2' />
                  </svg>
                </div>
                Delete
              </button>
            </li>
          </ul>
        </Transition>,
        document.body
      )}

      {ReactDOM.createPortal(
        isRenameOpen ? (
          <div className={`fixed inset-0 flex items-center justify-center z-[9999] transition-opacity duration-300 ${isRenameVisible ? 'opacity-100' : 'opacity-0'}`}>
            <div className='absolute inset-0 bg-black bg-opacity-30 backdrop-blur-sm' />
            <div
              ref={renameModalRef}
              className={`relative bg-[#2A2A2A] rounded-[12px] shadow-2xl border border-[#404040] p-6 w-[400px] transition-all duration-300 ${isRenameVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'} ${canRenameInteract ? 'pointer-events-auto' : 'pointer-events-none'}`}
            >
              <div className='flex flex-col gap-4 text-[12px] text-[#D4D4D4]'>
                <h2 className='text-[12px] font-medium text-[#9CA3AF]'>
                  New Workspace Name
                </h2>

                <div className='relative'>
                  <input
                    ref={newNameInputRef}
                    type='text'
                    placeholder='Enter new name'
                    className='w-full h-[32px] px-[12px] bg-[#363636] border border-[#404040] rounded-[6px] text-[13px] text-[#FFFFFF] placeholder-[#808080] focus:outline-none focus:ring-0 transition duration-200'
                  />
                </div>

                <div className='flex justify-end gap-2 mt-2'>
                  <button
                    onClick={handleRenameDialogClose}
                    disabled={!canRenameInteract}
                    className='h-[28px] px-[14px] rounded-[6px] text-[12px] font-medium transition-all duration-200 flex items-center justify-center bg-[#2A2A2A] hover:bg-[#333333] text-[#CDCDCD] border border-[#404040] hover:border-[#505050] disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none'
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRename}
                    disabled={!canRenameInteract}
                    className='h-[28px] px-[14px] rounded-[6px] text-[12px] font-medium transition-all duration-200 flex items-center justify-center bg-[#4599DF] hover:bg-[#3A85CC] text-white shadow-sm hover:shadow-md disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none'
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null,
        document.body
      )}
    </>
  );
}

export default FlowElementOperationMenu;

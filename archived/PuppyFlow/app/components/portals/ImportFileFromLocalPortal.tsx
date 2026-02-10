import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useRef, useCallback, useState } from 'react';

import { useDropzone } from 'react-dropzone';

// type filePortalProps = {
//   portalRef: React.RefObject<HTMLDivElement>
//   onFileSelect?: (files: File[]) => void;
// }

function ImportFileFromLocalPortal() {
  const onDrop = useCallback((acceptedFiles: any) => {
    // 处理上传的文件
    console.log(acceptedFiles);
  }, []);

  const { getRootProps, getInputProps, open } = useDropzone({ onDrop });

  // const onDrop = useCallback((acceptedFiles: File[]) => {
  //   if (onFileSelect) {
  //     onFileSelect(acceptedFiles);
  //   }
  //   console.log(acceptedFiles);
  // }, [onFileSelect]);

  // const { getRootProps, getInputProps, open } = useDropzone({
  //   onDrop,
  //   noClick: true,
  // });

  // useEffect(() => {
  //   if (portalRef.current) {
  //     portalRef.current.onclick = open;
  //   }
  // }, [open]);

  return ReactDOM.createPortal(
    <>
      <button
        onClick={open}
        className='absolute top-[40%] left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 text-pink-300  border-2 border-pink-300 rounded-md px-2 py-1'
      >
        Click me{' '}
      </button>
      <div
        {...getRootProps()}
        style={{
          display: 'none',
          position: 'absolute',
          top: '50%',
          right: '50%',
          transform: 'translate(50%, -50%)',
          zIndex: 9999,
          padding: 20,
          border: '2px dashed #ccc',
        }}
      >
        <input {...getInputProps()} />
        <p className='text-center text-main-grey'>
          Drag and drop files here, or click to select files
        </p>
      </div>
    </>,
    document.getElementById('flowChart') as Element
  );
}

export default ImportFileFromLocalPortal;

import React, { useEffect, useRef, useState } from "react"
import ReactDOM from "react-dom"

export const PuppyUpload = ({ handleInputChange, handleDrop, uploadedFiles, setUploadedFiles, isOnUploading, handleDelete }: any) => {
    const inputRef = useRef<HTMLInputElement>(null);
    

    // const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    //   console.log("handle file change")
    //   const files = event.target.files;
    //   if (files && files.length > 0) {
    //     // Convert to array and filter out duplicates
    //     const newFiles = Array.from(files);
    //     const uniqueNewFiles = newFiles.filter((newFile: File) => 
    //       !uploadedFiles.some((existingFile: File) => 
    //         existingFile.name === newFile.name && existingFile.size === newFile.size
    //       )
    //     );
    //     // Append unique new files to existing ones with explicit type for prevFiles
    //     setUploadedFiles((prevFiles: File[]) => [...prevFiles, ...uniqueNewFiles]);
    //   }
    // };


    return (
    <>
        <div 
            className={`cursor-pointer h-full w-full mx-auto my-2 rounded-[8px] 
                ${uploadedFiles.length === 0 ? 'border-dashed border-2 border-gray-400' : ''} 
                hover:border-blue-400 hover:bg-gray-800/20 active:border-blue-500 transition-all duration-200 
                flex flex-col items-center justify-start gap-3 p-4`}
            onClick={(e) => {
            console.log(inputRef.current)
            
            inputRef.current?.click();
            }}
            onDragOver={(e) => {
            e.preventDefault(); // Prevent default to allow drop
            e.stopPropagation();
            e.currentTarget.classList.add('bg-gray-800/30', 'border-blue-400');
            }}
            onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.classList.remove('bg-gray-800/30', 'border-blue-400');
            }}
            onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.classList.remove('bg-gray-800/30', 'border-blue-400');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                // Handle the file(s) here - append unique files only
                const newFiles = Array.from(files);
                const uniqueNewFiles = newFiles.filter((newFile: File) => 
                  !uploadedFiles.some((existingFile: File) => 
                    existingFile.name === newFile.name && existingFile.size === newFile.size
                  )
                );
                // Append unique new files to existing ones with explicit type for prevFiles
                handleDrop(uniqueNewFiles);
            }
            }}
        >

            {/* Loading overlay */}
            {isOnUploading && (
                <div className="absolute inset-0 bg-gray-900/70 rounded-[8px] flex flex-col items-center justify-center z-10">
                    <div className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-3 h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    </div>
                    <p className="text-blue-400 font-medium mt-3">Uploading file...</p>
                </div>
            )}

            {uploadedFiles.length === 0 ? (
                <>
                    {/* Upload Icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400 group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    
                    <div className="text-center space-y-2">
                    <p className="text-sm font-medium text-gray-300">Drag and drop files here</p>
                    <p className="text-xs text-gray-500">or</p>
                    <p className="text-xs font-medium text-blue-400 hover:text-blue-300">Browse files</p>
                    </div>
                    
                    <p className="text-xs text-gray-500 mt-2">Supported formats: .json</p>
                </>
            ) : (
                <div className="w-full min-h-[180px]">
                    {uploadedFiles.map((file: {fileName: string|undefined, fileType: string, task_id:string}, index: number) => (
                        <div 
                            key={index} 
                            className="bg-gray-700 hover:bg-gray-600 text-white rounded-md p-2 mb-2 flex justify-between items-center"
                        >
                            <span>{file.fileName?.replace(/^file_/, '') || file.task_id + '.' + file.fileType|| 'Unnamed file'}</span>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation(); // Prevent opening file dialog
                                    handleDelete(file, index)
                                    setUploadedFiles(uploadedFiles.filter((_: {fileName:string, task_id: string, fileType: string}, i: number) => i !== index));
                                }}
                                className="text-gray-400 hover:text-red-400"
                            >
                                &times;
                            </button>
                        </div>
                    ))}
                    <button 
                        className="mt-2 text-sm text-blue-400 hover:text-blue-300"
                        onClick={(e) => {
                            e.stopPropagation(); // Prevent opening file dialog
                            inputRef.current?.click();
                        }}
                    >
                        + Add more files
                    </button>
                </div>
            )}
        </div>
        {
            /* PDF
                TXT
                JSON
                DOC
                CSV
                XLSX
                MARKDOWN */
        }
        {ReactDOM.createPortal(
            <input
                type="file"
                ref={inputRef}
                onChange={handleInputChange}
                onClick={(e) => e.stopPropagation()}
                accept=".json, .pdf, .txt, .docx, .csv, .xlsx, .markdown, .md, .mdx"
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
    </>
    )
      
}
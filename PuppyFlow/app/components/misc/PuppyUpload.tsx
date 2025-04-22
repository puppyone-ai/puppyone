import React, { useEffect, useRef, useState } from "react"
import ReactDOM from "react-dom"

export const PuppyUpload = ({ handleInputChange, handleDrop, uploadedFiles, setUploadedFiles, isOnUploading, handleDelete }: any) => {
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <>
            <div
                className={`cursor-pointer h-full w-full px-[8px] py-[8px] mx-auto rounded-[8px] hover:bg-gray-800/40
                 transition-all duration-200`}
                onDragOver={(e) => {
                    e.preventDefault(); // Prevent default to allow drop
                    e.stopPropagation();
                    e.currentTarget.classList.add('bg-gray-800/20', 'border-blue-400');
                }}
                onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.remove('bg-gray-800/42', 'border-blue-400');
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.classList.remove('bg-gray-800/20', 'border-blue-400');
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
                    <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-[2px] rounded-[8px] flex flex-col items-center justify-center z-10">
                        <div className="relative flex items-center justify-center">
                            {/* 背景圆环 */}
                            <svg className="w-12 h-12 text-gray-700/50" viewBox="0 0 44 44">
                                <circle 
                                    cx="22" 
                                    cy="22" 
                                    r="20" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    strokeWidth="2"
                                />
                            </svg>
                            
                            {/* 动态进度圆环 */}
                            <svg className="absolute w-12 h-12 animate-[spin_2s_linear_infinite] text-[#9E7E5F]" viewBox="0 0 44 44">
                                <circle 
                                    cx="22" 
                                    cy="22" 
                                    r="20" 
                                    fill="none" 
                                    stroke="currentColor" 
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeDasharray="16 84"
                                />
                            </svg>
                            
                            {/* 中心上传图标 */}
                            <svg 
                                className="absolute w-5 h-5 text-[#9E7E5F]" 
                                viewBox="0 0 24 24" 
                                fill="none" 
                                stroke="currentColor"
                            >
                                <path 
                                    strokeLinecap="round" 
                                    strokeLinejoin="round" 
                                    strokeWidth={1.5}
                                    d="M7 10l5-5 5 5M12 5v10"
                                />
                            </svg>
                        </div>
                        <div className="mt-4 flex flex-col items-center">
                            <p className="text-[#9E7E5F] font-medium text-[13px]">Uploading</p>
                            <p className="text-gray-500 text-[11px] mt-1">Please wait...</p>
                        </div>
                    </div>
                )}

                {uploadedFiles.length === 0 ? (
                    <div 
                        className="text-center py-[8px] flex flex-col items-center justify-center h-full w-full cursor-pointer"
                        onClick={() => inputRef.current?.click()}
                    >
                        {/* Upload Icon */}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-8 w-8 mx-auto text-gray-400 group-hover:text-[#9E7E5F] transition-colors duration-300 mb-3"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                        >
                            {/* 文件轮廓 - 更锋利的角度 */}
                            <path
                                strokeLinecap="square"
                                strokeLinejoin="miter"
                                strokeWidth={1.2}
                                d="M8 3h6l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
                            />
                            {/* 文件折角 - 更锋利的转角 */}
                            <path
                                strokeLinecap="butt"
                                strokeLinejoin="miter"
                                strokeWidth={1.2}
                                d="M14 3v4h4"
                            />
                            {/* 上传箭头 - 更细的线条 */}
                            <path
                                strokeLinecap="square"
                                strokeLinejoin="miter"
                                strokeWidth={1.2}
                                d="M12 15V10m0 0l-2.5 2.5M12 10l2.5 2.5"
                            />
                        </svg>

                        <p className="text-[12px] text-gray-500">Drag and drop files here, or</p>
                        <p className="text-[12px] text-gray-500">Click to upload</p>
                    </div>
                ) : (
                    <div 
                        className="flex flex-col w-full gap-[8px] h-full"
                        onClick={(e) => {
                            // 确保只有点击空白区域时触发
                            if (e.currentTarget === e.target) {
                                inputRef.current?.click();
                            }
                        }}
                    >
                        {uploadedFiles.map((file: { fileName: string | undefined, fileType: string, task_id: string }, index: number) => (
                            <div
                                key={index}
                                className="bg-[#3C3B37] min-h-[32px] hover:bg-[#5A574F] text-[#CDCDCD] text-[14px] font-regular rounded-md pl-[12px] flex justify-between items-center"
                            >
                                <span className="truncate max-w-[calc(100%-28px)] overflow-hidden text-ellipsis">{file.fileName?.replace(/^file_/, '') || file.task_id + '.' + file.fileType || 'Unnamed file'}</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent opening file dialog
                                        handleDelete(file, index)
                                    }}
                                    className="text-gray-400 hover:text-red-400 w-[32px] h-[32px] flex items-center justify-center flex-shrink-0"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                </button>
                            </div>
                        ))}
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
                    multiple
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
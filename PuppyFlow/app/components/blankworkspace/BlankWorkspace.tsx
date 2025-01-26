import React from 'react';

const BlankWorkspace = () => {
    return (
        <div className='w-full h-full overflow-hidden pt-[8px] pb-[8px] pr-[8px] pl-[0px] bg-[#252525]'>
            <div className='w-full h-full border-[1px] border-[#303030] bg-[#181818] rounded-[8px] flex items-center justify-center'>
                <div className="flex flex-col items-center gap-4">
                    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="31.5" y="37.5" width="17" height="9" rx="4.5" stroke="#5D6065" stroke-width="3" />
                        <path d="M39.9999 48.0001L40 53.8577C40.0001 56.5099 38.9465 59.0536 37.071 60.929L36.9289 61.0711C35.0536 62.9465 32.5101 64 29.8579 64L29.1421 64C26.4899 64 23.9464 62.9464 22.071 61.071L20 59" stroke="#5D6065" stroke-width="3" />
                        <path d="M39.9999 47.9999L39.9999 53.8578C39.9999 56.51 41.0534 59.0535 42.9288 60.9288L43.0709 61.071C44.9463 62.9464 47.4899 64 50.1421 63.9999L50.8578 63.9999C53.5099 63.9999 56.0534 62.9464 57.9287 61.0711L61 57.9999" stroke="#5D6065" stroke-width="3" />
                        <rect x="25.5" y="18.5" width="9" height="9" rx="4.5" stroke="#5D6065" stroke-width="3" />
                        <path d="M51.9999 18L44 23L52 28" stroke="#5D6065" stroke-width="3" />
                    </svg>

                    <p className="text-[#808080] text-lg flex flex-col items-center gap-2">
                        <div className="text-center text-[14px]">
                            Puppy has nothing to show <br />
                            Go to create a workspace
                        </div>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline-block mr-2">
                            <path d="M15 8H1" stroke="#808080" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M6 3L1 8L6 13" stroke="#808080" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default BlankWorkspace;

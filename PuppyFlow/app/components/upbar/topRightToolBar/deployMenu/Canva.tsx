import React from 'react';

interface CanvaProps {
  setActivePanel: (panel: string | null) => void;
}

function Canva({ setActivePanel }: CanvaProps) {
  return (
    <div className="py-[16px] px-[16px]">
      <div className="flex items-center mb-4">
        <button 
          className="mr-2 p-1 rounded-full hover:bg-[#2A2A2A]"
          onClick={() => setActivePanel(null)}
        >
          <svg className="w-5 h-5" fill="#CDCDCD" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </button>
        <h2 className="text-[#CDCDCD] text-[16px]">Canva</h2>
      </div>
      
      <div className="flex flex-col items-center justify-center py-8">
        <svg className="w-12 h-12 mb-4" fill="#808080" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
        <p className="text-[#808080] text-center">This feature is coming soon!</p>
      </div>
    </div>
  );
}

export default Canva; 
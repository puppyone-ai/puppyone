import React from 'react';
import { useDashboardContext } from './states/DashBoardContext';

const Models: React.FC = () => {
  const { 
    cloudModels, 
    localModels, 
  } = useDashboardContext();

  return (
    <div className="space-y-6 max-h-[500px] pr-2">
      <h3 className="text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]">AI Models Configuration</h3>
      
      {/* Local Models Section */}
      <div className="space-y-4">
        <div className="py-[8px] flex items-center justify-between">
          <h4 className="text-[16px] font-medium text-[#AAAAAA]">Local Models</h4>
          
          <button 
            onClick={() => {/* refresh function will be added later */}}
            className="text-sm text-[#2B5C9B] flex items-center gap-1 px-2 py-1 rounded transition-all duration-200 hover:text-[#60A5FA] group"
          >
            <svg 
              className="w-4 h-4 transition-transform duration-300 group-hover:rotate-180" 
              viewBox="0 0 24 24" 
              fill="none" 
              xmlns="http://www.w3.org/2000/svg"
            >
              <path 
                d="M4 4V9H4.58152M19.9381 11C19.446 7.05369 16.0796 4 12 4C8.64262 4 5.76829 6.06817 4.58152 9M4.58152 9H9M20 20V15H19.4185M19.4185 15C18.2317 17.9318 15.3574 20 12 20C7.92038 20 4.55399 16.9463 4.06189 13M19.4185 15H15" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              />
            </svg>
            <span>Refresh</span>
          </button>
        </div>
        
        {localModels.length > 0 ? (
          <div className="bg-[#333333] rounded-lg p-4 space-y-3">
            {localModels.map(model => (
              <div key={model.id} className="flex items-center justify-between border-b border-[#404040] pb-2 last:border-0 last:pb-0">
                <div>
                  <div className="text-white">{model.name}</div>
                  <div className="text-[#888888] text-sm">Local Model</div>
                </div>
                <div className="text-[#16A34A] text-sm">
                  Active
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#333333] rounded-lg p-6 text-center">
            <span className="text-[#888888] block">No local models found</span>
          </div>
        )}
      </div>

      {/* Cloud Models Section */}
      <div className="py-[8px] space-y-4 overflow-y-auto">
        <h4 className="text-[16px] font-medium text-[#AAAAAA]">Cloud Models</h4>
        <div className="bg-[#333333] rounded-lg p-4 space-y-3">
          {cloudModels.map(model => (
            <div key={model.id} className="flex items-center justify-between border-b border-[#404040] pb-2 last:border-0 last:pb-0">
              <div>
                <div className="text-white">{model.name}</div>
                <div className="text-[#888888] text-sm">{model.provider}</div>
              </div>
              <div className="text-[#16A34A] text-sm">
                Active
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Models;

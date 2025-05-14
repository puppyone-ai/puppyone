import React from 'react';
import { useDashboardContext } from './states/DashBoardContext';

const Models: React.FC = () => {
  const { 
    cloudModels, 
    localModels, 
    newModelName,
    newModelPath,
    showAddForm,
    setNewModelName,
    setNewModelPath,
    setShowAddForm,
    toggleCloudModel,
    toggleLocalModel,
    addLocalModel,
    removeLocalModel
  } = useDashboardContext();

  return (
    <div className="space-y-6 max-h-[500px] pr-2">
      <h3 className="text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]">AI Models Configuration</h3>
      
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
              <div 
                onClick={() => toggleCloudModel(model.id)}
                className={`w-10 h-5 ${
                  model.active ? 'bg-[#16A34A]' : 'bg-[#404040]'
                } rounded-full p-0.5 cursor-pointer transition-colors duration-200`}
              >
                <div 
                  className={`w-4 h-4 bg-white rounded-full transform transition-transform duration-200 ${
                    model.active ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* Local Models Section */}
      <div className="space-y-4">
        <div className="py-[8px] flex items-center justify-between">
          <h4 className="text-[16px] font-medium text-[#AAAAAA]">Local Models</h4>
          <button 
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-sm text-[#2B5C9B] hover:text-[#1E4B8A] flex items-center"
          >
            {showAddForm ? 'Cancel' : '+ Add Model'}
          </button>
        </div>
        
        {showAddForm && (
          <div className="bg-[#2B2B2B] rounded-lg p-4 space-y-3">
            <div className="space-y-2">
              <label className="text-[#AAAAAA] text-sm">Model Name</label>
              <input 
                type="text" 
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                className="w-full bg-[#333333] text-white p-2 rounded border border-[#404040] focus:border-[#2B5C9B] outline-none"
                placeholder="Enter model name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[#AAAAAA] text-sm">Path to Model</label>
              <input 
                type="text" 
                value={newModelPath}
                onChange={(e) => setNewModelPath(e.target.value)}
                className="w-full bg-[#333333] text-white p-2 rounded border border-[#404040] focus:border-[#2B5C9B] outline-none"
                placeholder="/path/to/model"
              />
            </div>
            <button
              onClick={addLocalModel}
              disabled={!newModelName || !newModelPath}
              className={`px-4 py-2 rounded-md ${
                newModelName && newModelPath 
                  ? 'bg-[#2B5C9B] hover:bg-[#1E4B8A] text-white' 
                  : 'bg-[#404040] text-[#888888] cursor-not-allowed'
              } transition duration-200`}
            >
              Add Model
            </button>
          </div>
        )}
        
        {localModels.length > 0 ? (
          <div className="bg-[#333333] rounded-lg p-4 space-y-3">
            {localModels.map(model => (
              <div key={model.id} className="flex items-center justify-between border-b border-[#404040] pb-2 last:border-0 last:pb-0">
                <div>
                  <div className="text-white">{model.name}</div>
                  <div className="text-[#888888] text-sm truncate max-w-[250px]">{model.path}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div 
                    onClick={() => toggleLocalModel(model.id)}
                    className={`w-10 h-5 ${
                      model.active ? 'bg-[#16A34A]' : 'bg-[#404040]'
                    } rounded-full p-0.5 cursor-pointer transition-colors duration-200`}
                  >
                    <div 
                      className={`w-4 h-4 bg-white rounded-full transform transition-transform duration-200 ${
                        model.active ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </div>
                  <button 
                    onClick={() => removeLocalModel(model.id)}
                    className="text-[#DD4444] hover:text-[#FF0000] text-lg"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#333333] rounded-lg p-6 text-center">
            <span className="text-[#888888]">No local models added yet</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Models;

import React from 'react';
import { useDashboardContext } from './states/DashBoardContext';

const DeployedServers: React.FC = () => {
  // 初始化为空数组
  const servers: { id: string; type: string; workspace: string; endpoint: string }[] = [];

  return (
    <div className="space-y-6 max-h-[500px] pr-2">
      <h3 className="text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]">Deployed Servers</h3>
      
      <div className="py-[8px] overflow-y-auto">
        <h4 className="text-[16px] font-medium text-[#AAAAAA] mb-4">Server List</h4>
        
        {servers.length > 0 ? (
          <div className="bg-[#333333] rounded-lg p-4">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-[#404040]">
                  <th className="pb-3 text-[14px] font-medium text-[#AAAAAA]">Workspace</th>
                  <th className="pb-3 text-[14px] font-medium text-[#AAAAAA]">Endpoint</th>
                  <th className="pb-3 text-right text-[14px] font-medium text-[#AAAAAA]">Type</th>
                </tr>
              </thead>
              <tbody>
                {servers.map(server => (
                  <tr key={server.id} className="border-b border-[#404040] last:border-0">
                    <td className="py-3 text-[14px] text-white">{server.workspace}</td>
                    <td className="py-3 text-[13px] text-[#888888]">{server.endpoint}</td>
                    <td className="py-3 text-right">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[12px] ${
                        server.type === 'api' 
                          ? 'bg-[#3B82F6]/20 text-[#60A5FA]' 
                          : 'bg-[#8B5CF6]/20 text-[#A78BFA]'
                      }`}>
                        {server.type}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-[#333333] rounded-lg p-6 text-center">
            <span className="text-[#888888]">No deployed servers found</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default DeployedServers;

import React from 'react';

type DashboardProps = {
  activeTab: 'settings' | 'billing';
  onTabChange: (tab: 'settings' | 'billing') => void;
  onClose: () => void;
};

function Dashboard({ activeTab, onTabChange, onClose }: DashboardProps) {
  return (
    <div className="flex flex-col h-[600px]">
      {/* Main Content with Sidebar */}
      <div className="flex flex-1 gap-8 text-[14px] font-medium">
        {/* Sidebar Navigation */}
        <div className="w-48 border-r border-[#404040]">
          <nav className="space-y-1 pr-4">
            <button
              onClick={() => onTabChange('settings')}
              className={`w-full text-left px-4 py-2 rounded-md transition-colors ${
                activeTab === 'settings'
                  ? 'bg-[#2B5C9B]/10 text-[#2B5C9B]'
                  : 'text-[#888888] hover:bg-[#333333] hover:text-white'
              }`}
            >
              User Settings
            </button>
            <button
              onClick={() => onTabChange('billing')}
              className={`w-full text-left px-4 py-2 rounded-md transition-colors ${
                activeTab === 'billing'
                  ? 'bg-[#2B5C9B]/10 text-[#2B5C9B]'
                  : 'text-[#888888] hover:bg-[#333333] hover:text-white'
              }`}
            >
              Billing
            </button>
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-4">
          {activeTab === 'settings' ? (
            <div className="space-y-6">
              <h3 className="text-[18px] font-medium text-white mb-4">User Settings</h3>

              {/* Profile Section */}
              <div className="flex items-center gap-6 p-4 bg-[#333333] rounded-lg">
                <div className="w-20 h-20 rounded-full bg-[#4A4A4A] flex items-center justify-center">
                  <span className="text-3xl text-[#888888]">🐶</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-white text-[16px] font-medium">John Puppy</span>
                  <span className="text-[#888888] text-[14px] font-regular">@johnpuppy</span>
                </div>
              </div>

              {/* Preferences Section */}
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[#AAAAAA]">Dark Mode</span>
                    <div className="w-12 h-6 bg-[#2B5C9B] rounded-full p-1 cursor-pointer">
                      <div className="w-4 h-4 bg-white rounded-full ml-6"></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#AAAAAA]">Email Notifications</span>
                    <div className="w-12 h-6 bg-[#404040] rounded-full p-1 cursor-pointer">
                      <div className="w-4 h-4 bg-white rounded-full"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <h3 className="text-lg font-medium text-white mb-4">Billing</h3>
              {/* Current Plan */}
              <div className="bg-[#333333] rounded-lg p-4">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h4 className="text-white font-medium">Current Plan</h4>
                    <span className="text-[#2B5C9B] text-sm font-medium">Pro Plan</span>
                  </div>
                  <span className="bg-[#2B5C9B]/20 text-[#2B5C9B] px-3 py-1 rounded-full text-sm">
                    Active
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm text-[#888888]">
                  <span>Next billing date: Aug 1, 2024</span>
                  <span>$15/month</span>
                </div>
              </div>

              {/* Payment Method */}
              <div className="bg-[#333333] rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-white font-medium">Payment Method</h4>
                  <button className="text-[#2B5C9B] text-sm hover:text-[#1E4B8A]">
                    Change
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="bg-[#404040] p-2 rounded">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="2" y="5" width="20" height="14" rx="2" className="stroke-[#888888]" strokeWidth="1.5" />
                      <path d="M2 10H22" className="stroke-[#888888]" strokeWidth="1.5" />
                    </svg>
                  </div>
                  <div className="text-sm">
                    <div className="text-[#AAAAAA]">Visa ending in 4242</div>
                    <div className="text-[#888888]">Expires 12/24</div>
                  </div>
                </div>
              </div>

              {/* Billing History */}
              <div className="bg-[#333333] rounded-lg p-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-white font-medium">Invoice History</h4>
                  <button className="text-[#2B5C9B] text-sm hover:text-[#1E4B8A]">
                    View All
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 pt-6 border-t border-[#404040]">
        <button
          onClick={onClose}
          className="px-4 py-2 text-[#AAAAAA] hover:text-white rounded-md transition duration-200"
        >
          Cancel
        </button>
        <button className="px-4 py-2 bg-[#2B5C9B] hover:bg-[#1E4B8A] text-white rounded-md transition duration-200">
          Save Changes
        </button>
      </div>
    </div>
  );
}

export default Dashboard; 
import React, { useState, useEffect } from 'react';
import { useAppSettings } from '../states/AppSettingsContext';
import { SYSTEM_URLS } from '@/config/urls';

// 定义用量数据类型
type UsageData = {
  llm_calls: {
    used: number;      // current_usage
    total: number;     // base_limit + extra_balance
    remaining: number; // available
  };
  runs: {
    used: number;      // current_usage
    total: number;     // base_limit + extra_balance
    remaining: number; // available
  };
};

const Usage: React.FC = () => {
  const { userSubscriptionStatus, isLoadingSubscriptionStatus, getAuthHeaders } = useAppSettings();
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);

  // 获取用量数据
  const fetchUsageData = async () => {
    if (!userSubscriptionStatus) return;
    
    setIsLoadingUsage(true);
    try {
      const UserSystem_Backend_Base_Url = SYSTEM_URLS.USER_SYSTEM.BACKEND;
      
      // 并行请求两个API
      const [llmResponse, runsResponse] = await Promise.all([
        fetch(`${UserSystem_Backend_Base_Url}/usage/check/llm_calls`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
          }
        }),
        fetch(`${UserSystem_Backend_Base_Url}/usage/check/runs`, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
          }
        })
      ]);

      if (llmResponse.ok && runsResponse.ok) {
        const llmData = await llmResponse.json();
        const runsData = await runsResponse.json();
        
        setUsageData({
          llm_calls: {
            used: llmData.current_usage || 0,
            total: llmData.base_limit + (llmData.extra_balance || 0),
            remaining: llmData.available || 0
          },
          runs: {
            used: runsData.current_usage || 0,
            total: runsData.base_limit + (runsData.extra_balance || 0),
            remaining: runsData.available || 0
          }
        });
      }
    } catch (error) {
      console.error('Error fetching usage data:', error);
    } finally {
      setIsLoadingUsage(false);
    }
  };

  // 当订阅状态更新时，获取用量数据
  useEffect(() => {
    if (userSubscriptionStatus) {
      const isLocalDeployment = userSubscriptionStatus.days_left === 99999;
      if (!isLocalDeployment) {
        fetchUsageData();
      }
    }
  }, [userSubscriptionStatus]);

  // 获取计划限制
  const getPlanLimits = () => {
    if (userSubscriptionStatus?.is_premium) {
      return {
        llm_calls: 200,
        runs: 1000
      };
    } else {
      return {
        llm_calls: 50,
        runs: 100
      };
    }
  };

  // 渲染用量进度条
  const renderUsageBar = (used: number, total: number, label: string) => {
    const percentage = total > 0 ? (used / total) * 100 : 0;
    const isNearLimit = percentage >= 80;
    const isOverLimit = percentage >= 100;
    
    return (
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[14px] text-white">{label}</span>
          <span className="text-[14px] text-[#888888]">
            {used} / {total}
          </span>
        </div>
        <div className="w-full bg-[#404040] rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${
              isOverLimit ? 'bg-[#EF4444]' : 
              isNearLimit ? 'bg-[#F59E0B]' : 'bg-[#16A34A]'
            }`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          ></div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[14px] text-[#888888]">
            {total - used} remaining
          </span>
          <span className={`text-[12px] font-medium ${
            isOverLimit ? 'text-[#EF4444]' : 
            isNearLimit ? 'text-[#F59E0B]' : 'text-[#16A34A]'
          }`}>
            {percentage.toFixed(1)}% used
          </span>
        </div>
      </div>
    );
  };

  if (isLoadingSubscriptionStatus) {
    return (
      <div className="space-y-6 max-h-[500px] pr-2">
        <h3 className="text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]">Usage</h3>
        <div className="py-[8px] overflow-y-auto">
          <div className="bg-[#333333] rounded-lg p-6 text-center">
            <div className="w-6 h-6 border-2 border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin mx-auto mb-2"></div>
            <span className="text-[#888888] text-[14px]">Loading usage information...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!userSubscriptionStatus) {
    return (
      <div className="space-y-6 max-h-[500px] pr-2">
        <h3 className="text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]">Usage</h3>
        <div className="py-[8px] overflow-y-auto">
          <div className="bg-[#333333] rounded-lg p-6 text-center">
            <span className="text-[#888888] text-[14px]">Unable to load usage information</span>
          </div>
        </div>
      </div>
    );
  }

  const isLocalDeployment = userSubscriptionStatus.days_left === 99999;
  const planLimits = getPlanLimits();

  return (
    <div className="space-y-6 max-h-[500px] pr-2">
      <h3 className="text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]">Usage</h3>
      
      <div className="py-[8px] overflow-y-auto space-y-6">
        {/* Subscription Status */}
        <div className="bg-[#333333] rounded-lg p-4">
          <h4 className="text-[16px] font-medium text-[#AAAAAA] mb-3">Subscription Status</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[14px] text-white">Plan</span>
              <span className={`text-[14px] font-medium ${
                userSubscriptionStatus.is_premium ? 'text-[#16A34A]' : 'text-[#888888]'
              }`}>
                {userSubscriptionStatus.subscription_plan?.toUpperCase() || 'FREE'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[14px] text-white">Status</span>
              <span className={`text-[14px] font-medium capitalize ${
                userSubscriptionStatus.subscription_status === 'active' ? 'text-[#16A34A]' : 'text-[#F59E0B]'
              }`}>
                {userSubscriptionStatus.subscription_status || 'expired'}
              </span>
            </div>
            {!isLocalDeployment && (
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-white">Days Left</span>
                <span className={`text-[14px] font-medium ${
                  userSubscriptionStatus.days_left > 7 ? 'text-[#16A34A]' : 
                  userSubscriptionStatus.days_left > 0 ? 'text-[#F59E0B]' : 'text-[#EF4444]'
                }`}>
                  {userSubscriptionStatus.days_left} days
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Subscription Period */}
        {!isLocalDeployment && userSubscriptionStatus.subscription_period_start && (
          <div className="bg-[#333333] rounded-lg p-4">
            <h4 className="text-[16px] font-medium text-[#AAAAAA] mb-3">Billing Period</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-white">Start Date</span>
                <span className="text-[14px] text-[#888888]">
                  {new Date(userSubscriptionStatus.subscription_period_start).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[14px] text-white">End Date</span>
                <span className="text-[14px] text-[#888888]">
                  {new Date(userSubscriptionStatus.subscription_period_end).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Usage Limits */}
        <div className="bg-[#333333] rounded-lg p-4">
          <h4 className="text-[16px] font-medium text-[#AAAAAA] mb-3">Usage Limits</h4>
          <div className="space-y-3">
            {userSubscriptionStatus.is_premium ? (
              isLocalDeployment ? (
                <div className="text-center py-4">
                  <div className="text-[#16A34A] text-[24px] mb-2">∞</div>
                  <span className="text-[14px] text-[#16A34A] font-medium">Unlimited Usage</span>
                  <p className="text-[12px] text-[#888888] mt-1">Local deployment with no restrictions</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-center py-2">
                    <div className="text-[#16A34A] text-[18px] mb-2">🎉</div>
                    <span className="text-[14px] text-[#16A34A] font-medium">Premium Features Unlocked</span>
                    <p className="text-[12px] text-[#888888] mt-1">Enhanced limits and premium features</p>
                  </div>
                  
                  {/* Premium用户用量显示 */}
                  {usageData ? (
                    <div className="space-y-4 pt-2">
                      {renderUsageBar(usageData.llm_calls.used, planLimits.llm_calls, "LLM Calls")}
                      {renderUsageBar(usageData.runs.used, planLimits.runs, "Single Runs")}
                    </div>
                  ) : isLoadingUsage ? (
                    <div className="text-center py-2">
                      <div className="w-4 h-4 border-2 border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin mx-auto mb-2"></div>
                      <span className="text-[12px] text-[#888888]">Loading usage data...</span>
                    </div>
                  ) : (
                    <div className="text-center py-2">
                      <span className="text-[12px] text-[#888888]">Monthly limits: {planLimits.llm_calls} LLM calls, {planLimits.runs} runs</span>
                    </div>
                  )}
                </div>
              )
            ) : (
              <div className="space-y-4">
                <div className="text-center py-2">
                  <div className="text-[#888888] text-[18px] mb-2">📊</div>
                  <span className="text-[14px] text-[#888888] font-medium">Free Plan Limits</span>
                  <p className="text-[12px] text-[#666666] mt-1">Upgrade to premium for unlimited access</p>
                </div>
                
                {/* Free用户用量显示 */}
                {usageData ? (
                  <div className="space-y-4 pt-2">
                    {renderUsageBar(usageData.llm_calls.used, planLimits.llm_calls, "LLM Calls")}
                    {renderUsageBar(usageData.runs.used, planLimits.runs, "Single Runs")}
                  </div>
                ) : isLoadingUsage ? (
                  <div className="text-center py-2">
                    <div className="w-4 h-4 border-2 border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin mx-auto mb-2"></div>
                    <span className="text-[12px] text-[#888888]">Loading usage data...</span>
                  </div>
                ) : (
                  <div className="text-center py-2">
                    <span className="text-[12px] text-[#888888]">Monthly limits: {planLimits.llm_calls} LLM calls, {planLimits.runs} runs</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Usage; 
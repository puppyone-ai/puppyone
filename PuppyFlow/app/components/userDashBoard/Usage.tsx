import React from 'react';
import { useAppSettings } from '../states/AppSettingsContext';

const Usage: React.FC = () => {
  const { userSubscriptionStatus, isLoadingSubscriptionStatus } = useAppSettings();

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
                {userSubscriptionStatus.subscription_plan?.toUpperCase() || 'UNKNOWN'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[14px] text-white">Status</span>
              <span className={`text-[14px] font-medium capitalize ${
                userSubscriptionStatus.subscription_status === 'active' ? 'text-[#16A34A]' : 'text-[#F59E0B]'
              }`}>
                {userSubscriptionStatus.subscription_status}
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
                <div className="text-center py-4">
                  <div className="text-[#16A34A] text-[18px] mb-2">🎉</div>
                  <span className="text-[14px] text-[#16A34A] font-medium">Premium Features Unlocked</span>
                  <p className="text-[12px] text-[#888888] mt-1">Enjoy enhanced limits and premium features</p>
                </div>
              )
            ) : (
              <div className="text-center py-4">
                <div className="text-[#888888] text-[18px] mb-2">📊</div>
                <span className="text-[14px] text-[#888888] font-medium">Free Plan Limits</span>
                <p className="text-[12px] text-[#666666] mt-1">Upgrade to premium for unlimited access</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Usage; 
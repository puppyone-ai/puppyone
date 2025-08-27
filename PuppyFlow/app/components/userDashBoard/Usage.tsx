import React, { useEffect } from 'react';
import { useAppSettings } from '../states/AppSettingsContext';

// 定义用量数据类型
type UsageData = {
  llm_calls: {
    used: number; // current_usage
    total: number; // base_limit + extra_balance
    remaining: number; // available
  };
  runs: {
    used: number; // current_usage
    total: number; // base_limit + extra_balance
    remaining: number; // available
  };
};

const Usage: React.FC = () => {
  const {
    userSubscriptionStatus,
    isLoadingSubscriptionStatus,
    isLocalDeployment,
    usageData,
    isLoadingUsage,
    fetchUsageData,
    planLimits,
  } = useAppSettings();

  // 当订阅状态更新时，获取用量数据
  useEffect(() => {
    if (userSubscriptionStatus && !isLocalDeployment) {
      fetchUsageData();
    }
  }, [userSubscriptionStatus, isLocalDeployment, fetchUsageData]);

  // 渲染用量进度条
  const renderUsageBar = (used: number, total: number, label: string) => {
    const percentage = total > 0 ? (used / total) * 100 : 0;
    const isNearLimit = percentage >= 80;
    const isOverLimit = percentage >= 100;

    return (
      <div className='space-y-2'>
        <div className='flex justify-between items-center'>
          <span className='text-[14px] text-white'>{label}</span>
          <span className='text-[14px] text-[#888888]'>
            {used} / {total}
          </span>
        </div>
        <div className='w-full bg-[#404040] rounded-full h-2'>
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              isOverLimit
                ? 'bg-[#EF4444]'
                : isNearLimit
                  ? 'bg-[#F59E0B]'
                  : 'bg-[#16A34A]'
            }`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          ></div>
        </div>
        <div className='flex justify-between items-center'>
          <span className='text-[14px] text-[#888888]'>
            {total - used} remaining
          </span>
          <span
            className={`text-[12px] font-medium ${
              isOverLimit
                ? 'text-[#EF4444]'
                : isNearLimit
                  ? 'text-[#F59E0B]'
                  : 'text-[#16A34A]'
            }`}
          >
            {percentage.toFixed(1)}% used
          </span>
        </div>
      </div>
    );
  };

  if (isLoadingSubscriptionStatus) {
    return (
      <div className='space-y-6 max-h-[500px] pr-2'>
        <h3 className='text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]'>
          Usage
        </h3>
        <div className='py-[8px] overflow-y-auto'>
          <div className='bg-[#333333] rounded-lg p-6 text-center'>
            <div className='w-6 h-6 border-2 border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin mx-auto mb-2'></div>
            <span className='text-[#888888] text-[14px]'>
              Loading usage information...
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (!userSubscriptionStatus) {
    return (
      <div className='space-y-6 max-h-[500px] pr-2'>
        <h3 className='text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]'>
          Usage
        </h3>
        <div className='py-[8px] overflow-y-auto'>
          <div className='bg-[#333333] rounded-lg p-6 text-center'>
            <span className='text-[#888888] text-[14px]'>
              Unable to load usage information
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 使用全局上下文提供的部署类型与套餐限制

  return (
    <div className='space-y-6 max-h-[500px] pr-2'>
      <h3 className='text-[18px] font-medium text-white mb-4 sticky top-0 z-10 bg-[#2A2A2A]'>
        Usage
      </h3>

      <div className='py-[8px] overflow-y-auto space-y-6'>
        {/* Subscription Status */}
        <div className='bg-[#333333] rounded-lg p-4'>
          <h4 className='text-[16px] font-medium text-[#AAAAAA] mb-3'>
            Subscription Status
          </h4>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <span className='text-[14px] text-white'>Plan</span>
              <span
                className={`text-[14px] font-medium ${
                  userSubscriptionStatus.is_premium
                    ? 'text-[#16A34A]'
                    : 'text-[#888888]'
                }`}
              >
                {isLocalDeployment
                  ? 'LOCAL'
                  : userSubscriptionStatus.subscription_plan?.toUpperCase() || 'FREE'}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='text-[14px] text-white'>Status</span>
              <span
                className={`text-[14px] font-medium capitalize ${
                  userSubscriptionStatus.subscription_status === 'active'
                    ? 'text-[#16A34A]'
                    : 'text-[#F59E0B]'
                }`}
              >
                {userSubscriptionStatus.subscription_status || 'expired'}
              </span>
            </div>
            {!isLocalDeployment && (
              <div className='flex items-center justify-between'>
                <span className='text-[14px] text-white'>Days Left</span>
                <span
                  className={`text-[14px] font-medium ${
                    userSubscriptionStatus.days_left > 7
                      ? 'text-[#16A34A]'
                      : userSubscriptionStatus.days_left > 0
                        ? 'text-[#F59E0B]'
                        : 'text-[#EF4444]'
                  }`}
                >
                  {userSubscriptionStatus.days_left} days
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Subscription Period */}
        {!isLocalDeployment &&
          userSubscriptionStatus.subscription_period_start && (
            <div className='bg-[#333333] rounded-lg p-4'>
              <h4 className='text-[16px] font-medium text-[#AAAAAA] mb-3'>
                Billing Period
              </h4>
              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <span className='text-[14px] text-white'>Start Date</span>
                  <span className='text-[14px] text-[#888888]'>
                    {new Date(
                      userSubscriptionStatus.subscription_period_start
                    ).toLocaleDateString()}
                  </span>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='text-[14px] text-white'>End Date</span>
                  <span className='text-[14px] text-[#888888]'>
                    {new Date(
                      userSubscriptionStatus.subscription_period_end
                    ).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          )}

        {/* Usage Limits */}
        <div className='bg-[#333333] rounded-lg p-4'>
          <div className='flex items-center justify-between mb-3'>
            <h4 className='text-[16px] font-medium text-[#AAAAAA]'>
              Usage Limits
            </h4>
            {!isLocalDeployment && (
              <button
                onClick={fetchUsageData}
                disabled={isLoadingUsage}
                className={`flex items-center gap-2 px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
                  isLoadingUsage
                    ? 'bg-[#404040] text-[#666666] cursor-not-allowed'
                    : 'bg-[#404040] text-[#AAAAAA] hover:bg-[#505050] hover:text-white'
                }`}
              >
                {isLoadingUsage ? (
                  <>
                    <div className='w-3 h-3 border border-[#666666] border-t-transparent rounded-full animate-spin'></div>
                    <span>Refreshing...</span>
                  </>
                ) : (
                  <>
                    <svg
                      className='w-3 h-3'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
                      />
                    </svg>
                    <span>Refresh</span>
                  </>
                )}
              </button>
            )}
          </div>
          <div className='space-y-3'>
            {isLocalDeployment ? (
              <div className='text-center py-4'>
                <div className='text-[#16A34A] text-[24px] mb-2'>∞</div>
                <span className='text-[14px] text-[#16A34A] font-medium'>
                  Unlimited Usage
                </span>
                <p className='text-[12px] text-[#888888] mt-1'>
                  Local deployment with no restrictions
                </p>
              </div>
            ) : userSubscriptionStatus.is_premium ? (
                <div className='space-y-4'>
                  <div className='text-center py-2'>
                    <div className='text-[#16A34A] text-[18px] mb-2'>🎉</div>
                    <span className='text-[14px] text-[#16A34A] font-medium'>
                      Premium Features Unlocked
                    </span>
                    <p className='text-[12px] text-[#888888] mt-1'>
                      Enhanced limits and premium features
                    </p>
                  </div>

                  {/* Premium用户用量显示 */}
                  {usageData ? (
                    <div className='space-y-4 pt-2'>
                      {renderUsageBar(
                        usageData.llm_calls.used,
                        planLimits.llm_calls,
                        'LLM Calls'
                      )}
                      {renderUsageBar(
                        usageData.runs.used,
                        planLimits.runs,
                        'Single Runs'
                      )}
                    </div>
                  ) : isLoadingUsage ? (
                    <div className='text-center py-2'>
                      <div className='w-4 h-4 border-2 border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin mx-auto mb-2'></div>
                      <span className='text-[12px] text-[#888888]'>
                        Loading usage data...
                      </span>
                    </div>
                  ) : (
                    <div className='text-center py-2'>
                      <span className='text-[12px] text-[#888888]'>
                        Monthly limits: {planLimits.llm_calls} LLM calls,{' '}
                        {planLimits.runs} runs
                      </span>
                    </div>
                  )}
                </div>
            ) : (
              <div className='space-y-4'>
                <div className='text-center py-2'>
                  <div className='text-[#888888] text-[18px] mb-2'>📊</div>
                  <span className='text-[14px] text-[#888888] font-medium'>
                    Free Plan Limits
                  </span>
                  <p className='text-[12px] text-[#666666] mt-1'>
                    Upgrade to premium for unlimited access
                  </p>
                </div>

                {/* Free用户用量显示 */}
                {usageData ? (
                  <div className='space-y-4 pt-2'>
                    {renderUsageBar(
                      usageData.llm_calls.used,
                      planLimits.llm_calls,
                      'LLM Calls'
                    )}
                    {renderUsageBar(
                      usageData.runs.used,
                      planLimits.runs,
                      'Single Runs'
                    )}
                  </div>
                ) : isLoadingUsage ? (
                  <div className='text-center py-2'>
                    <div className='w-4 h-4 border-2 border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin mx-auto mb-2'></div>
                    <span className='text-[12px] text-[#888888]'>
                      Loading usage data...
                    </span>
                  </div>
                ) : (
                  <div className='text-center py-2'>
                    <span className='text-[12px] text-[#888888]'>
                      Monthly limits: {planLimits.llm_calls} LLM calls,{' '}
                      {planLimits.runs} runs
                    </span>
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

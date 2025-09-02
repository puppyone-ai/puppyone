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

  // 渲染 Notion 风格用量条
  const renderUsageBar = (used: number, total: number, label: string) => {
    const percentage = total > 0 ? (used / total) * 100 : 0;
    const isNearLimit = percentage >= 80;
    const isOverLimit = percentage >= 100;

    return (
      <div className='space-y-1.5'>
        <div className='flex justify-between items-center'>
          <span className='text-[12px] text-[#E5E5E5]'>{label}</span>
          <span className='text-[12px] text-[#9CA3AF]'>
            {used} / {total}
          </span>
        </div>
        <div className='w-full bg-[#2F2F2F] rounded-full h-1.5'>
          <div
            className={`h-1.5 rounded-full transition-all duration-300 ${
              isOverLimit
                ? 'bg-[#EF4444]'
                : isNearLimit
                  ? 'bg-[#F59E0B]'
                  : 'bg-[#4091FF]'
            }`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
        <div className='flex justify-between items-center'>
          <span className='text-[11px] text-[#6B7280]'>
            {Math.max(total - used, 0)} remaining
          </span>
          <span
            className={`text-[11px] ${
              isOverLimit
                ? 'text-[#EF4444]'
                : isNearLimit
                  ? 'text-[#F59E0B]'
                  : 'text-[#9CA3AF]'
            }`}
          >
            {percentage.toFixed(1)}%
          </span>
        </div>
      </div>
    );
  };

  if (isLoadingSubscriptionStatus) {
    return (
      <div className='space-y-4 max-h-[500px] pr-2 text-[13px] text-[#D4D4D4]'>
        <h3 className='text-[16px] font-semibold text-[#E5E5E5] sticky top-0 z-10 bg-[#2A2A2A] border-b border-[#343434] py-2'>
          Usage
        </h3>
        <div className='py-[8px] overflow-y-auto'>
          <div className='rounded-lg border border-[#2A2A2A] bg-[#141414] p-4'>
            <div className='flex items-center gap-2 text-[#8B8B8B] text-[12px]'>
              <div className='w-4 h-4 border-2 border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin'></div>
              <span>Loading usage information...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!userSubscriptionStatus) {
    return (
      <div className='space-y-4 max-h-[500px] pr-2 text-[13px] text-[#D4D4D4]'>
        <h3 className='text-[16px] font-semibold text-[#E5E5E5] sticky top-0 z-10 bg-[#2A2A2A] border-b border-[#343434] py-2'>
          Usage
        </h3>
        <div className='py-[8px] overflow-y-auto'>
          <div className='rounded-lg border border-[#2A2A2A] bg-[#141414] p-4'>
            <span className='text-[#8B8B8B] text-[12px]'>Unable to load usage information</span>
          </div>
        </div>
      </div>
    );
  }

  // 使用全局上下文提供的部署类型与套餐限制

  return (
    <div className='space-y-4 max-h-[500px] pr-2 text-[13px] text-[#D4D4D4]'>
      <h3 className='text-[16px] font-semibold text-[#E5E5E5] sticky top-0 z-10 bg-[#2A2A2A] border-b border-[#343434] py-2'>
        Usage
      </h3>

        <div className='py-[8px] overflow-y-auto space-y-4'>
        {/* Subscription Status */}
        <div className='rounded-lg border border-[#2A2A2A] bg-[#141414] p-4'>
          <div className='text-[12px] font-semibold text-[#9CA3AF] mb-2'>Subscription</div>
          <div className='space-y-2 divide-y divide-[#2A2A2A]'>
            <div className='flex items-center justify-between pb-2'>
              <span className='text-[12px] text-[#E5E5E5]'>Plan</span>
              <span
                className={`text-[12px] font-medium ${
                  userSubscriptionStatus.is_premium
                    ? 'text-[#16A34A]'
                    : 'text-[#9CA3AF]'
                }`}
              >
                {isLocalDeployment
                  ? 'LOCAL'
                  : userSubscriptionStatus.subscription_plan?.toUpperCase() || 'FREE'}
              </span>
            </div>
            <div className='flex items-center justify-between py-2'>
              <span className='text-[12px] text-[#E5E5E5]'>Status</span>
              <span
                className={`text-[12px] font-medium capitalize ${
                  userSubscriptionStatus.subscription_status === 'active'
                    ? 'text-[#16A34A]'
                    : 'text-[#F59E0B]'
                }`}
              >
                {userSubscriptionStatus.subscription_status || 'expired'}
              </span>
            </div>
            {!isLocalDeployment && (
              <div className='flex items-center justify-between pt-2'>
                <span className='text-[12px] text-[#E5E5E5]'>Days left</span>
                <span
                  className={`text-[12px] font-medium ${
                    userSubscriptionStatus.days_left > 7
                      ? 'text-[#16A34A]'
                      : userSubscriptionStatus.days_left > 0
                        ? 'text-[#F59E0B]'
                        : 'text-[#EF4444]'
                  }`}
                >
                  {userSubscriptionStatus.days_left}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Subscription Period */}
        {!isLocalDeployment &&
          userSubscriptionStatus.subscription_period_start && (
            <div className='rounded-lg border border-[#2A2A2A] bg-[#141414] p-4'>
              <div className='text-[12px] font-semibold text-[#9CA3AF] mb-2'>Billing period</div>
              <div className='space-y-2'>
                <div className='flex items-center justify-between'>
                  <span className='text-[12px] text-[#E5E5E5]'>Start</span>
                  <span className='text-[12px] text-[#9CA3AF]'>
                    {new Date(
                      userSubscriptionStatus.subscription_period_start
                    ).toLocaleDateString()}
                  </span>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='text-[12px] text-[#E5E5E5]'>End</span>
                  <span className='text-[12px] text-[#9CA3AF]'>
                    {new Date(
                      userSubscriptionStatus.subscription_period_end
                    ).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          )}

        {/* Usage Limits */}
        <div className='rounded-lg border border-[#2A2A2A] bg-[#141414] p-4'>
          <div className='flex items-center justify-between mb-2'>
            <div className='text-[12px] font-semibold text-[#9CA3AF]'>Usage this month</div>
            {!isLocalDeployment && (
              <button
                onClick={fetchUsageData}
                disabled={isLoadingUsage}
                className={`text-[12px] text-[#9CA3AF] hover:text-[#E5E5E5] transition-colors ${
                  isLoadingUsage ? 'opacity-70 cursor-not-allowed' : ''
                }`}
              >
                {isLoadingUsage ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
          </div>

          <div className='space-y-4'>
            {userSubscriptionStatus.is_premium ? (
              isLocalDeployment ? (
                <div className='py-2'>
                  <div className='text-[12px] text-[#16A34A]'>Unlimited usage on local deployment</div>
                </div>
              ) : (
                <>

                  {usageData ? (
                    <div className='space-y-4 pt-1'>
                      {renderUsageBar(
                        usageData.llm_calls.used,
                        planLimits.llm_calls,
                        'LLM calls'
                      )}
                      {renderUsageBar(
                        usageData.runs.used,
                        planLimits.runs,
                        'Single runs'
                      )}
                    </div>
                  ) : isLoadingUsage ? (
                    <div className='flex items-center gap-2 text-[12px] text-[#888888]'>
                      <div className='w-3.5 h-3.5 border-2 border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin'></div>
                      <span>Loading usage data…</span>
                    </div>
                  ) : (
                    <div className='text-[12px] text-[#888888]'>
                      Monthly limits: {planLimits.llm_calls} LLM calls, {planLimits.runs} runs
                    </div>
                  )}
 </>
              )

            ) : (
              <>
                {usageData ? (
                  <div className='space-y-4 pt-1'>
                    {renderUsageBar(
                      usageData.llm_calls.used,
                      planLimits.llm_calls,
                      'LLM calls'
                    )}
                    {renderUsageBar(
                      usageData.runs.used,
                      planLimits.runs,
                      'Single runs'
                    )}
                  </div>
                ) : isLoadingUsage ? (
                  <div className='flex items-center gap-2 text-[12px] text-[#888888]'>
                    <div className='w-3.5 h-3.5 border-2 border-[#404040] border-t-[#8B8B8B] rounded-full animate-spin'></div>
                    <span>Loading usage data…</span>
                  </div>
                ) : (
                  <div className='text-[12px] text-[#888888]'>
                    Monthly limits: {planLimits.llm_calls} LLM calls, {planLimits.runs} runs
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Usage;

import React, { useState, useEffect } from 'react';
import { useAppSettings } from '../states/AppSettingsContext';
import { useWorkspaces } from '../states/UserWorkspacesContext';
import { useAllDeployedServices } from '../states/UserServersContext';
import { SYSTEM_URLS } from '@/config/urls';

type UsageDisplayProps = {
  isExpanded: boolean;
};

const UsageDisplay: React.FC<UsageDisplayProps> = ({ isExpanded }) => {
  const {
    userSubscriptionStatus,
    isLocalDeployment,
    usageData,
    planLimits,
    isLoadingUsage,
  } = useAppSettings();
  const { workspaces } = useWorkspaces();
  const { apis, chatbots } = useAllDeployedServices();

  // Show Get Pro button for FREE users OR local deployment users
  const shouldShowGetProButton =
    userSubscriptionStatus &&
    (!userSubscriptionStatus.is_premium || isLocalDeployment);

  // Handle Get Pro button click
  const handleGetProClick = () => {
    window.open('https://www.puppyagent.com/pricing', '_blank');
  };

  // Circular progress component
  const CircularProgress: React.FC<{
    percentage: number;
    size: number;
    strokeWidth: number;
  }> = ({ percentage, strokeWidth, size }) => {
    const radius = (20 - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    // Calculate how much has been used (inverse of remaining)
    const usedPercentage = 100 - percentage;
    const strokeDasharray = `${Math.min((usedPercentage / 100) * circumference, circumference)} ${circumference}`;

    // Color based on remaining percentage
    const color =
      percentage <= 10 ? '#EF4444' : percentage <= 20 ? '#F59E0B' : '#16A34A';

    const sizeStyle = {
      width: `${size * 0.25}rem`,
      height: `${size * 0.25}rem`,
    };

    return (
      <div className='relative' style={sizeStyle}>
        <svg className='w-full h-full transform -rotate-90' viewBox='0 0 20 20'>
          {/* Background circle - shows remaining in color */}
          <circle
            cx='10'
            cy='10'
            r={radius}
            fill='none'
            stroke={color}
            strokeWidth={strokeWidth}
          />
          {/* Overlay circle - shows used portion in gray */}
          <circle
            cx='10'
            cy='10'
            r={radius}
            fill='none'
            stroke='#404040'
            strokeWidth={strokeWidth}
            strokeLinecap='round'
            strokeDasharray={strokeDasharray}
          />
        </svg>
      </div>
    );
  };

  if (!userSubscriptionStatus) return null;

  if (isExpanded) {
    return (
      <div className='my-[5px] p-[8px] pb-[4px] w-full border border-[#404040] rounded-[8px] bg-[#252525]'>
        {/* First row: Plan type and upgrade button */}
        <div className='flex items-center justify-between mb-2'>
          <span className='text-[#8B8B8B] text-[10px] font-medium'>
            {isLocalDeployment
              ? 'LOCAL'
              : userSubscriptionStatus.is_premium
                ? 'PRO'
                : 'FREE'}
          </span>
          {shouldShowGetProButton && (
            <button
              onClick={handleGetProClick}
              className='border border-[#303030] hover:border-[#FFA73D] text-[#8B8B8B] hover:text-[#FFA73D] text-[10px] font-medium py-[3px] px-[6px] rounded-md transition-all duration-200 bg-[#252525] hover:bg-[#FF6B35]/10 flex items-center gap-1'
            >
              <span>Upgrade</span>
              <span className='text-[10px]'>→</span>
            </button>
          )}
        </div>

        {/* Divider line */}
        <div className='w-full h-[1px] bg-[#404040] my-2'></div>

        {/* Second row: Mixed layout - circles for usage, text for limits */}
        <div className='w-full flex justify-between items-center'>
          {/* Workspaces - current/max format */}
          <div className='flex flex-col items-center gap-1'>
            <span className='text-[12px] text-[#8B8B8B] font-medium'>
              {isLocalDeployment
                ? `${workspaces?.length || 0}/∞`
                : `${workspaces?.length || 0}/${planLimits.workspaces}`}
            </span>
            <span className='text-[9px] text-[#666666]'>space</span>
          </div>

          {/* Deployed Services - current/max format */}
          <div className='flex flex-col items-center gap-1'>
            <span className='text-[12px] text-[#8B8B8B] font-medium'>
              {isLocalDeployment
                ? `${(apis?.length || 0) + (chatbots?.length || 0)}/∞`
                : `${(apis?.length || 0) + (chatbots?.length || 0)}/${planLimits.deployedServices}`}
            </span>
            <span className='text-[9px] text-[#666666]'>server</span>
          </div>

          {/* Runs - circle showing remaining */}
          <div className='flex flex-col items-center gap-1 mt-[6px]'>
            <CircularProgress
              percentage={
                isLocalDeployment
                  ? 100
                  : usageData
                    ? ((planLimits.runs - usageData.runs.used) /
                        planLimits.runs) *
                      100
                    : 100
              }
              size={3}
              strokeWidth={2}
            />
            <div className='text-[9px] text-[#666666] text-center'>
              <div>
                {isLocalDeployment
                  ? '∞ runs'
                  : usageData
                    ? `${planLimits.runs - usageData.runs.used} runs`
                    : `${planLimits.runs} runs`}
              </div>
              <div>remain</div>
            </div>
          </div>

          {/* LLM Calls - circle showing remaining */}
          <div className='flex flex-col items-center gap-1 mt-[6px]'>
            <CircularProgress
              percentage={
                isLocalDeployment
                  ? 100
                  : usageData
                    ? ((planLimits.llm_calls - usageData.llm_calls.used) /
                        planLimits.llm_calls) *
                      100
                    : 100
              }
              size={3}
              strokeWidth={2}
            />
            <div className='text-[9px] text-[#666666] text-center'>
              <div>
                {isLocalDeployment
                  ? '∞ calls'
                  : usageData
                    ? `${planLimits.llm_calls - usageData.llm_calls.used} calls`
                    : `${planLimits.llm_calls} calls`}
              </div>
              <div>remain</div>
            </div>
          </div>
        </div>
      </div>
    );
  } else {
    // Collapsed view

    return (
      <div className='mb-[8px] w-full flex flex-col items-center gap-1'>
        {/* Plan status and Get Pro button */}
        <div className='flex items-center gap-1'>
          <span className='text-[#8B8B8B] text-[9px] font-medium'>
            {isLocalDeployment
              ? 'LOCAL'
              : userSubscriptionStatus.is_premium
                ? 'PRO'
                : 'FREE'}
          </span>
          {shouldShowGetProButton && (
            <button
              onClick={handleGetProClick}
              className='border border-[#404040] hover:border-[#FF6B35] text-[#8B8B8B] hover:text-[#FF6B35] text-[9px] font-medium py-[2px] px-[4px] rounded transition-all duration-200 bg-[#252525] hover:bg-[#FF6B35]/10 flex items-center gap-[2px]'
            >
              <span>Upgrade</span>
              <span className='text-[9px]'>→</span>
            </button>
          )}
        </div>

        {/* Usage info with mini circles - Runs left, LLM right */}
        {isLocalDeployment ? (
          <div className='w-full flex items-center justify-center gap-2'>
            {/* Mini Mock Runs Circle for Local - LEFT */}
            <div className='flex items-center gap-[2px]'>
              <CircularProgress percentage={100} size={3} strokeWidth={3} />
              <span className='text-[8px] text-[#666666]'>∞ left</span>
            </div>

            {/* Mini Mock LLM Circle for Local - RIGHT */}
            <div className='flex items-center gap-[2px]'>
              <CircularProgress percentage={100} size={3} strokeWidth={3} />
              <span className='text-[8px] text-[#666666]'>∞ left</span>
            </div>
          </div>
        ) : usageData ? (
          <div className='w-full flex items-center justify-center gap-2'>
            {/* Mini Runs Circle - LEFT */}
            <div className='flex items-center gap-[2px]'>
              <CircularProgress
                percentage={
                  ((planLimits.runs - usageData.runs.used) / planLimits.runs) *
                  100
                }
                size={3}
                strokeWidth={3}
              />
              <span className='text-[8px] text-[#666666]'>
                {planLimits.runs - usageData.runs.used} left
              </span>
            </div>

            {/* Mini LLM Circle - RIGHT */}
            <div className='flex items-center gap-[2px]'>
              <CircularProgress
                percentage={
                  ((planLimits.llm_calls - usageData.llm_calls.used) /
                    planLimits.llm_calls) *
                  100
                }
                size={3}
                strokeWidth={3}
              />
              <span className='text-[8px] text-[#666666]'>
                {planLimits.llm_calls - usageData.llm_calls.used} left
              </span>
            </div>
          </div>
        ) : (
          <div className='text-[7px] text-[#666666] text-center'>
            {planLimits.runs}•{planLimits.llm_calls}
          </div>
        )}

      </div>
    );
  }
};

export default UsageDisplay;

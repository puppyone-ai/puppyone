import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useAppSettings } from '../states/AppSettingsContext';
import { useWorkspaces } from '../states/UserWorkspacesContext';
import { useAllDeployedServices } from '../states/UserServersContext';

type UsageDisplayProps = {
  isExpanded: boolean;
};

const UsageDisplay: React.FC<UsageDisplayProps> = ({ isExpanded }) => {
  const { userSubscriptionStatus, usageData, planLimits, isLoadingUsage, isLocalDeployment } = useAppSettings();
  const { workspaces } = useWorkspaces();
  const { apis, chatbots } = useAllDeployedServices();

  // Show Get Pro button for FREE users OR local deployment users
  const shouldShowGetProButton =
    userSubscriptionStatus && !userSubscriptionStatus.is_premium;

  // Handle Get Pro button click
  const handleGetProClick = () => {
    window.open('https://www.puppyagent.com/pricing', '_blank');
  };

  // Handle Learn more click
  const handleLearnMoreClick = () => {
    window.open('https://www.puppyagent.com/pricing', '_blank');
  };

  // Derived usage numbers for banner
  const totalRuns =
    usageData && Number.isFinite((usageData.runs.total as any))
      ? usageData.runs.total
      : Number.isFinite((planLimits as any).runs as any)
      ? (planLimits as any).runs
      : undefined;

  const remainingRuns = usageData
    ? Math.max(usageData.runs.remaining, 0)
    : Number.isFinite((planLimits as any).runs as any)
    ? (planLimits as any).runs
    : 0;

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
      <div className='my-[5px] p-[8px] pb-[6px] w-full border border-[#404040] rounded-[8px] bg-[#252525]'>
        {/* Banner with two-row layout */}
        <div className='flex flex-col items-start gap-2 mb-2'>
          <div className='text-[#E5E5E5] text-[12px]'>
            {isLocalDeployment
              ? 'You are running locally. Unlimited runs.'
              : `You have ${remainingRuns}${Number.isFinite((totalRuns as any)) ? ` of ${totalRuns}` : ''} ${userSubscriptionStatus?.is_premium ? 'Runs' : 'free Runs'} remaining with your ${userSubscriptionStatus?.is_premium ? 'Pro' : 'Free'} plan.`}
          </div>
          
        </div>

        {/* Divider line */}
        <div className='w-full h-[1px] bg-[#404040] my-1.5'></div>

        {/* Lower section: plan label and CTA (space-between) */}
        <div className='w-full flex items-center justify-between gap-3 py-1'>
          <span className='text-[12px] text-[#8B8B8B] font-medium'>
            {userSubscriptionStatus.is_premium ? 'PRO' : 'FREE'}
          </span>
          {shouldShowGetProButton && (
            <button
              onClick={handleGetProClick}
              className='border border-[#404040] bg-[#2B2B2B] text-[#CDCDCD] text-[11px] font-medium py-[6px] px-[10px] rounded-md hover:border-[#FFA73D] hover:bg-[#FFA73D] hover:text-[#111111] transition-all duration-200 inline-flex items-center gap-1'
            >
              <span>Unlock unlimited</span>
              <ArrowUpRight size={12} />
            </button>
          )}
        </div>
      </div>
    );
  } else {
    // Collapsed view

    return (
      <div className='mb-[8px] w-full flex flex-col items-center gap-1'>
        {/* Plan label */}
        <div className='text-[#8B8B8B] text-[12px] font-medium'>
          {userSubscriptionStatus.is_premium ? 'PRO' : 'FREE'}
        </div>

        {/* Upgrade button under plan */}
        {shouldShowGetProButton && (
          <button
            onClick={handleGetProClick}
            title='Upgrade'
            aria-label='Upgrade'
            className='border border-[#404040] hover:border-[#FFA73D] text-[#8B8B8B] hover:text-[#FFA73D] p-[2px] rounded transition-all duration-200 bg-[#252525] hover:bg-[#FFA73D]/10 flex items-center justify-center'
          >
            <ArrowUpRight size={12} />
          </button>
        )}

        {/* Usage: use expanded-style small circle (Runs only) */}
        <div className='w-full flex flex-col items-center justify-center gap-2 mt-[12px]'>
          <div className='flex flex-col items-center gap-1'>
            <CircularProgress
              percentage={
                usageData && Number.isFinite((planLimits as any).runs as any)
                  ? ((planLimits.runs - usageData.runs.used) / planLimits.runs) * 100
                  : 100
              }
              size={3}
              strokeWidth={2}
            />
            <div className='text-[9px] text-[#666666] text-center'>
              {usageData && Number.isFinite((planLimits as any).runs as any)
                ? `${Math.max(planLimits.runs - usageData.runs.used, 0)} runs`
                : Number.isFinite((planLimits as any).runs as any)
                ? `${planLimits.runs} runs`
                : `∞ runs`}
            </div>
          </div>
        </div>
      </div>
    );
  }
};

export default UsageDisplay;

import { useState, useEffect } from 'react';
import { SYSTEM_URLS } from '@/config/urls';
import Cookies from 'js-cookie';

// 定义用户订阅状态类型
export type UserSubscriptionStatus = {
  is_premium: boolean;
  subscription_plan: 'free' | 'premium';
  subscription_status: 'active' | 'canceled' | 'expired';
  subscription_period_start: string;
  subscription_period_end: string;
  effective_end_date: string;
  days_left: number;
  expired_date: string; // legacy字段，用于兼容性
  polar_subscription_id?: string;
};

export const useUserSubscription = (isLocalDeployment: boolean) => {
  const [userSubscriptionStatus, setUserSubscriptionStatus] = useState<UserSubscriptionStatus | null>(null);
  const [isLoadingSubscriptionStatus, setIsLoadingSubscriptionStatus] = useState<boolean>(false);

  // 获取认证 token
  const getToken = (): string | undefined => {
    if (isLocalDeployment) {
      return 'local-token'; // 本地部署不需要真实 token
    }
    return Cookies.get('access_token');
  };

  // 获取用户订阅状态
  const fetchUserSubscriptionStatus = async (): Promise<void> => {
    if (isLocalDeployment) {
      // 本地部署模式，设置默认的订阅状态，用量为99999
      setUserSubscriptionStatus({
        is_premium: true, // 本地部署默认为premium
        subscription_plan: 'premium',
        subscription_status: 'active',
        subscription_period_start: new Date().toISOString(),
        subscription_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 一年后
        effective_end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        days_left: 99999, // 本地部署设置为99999天
        expired_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      return;
    }

    // 云端部署模式
    setIsLoadingSubscriptionStatus(true);
    
    try {
      const userAccessToken = getToken();
      if (!userAccessToken) {
        throw new Error('No user access token found');
      }

      const UserSystem_Backend_Base_Url = SYSTEM_URLS.USER_SYSTEM.BACKEND;
      const response = await fetch(`${UserSystem_Backend_Base_Url}/user_subscription_status`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userAccessToken}`
        }
      });

      if (response.status !== 200) {
        const error_data: { error: string } = await response.json();
        throw new Error(`HTTP error! status: ${response.status}, error message: ${error_data.error}`);
      }

      const subscriptionData: UserSubscriptionStatus = await response.json();
      console.log('用户订阅状态:', subscriptionData);
      
      setUserSubscriptionStatus(subscriptionData);
    } catch (error) {
      console.error('Error fetching user subscription status:', error);
      
      // 云端部署失败时，设置默认的免费状态
      setUserSubscriptionStatus({
        is_premium: false,
        subscription_plan: 'free',
        subscription_status: 'expired',
        subscription_period_start: '',
        subscription_period_end: '',
        effective_end_date: '',
        days_left: 0,
        expired_date: '',
      });
    } finally {
      setIsLoadingSubscriptionStatus(false);
    }
  };

  // 自动获取订阅状态
  useEffect(() => {
    fetchUserSubscriptionStatus();
  }, [isLocalDeployment]);

  return {
    userSubscriptionStatus,
    isLoadingSubscriptionStatus,
    fetchUserSubscriptionStatus,
  };
}; 
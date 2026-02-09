/**
 * Profile API Client
 * 
 * 处理用户 Profile 和 Onboarding 相关的 API 调用
 */

import { apiRequest } from './apiClient';

// ============================================
// Types
// ============================================

export interface ProfileResponse {
  user_id: string;
  email: string;
  role: string;
  plan: string;
  has_onboarded: boolean;
  onboarded_at: string | null;
  demo_project_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface OnboardingStatusResponse {
  has_onboarded: boolean;
  demo_project_id: number | null;
  redirect_to: string;
  is_new_user: boolean;
}

export interface ResetOnboardingResponse {
  success: boolean;
  message: string;
}

// ============================================
// API Functions
// ============================================

/**
 * 获取当前用户 Profile
 */
export async function getProfile(): Promise<ProfileResponse> {
  return apiRequest<ProfileResponse>('/api/v1/profile/me');
}

/**
 * 检查 Onboarding 状态
 * 
 * 前端登录成功后应该调用此接口，根据返回结果决定跳转目标
 */
export async function checkOnboardingStatus(): Promise<OnboardingStatusResponse> {
  return apiRequest<OnboardingStatusResponse>('/api/v1/profile/onboarding/status');
}

/**
 * 完成 Onboarding
 * 
 * 此接口会：
 * 1. 如果用户未 onboarded，创建 Demo Project
 * 2. 标记用户为已 onboarded
 * 3. 返回重定向路径（带 ?welcome=true 用于显示欢迎弹窗）
 */
export async function completeOnboarding(
  demoProjectId?: number
): Promise<OnboardingStatusResponse> {
  return apiRequest<OnboardingStatusResponse>('/api/v1/profile/onboarding/complete', {
    method: 'POST',
    body: JSON.stringify({ demo_project_id: demoProjectId }),
  });
}

/**
 * 重置 Onboarding 状态（用于测试）
 */
export async function resetOnboarding(): Promise<ResetOnboardingResponse> {
  return apiRequest<ResetOnboardingResponse>('/api/v1/profile/onboarding/reset', {
    method: 'POST',
  });
}




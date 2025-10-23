/**
 * Vitest 全局测试配置
 *
 * ⚠️ 需要根据实际项目调整：
 * - Mock 的全局配置
 * - 测试环境变量
 * - 全局工具函数
 */

import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// 每个测试后清理
afterEach(() => {
  cleanup();
});

// 全局 Mock：React Flow
// ⚠️ 已移除全局 @xyflow/react mock，让各测试文件根据需要自行 mock
// 这样可以避免 mockReturnValue 冲突问题

// 全局 Mock：Next.js dynamic imports
vi.mock('next/dynamic', () => ({
  default: (fn: any, options?: any) => {
    const Component = fn();
    return Component;
  },
}));

// 全局 Mock：console 方法（可选，减少测试输出噪音）
global.console = {
  ...console,
  log: vi.fn(), // 屏蔽 console.log
  debug: vi.fn(), // 屏蔽 console.debug
  // 保留重要的输出
  warn: console.warn,
  error: console.error,
};

// Mock IntersectionObserver（某些组件可能需要）
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver（React Flow 可能需要）
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;

// Mock requestAnimationFrame（用于性能测试）
global.requestAnimationFrame = (cb: any) => {
  return setTimeout(cb, 0) as any;
};

global.cancelAnimationFrame = (id: any) => {
  clearTimeout(id);
};

// 环境变量（⚠️ 根据实际项目调整）
// process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000/api';
// process.env.NODE_ENV = 'test';

import { useCallback, useEffect, useRef } from 'react';

/**
 * 节流 Hook，用于限制函数的执行频率
 * @param callback 要节流的函数
 * @param delay 节流延迟时间（毫秒）
 * @returns 节流后的函数
 */
const useThrottle = (callback: Function, delay: number) => {
  const lastRun = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  return useCallback((...args: any[]) => {
    const now = Date.now();

    if (now - lastRun.current >= delay) {
      callback(...args);
      lastRun.current = now;
    } else {
      // 清除之前的定时器
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      // 设置新的定时器
      timeoutRef.current = setTimeout(() => {
        callback(...args);
        lastRun.current = Date.now();
      }, delay - (now - lastRun.current));
    }
  }, [callback, delay]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
};

export default useThrottle; 
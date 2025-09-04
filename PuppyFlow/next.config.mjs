// Boot-time log: show deployment mode and env injection status
const rawMode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
const deploymentType = rawMode === 'cloud' ? 'Cloud' : 'Local';

const safeEnvSummary = {
  DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE || '(not set)',
  NODE_ENV: process.env.NODE_ENV || '(not set)',
  // Server-side only envs (presence only)
  USER_SYSTEM_FRONTEND_URL: process.env.USER_SYSTEM_FRONTEND_URL ? 'SET' : 'NOT_SET',
  USER_SYSTEM_BACKEND: process.env.USER_SYSTEM_BACKEND ? 'SET' : 'NOT_SET',
  PUPPYENGINE_URL: process.env.PUPPYENGINE_URL ? 'SET' : 'NOT_SET',
  PUPPYSTORAGE_URL: process.env.PUPPYSTORAGE_URL ? 'SET' : 'NOT_SET',
  API_SERVER_URL: process.env.API_SERVER_URL ? 'SET' : 'NOT_SET',
  SERVICE_KEY: process.env.SERVICE_KEY ? 'CONFIGURED' : 'NOT_SET',
  ALLOW_VERIFY_WITHOUT_SERVICE_KEY:
    (process.env.ALLOW_VERIFY_WITHOUT_SERVICE_KEY || '').toLowerCase() === 'true',
  // Client-exposed envs (values are safe to print)
  NEXT_PUBLIC_FRONTEND_VERSION: process.env.NEXT_PUBLIC_FRONTEND_VERSION || '(not set)',
  NEXT_PUBLIC_OLLAMA_ENDPOINT: process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT || '(not set)'
};

console.log(`🐶 [PuppyFlow] Frontend boot: ${deploymentType} mode`);
console.log('[PuppyFlow] Env check (safe):', safeEnvSummary);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 统一把服务端 DEPLOYMENT_MODE 注入到客户端公开变量
  env: {
    NEXT_PUBLIC_DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE,
    // 将用户系统前端地址在构建期注入到客户端，避免客户端回退到 localhost:3000
    NEXT_PUBLIC_USER_SYSTEM_FRONTEND_URL: process.env.USER_SYSTEM_FRONTEND_URL,
  },
  // 你的其他配置保持不变
};

export default nextConfig;

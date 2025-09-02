// 🔒 安全修复：移除客户端直接访问后端服务的URL配置
// 所有后端通信现在通过安全的API代理进行：/api/server, /api/engine, /api/storage, /api/user-system

export const SYSTEM_URLS = {
  USER_SYSTEM: {
    // Prefer runtime server env on the server; fall back to client-exposed public env
    // Client bundle will only have NEXT_PUBLIC_* available
    FRONTEND:
      process.env.USER_SYSTEM_FRONTEND_URL ||
      (process.env.NEXT_PUBLIC_USER_SYSTEM_FRONTEND_URL as string) ||
      'http://localhost:3000',
  },
  // Client code must use same-origin API proxies; direct bases removed
  PUPPY_ENGINE: { BASE: '' },
  PUPPY_STORAGE: { BASE: '' },
  API_SERVER: { BASE: '' },
};
